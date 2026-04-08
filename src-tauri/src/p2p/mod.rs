//! P2P mesh-сеть — полная реализация на libp2p
//!
//! Слои обнаружения пиров:
//!   1. mDNS         — автообнаружение в локальной сети (LAN/WiFi)
//!   2. Kademlia DHT — глобальное обнаружение через IPFS bootstrap-узлы
//!
//! Идентификация: Soviet public key передаётся через поле agent_version протокола Identify.
//! Доставка сообщений: RequestResponse/CBOR (те же зашифрованные LanPacket, что и в LAN-режиме).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use libp2p::{
    identify, kad, mdns, ping, request_response,
    request_response::{cbor, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    Multiaddr, PeerId, StreamProtocol, SwarmBuilder,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::network::LanPacket;

// ─── Bootstrap-узлы IPFS (IP-адреса, без DNS) ────────────────────────────────

const BOOTSTRAP_ADDRS: &[&str] = &[
    "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ",
    "/ip4/104.236.179.241/tcp/4001/p2p/QmSoLPppuBtQSGwKDZT2M73ULpjvfd3aZ6ha4oFGL1KrGM",
    "/ip4/128.199.219.111/tcp/4001/p2p/QmSoLSafTMBsPKadTEgaXctDQVcqN88CNLHXMkTNwMKPnu",
    "/ip4/178.62.158.247/tcp/4001/p2p/QmSoLer265NRgSp2LA3dPaeykiS1J6DifTC88f5uVQKNAd",
    "/ip4/104.236.76.40/tcp/4001/p2p/QmSoLV4Bbm51jM9C4gDYZQ9Cy3U6aXMJDAbzgu2fzaDs9t",
];

/// Префикс в agent_version для передачи Soviet public key через Identify
const AGENT_PREFIX: &str = "soviet/1.0/";

// ─── Протокол RequestResponse ─────────────────────────────────────────────────

/// Зашифрованный пакет сообщения (payload = JSON-сериализованный LanPacket)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SovietRequest {
    pub payload: Vec<u8>,
}

/// Подтверждение доставки
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SovietResponse {
    pub ok: bool,
}

// ─── Составное поведение сети ─────────────────────────────────────────────────

#[derive(NetworkBehaviour)]
struct SovietBehaviour {
    kad:      kad::Behaviour<kad::store::MemoryStore>,
    identify: identify::Behaviour,
    ping:     ping::Behaviour,
    mdns:     mdns::tokio::Behaviour,
    rr:       cbor::Behaviour<SovietRequest, SovietResponse>,
}

// ─── Публичный API модуля ─────────────────────────────────────────────────────

/// Команды для управления P2P-нодой (отправка из AppState)
pub enum P2pCmd {
    /// Отправить зашифрованный пакет конкретному пиру
    SendMessage { peer_id: PeerId, data: Vec<u8> },
}

/// Информация об известном P2P-пире
#[derive(Serialize, Debug, Clone)]
pub struct P2pPeer {
    pub peer_id:  String,
    pub soviet_pk: Option<String>,
    pub addrs:    Vec<String>,
}

/// Дескриптор P2P-слоя, хранящийся в AppState
pub struct P2pHandle {
    pub cmd_tx: mpsc::Sender<P2pCmd>,
    peers:      Arc<Mutex<HashMap<String, P2pPeer>>>, // peer_id_str → P2pPeer
}

impl P2pHandle {
    /// Возвращает PeerId если пир с данным Soviet PK подключён прямо сейчас
    pub fn is_peer_online(&self, soviet_pk: &str) -> Option<PeerId> {
        let guard = self.peers.lock().unwrap();
        for (pid_str, peer) in guard.iter() {
            if peer.soviet_pk.as_deref() == Some(soviet_pk) {
                return pid_str.parse::<PeerId>().ok();
            }
        }
        None
    }

    pub fn get_peers(&self) -> Vec<P2pPeer> {
        self.peers.lock().unwrap().values().cloned().collect()
    }
}

// ─── Запуск P2P-ноды ──────────────────────────────────────────────────────────

