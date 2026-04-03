//! Nostr protocol client — channels (kinds 40, 41, 42) + Soviet DMs (kind 4444)
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::{mpsc, oneshot};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Sha256, Digest};
use secp256k1::{Secp256k1, SecretKey, Keypair, XOnlyPublicKey, Message as SecpMessage};
use rand::RngCore;
use rand::rngs::OsRng;

pub const DEFAULT_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NostrEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

pub enum NostrCmd {
    CreateChannel {
        name: String,
        about: String,
        reply_tx: oneshot::Sender<Result<String, String>>,
    },
    UpdateChannelMeta {
        channel_id: String,
        name: String,
        about: String,
        picture: String,
    },
    SendMessage {
        channel_id: String,
        relay: String,
        content: String,
        reply_to: Option<String>,
    },
    JoinChannel {
        channel_id: String,
    },
    LeaveChannel {
        channel_id: String,
    },
    DeleteChannel {
        channel_id: String,
    },
    /// Отправить зашифрованное личное сообщение через Nostr relay (internet fallback)
    /// Kind 4444 — содержит Soviet EncryptedMessage JSON, E2E шифрование Soviet крипто
    SendDm {
        recipient_soviet_pk: String, // Base58 Ed25519
        encrypted_json: String,      // Soviet EncryptedMessage JSON
    },
    /// Подписаться на входящие DM (вызывается при смене/создании identity)
    SubscribeDms {
        my_soviet_pk: String, // Base58 Ed25519
    },
}

pub struct NostrHandle {
    pub pubkey_hex: String,
    pub cmd_tx: mpsc::Sender<NostrCmd>,
}

pub fn generate_keys() -> (String, String) {
    let mut secret = [0u8; 32];
    OsRng.fill_bytes(&mut secret);
    let secp = Secp256k1::signing_only();
    let sk = SecretKey::from_slice(&secret).unwrap();
    let kp = Keypair::from_secret_key(&secp, &sk);
    let (xonly, _) = XOnlyPublicKey::from_keypair(&kp);
    (hex::encode(secret), hex::encode(xonly.serialize()))
}

pub fn pubkey_from_secret(secret_hex: &str) -> Option<String> {
    let secret = hex::decode(secret_hex).ok()?;
    if secret.len() != 32 { return None; }
    let secp = Secp256k1::signing_only();
    let sk = SecretKey::from_slice(&secret).ok()?;
    let kp = Keypair::from_secret_key(&secp, &sk);
    let (xonly, _) = XOnlyPublicKey::from_keypair(&kp);
    Some(hex::encode(xonly.serialize()))
}

fn sign_event(event: &mut NostrEvent, secret_hex: &str) {
    let serialized = json!([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content
    ]).to_string();
    let hash = Sha256::digest(serialized.as_bytes());
    event.id = hex::encode(hash);

    let secret = hex::decode(secret_hex).unwrap();
    let secp = Secp256k1::signing_only();
    let sk = SecretKey::from_slice(&secret).unwrap();
    let kp = Keypair::from_secret_key(&secp, &sk);
    let id_bytes: [u8; 32] = hex::decode(&event.id).unwrap().try_into().unwrap();
    let msg = SecpMessage::from_digest_slice(&id_bytes).unwrap();
    let sig = secp.sign_schnorr_no_aux_rand(&msg, &kp);
    event.sig = hex::encode(sig.as_ref());
}

fn build_event(kind: u32, tags: Vec<Vec<String>>, content: String, pubkey_hex: &str, secret_hex: &str) -> NostrEvent {
    let mut event = NostrEvent {
        id: String::new(),
        pubkey: pubkey_hex.to_string(),
        created_at: chrono::Utc::now().timestamp(),
        kind,
        tags,
        content,
        sig: String::new(),
    };
    sign_event(&mut event, secret_hex);
    event
}

pub fn start(
    secret_hex: String,
    pubkey_hex: String,
    my_soviet_pk: String,
    initial_channel_ids: Vec<String>,
    app_handle: tauri::AppHandle,
    db: Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> NostrHandle {
    let (cmd_tx, cmd_rx) = mpsc::channel::<NostrCmd>(64);
    let pubkey_hex_ret = pubkey_hex.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(relay_loop(
            secret_hex,
            pubkey_hex,
            my_soviet_pk,
            initial_channel_ids,
            cmd_rx,
            app_handle,
            db,
        ));
    });

    NostrHandle { pubkey_hex: pubkey_hex_ret, cmd_tx }
}

