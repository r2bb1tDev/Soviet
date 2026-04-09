use std::net::{SocketAddr, UdpSocket, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::Duration;
use serde::{Serialize, Deserialize};
use tokio::sync::mpsc;

pub const LAN_PORT: u16 = 7778;
pub const LAN_DISCOVERY_PORT: u16 = 7779;
pub const ANNOUNCE_INTERVAL_SECS: u64 = 30;

/// Пир обнаруженный в локальной сети
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LanPeer {
    pub nickname: String,
    pub public_key: String,
    pub addr: String,
    pub port: u16,
    pub version: u8,
}

/// Пакет UDP broadcast (обнаружение в LAN)
#[derive(Serialize, Deserialize, Debug, Clone)]
struct PresencePacket {
    #[serde(rename = "type")]
    packet_type: String,
    nickname: String,
    public_key: String,
    port: u16,
    version: u8,
}

/// Пакет TCP сообщения между пирами
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LanPacket {
    pub v: u8,
    #[serde(rename = "type")]
    pub packet_type: String,
    pub id: String,
    pub ts: i64,
    pub payload: serde_json::Value,
}

pub struct LanNetwork {
    pub peers: Arc<Mutex<HashMap<String, LanPeer>>>, // pk → peer
    pub my_pk: String,
    pub my_nickname: String,
    pub message_tx: mpsc::UnboundedSender<(String, LanPacket)>, // pk, packet
}

impl LanNetwork {
    pub fn new(
        my_pk: String,
        my_nickname: String,
        message_tx: mpsc::UnboundedSender<(String, LanPacket)>,
    ) -> Self {
        Self {
            peers: Arc::new(Mutex::new(HashMap::new())),
            my_pk,
            my_nickname,
            message_tx,
        }
    }

    /// Запуск LAN: UDP listener + broadcaster + TCP listener
    pub fn start(&self) -> anyhow::Result<()> {
        let peers_udp = Arc::clone(&self.peers);
        let pk = self.my_pk.clone();
        let nick = self.my_nickname.clone();
        let tx = self.message_tx.clone();

        // UDP listener (принимаем broadcast presence пакеты)
        std::thread::spawn(move || {
            if let Ok(socket) = UdpSocket::bind(format!("0.0.0.0:{}", LAN_DISCOVERY_PORT)) {
                socket.set_read_timeout(Some(Duration::from_secs(2))).ok();
                let mut buf = [0u8; 4096];
                loop {
                    if let Ok((n, addr)) = socket.recv_from(&mut buf) {
                        if let Ok(pkt) = serde_json::from_slice::<PresencePacket>(&buf[..n]) {
                            if pkt.public_key != pk && pkt.packet_type == "presence" {
                                let is_new = !peers_udp.lock().unwrap().contains_key(&pkt.public_key);
                                let peer = LanPeer {
                                    nickname: pkt.nickname.clone(),
                                    public_key: pkt.public_key.clone(),
                                    addr: addr.ip().to_string(),
                                    port: pkt.port,
                                    version: pkt.version,
                                };
                                peers_udp.lock().unwrap().insert(pkt.public_key.clone(), peer);
                                // При первом обнаружении пира — шлём ему hello с нашими данными
                                if is_new {
                                    let hello = make_hello_packet(&pk, &nick, "", "online", "");
                                    // Отправляем hello напрямую по TCP
                                    let peer_addr = format!("{}:{}", addr.ip(), pkt.port);
                                    let _ = send_packet_to_addr(&peer_addr, &hello);
                                    // Также уведомляем основной loop чтобы он мог послать hello с аватаркой
                                    let hello_notify = LanPacket {
                                        v: 1,
                                        packet_type: "peer_discovered".to_string(),
                                        id: uuid::Uuid::new_v4().to_string(),
                                        ts: chrono::Utc::now().timestamp(),
                                        payload: serde_json::json!({ "pk": pkt.public_key }),
                                    };
                                    tx.send((pkt.public_key, hello_notify)).ok();
                                }
                            }
                        }
                    }
                }
            }
        });

        // UDP broadcaster (объявляем себя каждые 30 сек)
        let pk_bc = self.my_pk.clone();
        let nick_bc = self.my_nickname.clone();
        std::thread::spawn(move || {
            let presence = PresencePacket {
                packet_type: "presence".to_string(),
                nickname: nick_bc,
                public_key: pk_bc,
                port: LAN_PORT,
                version: 1,
            };
            let data = serde_json::to_vec(&presence).unwrap_or_default();
            loop {
                if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
                    socket.set_broadcast(true).ok();
                    socket.send_to(&data, format!("255.255.255.255:{}", LAN_DISCOVERY_PORT)).ok();
                }
                std::thread::sleep(Duration::from_secs(ANNOUNCE_INTERVAL_SECS));
            }
        });

        // TCP listener (принимаем входящие соединения)
        let tx_tcp = tx;
        std::thread::spawn(move || {
            if let Ok(listener) = TcpListener::bind(format!("0.0.0.0:{}", LAN_PORT)) {
                for stream in listener.incoming().flatten() {
                    let tx2 = tx_tcp.clone();
                    std::thread::spawn(move || {
                        handle_tcp_connection(stream, tx2);
                    });
                }
            }
        });

        Ok(())
    }

    /// Отправить пакет конкретному пиру по TCP
    pub fn send_to_peer(&self, peer_pk: &str, packet: &LanPacket) -> anyhow::Result<()> {
        let peers = self.peers.lock().unwrap();
        let peer = peers.get(peer_pk)
            .ok_or_else(|| anyhow::anyhow!("Peer not found in LAN: {}", peer_pk))?;
        let addr: SocketAddr = format!("{}:{}", peer.addr, peer.port).parse()?;
        drop(peers);

        let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))?;
        let data = serde_json::to_vec(packet)?;
        let len = (data.len() as u32).to_be_bytes();
        stream.write_all(&len)?;
        stream.write_all(&data)?;
        stream.flush()?;
        Ok(())
    }

    /// Список пиров в LAN
    pub fn get_peers(&self) -> Vec<LanPeer> {
        self.peers.lock().unwrap().values().cloned().collect()
    }

    /// Peer online?
    pub fn is_peer_online(&self, pk: &str) -> bool {
        self.peers.lock().unwrap().contains_key(pk)
    }
}

