//! libp2p mesh network for Soviet messenger
//! Phase 1: mDNS (local) + Kademlia DHT (internet) + request-response (messages)
//! Phase 2 (TODO): relay/DCUtR NAT hole-punching, GossipSub for store-and-forward

use libp2p::{
    identify,
    identity,
    kad::{self, store::MemoryStore},
    mdns,
    noise,
    ping,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux,
    Multiaddr, PeerId, StreamProtocol,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::network::LanPacket;

const MSG_PROTO: &str = "/soviet/msg/1.0.0";
const KAD_PROTO: &str = "/soviet/kad/1.0.0";
const ID_PROTO: &str = "/soviet/id/1.0.0";

/// Public libp2p bootstrap nodes for initial DHT connectivity.
/// NOTE: For Soviet-specific peer routing, operators should run their own
/// Soviet bootstrap nodes. IPFS nodes are used here only for initial NAT
/// traversal / connectivity bootstrap — they won't route Soviet app peers.
const BOOTSTRAP_ADDRS: &[&str] = &[
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb",
    "/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt",
];

// ─── Public types ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct P2pPeer {
    pub peer_id: String,        // PeerId as string
    pub soviet_pk: Option<String>, // Base58 Ed25519, if known
    pub addrs: Vec<String>,
}

pub enum P2pCmd {
    SendMessage { peer_id: PeerId, data: Vec<u8> },
    FindPeer    { peer_id: PeerId },
    AddPeer     { peer_id: PeerId, addr: Multiaddr },
    Bootstrap,
}

pub struct P2pHandle {
    pub peer_id: PeerId,
    pub cmd_tx:  mpsc::Sender<P2pCmd>,
    peers: Arc<Mutex<HashMap<PeerId, P2pPeer>>>,
}

impl P2pHandle {
    pub fn get_peers(&self) -> Vec<P2pPeer> {
        self.peers.lock().unwrap().values().cloned().collect()
    }

    /// Derive libp2p PeerId from a Soviet Ed25519 public key and check if online.
    pub fn is_peer_online(&self, soviet_pk: &str) -> Option<PeerId> {
        let pid = peer_id_from_soviet_pk(soviet_pk)?;
        if self.peers.lock().unwrap().contains_key(&pid) {
            Some(pid)
        } else {
            None
        }
    }
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

/// Compute a deterministic libp2p PeerId from a Soviet Ed25519 public key (Base58).
/// Because Soviet uses Ed25519 keys, the PeerId is the SHA256 multihash of
/// the encoded public key — same algorithm libp2p uses for Ed25519.
pub fn peer_id_from_soviet_pk(soviet_pk_base58: &str) -> Option<PeerId> {
    let bytes = bs58::decode(soviet_pk_base58).into_vec().ok()?;
    let arr: [u8; 32] = bytes.try_into().ok()?;
    let pub_key = identity::ed25519::PublicKey::try_from_bytes(&arr).ok()?;
    let public  = identity::PublicKey::from(pub_key);
    Some(public.to_peer_id())
}

fn keypair_from_soviet_sk(private_bytes: [u8; 32]) -> anyhow::Result<identity::Keypair> {
    let secret = identity::ed25519::SecretKey::try_from_bytes(private_bytes)?;
    let kp     = identity::ed25519::Keypair::from(secret);
    Ok(identity::Keypair::from(kp))
}

// ─── Behaviour ────────────────────────────────────────────────────────────────

#[derive(NetworkBehaviour)]
struct SovietBehaviour {
    mdns:     mdns::tokio::Behaviour,
    kad:      kad::Behaviour<MemoryStore>,
    identify: identify::Behaviour,
    ping:     ping::Behaviour,
    msg:      request_response::cbor::Behaviour<Vec<u8>, Vec<u8>>,
}

// ─── Entry point ──────────────────────────────────────────────────────────────

pub fn start(
    soviet_private_key: [u8; 32],
    message_tx:   mpsc::UnboundedSender<(String, LanPacket)>,
    app_handle:   tauri::AppHandle,
) -> anyhow::Result<P2pHandle> {
    let keypair = keypair_from_soviet_sk(soviet_private_key)?;
    let peer_id = keypair.public().to_peer_id();
    let peers: Arc<Mutex<HashMap<PeerId, P2pPeer>>> = Arc::new(Mutex::new(HashMap::new()));
    let peers_c = Arc::clone(&peers);
    let (cmd_tx, cmd_rx) = mpsc::channel::<P2pCmd>(64);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(run_loop(keypair, peers_c, cmd_rx, message_tx, app_handle));
    });

    Ok(P2pHandle { peer_id, cmd_tx, peers })
}

// ─── Event loop ───────────────────────────────────────────────────────────────

async fn run_loop(
    keypair:    identity::Keypair,
    peers:      Arc<Mutex<HashMap<PeerId, P2pPeer>>>,
    mut cmd_rx: mpsc::Receiver<P2pCmd>,
    message_tx: mpsc::UnboundedSender<(String, LanPacket)>,
    app_handle: tauri::AppHandle,
) {
    let mut swarm = match build_swarm(keypair) {
        Ok(s)  => s,
        Err(e) => { log::error!("P2P: swarm build failed: {}", e); return; }
    };

    // Listen on all interfaces (random free ports)
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse().unwrap()).ok();
    swarm.listen_on("/ip4/0.0.0.0/udp/0/quic".parse().unwrap()).ok();

    // Kick off DHT bootstrap
    swarm.behaviour_mut().kad.bootstrap().ok();

    loop {
        tokio::select! {
            event = swarm.select_next_some() => {
                on_event(event, &mut swarm, &peers, &message_tx, &app_handle);
            }
            Some(cmd) = cmd_rx.recv() => {
                match cmd {
                    P2pCmd::SendMessage { peer_id, data } => {
                        swarm.behaviour_mut().msg.send_request(&peer_id, data);
                    }
                    P2pCmd::FindPeer { peer_id } => {
                        swarm.behaviour_mut().kad.get_closest_peers(peer_id.to_bytes());
                    }
                    P2pCmd::AddPeer { peer_id, addr } => {
                        swarm.behaviour_mut().kad.add_address(&peer_id, addr);
                    }
                    P2pCmd::Bootstrap => {
                        swarm.behaviour_mut().kad.bootstrap().ok();
                    }
                }
            }
        }
    }
}