/// Создаёт libp2p-ноду на основе Ed25519-ключа пользователя и запускает её
/// в отдельном потоке с собственным tokio runtime.
pub fn start(
    private_key_bytes: [u8; 32],
    lan_tx: mpsc::UnboundedSender<(String, LanPacket)>,
    app: AppHandle,
) -> anyhow::Result<P2pHandle> {
    // 1. Конвертируем Ed25519 private key → libp2p Keypair
    let secret = libp2p::identity::ed25519::SecretKey::try_from_bytes(private_key_bytes)
        .map_err(|e| anyhow::anyhow!("Ed25519 secret key error: {}", e))?;
    let ed_kp = libp2p::identity::ed25519::Keypair::from(secret);
    let keypair = libp2p::identity::Keypair::from(ed_kp);

    // Soviet public key (Base58) для передачи через Identify
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&private_key_bytes);
    let soviet_pk = bs58::encode(signing_key.verifying_key().as_bytes()).into_string();
    let agent_version = format!("{}{}", AGENT_PREFIX, soviet_pk);

    // 2. Канал команд и таблица пиров
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<P2pCmd>(128);
    let peers: Arc<Mutex<HashMap<String, P2pPeer>>> = Arc::new(Mutex::new(HashMap::new()));

    let handle = P2pHandle {
        cmd_tx: cmd_tx.clone(),
        peers: Arc::clone(&peers),
    };

    let peers_bg = Arc::clone(&peers);

    // 3. Запускаем в фоновом потоке (отдельный tokio runtime)
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => { log::error!("P2P runtime failed: {}", e); return; }
        };

        rt.block_on(async move {
            let agent_ver = agent_version.clone();

            let mut swarm = match build_swarm(keypair, &agent_ver) {
                Ok(s) => s,
                Err(e) => { log::error!("P2P swarm build failed: {}", e); return; }
            };

            // Слушаем на случайном порту на всех интерфейсах
            if let Err(e) = swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse().unwrap()) {
                log::error!("P2P listen failed: {}", e);
            }

            // Добавляем IPFS bootstrap-узлы в таблицу маршрутизации Kademlia
            add_bootstrap_peers(&mut swarm);

            // Запускаем bootstrap (находит ближайших соседей в DHT)
            swarm.behaviour_mut().kad.bootstrap().ok();

            log::info!("P2P node started, soviet_pk={}", agent_version.trim_start_matches(AGENT_PREFIX));
            app.emit("p2p-started", soviet_pk.clone()).ok();

            // 4. Основной event loop
            loop {
                tokio::select! {
                    // Обработка событий swarm
                    event = swarm.next() => {
                        match event {
                            Some(e) => handle_swarm_event(
                                e, &mut swarm, &peers_bg, &lan_tx, &app
                            ),
                            None => break,
                        }
                    }
                    // Обработка команд от AppState
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(P2pCmd::SendMessage { peer_id, data }) => {
                                swarm.behaviour_mut().rr.send_request(
                                    &peer_id,
                                    SovietRequest { payload: data },
                                );
                            }
                            None => break,
                        }
                    }
                }
            }
        });
    });

    Ok(handle)
}

// ─── Построение Swarm ─────────────────────────────────────────────────────────

fn build_swarm(
    keypair: libp2p::identity::Keypair,
    agent_version: &str,
) -> anyhow::Result<libp2p::Swarm<SovietBehaviour>> {
    let local_peer_id = PeerId::from(keypair.public());
    let av = agent_version.to_string();

    let swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(
            libp2p::tcp::Config::default().nodelay(true),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )
        .map_err(|e| anyhow::anyhow!("TCP transport error: {}", e))?
        .with_behaviour(|key| {
            // Kademlia DHT (совместим с IPFS-сетью)
            let kad_store = kad::store::MemoryStore::new(local_peer_id);
            let mut kad_cfg = kad::Config::default();
            kad_cfg.set_record_ttl(Some(Duration::from_secs(3600)));
            kad_cfg.set_replication_factor(
                std::num::NonZeroUsize::new(3).unwrap(),
            );
            let mut kad = kad::Behaviour::with_config(
                local_peer_id, kad_store, kad_cfg,
            );
            // Работаем как сервер — помогаем другим узлам маршрутизировать запросы
            kad.set_mode(Some(kad::Mode::Server));

            // Identify — обмен метаданными (включая Soviet PK через agent_version)
            let identify = identify::Behaviour::new(
                identify::Config::new("/soviet/id/1.0.0".to_string(), key.public())
                    .with_agent_version(av.clone())
                    .with_interval(Duration::from_secs(60)),
            );

            // Ping — поддержание соединений
            let ping = ping::Behaviour::new(
                ping::Config::new()
                    .with_interval(Duration::from_secs(30))
                    .with_timeout(Duration::from_secs(10)),
            );

            // mDNS — автообнаружение в локальной сети
            let mdns = mdns::tokio::Behaviour::new(
                mdns::Config::default(),
                local_peer_id,
            ).expect("mDNS init failed");

            // RequestResponse/CBOR — доставка зашифрованных сообщений
            let rr = cbor::Behaviour::<SovietRequest, SovietResponse>::new(
                [(
                    StreamProtocol::new("/soviet/msg/1.0.0"),
                    ProtocolSupport::Full,
                )],
                request_response::Config::default()
                    .with_request_timeout(Duration::from_secs(15)),
            );

            Ok(SovietBehaviour { kad, identify, ping, mdns, rr })
        })
        .map_err(|e| anyhow::anyhow!("Behaviour error: {}", e))?
        .with_swarm_config(|c| {
            c.with_idle_connection_timeout(Duration::from_secs(120))
        })
        .build();

    Ok(swarm)
}

