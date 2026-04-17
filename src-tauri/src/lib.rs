mod crypto;
mod identity;
mod storage;
mod network;
mod nostr;
mod p2p;

use std::sync::{Arc, Mutex};
use tauri::{Manager, State, AppHandle, Emitter};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use serde::{Serialize, Deserialize};
use storage::{Db, DbContact, DbMessage, OutboxItem};
use network::{LanNetwork, LanPacket};
use tokio::sync::mpsc;

const TRAY_IDLE_PNG:  &[u8] = include_bytes!("../icons/tray_idle.png");
const TRAY_MSG_PNG:   &[u8] = include_bytes!("../icons/tray_message.png");
const DEFAULT_RELAY: &str = "wss://relay.damus.io";

// ─── Application-level DB field encryption key ────────────────────────────────

/// Возвращает 32-байтовый ключ для шифрования чувствительных полей БД.
/// При первом запуске генерирует случайный ключ и сохраняет в OS keyring.
fn get_or_create_field_enc_key() -> [u8; 32] {
    const SERVICE: &str = "sovietmsg-db";
    const ACCOUNT: &str = "field_enc_key";

    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        if let Ok(hex_key) = entry.get_password() {
            if let Ok(bytes) = hex::decode(&hex_key) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    return key;
                }
            }
        }
    }

    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);

    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        entry.set_password(&hex::encode(key)).ok();
    }
    log::info!("DB: generated new field encryption key");
    key
}

// ─── App State ────────────────────────────────────────────────────────────────

pub struct AppState {
    pub db: Db,
    pub keypair: Mutex<Option<crypto::KeyPair>>,
    pub identity: Mutex<Option<identity::Identity>>,
    pub lan: Mutex<Option<LanNetwork>>,
    pub lan_tx: mpsc::UnboundedSender<(String, LanPacket)>,
    pub nostr: Mutex<Option<nostr::NostrHandle>>,
    pub p2p: Mutex<Option<p2p::P2pHandle>>,
    /// Реестр данных попаут-окон: label → JSON с данными чата/канала
    pub popout_registry: Mutex<std::collections::HashMap<String, serde_json::Value>>,
}

// ─── Commands — Identity / Onboarding ────────────────────────────────────────

#[derive(Serialize)]
pub struct IdentityInfo {
    pub nickname: String,
    pub public_key: String,
    pub has_identity: bool,
}

#[tauri::command]
fn get_identity(state: State<AppState>) -> IdentityInfo {
    let id = state.identity.lock().unwrap();
    match id.as_ref() {
        Some(i) => IdentityInfo {
            nickname: i.nickname.clone(),
            public_key: i.public_key.clone(),
            has_identity: true,
        },
        None => IdentityInfo {
            nickname: String::new(),
            public_key: String::new(),
            has_identity: false,
        },
    }
}