fn build_swarm(keypair: identity::Keypair) -> anyhow::Result<libp2p::Swarm<SovietBehaviour>> {
    let swarm = libp2p::SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|key| {
            let pid = key.public().to_peer_id();

            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), pid)
                .map_err(|e| anyhow::anyhow!("{}", e))?;

            let mut kad_cfg = kad::Config::default();
            kad_cfg.set_protocol_names(vec![StreamProtocol::new(KAD_PROTO)]);
            let mut kad = kad::Behaviour::with_config(pid, MemoryStore::new(pid), kad_cfg);

            // Add bootstrap peers so we can find other Soviet nodes on the internet
            for addr_str in BOOTSTRAP_ADDRS {
                if let Ok(addr) = addr_str.parse::<Multiaddr>() {
                    if let Some(bootstrap_id) = extract_peer_id(&addr) {
                        kad.add_address(&bootstrap_id, addr);
                    }
                }
            }

            let identify = identify::Behaviour::new(
                identify::Config::new(ID_PROTO.to_string(), key.public())
            );

            let msg = request_response::cbor::Behaviour::<Vec<u8>, Vec<u8>>::new(
                [(StreamProtocol::new(MSG_PROTO), ProtocolSupport::Full)],
                request_response::Config::default(),
            );

            Ok(SovietBehaviour {
                mdns,
                kad,
                identify,
                ping: ping::Behaviour::default(),
                msg,
            })
        })?
        .build();

    Ok(swarm)
}

fn extract_peer_id(addr: &Multiaddr) -> Option<PeerId> {
    use libp2p::multiaddr::Protocol;
    addr.iter().find_map(|p| {
        if let Protocol::P2p(id) = p { Some(id) } else { None }
    })
}

// ─── Swarm event handler ──────────────────────────────────────────────────────

fn on_event(
    event:      SwarmEvent<SovietBehaviourEvent>,
    swarm:      &mut libp2p::Swarm<SovietBehaviour>,
    peers:      &Arc<Mutex<HashMap<PeerId, P2pPeer>>>,
    message_tx: &mpsc::UnboundedSender<(String, LanPacket)>,
    app_handle: &tauri::AppHandle,
) {
    use tauri::Emitter;

    match event {
        // ── mDNS: local peer found ─────────────────────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Mdns(
            mdns::Event::Discovered(list)
        )) => {
            for (pid, addr) in list {
                log::info!("P2P mDNS: found {} @ {}", pid, addr);
                swarm.behaviour_mut().kad.add_address(&pid, addr.clone());
                {
                    let mut p = peers.lock().unwrap();
                    let entry = p.entry(pid).or_insert_with(|| P2pPeer {
                        peer_id:   pid.to_string(),
                        soviet_pk: None,
                        addrs:     vec![],
                    });
                    entry.addrs.push(addr.to_string());
                }
                app_handle.emit("p2p-peer-found", serde_json::json!({
                    "peer_id": pid.to_string(), "source": "mdns"
                })).ok();
            }
        }

        // ── mDNS: local peer expired ───────────────────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Mdns(
            mdns::Event::Expired(list)
        )) => {
            for (pid, _) in list {
                peers.lock().unwrap().remove(&pid);
                app_handle.emit("p2p-peer-lost", serde_json::json!({
                    "peer_id": pid.to_string()
                })).ok();
            }
        }

        // ── Identify: learn peer's listen addresses ────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Identify(
            identify::Event::Received { peer_id, info, .. }
        )) => {
            for addr in &info.listen_addrs {
                swarm.behaviour_mut().kad.add_address(&peer_id, addr.clone());
            }
            // If this is a Soviet peer (identifies with our protocol), emit event
            if info.protocol_version.starts_with("/soviet/") {
                log::info!("P2P: Soviet peer identified: {}", peer_id);
                app_handle.emit("p2p-peer-found", serde_json::json!({
                    "peer_id": peer_id.to_string(), "source": "identify"
                })).ok();
            }
        }

        // ── Request-response: incoming message ─────────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Msg(
            request_response::Event::Message {
                message: request_response::Message::Request { request, channel, .. },
                ..
            }
        )) => {
            if let Ok(packet) = serde_json::from_slice::<LanPacket>(&request) {
                let sender_pk = packet.payload
                    .get("sender_pk")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                message_tx.send((sender_pk, packet)).ok();
            }
            // Empty ACK response
            swarm.behaviour_mut().msg.send_response(channel, vec![]).ok();
        }

        // ── Connection events ──────────────────────────────────────────────
        SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
            log::debug!("P2P: connected to {}", peer_id);
            let addr = endpoint.get_remote_address().to_string();
            peers.lock().unwrap()
                .entry(peer_id)
                .or_insert_with(|| P2pPeer {
                    peer_id:   peer_id.to_string(),
                    soviet_pk: None,
                    addrs:     vec![],
                })
                .addrs.push(addr);
        }

        SwarmEvent::NewListenAddr { address, .. } => {
            log::info!("P2P: listening on {}", address);
        }

        _ => {}
    }
}