async fn relay_loop(
    secret_hex: String,
    pubkey_hex: String,
    my_soviet_pk: String,
    initial_channel_ids: Vec<String>,
    mut cmd_rx: mpsc::Receiver<NostrCmd>,
    app_handle: tauri::AppHandle,
    db: Arc<std::sync::Mutex<rusqlite::Connection>>,
) {
    // Hex-encoded Soviet pubkey for DM subscription filter tag
    let my_soviet_pk_hex = soviet_pk_to_hex(&my_soviet_pk);

    // Connect to relays
    let mut relay_senders: Vec<mpsc::UnboundedSender<String>> = Vec::new();

    for &url in DEFAULT_RELAYS {
        match connect_async(url).await {
            Ok((ws, _)) => {
                let (mut write, mut read) = ws.split();
                let (wtx, mut wrx) = mpsc::unbounded_channel::<String>();
                relay_senders.push(wtx);

                // writer task
                tokio::spawn(async move {
                    while let Some(m) = wrx.recv().await {
                        if write.send(WsMessage::Text(m)).await.is_err() { break; }
                    }
                });

                // reader task
                let app2 = app_handle.clone();
                let db2 = db.clone();
                let my_pk = pubkey_hex.clone();
                let soviet_pk_hex = my_soviet_pk_hex.clone();
                tokio::spawn(async move {
                    while let Some(Ok(WsMessage::Text(text))) = read.next().await {
                        on_relay_msg(&text, &app2, &db2, &my_pk, &soviet_pk_hex).await;
                    }
                });

                log::info!("Nostr: connected to {}", url);
            }
            Err(e) => log::warn!("Nostr: relay {} error: {}", url, e),
        }
    }

    // Subscribe to initial channels
    if !initial_channel_ids.is_empty() {
        let sub = sub_msg(&initial_channel_ids);
        broadcast(&relay_senders, &sub);
    }

    // Subscribe to incoming Soviet DMs (Kind 4444 tagged with our Soviet pubkey)
    if !my_soviet_pk_hex.is_empty() {
        let dm_sub = json!(["REQ", "soviet-dms",
            {"kinds": [4444], "#p": [my_soviet_pk_hex.clone()], "limit": 500}
        ]).to_string();
        broadcast(&relay_senders, &dm_sub);
        log::info!("Nostr: subscribed to DMs for Soviet pk {:.16}…", my_soviet_pk_hex);
    }

    // Command loop
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            NostrCmd::CreateChannel { name, about, reply_tx } => {
                let meta = json!({"name": name, "about": about, "picture": ""}).to_string();
                let ev = build_event(40, vec![], meta, &pubkey_hex, &secret_hex);
                let channel_id = ev.id.clone();
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
                let _ = reply_tx.send(Ok(channel_id));
            }

            NostrCmd::SendMessage { channel_id, relay, content, reply_to } => {
                let mut tags = vec![
                    vec!["e".to_string(), channel_id.clone(), relay.clone(), "root".to_string()],
                ];
                if let Some(rid) = reply_to {
                    tags.push(vec!["e".to_string(), rid, relay, "reply".to_string()]);
                }
                let ev = build_event(42, tags, content, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            NostrCmd::JoinChannel { channel_id } => {
                let sub = json!(["REQ", format!("ch-{}", &channel_id[..8]),
                    {"kinds": [42, 41], "#e": [channel_id.clone()], "limit": 100}
                ]).to_string();
                broadcast(&relay_senders, &sub);
                // Also fetch channel info (kind 40)
                let sub2 = json!(["REQ", format!("ci-{}", &channel_id[..8]),
                    {"kinds": [40], "ids": [channel_id], "limit": 1}
                ]).to_string();
                broadcast(&relay_senders, &sub2);
            }

            NostrCmd::UpdateChannelMeta { channel_id, name, about, picture } => {
                let meta = json!({"name": name, "about": about, "picture": picture}).to_string();
                let tags = vec![vec!["e".to_string(), channel_id]];
                let ev = build_event(41, tags, meta, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            NostrCmd::LeaveChannel { channel_id } => {
                let close = json!(["CLOSE", format!("ch-{}", &channel_id[..8.min(channel_id.len())])]).to_string();
                broadcast(&relay_senders, &close);
            }

            NostrCmd::DeleteChannel { channel_id } => {
                let tags = vec![vec!["e".to_string(), channel_id.clone()]];
                let ev = build_event(5, tags, "channel deleted".to_string(), &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
                let close = json!(["CLOSE", format!("ch-{}", &channel_id[..8.min(channel_id.len())])]).to_string();
                broadcast(&relay_senders, &close);
            }

            // ── Internet DM fallback ──────────────────────────────────────────
            NostrCmd::SendDm { recipient_soviet_pk, encrypted_json } => {
                let recipient_hex = soviet_pk_to_hex(&recipient_soviet_pk);
                if recipient_hex.is_empty() {
                    log::warn!("Nostr DM: invalid recipient pk");
                    continue;
                }
                let tags = vec![
                    vec!["p".to_string(), recipient_hex],
                    vec!["t".to_string(), "soviet-dm".to_string()],
                ];
                let ev = build_event(4444, tags, encrypted_json, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
                log::info!("Nostr DM: sent to {:.16}…", recipient_soviet_pk);
            }

            NostrCmd::SubscribeDms { my_soviet_pk } => {
                let pk_hex = soviet_pk_to_hex(&my_soviet_pk);
                if !pk_hex.is_empty() {
                    let sub = json!(["REQ", "soviet-dms",
                        {"kinds": [4444], "#p": [pk_hex.clone()], "limit": 500}
                    ]).to_string();
                    broadcast(&relay_senders, &sub);
                    log::info!("Nostr: DM subscription updated for {:.16}…", pk_hex);
                }
            }
        }
    }
}

/// Convert a Soviet Base58 Ed25519 public key to lowercase hex (for Nostr p-tag)
fn soviet_pk_to_hex(pk_base58: &str) -> String {
    bs58::decode(pk_base58)
        .into_vec()
        .map(|b| hex::encode(b))
        .unwrap_or_default()
}

fn broadcast(senders: &[mpsc::UnboundedSender<String>], msg: &str) {
    for s in senders {
        let _ = s.send(msg.to_string());
    }
}

fn sub_msg(channel_ids: &[String]) -> String {
    json!(["REQ", "all-channels",
        {"kinds": [42, 41], "#e": channel_ids, "limit": 200}
    ]).to_string()
}

async fn on_relay_msg(
    text: &str,
    app: &tauri::AppHandle,
    db: &Arc<std::sync::Mutex<rusqlite::Connection>>,
    my_pk: &str,
    my_soviet_pk_hex: &str,
) {
    let Ok(val): Result<Value, _> = serde_json::from_str(text) else { return };
    let Some(arr) = val.as_array() else { return };
    if arr.len() < 3 || arr[0].as_str() != Some("EVENT") { return; }

    let Ok(ev): Result<NostrEvent, _> = serde_json::from_value(arr[2].clone()) else { return };

    match ev.kind {
        40 => {
            let Ok(meta): Result<Value, _> = serde_json::from_str(&ev.content) else { return };
            let name = meta["name"].as_str().unwrap_or("").to_string();
            let about = meta["about"].as_str().unwrap_or("").to_string();
            let picture = meta["picture"].as_str().unwrap_or("").to_string();
            {
                let conn = db.lock().unwrap();
                crate::storage::nostr_update_channel_meta(&conn, &ev.id, &name, &about, &picture, &ev.pubkey).ok();
            }
            use tauri::Emitter;
            app.emit("nostr-channel-info", json!({
                "id": ev.id, "name": name, "about": about,
                "picture": picture, "creator_pubkey": ev.pubkey,
            })).ok();
        }

        42 => {
            let channel_id = ev.tags.iter()
                .find(|t| t.len() >= 4 && t[0] == "e" && t[3] == "root")
                .or_else(|| ev.tags.iter().find(|t| t.len() >= 2 && t[0] == "e"))
                .map(|t| t[1].clone());
            let Some(channel_id) = channel_id else { return };

            let reply_to = ev.tags.iter()
                .find(|t| t.len() >= 4 && t[0] == "e" && t[3] == "reply")
                .map(|t| t[1].clone());

            let is_mine = ev.pubkey == my_pk;

            {
                let conn = db.lock().unwrap();
                crate::storage::nostr_save_message(
                    &conn, &ev.id, &channel_id, &ev.pubkey,
                    &ev.content, ev.created_at, reply_to.as_deref(), is_mine,
                ).ok();
            }

            use tauri::Emitter;
            app.emit("nostr-message", json!({
                "channel_id": channel_id,
                "event_id": ev.id,
                "sender_pubkey": ev.pubkey,
                "content": ev.content,
                "timestamp": ev.created_at,
                "reply_to": reply_to,
                "is_mine": is_mine,
            })).ok();
        }

        5 => {
            // Deletion event — remove channel if creator deleted it
            for tag in &ev.tags {
                if tag.len() >= 2 && tag[0] == "e" {
                    let channel_id = &tag[1];
                    {
                        let conn = db.lock().unwrap();
                        crate::storage::nostr_delete_channel(&conn, channel_id).ok();
                    }
                    use tauri::Emitter;
                    app.emit("nostr-channel-deleted", json!({ "channel_id": channel_id })).ok();
                }
            }
        }

        // ── Soviet DM (Kind 4444) — E2E зашифрованное личное сообщение ──────
        4444 => {
            // Проверяем, что сообщение адресовано нам
            let recipient_hex = ev.tags.iter()
                .find(|t| t.len() >= 2 && t[0] == "p")
                .map(|t| t[1].clone())
                .unwrap_or_default();
            if recipient_hex != my_soviet_pk_hex || my_soviet_pk_hex.is_empty() {
                return;
            }

            // Получаем AppState для доступа к keypair
            let state: tauri::State<crate::AppState> = app.state();

            // Игнорируем свои же сообщения
            let my_soviet_pk = state.identity.lock().unwrap()
                .as_ref()
                .map(|i| i.public_key.clone())
                .unwrap_or_default();

            // Парсим Soviet EncryptedMessage из content
            let Ok(encrypted): Result<crate::crypto::EncryptedMessage, _> =
                serde_json::from_str(&ev.content) else {
                log::warn!("Nostr DM: failed to parse EncryptedMessage");
                return;
            };

            if encrypted.sender_pk == my_soviet_pk {
                return; // Наше собственное сообщение
            }

            // Расшифровываем с помощью Soviet keypair
            let preview = {
                let kp_guard = state.keypair.lock().unwrap();
                match kp_guard.as_ref() {
                    Some(kp) => crate::crypto::decrypt_message(kp, &encrypted)
                        .ok()
                        .and_then(|b| String::from_utf8(b).ok())
                        .unwrap_or_else(|| "[сообщение]".to_string()),
                    None => return,
                }
            };

            // Сохраняем в БД (через Nostr-соединение db)
            let conn = db.lock().unwrap();
            if let Ok(chat_id) = crate::storage::get_or_create_direct_chat(&conn, &encrypted.sender_pk) {
                // Проверяем дублирование (Nostr relay может переслать повторно)
                if crate::storage::message_exists_by_ts(&conn, chat_id, encrypted.timestamp, &encrypted.sender_pk)
                    .unwrap_or(false)
                {
                    return;
                }

                let preview_short = preview[..preview.len().min(100)].to_string();
                let msg = crate::storage::DbMessage {
                    id: 0,
                    chat_id,
                    sender_key:   encrypted.sender_pk.clone(),
                    content:      ev.content.clone(),
                    content_type: "text".to_string(),
                    timestamp:    encrypted.timestamp,
                    status:       "delivered".to_string(),
                    reply_to:     None,
                    edited_at:    None,
                    is_deleted:   false,
                };
                if let Ok(msg_id) = crate::storage::save_message_with_preview(&conn, &msg, &preview_short) {
                    crate::storage::increment_unread(&conn, chat_id).ok();
                    drop(conn);

                    use tauri::Emitter;
                    app.emit("new-message", serde_json::json!({
                        "chat_id":     chat_id,
                        "msg_id":      msg_id,
                        "sender_pk":   encrypted.sender_pk,
                        "preview":     preview_short,
                        "via":         "nostr",
                    })).ok();

                    // Иконка трея — новое сообщение
                    if let Some(tray) = app.tray_by_id("main-tray") {
                        if let Ok(icon) = tauri::image::Image::from_bytes(crate::TRAY_MSG_PNG) {
                            tray.set_icon(Some(icon)).ok();
                        }
                    }
                } else {
                    drop(conn);
                }
            }
        }

        _ => {}
    }
}