// ─── Bootstrap-узлы ──────────────────────────────────────────────────────────

fn add_bootstrap_peers(swarm: &mut libp2p::Swarm<SovietBehaviour>) {
    for addr_str in BOOTSTRAP_ADDRS {
        if let Ok(addr) = addr_str.parse::<Multiaddr>() {
            // Извлекаем PeerId из последнего компонента /p2p/<PeerId>
            let pid_opt = addr.iter().find_map(|proto| {
                if let libp2p::multiaddr::Protocol::P2p(pid) = proto {
                    Some(pid)
                } else {
                    None
                }
            });
            if let Some(peer_id) = pid_opt {
                // Добавляем без /p2p/ суффикса — Kademlia сам создаст нужный адрес
                let mut transport_addr = addr.clone();
                transport_addr.pop(); // убираем /p2p/...
                swarm.behaviour_mut().kad.add_address(&peer_id, transport_addr);
            }
        }
    }
}

// ─── Обработка событий ───────────────────────────────────────────────────────

fn handle_swarm_event(
    event: SwarmEvent<SovietBehaviourEvent>,
    swarm: &mut libp2p::Swarm<SovietBehaviour>,
    peers: &Arc<Mutex<HashMap<String, P2pPeer>>>,
    lan_tx: &mpsc::UnboundedSender<(String, LanPacket)>,
    app: &AppHandle,
) {
    match event {
        // ── Сетевые события ──────────────────────────────────────────────────
        SwarmEvent::NewListenAddr { address, .. } => {
            log::info!("P2P: listening on {}", address);
            app.emit("p2p-listen-addr", address.to_string()).ok();
        }

        SwarmEvent::ConnectionEstablished { peer_id, endpoint, .. } => {
            log::info!("P2P: connected to {}", peer_id);
            let addr = endpoint.get_remote_address().to_string();
            let mut guard = peers.lock().unwrap();
            let peer = guard.entry(peer_id.to_string()).or_insert_with(|| P2pPeer {
                peer_id: peer_id.to_string(),
                soviet_pk: None,
                addrs: vec![],
            });
            if !peer.addrs.contains(&addr) {
                peer.addrs.push(addr);
            }
        }

        SwarmEvent::ConnectionClosed { peer_id, .. } => {
            log::info!("P2P: disconnected from {}", peer_id);
            let removed = peers.lock().unwrap().remove(&peer_id.to_string());
            if let Some(p) = removed {
                if let Some(pk) = p.soviet_pk {
                    app.emit("p2p-peer-offline", serde_json::json!({
                        "peer_id": peer_id.to_string(),
                        "soviet_pk": pk,
                    })).ok();
                }
            }
        }

        SwarmEvent::OutgoingConnectionError { peer_id, error, .. } => {
            if let Some(pid) = peer_id {
                log::debug!("P2P: dial error to {}: {}", pid, error);
            }
        }

        // ── Identify: обмен метаданными (получаем Soviet PK пира) ────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Identify(
            identify::Event::Received { peer_id, info },
        )) => {
            // Извлекаем Soviet PK из agent_version: "soviet/1.0/BASE58KEY"
            let soviet_pk_opt = info.agent_version
                .strip_prefix(AGENT_PREFIX)
                .filter(|s| !s.is_empty() && s.len() > 10)
                .map(|s| s.to_string());

            // Добавляем адреса пира в Kademlia для маршрутизации
            for addr in &info.listen_addrs {
                swarm.behaviour_mut().kad.add_address(&peer_id, addr.clone());
            }

            let mut guard = peers.lock().unwrap();
            let peer = guard.entry(peer_id.to_string()).or_insert_with(|| P2pPeer {
                peer_id: peer_id.to_string(),
                soviet_pk: None,
                addrs: vec![],
            });
            peer.addrs = info.listen_addrs.iter().map(|a| a.to_string()).collect();

            if let Some(pk) = soviet_pk_opt {
                if peer.soviet_pk.as_deref() != Some(&pk) {
                    peer.soviet_pk = Some(pk.clone());
                    drop(guard);
                    log::info!("P2P: identified peer {} → soviet_pk={}", peer_id, pk);
                    app.emit("p2p-peer-online", serde_json::json!({
                        "peer_id": peer_id.to_string(),
                        "soviet_pk": pk,
                    })).ok();
                }
            }
        }

        SwarmEvent::Behaviour(SovietBehaviourEvent::Identify(
            identify::Event::Sent { peer_id },
        )) => {
            log::debug!("P2P: sent Identify to {}", peer_id);
        }

        // ── mDNS: обнаружение пиров в локальной сети ─────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Mdns(
            mdns::Event::Discovered(list),
        )) => {
            for (peer_id, addr) in list {
                log::info!("P2P/mDNS: discovered {} at {}", peer_id, addr);
                swarm.behaviour_mut().kad.add_address(&peer_id, addr);
                if !swarm.is_connected(&peer_id) {
                    swarm.dial(peer_id).ok();
                }
            }
        }

        SwarmEvent::Behaviour(SovietBehaviourEvent::Mdns(
            mdns::Event::Expired(list),
        )) => {
            for (peer_id, _) in list {
                if !swarm.is_connected(&peer_id) {
                    peers.lock().unwrap().remove(&peer_id.to_string());
                }
            }
        }

        // ── Kademlia: результаты DHT-запросов ────────────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Kad(
            kad::Event::OutboundQueryProgressed { result, .. },
        )) => {
            if let kad::QueryResult::Bootstrap(Ok(kad::BootstrapOk { num_remaining, .. })) = result {
                if num_remaining == 0 {
                    log::info!("P2P: Kademlia bootstrap complete");
                    app.emit("p2p-bootstrap-done", true).ok();
                }
            }
        }

        SwarmEvent::Behaviour(SovietBehaviourEvent::Kad(
            kad::Event::RoutingUpdated { peer, .. },
        )) => {
            log::debug!("P2P: Kademlia routing updated, added {}", peer);
        }

        // ── RequestResponse: входящие / исходящие сообщения ──────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Rr(
            request_response::Event::Message { peer, message },
        )) => {
            match message {
                request_response::Message::Request { request, channel, .. } => {
                    // Входящее сообщение — декодируем LanPacket и пробрасываем в общий обработчик
                    match serde_json::from_slice::<LanPacket>(&request.payload) {
                        Ok(packet) => {
                            let sender_pk = {
                                let guard = peers.lock().unwrap();
                                guard.get(&peer.to_string())
                                    .and_then(|p| p.soviet_pk.clone())
                                    .unwrap_or_default()
                            };
                            log::debug!("P2P: message from {}", sender_pk);
                            lan_tx.send((sender_pk, packet)).ok();
                        }
                        Err(e) => log::warn!("P2P: invalid payload from {}: {}", peer, e),
                    }
                    // Подтверждаем получение
                    swarm.behaviour_mut().rr.send_response(
                        channel,
                        SovietResponse { ok: true },
                    ).ok();
                }
                request_response::Message::Response { .. } => {
                    // Исходящее сообщение доставлено
                    log::debug!("P2P: delivery confirmed by {}", peer);
                }
            }
        }

        SwarmEvent::Behaviour(SovietBehaviourEvent::Rr(
            request_response::Event::OutboundFailure { peer, error, .. },
        )) => {
            log::warn!("P2P: send failed to {}: {}", peer, error);
        }

        SwarmEvent::Behaviour(SovietBehaviourEvent::Rr(
            request_response::Event::InboundFailure { peer, error, .. },
        )) => {
            log::warn!("P2P: inbound failure from {}: {}", peer, error);
        }

        // ── Ping ──────────────────────────────────────────────────────────────
        SwarmEvent::Behaviour(SovietBehaviourEvent::Ping(ping::Event {
            peer,
            result: Err(e),
            ..
        })) => {
            log::debug!("P2P: ping failed to {}: {}", peer, e);
        }

        _ => {}
    }
}
