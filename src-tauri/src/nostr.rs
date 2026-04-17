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
    /// Редактировать сообщение канала — Kind 42 с edit-тегом
    EditChannelMessage {
        channel_id: String,
        original_event_id: String,
        relay: String,
        new_content: String,
    },
    /// Удалить сообщение канала — Kind 5
    DeleteChannelMessage {
        event_id: String,
    },
    /// Реакция на сообщение — Kind 7 (NIP-25)
    SendReaction {
        target_event_id: String,
        target_author_pubkey: String,
        emoji: String,
    },
    /// Убрать реакцию — Kind 5 на reaction event
    RemoveReaction {
        reaction_event_id: String,
    },
    /// Отправить комментарий (ответ на пост) — Kind 42 с reply-тегом; от любого подписчика
    SendComment {
        channel_id: String,
        relay: String,
        parent_event_id: String,
        content: String,
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
        // Multi-thread runtime so the command loop can't be starved by
        // blocking DB mutex calls inside reader tasks (on_relay_msg).
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
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
        // 5-second timeout on connect — prevents dead relays from freezing startup.
        let connect_res = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            connect_async(url),
        ).await;
        match connect_res {
            Err(_) => {
                log::warn!("Nostr: relay {} connect timed out", url);
                continue;
            }
            Ok(Err(e)) => {
                log::warn!("Nostr: relay {} error: {}", url, e);
                continue;
            }
            Ok(Ok((ws, _))) => {
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

            // ── Edit channel message — Kind 42 with edit tag ──────────────────
            NostrCmd::EditChannelMessage { channel_id, original_event_id, relay, new_content } => {
                let tags = vec![
                    vec!["e".to_string(), channel_id, relay, "root".to_string()],
                    vec!["e".to_string(), original_event_id, "".to_string(), "edit".to_string()],
                ];
                let ev = build_event(42, tags, new_content, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            // ── Delete channel message — Kind 5 ──────────────────────────────
            NostrCmd::DeleteChannelMessage { event_id } => {
                let tags = vec![vec!["e".to_string(), event_id]];
                let ev = build_event(5, tags, "deleted".to_string(), &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            // ── Reaction — Kind 7 (NIP-25) ───────────────────────────────────
            NostrCmd::SendReaction { target_event_id, target_author_pubkey, emoji } => {
                let tags = vec![
                    vec!["e".to_string(), target_event_id],
                    vec!["p".to_string(), target_author_pubkey],
                    vec!["t".to_string(), "soviet-channel".to_string()],
                ];
                let ev = build_event(7, tags, emoji, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            // ── Remove reaction — Kind 5 on reaction event ───────────────────
            NostrCmd::RemoveReaction { reaction_event_id } => {
                let tags = vec![vec!["e".to_string(), reaction_event_id]];
                let ev = build_event(5, tags, "reaction removed".to_string(), &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
            }

            // ── Comment (reply to post) — Kind 42 with reply tag ─────────────
            NostrCmd::SendComment { channel_id, relay, parent_event_id, content } => {
                let tags = vec![
                    vec!["e".to_string(), channel_id, relay.clone(), "root".to_string()],
                    vec!["e".to_string(), parent_event_id, relay, "reply".to_string()],
                ];
                let ev = build_event(42, tags, content, &pubkey_hex, &secret_hex);
                broadcast(&relay_senders, &json!(["EVENT", ev]).to_string());
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
            use tauri::Emitter;

            // Detect edit-tag: ["e", original_event_id, "", "edit"]
            let edit_target = ev.tags.iter()
                .find(|t| t.len() >= 4 && t[0] == "e" && t[3] == "edit")
                .map(|t| t[1].clone());

            if let Some(original_id) = edit_target {
                // This is an edit event — update existing message
                let conn = db.lock().unwrap();
                crate::storage::nostr_edit_message(&conn, &original_id, &ev.content, ev.created_at).ok();
                drop(conn);
                app.emit("nostr-message-edited", json!({
                    "event_id": original_id,
                    "new_content": ev.content,
                    "edited_at": ev.created_at,
                })).ok();
                return;
            }

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
            use tauri::Emitter;
            for tag in &ev.tags {
                if tag.len() >= 2 && tag[0] == "e" {
                    let target_id = &tag[1];
                    let conn = db.lock().unwrap();
                    // Try soft-delete as channel message first
                    crate::storage::nostr_soft_delete_message(&conn, target_id).ok();
                    // Also remove reaction if it's a reaction deletion
                    crate::storage::nostr_remove_reaction(&conn, target_id).ok();
                    // Also try channel deletion (for kind 40 events)
                    crate::storage::nostr_delete_channel(&conn, target_id).ok();
                    drop(conn);
                    app.emit("nostr-message-deleted", json!({
                        "event_id": target_id
                    })).ok();
                    app.emit("nostr-channel-deleted", json!({ "channel_id": target_id })).ok();
                }
            }
        }

        // ── Kind 7: Reaction ──────────────────────────────────────────────────
        7 => {
            let target_event_id = ev.tags.iter()
                .find(|t| t.len() >= 2 && t[0] == "e")
                .map(|t| t[1].clone())
                .unwrap_or_default();
            if target_event_id.is_empty() { return; }

            // Find channel_id for this message
            let channel_id = {
                let conn = db.lock().unwrap();
                conn.query_row(
                    "SELECT channel_id FROM nostr_messages WHERE event_id=?1",
                    rusqlite::params![target_event_id],
                    |r| r.get::<_, String>(0),
                ).unwrap_or_default()
            };
            if channel_id.is_empty() { return; }

            {
                let conn = db.lock().unwrap();
                crate::storage::nostr_save_reaction(
                    &conn, &target_event_id, &channel_id,
                    &ev.pubkey, &ev.content, &ev.id,
                ).ok();
            }

            use tauri::Emitter;
            app.emit("nostr-reaction", json!({
                "event_id": target_event_id,
                "channel_id": channel_id,
                "reactor_pubkey": ev.pubkey,
                "emoji": ev.content,
                "reaction_event_id": ev.id,
            })).ok();
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
            let decrypted_bytes = {
                let kp_guard = state.keypair.lock().unwrap();
                match kp_guard.as_ref() {
                    Some(kp) => match crate::crypto::decrypt_message(kp, &encrypted) {
                        Ok(b) => b,
                        Err(_) => return,
                    },
                    None => return,
                }
            };

            let decrypted_str = match String::from_utf8(decrypted_bytes) {
                Ok(s) => s,
                Err(_) => return,
            };

            // Если payload — это LanPacket (групповые сообщения, приглашения, etc.) — роутируем
            if let Ok(packet) = serde_json::from_str::<crate::network::LanPacket>(&decrypted_str) {
                // Только пакеты связанные с группами и коллаборацией (не plain message — он обрабатывается ниже)
                match packet.packet_type.as_str() {
                    "group_message" | "group_invite" | "member_left" | "group_dissolved"
                    | "read_receipt" | "reaction" | "edit_message" | "delete_message"
                    | "contact_request" | "hello" => {
                        crate::handle_lan_packet(app, packet);
                        return;
                    }
                    _ => {}
                }
            }

            let preview = decrypted_str;

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
                    plaintext:    None,
                };
                if let Ok(msg_id) = crate::storage::save_message_with_preview(&conn, &msg, &preview_short, &preview_short) {
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