#[tauri::command]
fn create_identity(
    nickname: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<IdentityInfo, String> {
    let (ident, keypair) = identity::create_identity(&nickname)
        .map_err(|e| e.to_string())?;

    let db = state.db.0.lock().unwrap();
    storage::set_setting(&db, "nickname", &nickname).ok();
    storage::set_setting(&db, "public_key", &ident.public_key).ok();
    storage::set_setting(&db, "status", "online").ok();
    drop(db);

    let result = IdentityInfo {
        nickname: ident.nickname.clone(),
        public_key: ident.public_key.clone(),
        has_identity: true,
    };

    // Запускаем LAN если не запущен
    {
        let mut lan_guard = state.lan.lock().unwrap();
        if lan_guard.is_none() {
            let tx = state.lan_tx.clone();
            let l = LanNetwork::new(ident.public_key.clone(), ident.nickname.clone(), tx);
            l.start().ok();
            *lan_guard = Some(l);
        }
    }

    // Подписываемся на Nostr DMs
    {
        let nostr_guard = state.nostr.lock().unwrap();
        if let Some(n) = nostr_guard.as_ref() {
            n.cmd_tx.try_send(nostr::NostrCmd::SubscribeDms {
                my_soviet_pk: ident.public_key.clone(),
            }).ok();
        }
    }

    // Запускаем P2P mesh если не запущен
    {
        let mut p2p_guard = state.p2p.lock().unwrap();
        if p2p_guard.is_none() {
            let pk_bytes = keypair.private_key_bytes();
            let tx = state.lan_tx.clone();
            let p2p_db_path = app.path().app_data_dir()
                .map(|d| d.join("sovietmsg.db").to_string_lossy().to_string())
                .unwrap_or_else(|_| "sovietmsg.db".to_string());
            let p2p_enc_key = get_or_create_field_enc_key();
            match p2p::start(pk_bytes, tx, app, p2p_db_path, p2p_enc_key) {
                Ok(handle) => { *p2p_guard = Some(handle); }
                Err(e) => log::error!("P2P start error: {}", e),
            }
        }
    }

    *state.identity.lock().unwrap() = Some(ident);
    *state.keypair.lock().unwrap() = Some(keypair);

    Ok(result)
}

#[tauri::command]
fn export_keys(state: State<AppState>) -> Result<String, String> {
    let kp = state.keypair.lock().unwrap();
    match kp.as_ref() {
        Some(kp) => Ok(identity::export_keys(kp)),
        None => Err("No identity".to_string()),
    }
}

#[tauri::command]
fn import_keys(
    encoded: String,
    nickname: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<IdentityInfo, String> {
    let keypair = identity::import_keys(&encoded).map_err(|e| e.to_string())?;
    let ident = identity::Identity {
        nickname: nickname.clone(),
        public_key: keypair.public_key_base58(),
    };
    let db = state.db.0.lock().unwrap();
    storage::set_setting(&db, "nickname", &nickname).ok();
    storage::set_setting(&db, "public_key", &ident.public_key).ok();
    drop(db);

    // Запускаем LAN
    {
        let mut lan_guard = state.lan.lock().unwrap();
        if lan_guard.is_none() {
            let tx = state.lan_tx.clone();
            let l = LanNetwork::new(ident.public_key.clone(), ident.nickname.clone(), tx);
            l.start().ok();
            *lan_guard = Some(l);
        }
    }

    // Подписываемся на Nostr DMs
    {
        let nostr_guard = state.nostr.lock().unwrap();
        if let Some(n) = nostr_guard.as_ref() {
            n.cmd_tx.try_send(nostr::NostrCmd::SubscribeDms {
                my_soviet_pk: ident.public_key.clone(),
            }).ok();
        }
    }

    // Запускаем P2P mesh
    {
        let mut p2p_guard = state.p2p.lock().unwrap();
        if p2p_guard.is_none() {
            let pk_bytes = keypair.private_key_bytes();
            let tx = state.lan_tx.clone();
            let p2p_db_path = app.path().app_data_dir()
                .map(|d| d.join("sovietmsg.db").to_string_lossy().to_string())
                .unwrap_or_else(|_| "sovietmsg.db".to_string());
            let p2p_enc_key = get_or_create_field_enc_key();
            match p2p::start(pk_bytes, tx, app, p2p_db_path, p2p_enc_key) {
                Ok(handle) => { *p2p_guard = Some(handle); }
                Err(e) => log::error!("P2P start error: {}", e),
            }
        }
    }

    let result = IdentityInfo {
        nickname: ident.nickname.clone(),
        public_key: ident.public_key.clone(),
        has_identity: true,
    };
    *state.identity.lock().unwrap() = Some(ident);
    *state.keypair.lock().unwrap() = Some(keypair);
    Ok(result)
}

// ─── Commands — Contacts ─────────────────────────────────────────────────────

#[tauri::command]
fn get_contacts(state: State<AppState>) -> Result<Vec<DbContact>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_contacts(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_contact(
    public_key: String,
    nickname: String,
    state: State<AppState>,
) -> Result<(), String> {
    let contact = DbContact {
        id: 0,
        public_key,
        nickname,
        local_alias: None,
        status: "offline".to_string(),
        status_text: None,
        last_seen: None,
        notes: None,
        is_blocked: false,
        is_favorite: false,
        added_at: chrono::Utc::now().timestamp(),
        verified: false,
        avatar_data: None,
    };
    let db = state.db.0.lock().unwrap();
    storage::upsert_contact(&db, &contact).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_contact(public_key: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::delete_contact(&db, &public_key).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_contact(
    public_key: String,
    alias: Option<String>,
    notes: Option<String>,
    is_favorite: bool,
    is_blocked: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::update_contact_fields(
        &db, &public_key,
        alias.as_deref(), notes.as_deref(),
        is_favorite, is_blocked,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_lan_peers(state: State<AppState>) -> Vec<network::LanPeer> {
    let lan = state.lan.lock().unwrap();
    match lan.as_ref() {
        Some(lan) => lan.get_peers(),
        None => vec![],
    }
}

#[tauri::command]
fn get_safety_number(peer_pk: String, state: State<AppState>) -> Result<String, String> {
    let id = state.identity.lock().unwrap();
    match id.as_ref() {
        Some(i) => Ok(crypto::safety_number(&i.public_key, &peer_pk)),
        None => Err("No identity".to_string()),
    }
}

// ─── Commands — Contact Requests ─────────────────────────────────────────────

#[tauri::command]
fn get_contact_requests(state: State<AppState>) -> Result<Vec<storage::ContactRequest>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_pending_requests(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn accept_contact_request(
    public_key: String,
    nickname: String,
    state: State<AppState>,
) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    // Добавляем в контакты
    let contact = DbContact {
        id: 0,
        public_key: public_key.clone(),
        nickname: nickname.clone(),
        local_alias: None,
        status: "offline".to_string(),
        status_text: None,
        last_seen: None,
        notes: None,
        is_blocked: false,
        is_favorite: false,
        added_at: chrono::Utc::now().timestamp(),
        verified: false,
        avatar_data: None,
    };
    storage::upsert_contact(&db, &contact).map_err(|e| e.to_string())?;
    storage::update_request_status(&db, &public_key, "accepted").map_err(|e| e.to_string())
}

#[tauri::command]
fn reject_contact_request(public_key: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::update_request_status(&db, &public_key, "rejected").map_err(|e| e.to_string())
}

#[tauri::command]
fn send_contact_request(
    recipient_pk: String,
    state: State<AppState>,
) -> Result<(), String> {
    let id_guard = state.identity.lock().unwrap();
    let ident = id_guard.as_ref().ok_or("No identity")?;
    let my_pk   = ident.public_key.clone();
    let my_nick = ident.nickname.clone();
    drop(id_guard);

    let packet = network::make_contact_request_packet(&my_pk, &my_nick);

    // Сохраняем исходящий запрос локально (ICQ-логика авторизации)
    {
        let db = state.db.0.lock().unwrap();
        storage::save_contact_request(&db, &recipient_pk, "", "outgoing").ok();
    }

    // 1. Try LAN
    let sent = {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&recipient_pk) {
                lan.send_to_peer(&recipient_pk, &packet).is_ok()
            } else { false }
        } else { false }
    };

    // 2. Try P2P mesh
    let sent = if !sent {
        let p2p_guard = state.p2p.lock().unwrap();
        if let Some(p2p) = p2p_guard.as_ref() {
            if let Some(peer_id) = p2p.is_peer_online(&recipient_pk) {
                let data = serde_json::to_vec(&packet).unwrap_or_default();
                p2p.cmd_tx.try_send(p2p::P2pCmd::SendMessage { peer_id, data }).is_ok()
            } else { false }
        } else { false }
    } else { true };

    // 3. Fallback: send contact request payload via Nostr DM
    if !sent {
        let kp_guard = state.keypair.lock().unwrap();
        let kp = kp_guard.as_ref().ok_or("No keypair")?;
        // Encrypt the contact_request packet payload as a Soviet DM
        let payload_bytes = serde_json::to_vec(&packet).map_err(|e| e.to_string())?;
        let encrypted = crypto::encrypt_message(kp, &recipient_pk, &payload_bytes)
            .map_err(|e| e.to_string())?;
        drop(kp_guard);
        let enc_json = serde_json::to_string(&encrypted).map_err(|e| e.to_string())?;
        let nostr_guard = state.nostr.lock().unwrap();
        if let Some(n) = nostr_guard.as_ref() {
            n.cmd_tx.try_send(nostr::NostrCmd::SendDm {
                recipient_soviet_pk: recipient_pk,
                encrypted_json: enc_json,
            }).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─── Commands — Chats & Messages ─────────────────────────────────────────────

#[tauri::command]
fn get_chats(state: State<AppState>) -> Result<Vec<storage::DbChat>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_chats(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_messages(
    chat_id: i64,
    limit: i64,
    before: Option<i64>,
    state: State<AppState>,
) -> Result<Vec<DbMessage>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_messages(&db, chat_id, limit, before).map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_read(chat_id: i64, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::mark_messages_read(&db, chat_id).map_err(|e| e.to_string())?;
    // Обновляем счётчик в трее
    let unread = storage::get_total_unread_count(&db).unwrap_or(0);

    // Ищем peer_key чата чтобы отправить read receipt
    let peer_key = storage::get_chat_peer_key(&db, chat_id).ok().flatten();
    drop(db);

    update_tray_badge(&app, unread);

    // Отправляем read receipt собеседнику (чтобы у него ✓✓ стало синим)
    // Пробуем LAN → P2P → Nostr (тот же порядок что и при отправке сообщений)
    if let Some(peer_pk) = peer_key {
        let id_guard = state.identity.lock().unwrap();
        let my_pk = match id_guard.as_ref() {
            Some(i) => i.public_key.clone(),
            None => return Ok(()),
        };
        drop(id_guard);

        let packet = network::make_read_receipt_packet(&my_pk, &peer_pk);

        // 1. LAN
        let sent = {
            let lan_guard = state.lan.lock().unwrap();
            if let Some(lan) = lan_guard.as_ref() {
                if lan.is_peer_online(&peer_pk) {
                    lan.send_to_peer(&peer_pk, &packet).is_ok()
                } else { false }
            } else { false }
        };

        // 2. P2P mesh
        let sent = if !sent {
            let p2p_guard = state.p2p.lock().unwrap();
            if let Some(p2p) = p2p_guard.as_ref() {
                if let Some(peer_id) = p2p.is_peer_online(&peer_pk) {
                    let data = serde_json::to_vec(&packet).unwrap_or_default();
                    p2p.cmd_tx.try_send(p2p::P2pCmd::SendMessage { peer_id, data }).is_ok()
                } else { false }
            } else { false }
        } else { true };

        // 3. Nostr DM fallback
        if !sent {
            let kp_guard = state.keypair.lock().unwrap();
            if let Some(kp) = kp_guard.as_ref() {
                if let Ok(payload_bytes) = serde_json::to_vec(&packet) {
                    if let Ok(encrypted) = crypto::encrypt_message(kp, &peer_pk, &payload_bytes) {
                        drop(kp_guard);
                        if let Ok(enc_json) = serde_json::to_string(&encrypted) {
                            let nostr_guard = state.nostr.lock().unwrap();
                            if let Some(n) = nostr_guard.as_ref() {
                                n.cmd_tx.try_send(nostr::NostrCmd::SendDm {
                                    recipient_soviet_pk: peer_pk,
                                    encrypted_json: enc_json,
                                }).ok();
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn send_message(
    recipient_pk: String,
    text: String,
    reply_to: Option<i64>,
    state: State<AppState>,
    app: AppHandle,
) -> Result<i64, String> {
    // Нельзя писать, пока контакт не авторизован (принятие запроса)
    {
        let db = state.db.0.lock().unwrap();
        if !storage::is_contact_accepted(&db, &recipient_pk).unwrap_or(false) {
            return Err("Контакт не авторизован. Сначала отправьте запрос и дождитесь принятия.".to_string());
        }
    }

    let kp_guard = state.keypair.lock().unwrap();
    let kp = kp_guard.as_ref().ok_or("No keypair")?;
    let id_guard = state.identity.lock().unwrap();
    let ident = id_guard.as_ref().ok_or("No identity")?;

    let encrypted = crypto::encrypt_message(kp, &recipient_pk, text.as_bytes())
        .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp();

    let db = state.db.0.lock().unwrap();
    let chat_id = storage::get_or_create_direct_chat(&db, &recipient_pk)
        .map_err(|e| e.to_string())?;

    let content_json = serde_json::to_string(&encrypted).map_err(|e| e.to_string())?;
    let msg = DbMessage {
        id: 0,
        chat_id,
        sender_key: ident.public_key.clone(),
        content: content_json.clone(),
        content_type: "text".to_string(),
        timestamp: now,
        status: "sent".to_string(),
        reply_to,
        edited_at: None,
        is_deleted: false,
        plaintext: Some(text.clone()),
    };

    // Сохраняем с текстовым превью для сайдбара (мы знаем plaintext)
    let preview = format!("Вы: {}", &text[..text.len().min(80)]);
    let msg_id = storage::save_message_with_preview(&db, &msg, &preview, &text)
        .map_err(|e| e.to_string())?;
    // Always queue for offline delivery (ICQ offline messages). If it goes out immediately, worker will mark sent.
    storage::enqueue_outbox(&db, "direct", &recipient_pk, msg_id, &content_json, "text").ok();
    drop(db);

    // 1. Пробуем LAN (локальная сеть)
    let sent = {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&recipient_pk) {
                let packet = network::make_message_packet(&ident.public_key, &encrypted);
                lan.send_to_peer(&recipient_pk, &packet).is_ok()
            } else { false }
        } else { false }
    };

    // 2. Пробуем P2P mesh (интернет/LAN через libp2p)
    let sent = if !sent {
        let p2p_guard = state.p2p.lock().unwrap();
        if let Some(p2p) = p2p_guard.as_ref() {
            if let Some(peer_id) = p2p.is_peer_online(&recipient_pk) {
                let packet = network::make_message_packet(&ident.public_key, &encrypted);
                let data = serde_json::to_vec(&packet).unwrap_or_default();
                p2p.cmd_tx.try_send(p2p::P2pCmd::SendMessage { peer_id, data }).is_ok()
            } else { false }
        } else { false }
    } else { true };

    // 3. Fallback: Nostr relay DM (интернет, не требует прямого соединения)
    if !sent {
        let nostr_guard = state.nostr.lock().unwrap();
        if let Some(n) = nostr_guard.as_ref() {
            let enc_json = serde_json::to_string(&encrypted).unwrap_or_default();
            n.cmd_tx.try_send(nostr::NostrCmd::SendDm {
                recipient_soviet_pk: recipient_pk.clone(),
                encrypted_json: enc_json,
            }).ok();
        }
    }

    app.emit("message-sent", serde_json::json!({ "chat_id": chat_id, "msg_id": msg_id })).ok();

    Ok(msg_id)
}

#[tauri::command]
fn decrypt_message_text(
    encrypted_json: String,
    state: State<AppState>,
) -> Result<String, String> {
    let kp_guard = state.keypair.lock().unwrap();
    let kp = kp_guard.as_ref().ok_or("No keypair")?;
    let encrypted: crypto::EncryptedMessage = serde_json::from_str(&encrypted_json)
        .map_err(|e| e.to_string())?;
    let plaintext = crypto::decrypt_message(kp, &encrypted)
        .map_err(|e| e.to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_typing(
    recipient_pk: String,
    is_typing: bool,
    state: State<AppState>,
) -> Result<(), String> {
    let id_guard = state.identity.lock().unwrap();
    let ident = id_guard.as_ref().ok_or("No identity")?;
    let packet = network::make_typing_packet(&ident.public_key, is_typing);
    drop(id_guard);

    let lan_guard = state.lan.lock().unwrap();
    if let Some(lan) = lan_guard.as_ref() {
        if lan.is_peer_online(&recipient_pk) {
            lan.send_to_peer(&recipient_pk, &packet).ok();
        }
    }
    Ok(())
}

// ─── Commands — Settings / Status ────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct Settings {
    pub nickname: String,
    pub public_key: String,
    pub status: String,
    pub status_text: String,
    pub lan_enabled: bool,
    pub notify_sounds: bool,
    pub theme: String,
    pub avatar_data: String,
    pub custom_id: String,
    // Messaging / Privacy (ICQ-style preferences) — stored as plain strings in settings table
    pub auto_response: String,
    pub history_enabled: bool,
    pub allow_list: String,
    pub deny_list: String,
    pub invisible_list: String,
    pub ignore_list: String,
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<Settings, String> {
    let db = state.db.0.lock().unwrap();
    let get = |k: &str| storage::get_setting(&db, k).ok().flatten().unwrap_or_default();
    Ok(Settings {
        nickname: get("nickname"),
        public_key: get("public_key"),
        status: get("status"),
        status_text: get("status_text"),
        lan_enabled: get("lan_enabled") != "false",
        notify_sounds: get("notify_sounds") != "false",
        theme: if get("theme").is_empty() { "system".to_string() } else { get("theme") },
        avatar_data: get("avatar_data"),
        custom_id: get("custom_id"),
        auto_response: get("auto_response"),
        history_enabled: get("history_enabled") != "false",
        allow_list: get("allow_list"),
        deny_list: get("deny_list"),
        invisible_list: get("invisible_list"),
        ignore_list: get("ignore_list"),
    })
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::set_setting(&db, "nickname", &settings.nickname).ok();
    storage::set_setting(&db, "status", &settings.status).ok();
    storage::set_setting(&db, "status_text", &settings.status_text).ok();
    storage::set_setting(&db, "lan_enabled", if settings.lan_enabled { "true" } else { "false" }).ok();
    storage::set_setting(&db, "notify_sounds", if settings.notify_sounds { "true" } else { "false" }).ok();
    storage::set_setting(&db, "theme", &settings.theme).ok();
    if !settings.avatar_data.is_empty() {
        storage::set_setting(&db, "avatar_data", &settings.avatar_data).ok();
    }
    storage::set_setting(&db, "custom_id", &settings.custom_id).ok();
    storage::set_setting(&db, "auto_response", &settings.auto_response).ok();
    storage::set_setting(&db, "history_enabled", if settings.history_enabled { "true" } else { "false" }).ok();
    storage::set_setting(&db, "allow_list", &settings.allow_list).ok();
    storage::set_setting(&db, "deny_list", &settings.deny_list).ok();
    storage::set_setting(&db, "invisible_list", &settings.invisible_list).ok();
    storage::set_setting(&db, "ignore_list", &settings.ignore_list).ok();
    Ok(())
}

#[tauri::command]
fn set_status(status: String, text: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::set_setting(&db, "status", &status).ok();
    storage::set_setting(&db, "status_text", &text).ok();
    Ok(())
}

// ─── Commands — Outbox (offline queue UI) ─────────────────────────────────────

#[tauri::command]
fn get_outbox(status: String, limit: i64, state: State<AppState>) -> Result<Vec<storage::OutboxItem>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_outbox(&db, &status, limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_outbox(msg_id: i64, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::drop_outbox_for_msg(&db, msg_id).map_err(|e| e.to_string())?;
    storage::set_message_status(&db, msg_id, "failed").ok();
    Ok(())
}

// ─── Входящие LAN-пакеты ─────────────────────────────────────────────────────

pub fn handle_lan_packet(app: &AppHandle, packet: LanPacket) {
    match packet.packet_type.as_str() {
        "message" => {
            if let Ok(encrypted) = serde_json::from_value::<crypto::EncryptedMessage>(packet.payload.clone()) {
                let state: tauri::State<AppState> = app.state();

                let my_pk = state.identity.lock().unwrap()
                    .as_ref()
                    .map(|i| i.public_key.clone())
                    .unwrap_or_default();
                if encrypted.sender_pk == my_pk { return; }

                let db = state.db.0.lock().unwrap();

                if let Ok(chat_id) = storage::get_or_create_direct_chat(&db, &encrypted.sender_pk) {
                    // Расшифровываем сообщение
                    let kp_guard = state.keypair.lock().unwrap();
                    let decrypted_text = if let Some(kp) = kp_guard.as_ref() {
                        crypto::decrypt_message(kp, &encrypted)
                            .ok()
                            .and_then(|b| String::from_utf8(b).ok())
                            .unwrap_or_else(|| "[сообщение]".to_string())
                    } else {
                        "[сообщение]".to_string()
                    };
                    drop(kp_guard);

                    // Определяем тип контента: файл/изображение или текст
                    let (content_type, preview, plaintext_stored) =
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&decrypted_text) {
                            if val.get("file_name").is_some() && val.get("data").is_some() {
                                let fname = val["file_name"].as_str().unwrap_or("файл");
                                let mime  = val["mime_type"].as_str().unwrap_or("");
                                let ct = if mime.starts_with("image/") { "image" }
                                 else if mime.starts_with("audio/") { "audio" }
                                 else { "file" };
                                (ct.to_string(), format!("[{}]", fname), Some(decrypted_text.clone()))
                            } else {
                                ("text".to_string(), decrypted_text.clone(), None)
                            }
                        } else {
                            ("text".to_string(), decrypted_text.clone(), None)
                        };

                    let content_json = serde_json::to_string(&encrypted).unwrap_or_default();
                    let msg = DbMessage {
                        id: 0,
                        chat_id,
                        sender_key: encrypted.sender_pk.clone(),
                        content: content_json,
                        content_type,
                        timestamp: encrypted.timestamp,
                        status: "delivered".to_string(),
                        reply_to: None,
                        edited_at: None,
                        is_deleted: false,
                        plaintext: plaintext_stored,
                    };

                    if let Ok(msg_id) = storage::save_message_with_preview(&db, &msg, &preview, &preview) {
                        storage::increment_unread(&db, chat_id).ok();
                        drop(db);

                        let db2 = state.db.0.lock().unwrap();
                        let sender_name = storage::get_contacts(&db2).unwrap_or_default()
                            .into_iter()
                            .find(|c| c.public_key == encrypted.sender_pk)
                            .map(|c| c.local_alias.unwrap_or(c.nickname))
                            .unwrap_or_else(|| "Неизвестный".to_string());
                        drop(db2);

                        let preview_short = if preview.chars().count() > 100 {
                            format!("{}...", preview.chars().take(100).collect::<String>())
                        } else {
                            preview.clone()
                        };

                        app.emit("new-message", serde_json::json!({
                            "chat_id": chat_id,
                            "msg_id": msg_id,
                            "sender_pk": encrypted.sender_pk,
                            "sender_name": sender_name,
                            "preview": preview_short,
                        })).ok();

                        // OS уведомление
                        use tauri_plugin_notification::NotificationExt;
                        app.notification()
                            .builder()
                            .title(&sender_name)
                            .body(&preview_short)
                            .show()
                            .ok();

                        // Иконка трея + счётчик непрочитанных
                        let db3 = state.db.0.lock().unwrap();
                        let unread = storage::get_total_unread_count(&db3).unwrap_or(1);
                        drop(db3);
                        update_tray_badge(&app, unread);
                    } else {
                        drop(db);
                    }
                }
            }
        }

        "contact_request" => {
            let pk = packet.payload.get("sender_pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            let nickname = packet.payload.get("nickname")
                .and_then(|v| v.as_str()).unwrap_or("Неизвестный").to_string();

            if !pk.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::save_contact_request(&db, &pk, &nickname, "incoming").ok();
                drop(db);
                app.emit("contact-request", serde_json::json!({
                    "sender_pk": pk,
                    "nickname": nickname,
                })).ok();
            }
        }

        "typing" => {
            app.emit("typing", &packet.payload).ok();
        }

        "hello" => {
            let pk = packet.payload.get("pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !pk.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                let status = packet.payload.get("status")
                    .and_then(|v| v.as_str()).unwrap_or("online");
                let status_text = packet.payload.get("status_text")
                    .and_then(|v| v.as_str()).unwrap_or("");
                let avatar = packet.payload.get("avatar")
                    .and_then(|v| v.as_str()).unwrap_or("");
                storage::update_contact_status(&db, &pk, status, Some(status_text)).ok();
                // Сохраняем аватарку если контакт известен и аватарка пришла
                if !avatar.is_empty() {
                    storage::set_contact_avatar(&db, &pk, avatar).ok();
                }
                drop(db);
                app.emit("contact-status", serde_json::json!({
                    "pk": pk,
                    "status": status,
                    "status_text": status_text,
                    "avatar": avatar,
                })).ok();
            }
        }

        "peer_discovered" => {
            // Новый пир найден в LAN — отправляем ему полный hello с аватаркой
            let peer_pk = packet.payload.get("pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !peer_pk.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let (my_pk, my_nick, my_avatar, my_status, my_status_text) = {
                    let id = state.identity.lock().unwrap();
                    let db = state.db.0.lock().unwrap();
                    let get = |k: &str| storage::get_setting(&db, k).ok().flatten().unwrap_or_default();
                    (
                        id.as_ref().map(|i| i.public_key.clone()).unwrap_or_default(),
                        id.as_ref().map(|i| i.nickname.clone()).unwrap_or_default(),
                        get("avatar_data"),
                        get("status"),
                        get("status_text"),
                    )
                };
                if !my_pk.is_empty() {
                    let hello = network::make_hello_packet(&my_pk, &my_nick, &my_avatar, &my_status, &my_status_text);
                    let lan_guard = state.lan.lock().unwrap();
                    if let Some(lan) = lan_guard.as_ref() {
                        lan.send_to_peer(&peer_pk, &hello).ok();
                    }
                }
            }
        }

        "group_invite" => {
            let group_id = packet.payload.get("group_id")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            let group_name = packet.payload.get("group_name")
                .and_then(|v| v.as_str()).unwrap_or("Группа").to_string();
            let sender_pk = packet.payload.get("sender_pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();

            if !group_id.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::create_group_chat(&db, &group_id, &group_name).ok();

                // Добавляем участников из списка
                if let Some(arr) = packet.payload.get("members").and_then(|v| v.as_array()) {
                    let contacts = storage::get_contacts(&db).unwrap_or_default();
                    let my_pk = state.identity.lock().unwrap()
                        .as_ref().map(|i| i.public_key.clone()).unwrap_or_default();
                    for pk_val in arr {
                        if let Some(pk) = pk_val.as_str() {
                            let nick = if pk == my_pk {
                                state.identity.lock().unwrap()
                                    .as_ref().map(|i| i.nickname.clone()).unwrap_or_default()
                            } else {
                                contacts.iter().find(|c| c.public_key == pk)
                                    .map(|c| c.local_alias.clone().unwrap_or(c.nickname.clone()))
                                    .unwrap_or_default()
                            };
                            storage::add_group_member(&db, &group_id, pk, &nick, pk == sender_pk).ok();
                        }
                    }
                }
                drop(db);

                app.emit("group-invite", serde_json::json!({
                    "group_id": group_id,
                    "group_name": group_name,
                    "sender_pk": sender_pk,
                })).ok();
            }
        }

        "group_message" => {
            let group_id = packet.payload.get("group_id")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            let sender_pk = packet.payload.get("sender_pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            let content = packet.payload.get("content")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();

            if !group_id.is_empty() && !sender_pk.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();

                if let Ok(Some(chat_id)) = storage::get_group_chat_id(&db, &group_id) {
                    // Расшифровываем
                    let kp_guard = state.keypair.lock().unwrap();
                    let plain = if let Some(kp) = kp_guard.as_ref() {
                        if let Ok(enc) = serde_json::from_str::<crypto::EncryptedMessage>(&content) {
                            crypto::decrypt_message(kp, &enc)
                                .ok()
                                .and_then(|b| String::from_utf8(b).ok())
                                .unwrap_or_else(|| "[сообщение]".to_string())
                        } else { content.clone() }
                    } else { "[сообщение]".to_string() };
                    drop(kp_guard);

                    let members = storage::get_group_members(&db, &group_id).unwrap_or_default();
                    let sender_name = members.iter()
                        .find(|m| m.public_key == sender_pk)
                        .map(|m| m.nickname.clone())
                        .unwrap_or_else(|| sender_pk[..8.min(sender_pk.len())].to_string());

                    let preview = format!("{}: {}", sender_name, &plain[..plain.len().min(60)]);
                    let msg = storage::DbMessage {
                        id: 0, chat_id,
                        sender_key: sender_pk.clone(),
                        content: plain.clone(),
                        content_type: "text".to_string(),
                        timestamp: chrono::Utc::now().timestamp(),
                        status: "delivered".to_string(),
                        reply_to: None,
        edited_at: None,
        is_deleted: false,
        plaintext: None,
                    };
                    if let Ok(msg_id) = storage::save_message_with_preview(&db, &msg, &preview, &plain) {
                        storage::increment_unread(&db, chat_id).ok();
                        let unread = storage::get_total_unread_count(&db).unwrap_or(1);
                        drop(db);
                        app.emit("group-message", serde_json::json!({
                            "chat_id": chat_id,
                            "msg_id": msg_id,
                            "group_id": group_id,
                            "sender_pk": sender_pk,
                            "sender_name": sender_name,
                            "preview": plain,
                        })).ok();
                        update_tray_badge(&app, unread);
                    } else { drop(db); }
                } else { drop(db); }
            }
        }

        "read_receipt" => {
            // Собеседник прочитал наши сообщения — ставим им статус "read"
            let sender_pk = packet.payload.get("sender_pk")
                .and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !sender_pk.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::mark_sent_messages_read(&db, &sender_pk).ok();
                drop(db);
                app.emit("read-receipt", serde_json::json!({ "peer_pk": sender_pk })).ok();
            }
        }

        "member_left" => {
            let sender_pk  = packet.payload.get("sender_pk").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let group_id   = packet.payload.get("group_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let nickname   = packet.payload.get("nickname").and_then(|v| v.as_str()).unwrap_or("участник").to_string();
            if !group_id.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::remove_group_member(&db, &group_id, &sender_pk).ok();
                if let Ok(Some(cid)) = storage::get_group_chat_id(&db, &group_id) {
                    let text = format!("{} покинул(а) чат", nickname);
                    if let Ok(msg_id) = storage::save_system_message(&db, cid, &text) {
                        drop(db);
                        app.emit("group-message", serde_json::json!({
                            "chat_id": cid, "msg_id": msg_id,
                            "group_id": group_id, "sender_pk": sender_pk,
                            "preview": text,
                        })).ok();
                    } else { drop(db); }
                } else { drop(db); }
            }
        }

        "group_dissolved" => {
            let group_id = packet.payload.get("group_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !group_id.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::delete_group(&db, &group_id).ok();
                drop(db);
                app.emit("group-dissolved", serde_json::json!({ "group_id": group_id })).ok();
            }
        }

        "reaction" => {
            let sender_pk = packet.payload.get("sender_pk").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let target_sender = packet.payload.get("target_sender").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let target_ts = packet.payload.get("target_ts").and_then(|v| v.as_i64()).unwrap_or(0);
            let emoji = packet.payload.get("emoji").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let action = packet.payload.get("action").and_then(|v| v.as_str()).unwrap_or("add").to_string();
            if !sender_pk.is_empty() && !emoji.is_empty() {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                if action == "add" {
                    storage::add_reaction_by_key(&db, &target_sender, target_ts, &sender_pk, &emoji).ok();
                } else {
                    storage::remove_reaction_by_key(&db, &target_sender, target_ts, &sender_pk, &emoji).ok();
                }
                let msg_id = storage::find_message_id(&db, &target_sender, target_ts).ok().flatten();
                drop(db);
                if let Some(mid) = msg_id {
                    app.emit("reaction-update", serde_json::json!({
                        "message_id": mid, "sender_pk": sender_pk,
                        "emoji": emoji, "action": action,
                    })).ok();
                }
            }
        }

        "edit_message" => {
            let sender_pk = packet.payload.get("sender_pk").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let timestamp = packet.payload.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
            let new_content = packet.payload.get("new_content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !sender_pk.is_empty() && timestamp > 0 {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                storage::edit_message_by_key(&db, &sender_pk, timestamp, &new_content).ok();
                let msg_id = storage::find_message_id(&db, &sender_pk, timestamp).ok().flatten();
                drop(db);
                if let Some(mid) = msg_id {
                    app.emit("message-edited", serde_json::json!({
                        "message_id": mid, "new_content": new_content,
                    })).ok();
                }
            }
        }

        "delete_message" => {
            let sender_pk = packet.payload.get("sender_pk").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let timestamp = packet.payload.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0);
            if !sender_pk.is_empty() && timestamp > 0 {
                let state: tauri::State<AppState> = app.state();
                let db = state.db.0.lock().unwrap();
                let msg_id = storage::find_message_id(&db, &sender_pk, timestamp).ok().flatten();
                if let Some(mid) = msg_id {
                    storage::delete_message(&db, mid).ok();
                }
                drop(db);
                if let Some(mid) = msg_id {
                    app.emit("message-deleted", serde_json::json!({ "message_id": mid })).ok();
                }
            }
        }

        _ => {}
    }
}

// ─── Universal peer send helper (LAN → P2P → Nostr) ─────────────────────────

/// Отправить LanPacket собеседнику через любой доступный транспорт.
/// Порядок: LAN → P2P mesh → Nostr DM (fallback).
/// Возвращает true если отправлено хотя бы через один канал.
fn send_packet_to_peer(state: &tauri::State<AppState>, recipient_pk: &str, packet: &network::LanPacket) -> bool {
    // 1. LAN
    let sent = {
        let lan = state.lan.lock().unwrap();
        if let Some(lan) = lan.as_ref() {
            if lan.is_peer_online(recipient_pk) {
                lan.send_to_peer(recipient_pk, packet).is_ok()
            } else { false }
        } else { false }
    };
    if sent { return true; }

    // 2. P2P mesh
    let sent = {
        let p2p = state.p2p.lock().unwrap();
        if let Some(p2p) = p2p.as_ref() {
            if let Some(peer_id) = p2p.is_peer_online(recipient_pk) {
                let data = serde_json::to_vec(packet).unwrap_or_default();
                p2p.cmd_tx.try_send(p2p::P2pCmd::SendMessage { peer_id, data }).is_ok()
            } else { false }
        } else { false }
    };
    if sent { return true; }

    // 3. Nostr DM — шифруем весь пакет как байты
    let kp_guard = state.keypair.lock().unwrap();
    if let Some(kp) = kp_guard.as_ref() {
        let packet_bytes = serde_json::to_vec(packet).unwrap_or_default();
        if let Ok(encrypted) = crypto::encrypt_message(kp, recipient_pk, &packet_bytes) {
            drop(kp_guard);
            if let Ok(enc_json) = serde_json::to_string(&encrypted) {
                let nostr = state.nostr.lock().unwrap();
                if let Some(n) = nostr.as_ref() {
                    return n.cmd_tx.try_send(nostr::NostrCmd::SendDm {
                        recipient_soviet_pk: recipient_pk.to_string(),
                        encrypted_json: enc_json,
                    }).is_ok();
                }
            }
        }
    }
    false
}

// ─── Outbox retry worker ──────────────────────────────────────────────────────

fn outbox_backoff_seconds(attempts: i64) -> i64 {
    // 2s, 5s, 15s, 45s, 2m, 5m, 10m (cap)
    match attempts {
        0 => 2,
        1 => 5,
        2 => 15,
        3 => 45,
        4 => 120,
        5 => 300,
        _ => 600,
    }
}

fn try_send_outbox_item(_app: &AppHandle, state: &tauri::State<AppState>, item: &OutboxItem) -> Result<bool, String> {
    // Returns Ok(true) if delivery was attempted/sent, Ok(false) if not possible yet.
    let id_guard = state.identity.lock().unwrap();
    let ident = id_guard.as_ref().ok_or("No identity")?;
    let my_pk = ident.public_key.clone();
    drop(id_guard);

    match item.kind.as_str() {
        "direct" | "file" => {
            let recipient_pk = item.target.clone();
            let encrypted_json = item.payload.clone();

            // 1) LAN
            let sent = {
                let lan_guard = state.lan.lock().unwrap();
                if let Some(lan) = lan_guard.as_ref() {
                    if lan.is_peer_online(&recipient_pk) {
                        if let Ok(enc) = serde_json::from_str::<crypto::EncryptedMessage>(&encrypted_json) {
                            let packet = network::make_message_packet(&my_pk, &enc);
                            lan.send_to_peer(&recipient_pk, &packet).is_ok()
                        } else { false }
                    } else { false }
                } else { false }
            };

            // 2) P2P
            let sent = if !sent {
                let p2p_guard = state.p2p.lock().unwrap();
                if let Some(p2p) = p2p_guard.as_ref() {
                    if let Some(peer_id) = p2p.is_peer_online(&recipient_pk) {
                        if let Ok(enc) = serde_json::from_str::<crypto::EncryptedMessage>(&encrypted_json) {
                            let packet = network::make_message_packet(&my_pk, &enc);
                            let data = serde_json::to_vec(&packet).unwrap_or_default();
                            p2p.cmd_tx.try_send(p2p::P2pCmd::SendMessage { peer_id, data }).is_ok()
                        } else { false }
                    } else { false }
                } else { false }
            } else { true };

            // 3) Nostr DM fallback
            if !sent {
                let nostr_guard = state.nostr.lock().unwrap();
                if let Some(n) = nostr_guard.as_ref() {
                    n.cmd_tx.try_send(nostr::NostrCmd::SendDm {
                        recipient_soviet_pk: recipient_pk,
                        encrypted_json,
                    }).map_err(|e| e.to_string())?;
                    return Ok(true);
                }
                return Ok(false);
            }
            Ok(true)
        }
        "group" => {
            // payload = plaintext; re-encrypt per member and send via LAN → P2P → Nostr
            let group_id = item.target.clone();
            let plaintext = item.payload.clone();

            let db = state.db.0.lock().unwrap();
            let members = storage::get_group_members(&db, &group_id).map_err(|e| e.to_string())?;
            drop(db);

            // Build per-member encrypted packets while holding keypair lock
            let packets: Vec<(String, network::LanPacket)> = {
                let kp_guard = state.keypair.lock().unwrap();
                if let Some(kp) = kp_guard.as_ref() {
                    members.iter()
                        .filter(|m| m.public_key != my_pk)
                        .filter_map(|m| {
                            crypto::encrypt_message(kp, &m.public_key, plaintext.as_bytes()).ok()
                                .and_then(|enc| serde_json::to_string(&enc).ok())
                                .map(|enc_json| {
                                    let pkt = network::make_group_message_packet(&my_pk, &group_id, &enc_json);
                                    (m.public_key.clone(), pkt)
                                })
                        })
                        .collect()
                } else { vec![] }
            };

            let mut any = false;
            for (peer_pk, packet) in &packets {
                if send_packet_to_peer(state, peer_pk, packet) { any = true; }
            }
            Ok(any)
        }
        _ => Ok(false),
    }
}

fn start_outbox_worker(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let state: tauri::State<AppState> = app.state();
            let db = state.db.0.lock().unwrap();
            let due = storage::get_due_outbox(&db, 25).unwrap_or_default();
            drop(db);
            if due.is_empty() { continue; }

            for item in due {
                let ok = match try_send_outbox_item(&app, &state, &item) {
                    Ok(sent) => sent,
                    Err(_) => false,
                };
                let db = state.db.0.lock().unwrap();
                if ok {
                    storage::mark_outbox_sent(&db, item.id).ok();
                    // Best-effort: update message status to "sent" (still may not be delivered yet)
                    storage::set_message_status(&db, item.msg_id, "sent").ok();
                    drop(db);
                    app.emit("outbox-updated", serde_json::json!({ "msg_id": item.msg_id, "status": "sent" })).ok();
                } else {
                    let next_attempts = item.attempts + 1;
                    let backoff = outbox_backoff_seconds(item.attempts);
                    let next_retry = chrono::Utc::now().timestamp() + backoff;
                    storage::mark_outbox_attempt(&db, item.id, next_attempts, next_retry, Some("offline")).ok();
                }
            }
        }
    });
}

// ─── Commands — File Transfer ────────────────────────────────────────────────

#[tauri::command]
fn send_file(
    recipient_pk: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<i64, String> {
    {
        let db = state.db.0.lock().unwrap();
        if !storage::is_contact_accepted(&db, &recipient_pk).unwrap_or(false) {
            return Err("Контакт не авторизован. Сначала отправьте запрос и дождитесь принятия.".to_string());
        }
    }

    let kp_guard = state.keypair.lock().unwrap();
    let kp = kp_guard.as_ref().ok_or("No keypair")?;
    let id_guard = state.identity.lock().unwrap();
    let ident = id_guard.as_ref().ok_or("No identity")?;
    let my_pk = ident.public_key.clone();
    drop(id_guard);

    // Payload: JSON с именем файла и данными
    let payload = serde_json::json!({
        "file_name": file_name,
        "mime_type": mime_type,
        "data": data_base64,
    }).to_string();

    let encrypted = crypto::encrypt_message(kp, &recipient_pk, payload.as_bytes())
        .map_err(|e| e.to_string())?;
    drop(kp_guard);

    let content_type = if mime_type.starts_with("image/") { "image" } else { "file" };
    let db = state.db.0.lock().unwrap();
    let chat_id = storage::get_or_create_direct_chat(&db, &recipient_pk)
        .map_err(|e| e.to_string())?;
    let content_json = serde_json::to_string(&encrypted).map_err(|e| e.to_string())?;
    let preview = format!("Вы: 📎 {}", file_name);
    let msg = DbMessage {
        id: 0, chat_id,
        sender_key: my_pk.clone(),
        content: content_json,
        content_type: content_type.to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        status: "sent".to_string(),
        reply_to: None,
        edited_at: None,
        is_deleted: false,
        plaintext: None,
    };
    let msg_id = storage::save_message_with_preview(&db, &msg, &preview, &file_name)
        .map_err(|e| e.to_string())?;
    storage::enqueue_outbox(&db, "file", &recipient_pk, msg_id, &msg.content, content_type).ok();
    drop(db);

    // Отправляем LAN → P2P → Nostr
    let packet = network::make_message_packet(&my_pk, &encrypted);
    send_packet_to_peer(&state, &recipient_pk, &packet);

    app.emit("message-sent", serde_json::json!({ "chat_id": chat_id, "msg_id": msg_id })).ok();
    Ok(msg_id)
}

// ─── Commands — Group Chats ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct CreateGroupArgs {
    pub name: String,
    pub member_pks: Vec<String>,
}

#[tauri::command]
fn create_group(
    name: String,
    member_pks: Vec<String>,
    state: State<AppState>,
) -> Result<String, String> {
    let group_id = uuid::Uuid::new_v4().to_string();
    let db = state.db.0.lock().unwrap();
    storage::create_group_chat(&db, &group_id, &name).map_err(|e| e.to_string())?;

    // Добавляем себя как admin
    let my_pk = state.identity.lock().unwrap()
        .as_ref().map(|i| i.public_key.clone()).unwrap_or_default();
    let my_nick = state.identity.lock().unwrap()
        .as_ref().map(|i| i.nickname.clone()).unwrap_or_default();
    storage::add_group_member(&db, &group_id, &my_pk, &my_nick, true).map_err(|e| e.to_string())?;

    // Добавляем остальных участников
    let contacts = storage::get_contacts(&db).unwrap_or_default();
    let mut all_pks = vec![my_pk.clone()];
    for pk in &member_pks {
        let nick = contacts.iter().find(|c| &c.public_key == pk)
            .map(|c| c.local_alias.clone().unwrap_or(c.nickname.clone()))
            .unwrap_or_default();
        storage::add_group_member(&db, &group_id, pk, &nick, false).map_err(|e| e.to_string())?;
        all_pks.push(pk.clone());
    }
    drop(db);

    // Рассылаем приглашение через LAN → P2P → Nostr
    let packet = network::make_group_invite_packet(&my_pk, &group_id, &name, &all_pks);
    for pk in &member_pks {
        send_packet_to_peer(&state, pk, &packet);
    }

    Ok(group_id)
}

#[tauri::command]
fn get_group_members(group_id: String, state: State<AppState>) -> Result<Vec<storage::GroupMember>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_group_members(&db, &group_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_group_message(
    group_id: String,
    text: String,
    state: State<AppState>,
) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    let members = storage::get_group_members(&db, &group_id).map_err(|e| e.to_string())?;
    let chat_id = storage::get_group_chat_id(&db, &group_id)
        .map_err(|e| e.to_string())?
        .ok_or("Group chat not found")?;

    let my_pk = state.identity.lock().unwrap()
        .as_ref().map(|i| i.public_key.clone()).unwrap_or_default();

    let preview = format!("Вы: {}", &text[..text.len().min(80)]);
    let msg = storage::DbMessage {
        id: 0,
        chat_id,
        sender_key: my_pk.clone(),
        content: text.clone(),
        content_type: "text".to_string(),
        timestamp: chrono::Utc::now().timestamp(),
        status: "sent".to_string(),
        reply_to: None,
        edited_at: None,
        is_deleted: false,
        plaintext: None,
    };
    let msg_id = storage::save_message_with_preview(&db, &msg, &preview, &text).map_err(|e| e.to_string())?;
    // Queue plaintext for later per-member encryption/retry (MVP: LAN only)
    storage::enqueue_outbox(&db, "group", &group_id, msg_id, &text, "text").ok();
    drop(db);

    // Шифруем per-member заранее, затем отправляем через LAN → P2P → Nostr
    let packets: Vec<(String, network::LanPacket)> = {
        let kp_guard = state.keypair.lock().unwrap();
        if let Some(kp) = kp_guard.as_ref() {
            members.iter()
                .filter(|m| m.public_key != my_pk)
                .filter_map(|m| {
                    crypto::encrypt_message(kp, &m.public_key, text.as_bytes()).ok()
                        .and_then(|enc| serde_json::to_string(&enc).ok())
                        .map(|enc_json| {
                            let pkt = network::make_group_message_packet(&my_pk, &group_id, &enc_json);
                            (m.public_key.clone(), pkt)
                        })
                })
                .collect()
        } else { vec![] }
    };
    for (peer_pk, packet) in &packets {
        send_packet_to_peer(&state, peer_pk, packet);
    }

    Ok(())
}

// ─── Commands — Group Management ─────────────────────────────────────────────

#[tauri::command]
fn leave_group(group_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let my_pk  = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let my_nick = state.identity.lock().unwrap().as_ref().map(|i| i.nickname.clone()).unwrap_or_default();
    let (members, chat_id) = {
        let db = state.db.0.lock().unwrap();
        let members  = storage::get_group_members(&db, &group_id).unwrap_or_default();
        let chat_id  = storage::get_group_chat_id(&db, &group_id).ok().flatten();
        if let Some(cid) = chat_id {
            storage::save_system_message(&db, cid, &format!("{} покинул(а) чат", my_nick)).ok();
        }
        storage::remove_group_member(&db, &group_id, &my_pk).map_err(|e| e.to_string())?;
        (members, chat_id)
    };
    let pkt = network::make_member_left_packet(&my_pk, &group_id, &my_nick);
    for m in &members {
        if m.public_key != my_pk {
            send_packet_to_peer(&state, &m.public_key, &pkt);
        }
    }
    app.emit("group-left", serde_json::json!({ "group_id": group_id, "chat_id": chat_id })).ok();
    Ok(())
}

#[tauri::command]
fn delete_group(group_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let my_pk = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let members = {
        let db = state.db.0.lock().unwrap();
        let members = storage::get_group_members(&db, &group_id).unwrap_or_default();
        if !members.iter().any(|m| m.public_key == my_pk && m.is_admin) {
            return Err("Not group admin".into());
        }
        storage::delete_group(&db, &group_id).map_err(|e| e.to_string())?;
        members
    };
    let pkt = network::make_group_dissolved_packet(&my_pk, &group_id);
    for m in &members {
        if m.public_key != my_pk {
            send_packet_to_peer(&state, &m.public_key, &pkt);
        }
    }
    app.emit("group-dissolved", serde_json::json!({ "group_id": group_id })).ok();
    Ok(())
}

// ─── Commands — Reactions / Edit / Delete ────────────────────────────────────

#[tauri::command]
fn get_reactions(chat_id: i64, state: State<AppState>) -> Result<Vec<storage::MessageReaction>, String> {
    let db = state.db.0.lock().unwrap();
    storage::get_reactions(&db, chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_reaction_cmd(
    msg_id: i64,
    chat_id: i64,
    emoji: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let my_pk = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let (peer_key, msg_ts, msg_sender) = {
        let db = state.db.0.lock().unwrap();
        storage::add_reaction(&db, msg_id, &my_pk, &emoji).map_err(|e| e.to_string())?;
        let peer_key = storage::get_chat_peer_key(&db, chat_id).ok().flatten();
        let msg = storage::get_message_by_id(&db, msg_id).ok().flatten();
        (peer_key, msg.as_ref().map(|m| m.timestamp), msg.map(|m| m.sender_key))
    };
    app.emit("reaction-update", serde_json::json!({
        "message_id": msg_id, "sender_pk": my_pk, "emoji": emoji, "action": "add",
    })).ok();
    if let (Some(peer), Some(ts), Some(sender)) = (peer_key, msg_ts, msg_sender) {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&peer) {
                let packet = network::make_reaction_packet(&my_pk, &sender, ts, &emoji, "add");
                lan.send_to_peer(&peer, &packet).ok();
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn remove_reaction_cmd(
    msg_id: i64,
    chat_id: i64,
    emoji: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let my_pk = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let (peer_key, msg_ts, msg_sender) = {
        let db = state.db.0.lock().unwrap();
        storage::remove_reaction(&db, msg_id, &my_pk, &emoji).map_err(|e| e.to_string())?;
        let peer_key = storage::get_chat_peer_key(&db, chat_id).ok().flatten();
        let msg = storage::get_message_by_id(&db, msg_id).ok().flatten();
        (peer_key, msg.as_ref().map(|m| m.timestamp), msg.map(|m| m.sender_key))
    };
    app.emit("reaction-update", serde_json::json!({
        "message_id": msg_id, "sender_pk": my_pk, "emoji": emoji, "action": "remove",
    })).ok();
    if let (Some(peer), Some(ts), Some(sender)) = (peer_key, msg_ts, msg_sender) {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&peer) {
                let packet = network::make_reaction_packet(&my_pk, &sender, ts, &emoji, "remove");
                lan.send_to_peer(&peer, &packet).ok();
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn edit_message_cmd(
    msg_id: i64,
    chat_id: i64,
    new_text: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let my_pk = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let (peer_key, msg_ts) = {
        let db = state.db.0.lock().unwrap();
        let msg = storage::get_message_by_id(&db, msg_id).ok().flatten().ok_or("Message not found")?;
        if msg.sender_key != my_pk { return Err("Not your message".into()); }
        storage::edit_message(&db, msg_id, &new_text).map_err(|e| e.to_string())?;
        let peer_key = storage::get_chat_peer_key(&db, chat_id).ok().flatten();
        (peer_key, msg.timestamp)
    };
    app.emit("message-edited", serde_json::json!({ "message_id": msg_id, "new_content": new_text })).ok();
    if let Some(peer) = peer_key {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&peer) {
                let packet = network::make_edit_packet(&my_pk, msg_ts, &new_text);
                lan.send_to_peer(&peer, &packet).ok();
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn delete_message_cmd(
    msg_id: i64,
    chat_id: i64,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let my_pk = state.identity.lock().unwrap().as_ref().map(|i| i.public_key.clone()).ok_or("No identity")?;
    let (peer_key, msg_ts) = {
        let db = state.db.0.lock().unwrap();
        let msg = storage::get_message_by_id(&db, msg_id).ok().flatten().ok_or("Message not found")?;
        if msg.sender_key != my_pk { return Err("Not your message".into()); }
        storage::delete_message(&db, msg_id).map_err(|e| e.to_string())?;
        let peer_key = storage::get_chat_peer_key(&db, chat_id).ok().flatten();
        (peer_key, msg.timestamp)
    };
    app.emit("message-deleted", serde_json::json!({ "message_id": msg_id })).ok();
    if let Some(peer) = peer_key {
        let lan_guard = state.lan.lock().unwrap();
        if let Some(lan) = lan_guard.as_ref() {
            if lan.is_peer_online(&peer) {
                let packet = network::make_delete_packet(&my_pk, msg_ts);
                lan.send_to_peer(&peer, &packet).ok();
            }
        }
    }
    Ok(())
}

// ─── Commands — Nostr Channels ───────────────────────────────────────────────

#[tauri::command]
fn nostr_get_pubkey(state: State<AppState>) -> String {
    state.nostr.lock().unwrap()
        .as_ref()
        .map(|n| n.pubkey_hex.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn nostr_get_channels(state: State<AppState>) -> Result<Vec<storage::NostrChannelRow>, String> {
    let db = state.db.0.lock().unwrap();
    storage::nostr_get_channels(&db).map_err(|e| e.to_string())
}

#[tauri::command]
fn nostr_get_messages(channel_id: String, limit: Option<i64>, state: State<AppState>) -> Result<Vec<storage::NostrMessageRow>, String> {
    let db = state.db.0.lock().unwrap();
    storage::nostr_get_messages(&db, &channel_id, limit.unwrap_or(100))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_create_channel(name: String, about: String, state: State<'_, AppState>) -> Result<String, String> {
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    let name_clone = name.clone();
    let about_clone = about.clone();
    // Extract cmd_tx BEFORE any await to avoid holding MutexGuard across await points
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    cmd_tx.send(nostr::NostrCmd::CreateChannel { name, about, reply_tx })
        .await.map_err(|e| e.to_string())?;
    let channel_id = reply_rx.await.map_err(|e| e.to_string())??;

    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_join_channel(&db, &channel_id, "").map_err(|e| e.to_string())?;
        // Mark ourselves as creator immediately
        let my_pk = state.nostr.lock().unwrap()
            .as_ref().map(|n| n.pubkey_hex.clone()).unwrap_or_default();
        if !my_pk.is_empty() {
            storage::nostr_update_channel_meta(&db, &channel_id, &name_clone, &about_clone, "", &my_pk).ok();
        }
    }
    let cmd_tx2 = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().map(|n| n.cmd_tx.clone())
    };
    if let Some(tx) = cmd_tx2 {
        let _ = tx.send(nostr::NostrCmd::JoinChannel { channel_id: channel_id.clone() }).await;
    }
    Ok(channel_id)
}

#[tauri::command]
async fn nostr_join_channel(channel_id: String, relay: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let relay = relay.unwrap_or_default();
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_join_channel(&db, &channel_id, &relay).map_err(|e| e.to_string())?;
    }
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().map(|n| n.cmd_tx.clone())
    };
    if let Some(tx) = cmd_tx {
        let _ = tx.send(nostr::NostrCmd::JoinChannel { channel_id }).await;
    }
    Ok(())
}

#[tauri::command]
async fn nostr_leave_channel(channel_id: String, state: State<'_, AppState>) -> Result<(), String> {
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_leave_channel(&db, &channel_id).map_err(|e| e.to_string())?;
    }
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().map(|n| n.cmd_tx.clone())
    };
    if let Some(tx) = cmd_tx {
        let _ = tx.send(nostr::NostrCmd::LeaveChannel { channel_id }).await;
    }
    Ok(())
}

#[tauri::command]
async fn nostr_send_channel_message(
    channel_id: String,
    content: String,
    reply_to: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let relay = DEFAULT_RELAY.to_string();
    let (cmd_tx, my_pk) = {
        let guard = state.nostr.lock().unwrap();
        let n = guard.as_ref().ok_or("Nostr not ready")?;
        (n.cmd_tx.clone(), n.pubkey_hex.clone())
    };
    cmd_tx.send(nostr::NostrCmd::SendMessage {
        channel_id: channel_id.clone(),
        relay,
        content: content.clone(),
        reply_to: reply_to.clone(),
    }).await.map_err(|e| e.to_string())?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let temp_event_id = format!("local_{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let db = state.db.0.lock().unwrap();
    storage::nostr_save_message(
        &db,
        &temp_event_id,
        &channel_id,
        &my_pk,
        &content,
        timestamp,
        reply_to.as_deref(),
        true,
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn nostr_mark_channel_read(channel_id: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::nostr_mark_channel_read(&db, &channel_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_update_channel_meta(
    channel_id: String,
    name: String,
    about: String,
    picture: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_update_channel_meta_info(&db, &channel_id, &name, &about, &picture)
            .map_err(|e| e.to_string())?;
    }
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    cmd_tx.send(nostr::NostrCmd::UpdateChannelMeta { channel_id, name, about, picture })
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_chat(chat_id: i64, state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::delete_direct_chat(&db, chat_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_delete_channel_cmd(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_delete_channel(&db, &channel_id).map_err(|e| e.to_string())?;
    }
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    cmd_tx.send(nostr::NostrCmd::DeleteChannel { channel_id })
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
fn nostr_get_subscriber_count(channel_id: String, state: State<AppState>) -> i64 {
    let db = state.db.0.lock().unwrap();
    storage::nostr_get_subscriber_count(&db, &channel_id).unwrap_or(0)
}

// ─── Commands — Channel v2: Edit / Delete / Reactions / Comments ─────────────

#[tauri::command]
async fn nostr_edit_channel_message(
    event_id: String,
    channel_id: String,
    new_content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    {
        let now = chrono::Utc::now().timestamp();
        let db = state.db.0.lock().unwrap();
        storage::nostr_edit_message(&db, &event_id, &new_content, now)
            .map_err(|e| e.to_string())?;
    }
    cmd_tx.send(nostr::NostrCmd::EditChannelMessage {
        channel_id,
        original_event_id: event_id,
        relay: DEFAULT_RELAY.to_string(),
        new_content,
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_delete_channel_message(
    event_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_soft_delete_message(&db, &event_id)
            .map_err(|e| e.to_string())?;
    }
    cmd_tx.send(nostr::NostrCmd::DeleteChannelMessage { event_id })
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_send_channel_reaction(
    event_id: String,
    channel_id: String,
    author_pubkey: String,
    emoji: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    // Optimistic local save with a temp reaction_event_id
    let temp_rid = format!("local_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let my_pk = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().map(|n| n.pubkey_hex.clone()).unwrap_or_default()
    };
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_save_reaction(&db, &event_id, &channel_id, &my_pk, &emoji, &temp_rid)
            .map_err(|e| e.to_string())?;
    }
    cmd_tx.send(nostr::NostrCmd::SendReaction {
        target_event_id: event_id,
        target_author_pubkey: author_pubkey,
        emoji,
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_remove_channel_reaction(
    reaction_event_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let cmd_tx = {
        let guard = state.nostr.lock().unwrap();
        guard.as_ref().ok_or("Nostr not ready")?.cmd_tx.clone()
    };
    {
        let db = state.db.0.lock().unwrap();
        storage::nostr_remove_reaction(&db, &reaction_event_id)
            .map_err(|e| e.to_string())?;
    }
    cmd_tx.send(nostr::NostrCmd::RemoveReaction { reaction_event_id })
        .await.map_err(|e| e.to_string())
}

#[tauri::command]
fn nostr_get_channel_reactions(
    channel_id: String,
    state: State<AppState>,
) -> Result<Vec<storage::NostrReactionRow>, String> {
    let db = state.db.0.lock().unwrap();
    storage::nostr_get_reactions(&db, &channel_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn nostr_send_comment(
    channel_id: String,
    parent_event_id: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let relay = DEFAULT_RELAY.to_string();
    let (cmd_tx, my_pk) = {
        let guard = state.nostr.lock().unwrap();
        let n = guard.as_ref().ok_or("Nostr not ready")?;
        (n.cmd_tx.clone(), n.pubkey_hex.clone())
    };
    cmd_tx.send(nostr::NostrCmd::SendComment {
        channel_id: channel_id.clone(),
        relay: relay.clone(),
        parent_event_id: parent_event_id.clone(),
        content: content.clone(),
    }).await.map_err(|e| e.to_string())?;

    // Save locally as a reply
    let timestamp = chrono::Utc::now().timestamp();
    let temp_event_id = format!("local_comment_{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
    let db = state.db.0.lock().unwrap();
    storage::nostr_save_message(
        &db, &temp_event_id, &channel_id, &my_pk,
        &content, timestamp, Some(&parent_event_id), true,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_messages(
    query: String,
    limit: Option<i64>,
    state: State<AppState>,
) -> Result<Vec<storage::SearchResult>, String> {
    if query.trim().len() < 2 {
        return Ok(vec![]);
    }
    let db = state.db.0.lock().unwrap();
    storage::search_messages(&db, &query, limit.unwrap_or(60))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_p2p_peers(state: State<AppState>) -> Vec<p2p::P2pPeer> {
    let p2p_guard = state.p2p.lock().unwrap();
    match p2p_guard.as_ref() {
        Some(p2p) => p2p.get_peers(),
        None => vec![],
    }
}

#[tauri::command]
fn sign_out(state: State<AppState>) -> Result<(), String> {
    let db = state.db.0.lock().unwrap();
    storage::set_setting(&db, "nickname", "").map_err(|e| e.to_string())?;
    *state.identity.lock().unwrap() = None;
    *state.keypair.lock().unwrap() = None;
    Ok(())
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 1. Открываем БД
            let data_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("sovietmsg.db");
            let db_path_str = db_path.to_str().unwrap_or("sovietmsg.db");
            // Ключ для шифрования чувствительных полей (хранится в OS keyring)
            let enc_key = get_or_create_field_enc_key();
            let conn = storage::open(db_path_str, &enc_key)
                .expect("Cannot open database");

            // 2. Загружаем сохранённую идентичность
            let nickname = storage::get_setting(&conn, "nickname")
                .ok().flatten().unwrap_or_default();
            let (loaded_identity, loaded_keypair) = if !nickname.is_empty() {
                match identity::load_identity(&nickname) {
                    Ok(Some((id, kp))) => (Some(id), Some(kp)),
                    _ => (None, None),
                }
            } else {
                (None, None)
            };

            // 3. Создаём канал для входящих LAN-пакетов
            let (tx, mut rx) = mpsc::unbounded_channel::<(String, LanPacket)>();

            // 3b. Initialize Nostr keys and channels
            let (n_secret, n_pubkey) = match storage::nostr_get_keys(&conn, &enc_key) {
                Ok(Some(keys)) => keys,
                _ => {
                    let (s, p) = nostr::generate_keys();
                    storage::nostr_save_keys(&conn, &enc_key, &s, &p).ok();
                    (s, p)
                }
            };
            let n_channel_ids: Vec<String> = storage::nostr_get_channels(&conn)
                .unwrap_or_default()
                .into_iter()
                .map(|c| c.channel_id)
                .collect();

            // Soviet pubkey for Nostr DM subscription (empty if no identity yet)
            let n_soviet_pk = loaded_identity.as_ref()
                .map(|id| id.public_key.clone())
                .unwrap_or_default();
            // Snapshot private key bytes before moving keypair into AppState
            let p2p_sk = loaded_keypair.as_ref().map(|kp| kp.private_key_bytes());

            // Open a second DB connection for Nostr (runs in separate thread)
            let n_db = Arc::new(std::sync::Mutex::new(
                storage::open(db_path_str, &enc_key)
                    .expect("Cannot open nostr db connection")
            ));
            let nostr_handle = nostr::start(
                n_secret,
                n_pubkey,
                n_soviet_pk,
                n_channel_ids,
                app.handle().clone(),
                n_db,
            );

            // 4. СНАЧАЛА регистрируем состояние (чтобы обработчик мог его использовать)
            app.manage(AppState {
                db: Db(std::sync::Mutex::new(conn)),
                keypair: Mutex::new(loaded_keypair),
                identity: Mutex::new(loaded_identity.clone()),
                lan: Mutex::new(None),
                lan_tx: tx.clone(),
                nostr: Mutex::new(Some(nostr_handle)),
                p2p: Mutex::new(None),
                popout_registry: Mutex::new(std::collections::HashMap::new()),
            });

            // 5. Запускаем LAN если есть идентичность
            if let Some(ref id) = loaded_identity {
                let state: tauri::State<AppState> = app.state();
                let l = LanNetwork::new(id.public_key.clone(), id.nickname.clone(), tx.clone());
                l.start().ok();
                *state.lan.lock().unwrap() = Some(l);
            }

            // 5b. Запускаем P2P mesh если есть keypair
            if let Some(sk_bytes) = p2p_sk {
                let app_h = app.handle().clone();
                match p2p::start(sk_bytes, tx, app_h, db_path_str.to_string(), enc_key) {
                    Ok(handle) => {
                        let state: tauri::State<AppState> = app.state();
                        *state.p2p.lock().unwrap() = Some(handle);
                    }
                    Err(e) => log::error!("P2P init error: {}", e),
                }
            }

            // 6. Запускаем обработчик входящих пакетов в отдельном потоке
            let app_handler = app.handle().clone();
            std::thread::spawn(move || {
                while let Some((_sender_pk, packet)) = rx.blocking_recv() {
                    handle_lan_packet(&app_handler, packet);
                }
            });

            // 7. Глобальный обработчик событий меню (fallback)
            app.on_menu_event(|app, event| {
                handle_tray_menu(app, event.id().as_ref());
            });

            // 8. Системный трей
            setup_tray(app)?;

            // 8b. Offline outbox retry worker (ICQ offline messages)
            start_outbox_worker(app.handle().clone());

            // 9. Показываем окно + перехватываем крестик (скрывать в трей вместо закрытия)
            if let Some(window) = app.get_webview_window("main") {
                window.show().ok();
                window.set_focus().ok();

                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            w.hide().ok();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_identity,
            create_identity,
            export_keys,
            import_keys,
            get_contacts,
            add_contact,
            delete_contact,
            update_contact,
            get_lan_peers,
            get_safety_number,
            get_contact_requests,
            accept_contact_request,
            reject_contact_request,
            send_contact_request,
            get_chats,
            get_messages,
            mark_read,
            send_message,
            decrypt_message_text,
            send_typing,
            get_settings,
            save_settings,
            set_status,
            get_outbox,
            cancel_outbox,
            send_file,
            create_group,
            get_group_members,
            send_group_message,
            leave_group,
            delete_group,
            get_reactions,
            add_reaction_cmd,
            remove_reaction_cmd,
            edit_message_cmd,
            delete_message_cmd,
            nostr_get_pubkey,
            nostr_get_channels,
            nostr_get_messages,
            nostr_create_channel,
            nostr_join_channel,
            nostr_leave_channel,
            nostr_send_channel_message,
            nostr_mark_channel_read,
            nostr_update_channel_meta,
            delete_chat,
            nostr_delete_channel_cmd,
            nostr_get_subscriber_count,
            nostr_edit_channel_message,
            nostr_delete_channel_message,
            nostr_send_channel_reaction,
            nostr_remove_channel_reaction,
            nostr_get_channel_reactions,
            nostr_send_comment,
            get_p2p_peers,
            search_messages,
            sign_out,
            set_tray_update_badge,
            open_chat_window,
            open_channel_window,
            get_popout_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Soviet");
}

/// Читает тему из базы настроек и возвращает 'dark' или 'light'
fn resolve_theme(state: &tauri::State<'_, AppState>) -> &'static str {
    let db = state.db.0.lock().unwrap();
    match storage::get_setting(&db, "theme").ok().flatten().unwrap_or_default().as_str() {
        "light" => "light",
        _ => "dark",
    }
}

/// Получить данные попаут-окна по label.
/// Фронтенд вызывает это сразу после загрузки — данные уже в AppState (Rust),
/// поэтому не зависим от initialization_script / sessionStorage / URL-параметров.
#[tauri::command]
fn get_popout_data(state: State<AppState>, label: String) -> Option<serde_json::Value> {
    state.popout_registry.lock().unwrap().get(&label).cloned()
}

/// Открыть чат в отдельном окне
#[tauri::command]
fn open_chat_window(app: AppHandle, state: tauri::State<'_, AppState>, chat_id: i64, peer_key: String, peer_name: String) -> Result<(), String> {
    let safe_label: String = if chat_id > 0 {
        format!("chat-{}", chat_id)
    } else {
        let id: String = peer_key.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
        format!("chat-{}", id)
    };
    if let Some(w) = app.get_webview_window(&safe_label) {
        w.show().ok();
        w.set_focus().ok();
        return Ok(());
    }
    let theme = resolve_theme(&state);
    // Сохраняем данные в AppState — фронтенд получит их через invoke('get_popout_data').
    // Это надёжнее initialization_script (затирается Vite HMR),
    // sessionStorage (недоступен до загрузки страницы) и URL query params
    // (обрезаются WebviewUrl::App на Windows).
    {
        let mut reg = state.popout_registry.lock().unwrap();
        reg.insert(safe_label.clone(), serde_json::json!({
            "type": "chat",
            "chatId": chat_id,
            "peerKey": peer_key,
            "peerName": peer_name,
            "theme": theme,
        }));
    }
    let win = tauri::WebviewWindowBuilder::new(&app, &safe_label, tauri::WebviewUrl::App("popout.html".into()))
        .title(&peer_name)
        .inner_size(480.0, 620.0)
        .min_inner_size(360.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    // Очистка реестра при закрытии окна
    let label_for_close = safe_label.clone();
    let app_for_close = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            app_for_close.state::<AppState>().popout_registry.lock().unwrap().remove(&label_for_close);
        }
    });
    Ok(())
}

/// Открыть канал в отдельном окне
#[tauri::command]
fn open_channel_window(app: AppHandle, state: tauri::State<'_, AppState>, channel_id: String, channel_name: String) -> Result<(), String> {
    let safe_id: String = channel_id.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    let label = format!("chan-{}", safe_id);
    if let Some(w) = app.get_webview_window(&label) {
        w.show().ok();
        w.set_focus().ok();
        return Ok(());
    }
    let theme = resolve_theme(&state);
    {
        let mut reg = state.popout_registry.lock().unwrap();
        reg.insert(label.clone(), serde_json::json!({
            "type": "channel",
            "channelId": channel_id,
            "channelName": channel_name,
            "theme": theme,
        }));
    }
    let win = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("popout.html".into()))
        .title(&channel_name)
        .inner_size(560.0, 650.0)
        .min_inner_size(400.0, 400.0)
        .build()
        .map_err(|e| e.to_string())?;
    // Очистка реестра при закрытии окна
    let label_for_close = label.clone();
    let app_for_close = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            app_for_close.state::<AppState>().popout_registry.lock().unwrap().remove(&label_for_close);
        }
    });
    Ok(())
}

/// Обновляет иконку трея + тултип с числом непрочитанных
fn update_tray_badge(app: &AppHandle, unread: u32) {
    let Some(tray) = app.tray_by_id("main-tray") else { return };
    let icon_bytes = if unread > 0 { TRAY_MSG_PNG } else { TRAY_IDLE_PNG };
    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
        tray.set_icon(Some(icon)).ok();
    }
    let tooltip = if unread > 0 {
        format!("Soviet — {} непрочитанных", unread)
    } else {
        "Soviet Messenger".to_string()
    };
    tray.set_tooltip(Some(&tooltip)).ok();
    // macOS: показываем цифру рядом с иконкой в menu bar
    #[cfg(target_os = "macos")]
    {
        if unread > 0 {
            let label = if unread > 99 { "99+".to_string() } else { unread.to_string() };
            tray.set_title(Some(label)).ok();
        } else {
            tray.set_title(None::<String>).ok();
        }
    }
}

/// Обновляет тултип трея и добавляет пункт меню «Обновить» при наличии обновления
#[tauri::command]
fn set_tray_update_badge(app: AppHandle, version: String) {
    let label = if version.is_empty() {
        "⬆ Доступно обновление!".to_string()
    } else {
        format!("⬆ Доступно обновление v{}!", version)
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        tray.set_tooltip(Some(&label)).ok();
    }
    // Emit event so frontend can show update dialog if window is hidden
    app.emit("update-available-tray", &version).ok();
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        w.show().ok();
        w.set_focus().ok();
        return;
    }
    for (_, w) in app.webview_windows() {
        w.show().ok();
        w.set_focus().ok();
        return;
    }
}

/// Выполнить JS в главном окне — надёжнее emit когда окно было скрыто
fn eval_in_window(app: &AppHandle, js: &str) {
    if let Some(w) = app.get_webview_window("main") {
        w.eval(js).ok();
    }
}

fn handle_tray_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => {
            show_main_window(app);
        }
        "quit" => app.exit(0),
        "settings" => {
            show_main_window(app);
            let app2 = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                eval_in_window(&app2, "window.__trayNavigate && window.__trayNavigate('settings')");
                app2.emit("navigate", "settings").ok();
            });
        }
        "status_online" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('online')");
            app.emit("tray-status-change", "online").ok();
        }
        "status_away" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('away')");
            app.emit("tray-status-change", "away").ok();
        }
        "status_busy" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('busy')");
            app.emit("tray-status-change", "busy").ok();
        }
        "status_na" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('na')");
            app.emit("tray-status-change", "na").ok();
        }
        "status_dnd" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('dnd')");
            app.emit("tray-status-change", "dnd").ok();
        }
        "status_invis" => {
            eval_in_window(app, "window.__trayStatus && window.__trayStatus('invisible')");
            app.emit("tray-status-change", "invisible").ok();
        }
        _ => {}
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open_item     = MenuItemBuilder::with_id("open",         "Открыть Soviet").build(app)?;
    let sep           = PredefinedMenuItem::separator(app)?;
    let status_online = MenuItemBuilder::with_id("status_online","🟢 В сети").build(app)?;
    let status_away   = MenuItemBuilder::with_id("status_away",  "🟡 Отошёл").build(app)?;
    let status_na     = MenuItemBuilder::with_id("status_na",    "🟣 Недоступен").build(app)?;
    let status_dnd    = MenuItemBuilder::with_id("status_dnd",   "🔴 Не беспокоить").build(app)?;
    let status_invis  = MenuItemBuilder::with_id("status_invis", "⚫ Невидимка").build(app)?;
    let sep2          = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItemBuilder::with_id("settings",     "⚙ Настройки").build(app)?;
    let sep3          = PredefinedMenuItem::separator(app)?;
    let quit_item     = MenuItemBuilder::with_id("quit",         "✕ Выход").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&sep)
        .item(&status_online)
        .item(&status_away)
        .item(&status_na)
        .item(&status_dnd)
        .item(&status_invis)
        .item(&sep2)
        .item(&settings_item)
        .item(&sep3)
        .item(&quit_item)
        .build()?;

    let tray_icon = tauri::image::Image::from_bytes(TRAY_IDLE_PNG)
        .map_err(|e| tauri::Error::Anyhow(e.into()))?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("Soviet")
        .icon(tray_icon)
        .on_menu_event(|app, event| {
            handle_tray_menu(app, event.id().as_ref());
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                let app = tray.app_handle();
                // Левый клик — показать/скрыть окно
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        w.hide().ok();
                    } else {
                        w.show().ok();
                        w.set_focus().ok();
                    }
                } else {
                    show_main_window(app);
                }
            }
        })
        .build(app)?;

    // Предотвращаем дроп TrayIcon — иначе Tauri отключает event-хэндлеры
    std::mem::forget(tray);

    Ok(())
}