fn handle_tcp_connection(
    mut stream: TcpStream,
    tx: mpsc::UnboundedSender<(String, LanPacket)>,
) {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let mut len_buf = [0u8; 4];
    if stream.read_exact(&mut len_buf).is_err() { return; }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 10 * 1024 * 1024 { return; } // max 10 МБ

    let mut data = vec![0u8; len];
    if stream.read_exact(&mut data).is_err() { return; }

    if let Ok(packet) = serde_json::from_slice::<LanPacket>(&data) {
        // Извлекаем sender_pk из payload
        let sender_pk = packet.payload
            .get("sender_pk")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        tx.send((sender_pk, packet)).ok();
    }
}

/// Отправить пакет напрямую по адресу (без поиска в peers map)
pub fn send_packet_to_addr(addr: &str, packet: &LanPacket) -> anyhow::Result<()> {
    let sock_addr: SocketAddr = addr.parse()?;
    let mut stream = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(3))?;
    let data = serde_json::to_vec(packet)?;
    let len = (data.len() as u32).to_be_bytes();
    stream.write_all(&len)?;
    stream.write_all(&data)?;
    stream.flush()?;
    Ok(())
}

/// Создать LAN пакет-сообщение
pub fn make_message_packet(
    sender_pk: &str,
    encrypted_msg: &crate::crypto::EncryptedMessage,
) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "message".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::to_value(encrypted_msg).unwrap_or(serde_json::Value::Null),
    }
}

/// Пакет handshake (hello)
pub fn make_hello_packet(pk: &str, nickname: &str, avatar: &str, status: &str, status_text: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "hello".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "pk": pk,
            "nickname": nickname,
            "avatar": avatar,
            "status": status,
            "status_text": status_text,
        }),
    }
}

/// Пакет запроса на добавление в контакты
pub fn make_contact_request_packet(sender_pk: &str, nickname: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "contact_request".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({ "sender_pk": sender_pk, "nickname": nickname }),
    }
}

/// Пакет typing indicator
pub fn make_typing_packet(sender_pk: &str, is_typing: bool) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "typing".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({ "sender_pk": sender_pk, "is_typing": is_typing }),
    }
}

/// Пакет группового сообщения (broadcast всем членам)
pub fn make_group_message_packet(sender_pk: &str, group_id: &str, encrypted_content: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "group_message".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "group_id": group_id,
            "content": encrypted_content,
        }),
    }
}

/// Пакет приглашения в группу
pub fn make_group_invite_packet(sender_pk: &str, group_id: &str, group_name: &str, members: &[String]) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "group_invite".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "group_id": group_id,
            "group_name": group_name,
            "members": members,
        }),
    }
}

/// Пакет уведомления о прочтении сообщений в чате
pub fn make_read_receipt_packet(sender_pk: &str, chat_peer_pk: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "read_receipt".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({ "sender_pk": sender_pk, "chat_peer_pk": chat_peer_pk }),
    }
}

/// Пакет реакции на сообщение
pub fn make_reaction_packet(sender_pk: &str, target_sender: &str, target_ts: i64, emoji: &str, action: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "reaction".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "target_sender": target_sender,
            "target_ts": target_ts,
            "emoji": emoji,
            "action": action,
        }),
    }
}

/// Пакет редактирования сообщения
pub fn make_edit_packet(sender_pk: &str, timestamp: i64, new_content: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "edit_message".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "timestamp": timestamp,
            "new_content": new_content,
        }),
    }
}

/// Пакет выхода из группы
pub fn make_member_left_packet(sender_pk: &str, group_id: &str, nickname: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "member_left".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "group_id": group_id,
            "nickname": nickname,
        }),
    }
}

/// Пакет роспуска группы (только создатель)
pub fn make_group_dissolved_packet(sender_pk: &str, group_id: &str) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "group_dissolved".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "group_id": group_id,
        }),
    }
}

/// Пакет удаления сообщения
pub fn make_delete_packet(sender_pk: &str, timestamp: i64) -> LanPacket {
    LanPacket {
        v: 1,
        packet_type: "delete_message".to_string(),
        id: uuid::Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp(),
        payload: serde_json::json!({
            "sender_pk": sender_pk,
            "timestamp": timestamp,
        }),
    }
}
