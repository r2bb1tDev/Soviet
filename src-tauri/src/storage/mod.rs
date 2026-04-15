use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::sync::Mutex;
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use chacha20poly1305::aead::{Aead, KeyInit};

// ─── Peer reputation ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerReputation {
    pub peer_id:      String,
    pub soviet_pk:    Option<String>,
    pub score:        i64,
    pub msg_count:    i64,
    pub last_msg_at:  Option<i64>,
    pub banned_until: Option<i64>,
    pub updated_at:   i64,
}

pub fn reputation_is_banned(conn: &Connection, peer_id: &str) -> bool {
    let now = chrono::Utc::now().timestamp();
    let banned: i64 = conn.query_row(
        "SELECT COALESCE(banned_until, 0) FROM peer_reputation WHERE peer_id=?1",
        params![peer_id], |r| r.get(0),
    ).unwrap_or(0);
    banned > now
}

pub fn reputation_record_message(
    conn: &Connection,
    peer_id: &str,
    soviet_pk: Option<&str>,
    valid: bool,
) {
    let now = chrono::Utc::now().timestamp();
    // Upsert — create row if not exists
    conn.execute(
        "INSERT INTO peer_reputation(peer_id, soviet_pk, score, msg_count, last_msg_at, updated_at)
         VALUES(?1,?2,100,0,NULL,?3)
         ON CONFLICT(peer_id) DO NOTHING",
        params![peer_id, soviet_pk, now],
    ).ok();

    if valid {
        // Check rate: if > 20 messages in the last 60s → penalise
        let recent: i64 = conn.query_row(
            "SELECT msg_count FROM peer_reputation WHERE peer_id=?1",
            params![peer_id], |r| r.get(0),
        ).unwrap_or(0);
        let last: i64 = conn.query_row(
            "SELECT COALESCE(last_msg_at, 0) FROM peer_reputation WHERE peer_id=?1",
            params![peer_id], |r| r.get(0),
        ).unwrap_or(0);
        let (delta_score, reset_count) = if now - last < 60 && recent >= 20 {
            // Flood — penalise
            (-30_i64, false)
        } else if now - last >= 60 {
            (1_i64, true) // new window, reward
        } else {
            (1_i64, false)
        };
        if reset_count {
            conn.execute(
                "UPDATE peer_reputation SET score=MIN(200,score+?1), msg_count=1, last_msg_at=?2, updated_at=?2 WHERE peer_id=?3",
                params![delta_score, now, peer_id],
            ).ok();
        } else {
            conn.execute(
                "UPDATE peer_reputation SET score=MIN(200,score+?1), msg_count=msg_count+1, last_msg_at=?2, updated_at=?2 WHERE peer_id=?3",
                params![delta_score, now, peer_id],
            ).ok();
        }
    } else {
        // Invalid payload → heavy penalty
        conn.execute(
            "UPDATE peer_reputation SET score=score-20, updated_at=?1 WHERE peer_id=?2",
            params![now, peer_id],
        ).ok();
    }

    // Apply ban if score dropped below threshold
    let score: i64 = conn.query_row(
        "SELECT score FROM peer_reputation WHERE peer_id=?1",
        params![peer_id], |r| r.get(0),
    ).unwrap_or(100);
    if score < 0 {
        // 24-hour ban
        conn.execute(
            "UPDATE peer_reputation SET banned_until=?1, updated_at=?1 WHERE peer_id=?2",
            params![now + 86400, peer_id],
        ).ok();
    } else if score < 20 {
        // 1-hour ban
        conn.execute(
            "UPDATE peer_reputation SET banned_until=?1, updated_at=?1 WHERE peer_id=?2",
            params![now + 3600, peer_id],
        ).ok();
    }
}

pub fn get_peer_reputations(conn: &Connection) -> anyhow::Result<Vec<PeerReputation>> {
    let mut stmt = conn.prepare(
        "SELECT peer_id, soviet_pk, score, msg_count, last_msg_at, banned_until, updated_at
         FROM peer_reputation ORDER BY score ASC LIMIT 100"
    )?;
    let rows = stmt.query_map([], |r| Ok(PeerReputation {
        peer_id:      r.get(0)?,
        soviet_pk:    r.get(1)?,
        score:        r.get(2)?,
        msg_count:    r.get(3)?,
        last_msg_at:  r.get(4)?,
        banned_until: r.get(5)?,
        updated_at:   r.get(6)?,
    }))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DbContact {
    pub id: i64,
    pub public_key: String,
    pub nickname: String,
    pub local_alias: Option<String>,
    pub status: String,
    pub status_text: Option<String>,
    pub last_seen: Option<i64>,
    pub notes: Option<String>,
    pub is_blocked: bool,
    pub is_favorite: bool,
    pub added_at: i64,
    pub verified: bool,
    pub avatar_data: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DbMessage {
    pub id: i64,
    pub chat_id: i64,
    pub sender_key: String,
    pub content: String,        // зашифрованный JSON (или plaintext если edited_at set)
    pub content_type: String,   // "text" | "file" | "image"
    pub timestamp: i64,
    pub status: String,         // "sent" | "delivered" | "read"
    pub reply_to: Option<i64>,
    pub edited_at: Option<i64>,
    pub is_deleted: bool,
    pub plaintext: Option<String>, // открытый текст для отображения (не нужно расшифровывать)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageReaction {
    pub id: i64,
    pub message_id: i64,
    pub sender_key: String,
    pub emoji: String,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DbChat {
    pub id: i64,
    pub chat_type: String,      // "direct" | "group"
    pub peer_key: Option<String>,
    pub group_id: Option<String>,
    pub created_at: i64,
    pub last_message: Option<String>,
    pub last_message_time: Option<i64>,
    pub unread_count: i64,
    pub group_name: Option<String>,  // имя группы (только для group-чатов)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ContactRequest {
    pub id: i64,
    pub public_key: String,
    pub nickname: String,
    pub direction: String,   // "incoming" | "outgoing"
    pub status: String,      // "pending" | "accepted" | "rejected"
    pub created_at: i64,
}

// ─── Outbox (offline queue) ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct OutboxItem {
    pub id: i64,
    pub kind: String,            // "direct" | "group" | "file"
    pub target: String,          // recipient_pk or group_id
    pub msg_id: i64,             // messages.id (local)
    pub payload: String,         // encrypted_json or group_message_json
    pub content_type: String,    // "text" | "file" | "image"
    pub status: String,          // "queued" | "sent" | "failed"
    pub attempts: i64,
    pub next_retry_at: i64,
    pub last_error: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Открывает (или создаёт) зашифрованную SQLCipher БД.
/// `enc_key` — 32-байтовый ключ из OS keyring.
pub fn open(path: &str, enc_key: &[u8; 32]) -> anyhow::Result<Connection> {
    // Если БД ещё не зашифрована — сначала мигрируем
    migrate_to_encrypted(path, enc_key)?;

    let conn = Connection::open(path)?;
    // PRAGMA key должен быть первым оператором после открытия соединения
    let key_hex = hex::encode(enc_key);
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";\nPRAGMA journal_mode=WAL;\nPRAGMA foreign_keys=ON;", key_hex))?;
    migrate(&conn)?;
    Ok(conn)
}

/// Однократная миграция незашифрованной БД в SQLCipher.
/// Определяет тип БД по magic bytes — надёжно работает с SQLCipher.
fn migrate_to_encrypted(path: &str, enc_key: &[u8; 32]) -> anyhow::Result<()> {
    use std::path::Path;
    use std::io::Read;

    // Если файла нет — новая БД, будет создана сразу зашифрованной
    if !Path::new(path).exists() {
        return Ok(());
    }

    // SQLite plaintext-файл ВСЕГДА начинается с "SQLite format 3\0" (16 байт).
    // SQLCipher-зашифрованный файл начинается с произвольных байт.
    // Это ЕДИНСТВЕННЫЙ надёжный способ определить тип при использовании SQLCipher.
    let is_plain = {
        let mut f = std::fs::File::open(path)?;
        let mut header = [0u8; 16];
        matches!(f.read_exact(&mut header), Ok(())) && &header == b"SQLite format 3\0"
    };

    if !is_plain {
        // Уже зашифрована или повреждена — ничего не делаем
        return Ok(());
    }

    log::info!("SQLCipher: migrating plaintext DB to encrypted...");

    let enc_path = format!("{}.enc", path);
    let key_hex = hex::encode(enc_key);

    // Открываем plaintext БД: PRAGMA key = "" в SQLCipher = без шифрования
    let old = Connection::open(path)?;
    old.execute_batch("PRAGMA key = \"\";")?;
    // Экспортируем в новую зашифрованную БД
    old.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS encrypted KEY \"x'{}'\";\
         SELECT sqlcipher_export('encrypted');\
         DETACH DATABASE encrypted;",
        enc_path, key_hex
    ))?;
    drop(old);

    // Резервная копия + заменяем оригинал
    let bak_path = format!("{}.bak", path);
    std::fs::copy(path, &bak_path)?;
    std::fs::rename(&enc_path, path)?;

    log::info!("SQLCipher: migration done. Backup saved at {}", bak_path);
    Ok(())
}

// ─── Application-level field encryption (ChaCha20-Poly1305) ──────────────────

/// Шифрует строку с помощью ChaCha20-Poly1305.
/// Формат вывода (hex): <24-символа nonce><hex-ciphertext>
pub fn encrypt_field(key: &[u8; 32], plaintext: &str) -> String {
    use rand::RngCore;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap_or_default();
    format!("{}{}", hex::encode(nonce_bytes), hex::encode(ct))
}

/// Расшифровывает строку, зашифрованную через `encrypt_field`.
pub fn decrypt_field(key: &[u8; 32], encoded: &str) -> anyhow::Result<String> {
    if encoded.len() < 24 {
        anyhow::bail!("encrypted field too short");
    }
    let nonce_bytes = hex::decode(&encoded[..24])?;
    let ct = hex::decode(&encoded[24..])?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let pt = cipher.decrypt(nonce, ct.as_slice())
        .map_err(|e| anyhow::anyhow!("decrypt_field: {}", e))?;
    Ok(String::from_utf8(pt)?)
}

fn migrate(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS contacts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key  TEXT    NOT NULL UNIQUE,
            nickname    TEXT    NOT NULL,
            local_alias TEXT,
            status      TEXT    DEFAULT 'offline',
            status_text TEXT,
            last_seen   INTEGER,
            notes       TEXT,
            is_blocked  INTEGER DEFAULT 0,
            is_favorite INTEGER DEFAULT 0,
            added_at    INTEGER NOT NULL,
            verified    INTEGER DEFAULT 0,
            verified_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS contact_requests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            public_key  TEXT    NOT NULL,
            nickname    TEXT    NOT NULL,
            direction   TEXT    NOT NULL,
            status      TEXT    DEFAULT 'pending',
            created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_type       TEXT    NOT NULL,
            peer_key        TEXT,
            group_id        TEXT,
            created_at      INTEGER NOT NULL,
            last_message    TEXT,
            last_message_time INTEGER,
            unread_count    INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id      INTEGER NOT NULL REFERENCES chats(id),
            sender_key   TEXT    NOT NULL,
            content      TEXT    NOT NULL,
            content_type TEXT    NOT NULL DEFAULT 'text',
            timestamp    INTEGER NOT NULL,
            status       TEXT    DEFAULT 'sent',
            reply_to     INTEGER REFERENCES messages(id)
        );

        CREATE TABLE IF NOT EXISTS outbox (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            kind          TEXT    NOT NULL,        -- direct | group | file
            target        TEXT    NOT NULL,        -- recipient_pk or group_id
            msg_id        INTEGER NOT NULL,        -- FK to messages.id (logical link)
            payload       TEXT    NOT NULL,        -- encrypted JSON or group payload
            content_type  TEXT    NOT NULL DEFAULT 'text',
            status        TEXT    NOT NULL DEFAULT 'queued',
            attempts      INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER NOT NULL,
            last_error    TEXT,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox(status, next_retry_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_msg_id ON outbox(msg_id);

        CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_contacts_pk ON contacts(public_key);

        CREATE TABLE IF NOT EXISTS message_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            sender_key TEXT NOT NULL,
            emoji TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(message_id, sender_key, emoji)
        );

        CREATE TABLE IF NOT EXISTS group_members (
            group_id  TEXT NOT NULL,
            public_key TEXT NOT NULL,
            nickname   TEXT NOT NULL DEFAULT '',
            is_admin   INTEGER DEFAULT 0,
            joined_at  INTEGER NOT NULL,
            PRIMARY KEY (group_id, public_key)
        );

        CREATE TABLE IF NOT EXISTS nostr_keys (
            id INTEGER PRIMARY KEY,
            secret_key_hex TEXT NOT NULL,
            public_key_hex TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nostr_channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            about TEXT DEFAULT '',
            picture TEXT DEFAULT '',
            creator_pubkey TEXT DEFAULT '',
            relay TEXT DEFAULT '',
            joined_at INTEGER,
            last_message TEXT,
            last_message_time INTEGER,
            unread_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS nostr_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT UNIQUE NOT NULL,
            channel_id TEXT NOT NULL,
            sender_pubkey TEXT NOT NULL,
            sender_name TEXT,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            reply_to TEXT,
            is_mine INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS nostr_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            reactor_pubkey TEXT NOT NULL,
            emoji TEXT NOT NULL,
            reaction_event_id TEXT,
            created_at INTEGER NOT NULL,
            UNIQUE(event_id, reactor_pubkey, emoji)
        );

        CREATE TABLE IF NOT EXISTS peer_reputation (
            peer_id      TEXT PRIMARY KEY,
            soviet_pk    TEXT,
            score        INTEGER DEFAULT 100,
            msg_count    INTEGER DEFAULT 0,
            last_msg_at  INTEGER,
            banned_until INTEGER,
            updated_at   INTEGER NOT NULL
        );
    ")?;
    // Add new columns to existing messages table (silently ignored if already present)
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN edited_at INTEGER", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN is_deleted INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN plaintext TEXT", []);
    // FTS index for plaintext search
    let _ = conn.execute_batch("
        CREATE INDEX IF NOT EXISTS idx_messages_plaintext ON messages(plaintext);
    ");
    // Add new columns to nostr_messages (silently ignored if already present)
    let _ = conn.execute("ALTER TABLE nostr_messages ADD COLUMN edited_at INTEGER", []);
    let _ = conn.execute("ALTER TABLE nostr_messages ADD COLUMN is_deleted INTEGER DEFAULT 0", []);
    // Avatar column for contacts (silently ignored if already present)
    let _ = conn.execute("ALTER TABLE contacts ADD COLUMN avatar_data TEXT", []);
    Ok(())
}

pub fn set_contact_avatar(conn: &Connection, public_key: &str, avatar_data: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE contacts SET avatar_data=?1 WHERE public_key=?2",
        params![avatar_data, public_key],
    )?;
    Ok(())
}

pub fn enqueue_outbox(
    conn: &Connection,
    kind: &str,
    target: &str,
    msg_id: i64,
    payload: &str,
    content_type: &str,
) -> anyhow::Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO outbox(kind,target,msg_id,payload,content_type,status,attempts,next_retry_at,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,'queued',0,?6,?6,?6)",
        params![kind, target, msg_id, payload, content_type, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_due_outbox(conn: &Connection, limit: i64) -> anyhow::Result<Vec<OutboxItem>> {
    let now = chrono::Utc::now().timestamp();
    let mut stmt = conn.prepare(
        "SELECT id,kind,target,msg_id,payload,content_type,status,attempts,next_retry_at,last_error,created_at,updated_at
         FROM outbox
         WHERE status='queued' AND next_retry_at<=?1
         ORDER BY next_retry_at ASC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![now, limit], |r| {
        Ok(OutboxItem {
            id: r.get(0)?,
            kind: r.get(1)?,
            target: r.get(2)?,
            msg_id: r.get(3)?,
            payload: r.get(4)?,
            content_type: r.get(5)?,
            status: r.get(6)?,
            attempts: r.get(7)?,
            next_retry_at: r.get(8)?,
            last_error: r.get(9)?,
            created_at: r.get(10)?,
            updated_at: r.get(11)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_outbox(conn: &Connection, status: &str, limit: i64) -> anyhow::Result<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "SELECT id,kind,target,msg_id,payload,content_type,status,attempts,next_retry_at,last_error,created_at,updated_at
         FROM outbox
         WHERE status=?1
         ORDER BY updated_at DESC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![status, limit], |r| {
        Ok(OutboxItem {
            id: r.get(0)?,
            kind: r.get(1)?,
            target: r.get(2)?,
            msg_id: r.get(3)?,
            payload: r.get(4)?,
            content_type: r.get(5)?,
            status: r.get(6)?,
            attempts: r.get(7)?,
            next_retry_at: r.get(8)?,
            last_error: r.get(9)?,
            created_at: r.get(10)?,
            updated_at: r.get(11)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn mark_outbox_attempt(
    conn: &Connection,
    outbox_id: i64,
    attempts: i64,
    next_retry_at: i64,
    last_error: Option<&str>,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE outbox
         SET attempts=?1, next_retry_at=?2, last_error=?3, updated_at=?4
         WHERE id=?5",
        params![attempts, next_retry_at, last_error, now, outbox_id],
    )?;
    Ok(())
}

pub fn mark_outbox_sent(conn: &Connection, outbox_id: i64) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE outbox SET status='sent', updated_at=?1 WHERE id=?2",
        params![now, outbox_id],
    )?;
    Ok(())
}

pub fn drop_outbox_for_msg(conn: &Connection, msg_id: i64) -> anyhow::Result<()> {
    conn.execute("DELETE FROM outbox WHERE msg_id=?1", params![msg_id])?;
    Ok(())
}

// ─── Settings ────────────────────────────────────────────────────────────────

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> anyhow::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key=?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get(0).unwrap_or_default()))
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

pub fn upsert_contact(conn: &Connection, c: &DbContact) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO contacts(public_key,nickname,local_alias,status,status_text,
            last_seen,notes,is_blocked,is_favorite,added_at,verified)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
         ON CONFLICT(public_key) DO UPDATE SET
            nickname=excluded.nickname,
            status=excluded.status,
            status_text=excluded.status_text,
            last_seen=excluded.last_seen",
        params![
            c.public_key, c.nickname, c.local_alias, c.status, c.status_text,
            c.last_seen, c.notes, c.is_blocked as i64, c.is_favorite as i64,
            c.added_at, c.verified as i64
        ],
    )?;
    Ok(())
}

pub fn get_contacts(conn: &Connection) -> anyhow::Result<Vec<DbContact>> {
    let mut stmt = conn.prepare(
        "SELECT id,public_key,nickname,local_alias,status,status_text,
                last_seen,notes,is_blocked,is_favorite,added_at,verified,avatar_data
         FROM contacts WHERE is_blocked=0
         ORDER BY CASE status
             WHEN 'online' THEN 0 WHEN 'away' THEN 1 WHEN 'busy' THEN 2
             ELSE 3 END, nickname COLLATE NOCASE"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DbContact {
            id: r.get(0)?,
            public_key: r.get(1)?,
            nickname: r.get(2)?,
            local_alias: r.get(3)?,
            status: r.get(4)?,
            status_text: r.get(5)?,
            last_seen: r.get(6)?,
            notes: r.get(7)?,
            is_blocked: r.get::<_,i64>(8)? != 0,
            is_favorite: r.get::<_,i64>(9)? != 0,
            added_at: r.get(10)?,
            verified: r.get::<_,i64>(11)? != 0,
            avatar_data: r.get(12).unwrap_or(None),
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn update_contact_status(conn: &Connection, pk: &str, status: &str, text: Option<&str>) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE contacts SET status=?1, status_text=?2, last_seen=?3 WHERE public_key=?4",
        params![status, text, chrono::Utc::now().timestamp(), pk],
    )?;
    Ok(())
}

pub fn update_contact_fields(
    conn: &Connection,
    pk: &str,
    alias: Option<&str>,
    notes: Option<&str>,
    is_favorite: bool,
    is_blocked: bool,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE contacts SET local_alias=?1, notes=?2, is_favorite=?3, is_blocked=?4 WHERE public_key=?5",
        params![alias, notes, is_favorite as i64, is_blocked as i64, pk],
    )?;
    Ok(())
}

pub fn delete_contact(conn: &Connection, pk: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM contacts WHERE public_key=?1", params![pk])?;
    Ok(())
}

pub fn is_contact_accepted(conn: &Connection, pk: &str) -> anyhow::Result<bool> {
    // Контакт считается авторизованным, если он есть в contacts и не заблокирован.
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM contacts WHERE public_key=?1 AND COALESCE(is_blocked,0)=0",
        params![pk],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

// ─── Contact Requests ─────────────────────────────────────────────────────────

pub fn save_contact_request(conn: &Connection, pk: &str, nickname: &str, direction: &str) -> anyhow::Result<i64> {
    // Не дублируем pending запрос от того же пользователя
    let mut stmt = conn.prepare(
        "SELECT id FROM contact_requests WHERE public_key=?1 AND direction=?2 AND status='pending'"
    )?;
    let mut rows = stmt.query(params![pk, direction])?;
    if let Some(row) = rows.next()? {
        return Ok(row.get(0)?);
    }
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO contact_requests(public_key,nickname,direction,status,created_at) VALUES(?1,?2,?3,'pending',?4)",
        params![pk, nickname, direction, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_pending_requests(conn: &Connection) -> anyhow::Result<Vec<ContactRequest>> {
    let mut stmt = conn.prepare(
        "SELECT id,public_key,nickname,direction,status,created_at
         FROM contact_requests WHERE status='pending' AND direction='incoming'
         ORDER BY created_at DESC"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ContactRequest {
            id: r.get(0)?,
            public_key: r.get(1)?,
            nickname: r.get(2)?,
            direction: r.get(3)?,
            status: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn update_request_status(conn: &Connection, pk: &str, status: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE contact_requests SET status=?1 WHERE public_key=?2",
        params![status, pk],
    )?;
    Ok(())
}

// ─── Chats ────────────────────────────────────────────────────────────────────

pub fn get_or_create_direct_chat(conn: &Connection, peer_key: &str) -> anyhow::Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT id FROM chats WHERE chat_type='direct' AND peer_key=?1"
    )?;
    let mut rows = stmt.query(params![peer_key])?;
    if let Some(row) = rows.next()? {
        return Ok(row.get(0)?);
    }
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO chats(chat_type,peer_key,created_at,unread_count) VALUES('direct',?1,?2,0)",
        params![peer_key, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_chats(conn: &Connection) -> anyhow::Result<Vec<DbChat>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.chat_type, c.peer_key, c.group_id, c.created_at, c.last_message, c.last_message_time, c.unread_count,
                (SELECT s.value FROM settings s WHERE s.key = 'group_name_' || c.group_id) as group_name
         FROM chats c ORDER BY COALESCE(c.last_message_time, c.created_at) DESC"
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DbChat {
            id: r.get(0)?,
            chat_type: r.get(1)?,
            peer_key: r.get(2)?,
            group_id: r.get(3)?,
            created_at: r.get(4)?,
            last_message: r.get(5)?,
            last_message_time: r.get(6)?,
            unread_count: r.get(7)?,
            group_name: r.get(8).unwrap_or(None),
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ─── Messages ─────────────────────────────────────────────────────────────────

pub fn save_message(conn: &Connection, msg: &DbMessage) -> anyhow::Result<i64> {
    conn.execute(
        "INSERT INTO messages(chat_id,sender_key,content,content_type,timestamp,status,reply_to)
         VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            msg.chat_id, msg.sender_key, msg.content,
            msg.content_type, msg.timestamp, msg.status, msg.reply_to
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE chats SET last_message=?1, last_message_time=?2 WHERE id=?3",
        params![&msg.content, msg.timestamp, msg.chat_id],
    )?;
    Ok(id)
}

/// Проверить, существует ли уже сообщение с таким timestamp и sender (дедупликация Nostr DM)
pub fn message_exists_by_ts(conn: &Connection, chat_id: i64, ts: i64, sender_key: &str) -> anyhow::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE chat_id=?1 AND timestamp=?2 AND sender_key=?3",
        params![chat_id, ts, sender_key],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

/// Сохранить сообщение с явным текстовым превью для сайдбара и plaintext для поиска.
/// `preview` — отображается в сайдбаре (может быть «Вы: текст»).
/// `plaintext` — чистый текст без префикса, сохраняется для поиска.
pub fn save_message_with_preview(
    conn: &Connection,
    msg: &DbMessage,
    preview: &str,
    plaintext: &str,
) -> anyhow::Result<i64> {
    conn.execute(
        "INSERT INTO messages(chat_id,sender_key,content,content_type,timestamp,status,reply_to,plaintext)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            msg.chat_id, msg.sender_key, msg.content,
            msg.content_type, msg.timestamp, msg.status, msg.reply_to,
            plaintext
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE chats SET last_message=?1, last_message_time=?2 WHERE id=?3",
        params![preview, msg.timestamp, msg.chat_id],
    )?;
    Ok(id)
}

// ─── Поиск сообщений ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub msg_id:       i64,
    pub chat_id:      i64,
    pub sender_key:   String,
    pub plaintext:    String,
    pub timestamp:    i64,
    pub content_type: String,
    pub chat_type:    String,
    pub peer_key:     Option<String>,
    pub group_id:     Option<String>,
}

pub fn search_messages(conn: &Connection, query: &str, limit: i64) -> anyhow::Result<Vec<SearchResult>> {
    let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn.prepare(
        "SELECT m.id, m.chat_id, m.sender_key, m.plaintext, m.timestamp, m.content_type,
                c.chat_type, c.peer_key, c.group_id
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
         WHERE m.plaintext LIKE ?1 ESCAPE '\\'
           AND COALESCE(m.is_deleted, 0) = 0
           AND m.plaintext IS NOT NULL
         ORDER BY m.timestamp DESC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![pattern, limit], |r| {
        Ok(SearchResult {
            msg_id:       r.get(0)?,
            chat_id:      r.get(1)?,
            sender_key:   r.get(2)?,
            plaintext:    r.get(3)?,
            timestamp:    r.get(4)?,
            content_type: r.get(5)?,
            chat_type:    r.get(6)?,
            peer_key:     r.get(7)?,
            group_id:     r.get(8)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_messages(conn: &Connection, chat_id: i64, limit: i64, before: Option<i64>) -> anyhow::Result<Vec<DbMessage>> {
    let rows = if let Some(before_ts) = before {
        let mut s = conn.prepare(
            "SELECT id,chat_id,sender_key,content,content_type,timestamp,status,reply_to,
                    edited_at, COALESCE(is_deleted,0), plaintext
             FROM messages WHERE chat_id=?1 AND timestamp<?2
             ORDER BY timestamp DESC LIMIT ?3"
        )?;
        let rows: Vec<_> = s.query_map(params![chat_id, before_ts, limit], row_to_msg)?
            .filter_map(|r| r.ok()).collect();
        rows
    } else {
        let mut s = conn.prepare(
            "SELECT id,chat_id,sender_key,content,content_type,timestamp,status,reply_to,
                    edited_at, COALESCE(is_deleted,0), plaintext
             FROM messages WHERE chat_id=?1
             ORDER BY timestamp DESC LIMIT ?2"
        )?;
        let rows: Vec<_> = s.query_map(params![chat_id, limit], row_to_msg)?
            .filter_map(|r| r.ok()).collect();
        rows
    };
    let mut msgs = rows;
    msgs.reverse();
    Ok(msgs)
}

pub fn get_message_by_id(conn: &Connection, msg_id: i64) -> anyhow::Result<Option<DbMessage>> {
    let mut s = conn.prepare(
        "SELECT id,chat_id,sender_key,content,content_type,timestamp,status,reply_to,
                edited_at, COALESCE(is_deleted,0), plaintext
         FROM messages WHERE id=?1"
    )?;
    match s.query_row(params![msg_id], row_to_msg) {
        Ok(m) => Ok(Some(m)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn find_message_id(conn: &Connection, sender_key: &str, timestamp: i64) -> anyhow::Result<Option<i64>> {
    match conn.query_row(
        "SELECT id FROM messages WHERE sender_key=?1 AND timestamp=?2 LIMIT 1",
        params![sender_key, timestamp],
        |r| r.get(0),
    ) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn row_to_msg(r: &rusqlite::Row) -> rusqlite::Result<DbMessage> {
    Ok(DbMessage {
        id: r.get(0)?,
        chat_id: r.get(1)?,
        sender_key: r.get(2)?,
        content: r.get(3)?,
        content_type: r.get(4)?,
        timestamp: r.get(5)?,
        status: r.get(6)?,
        reply_to: r.get(7)?,
        edited_at: r.get(8)?,
        is_deleted: r.get::<_, i64>(9)? != 0,
        plaintext: r.get(10).unwrap_or(None),
    })
}

// ─── Reactions ────────────────────────────────────────────────────────────────

pub fn add_reaction(conn: &Connection, message_id: i64, sender_key: &str, emoji: &str) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO message_reactions(message_id,sender_key,emoji,created_at) VALUES(?1,?2,?3,?4)",
        params![message_id, sender_key, emoji, now],
    )?;
    Ok(())
}

pub fn remove_reaction(conn: &Connection, message_id: i64, sender_key: &str, emoji: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM message_reactions WHERE message_id=?1 AND sender_key=?2 AND emoji=?3",
        params![message_id, sender_key, emoji],
    )?;
    Ok(())
}

pub fn get_reactions(conn: &Connection, chat_id: i64) -> anyhow::Result<Vec<MessageReaction>> {
    let mut stmt = conn.prepare(
        "SELECT r.id,r.message_id,r.sender_key,r.emoji,r.created_at
         FROM message_reactions r
         JOIN messages m ON m.id=r.message_id
         WHERE m.chat_id=?1"
    )?;
    let rows = stmt.query_map(params![chat_id], |r| {
        Ok(MessageReaction {
            id: r.get(0)?,
            message_id: r.get(1)?,
            sender_key: r.get(2)?,
            emoji: r.get(3)?,
            created_at: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn add_reaction_by_key(conn: &Connection, target_sender: &str, target_ts: i64, reactor_key: &str, emoji: &str) -> anyhow::Result<()> {
    if let Some(msg_id) = find_message_id(conn, target_sender, target_ts)? {
        add_reaction(conn, msg_id, reactor_key, emoji)?;
    }
    Ok(())
}

pub fn remove_reaction_by_key(conn: &Connection, target_sender: &str, target_ts: i64, reactor_key: &str, emoji: &str) -> anyhow::Result<()> {
    if let Some(msg_id) = find_message_id(conn, target_sender, target_ts)? {
        remove_reaction(conn, msg_id, reactor_key, emoji)?;
    }
    Ok(())
}

// ─── Edit / Delete ────────────────────────────────────────────────────────────

pub fn edit_message(conn: &Connection, msg_id: i64, new_content: &str) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE messages SET content=?1, edited_at=?2 WHERE id=?3",
        params![new_content, now, msg_id],
    )?;
    Ok(())
}

pub fn delete_message(conn: &Connection, msg_id: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE messages SET is_deleted=1, content='' WHERE id=?1",
        params![msg_id],
    )?;
    Ok(())
}

pub fn edit_message_by_key(conn: &Connection, sender_key: &str, timestamp: i64, new_content: &str) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE messages SET content=?1, edited_at=?2 WHERE sender_key=?3 AND timestamp=?4",
        params![new_content, now, sender_key, timestamp],
    )?;
    Ok(())
}

pub fn delete_message_by_key(conn: &Connection, sender_key: &str, timestamp: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE messages SET is_deleted=1, content='' WHERE sender_key=?1 AND timestamp=?2",
        params![sender_key, timestamp],
    )?;
    Ok(())
}

pub fn mark_messages_read(conn: &Connection, chat_id: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE messages SET status='read' WHERE chat_id=?1 AND status!='read'",
        params![chat_id],
    )?;
    conn.execute(
        "UPDATE chats SET unread_count=0 WHERE id=?1",
        params![chat_id],
    )?;
    Ok(())
}

pub fn increment_unread(conn: &Connection, chat_id: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE chats SET unread_count=unread_count+1 WHERE id=?1",
        params![chat_id],
    )?;
    Ok(())
}

pub fn get_chat_peer_key(conn: &Connection, chat_id: i64) -> anyhow::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT peer_key FROM chats WHERE id=?1")?;
    let result = stmt.query_row(params![chat_id], |r| r.get(0));
    match result {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Помечаем наши исходящие сообщения в чате как прочитанные (получили read receipt)
pub fn mark_sent_messages_read(conn: &Connection, peer_pk: &str) -> anyhow::Result<()> {
    // Находим chat_id по peer_key
    let chat_id: i64 = match conn.query_row(
        "SELECT id FROM chats WHERE peer_key=?1 AND chat_type='direct'",
        params![peer_pk],
        |r| r.get(0),
    ) {
        Ok(id) => id,
        Err(_) => return Ok(()),
    };
    conn.execute(
        "UPDATE messages SET status='read' WHERE chat_id=?1 AND status IN ('sent','delivered')",
        params![chat_id],
    )?;
    Ok(())
}

pub fn set_message_status(conn: &Connection, msg_id: i64, status: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE messages SET status=?1 WHERE id=?2",
        params![status, msg_id],
    )?;
    Ok(())
}

pub fn has_unread_messages(conn: &Connection) -> anyhow::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COALESCE(SUM(unread_count), 0) FROM chats",
        [],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn get_total_unread_count(conn: &Connection) -> anyhow::Result<u32> {
    let count: i64 = conn.query_row(
        "SELECT COALESCE(SUM(unread_count), 0) FROM chats",
        [],
        |r| r.get(0),
    )?;
    Ok(count.max(0) as u32)
}

// ─── Groups ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GroupMember {
    pub group_id: String,
    pub public_key: String,
    pub nickname: String,
    pub is_admin: bool,
    pub joined_at: i64,
}

pub fn create_group_chat(conn: &Connection, group_id: &str, name: &str) -> anyhow::Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO chats(chat_type, group_id, created_at) VALUES('group', ?1, ?2)",
        params![group_id, now],
    )?;
    // Сохраняем имя группы в settings-подобном ключе
    conn.execute(
        "INSERT OR REPLACE INTO settings(key, value) VALUES(?1, ?2)",
        params![format!("group_name_{}", group_id), name],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM chats WHERE chat_type='group' AND group_id=?1",
        params![group_id],
        |r| r.get(0),
    )?;
    Ok(id)
}

pub fn get_group_chat_id(conn: &Connection, group_id: &str) -> anyhow::Result<Option<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM chats WHERE chat_type='group' AND group_id=?1")?;
    match stmt.query_row(params![group_id], |r| r.get(0)) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn add_group_member(conn: &Connection, group_id: &str, pk: &str, nickname: &str, is_admin: bool) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO group_members(group_id, public_key, nickname, is_admin, joined_at)
         VALUES(?1, ?2, ?3, ?4, ?5)",
        params![group_id, pk, nickname, is_admin as i64, now],
    )?;
    Ok(())
}

pub fn get_group_members(conn: &Connection, group_id: &str) -> anyhow::Result<Vec<GroupMember>> {
    let mut stmt = conn.prepare(
        "SELECT group_id, public_key, nickname, is_admin, joined_at FROM group_members WHERE group_id=?1"
    )?;
    let rows = stmt.query_map(params![group_id], |r| {
        Ok(GroupMember {
            group_id: r.get(0)?,
            public_key: r.get(1)?,
            nickname: r.get(2)?,
            is_admin: r.get::<_, i64>(3)? != 0,
            joined_at: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_group_name(conn: &Connection, group_id: &str) -> anyhow::Result<String> {
    get_setting(conn, &format!("group_name_{}", group_id))
        .map(|v| v.unwrap_or_default())
}

pub fn remove_group_member(conn: &Connection, group_id: &str, pk: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM group_members WHERE group_id=?1 AND public_key=?2",
        params![group_id, pk],
    )?;
    Ok(())
}

pub fn delete_group(conn: &Connection, group_id: &str) -> anyhow::Result<()> {
    // Find chat_id first
    let chat_id: Option<i64> = match conn.query_row(
        "SELECT id FROM chats WHERE chat_type='group' AND group_id=?1",
        params![group_id], |r| r.get(0),
    ) {
        Ok(id) => Some(id),
        Err(_) => None,
    };
    if let Some(cid) = chat_id {
        conn.execute("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?1)", params![cid])?;
        conn.execute("DELETE FROM messages WHERE chat_id=?1", params![cid])?;
        conn.execute("DELETE FROM chats WHERE id=?1", params![cid])?;
    }
    conn.execute("DELETE FROM group_members WHERE group_id=?1", params![group_id])?;
    conn.execute("DELETE FROM settings WHERE key=?1", params![format!("group_name_{}", group_id)])?;
    Ok(())
}

/// Save a plaintext system message to a group/direct chat
pub fn save_system_message(conn: &Connection, chat_id: i64, text: &str) -> anyhow::Result<i64> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO messages(chat_id,sender_key,content,content_type,timestamp,status,reply_to,edited_at,is_deleted)
         VALUES(?1,'system',?2,'system',?3,'delivered',NULL,NULL,0)",
        params![chat_id, text, now],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE chats SET last_message=?1, last_message_time=?2 WHERE id=?3",
        params![text, now, chat_id],
    )?;
    Ok(id)
}

// ─── Nostr ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NostrChannelRow {
    pub channel_id: String,
    pub name: String,
    pub about: String,
    pub picture: String,
    pub creator_pubkey: String,
    pub relay: String,
    pub unread_count: i64,
    pub last_message: Option<String>,
    pub last_message_time: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NostrMessageRow {
    pub id: i64,
    pub event_id: String,
    pub channel_id: String,
    pub sender_pubkey: String,
    pub sender_name: Option<String>,
    pub content: String,
    pub timestamp: i64,
    pub reply_to: Option<String>,
    pub is_mine: bool,
    pub edited_at: Option<i64>,
    pub is_deleted: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NostrReactionRow {
    pub id: i64,
    pub event_id: String,
    pub channel_id: String,
    pub reactor_pubkey: String,
    pub emoji: String,
    pub reaction_event_id: Option<String>,
    pub created_at: i64,
}

/// Читает Nostr-ключи из БД и расшифровывает секретный ключ.
/// `enc_key` — 32-байтовый ключ шифрования из OS keyring.
pub fn nostr_get_keys(conn: &Connection, enc_key: &[u8; 32]) -> anyhow::Result<Option<(String, String)>> {
    let mut stmt = conn.prepare("SELECT secret_key_hex, public_key_hex FROM nostr_keys WHERE id=1")?;
    let result = stmt.query_row([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });
    match result {
        Ok((enc_secret, pubkey)) => {
            // Пробуем расшифровать; если не получилось — значит ключ хранится в старом plaintext формате
            let secret = decrypt_field(enc_key, &enc_secret).unwrap_or(enc_secret);
            Ok(Some((secret, pubkey)))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Сохраняет Nostr-ключи в БД, шифруя секретный ключ.
/// `enc_key` — 32-байтовый ключ шифрования из OS keyring.
pub fn nostr_save_keys(conn: &Connection, enc_key: &[u8; 32], secret_hex: &str, pubkey_hex: &str) -> anyhow::Result<()> {
    let encrypted_secret = encrypt_field(enc_key, secret_hex);
    conn.execute(
        "INSERT OR REPLACE INTO nostr_keys (id, secret_key_hex, public_key_hex) VALUES (1, ?1, ?2)",
        params![encrypted_secret, pubkey_hex],
    )?;
    Ok(())
}

pub fn nostr_get_channels(conn: &Connection) -> anyhow::Result<Vec<NostrChannelRow>> {
    let mut stmt = conn.prepare(
        "SELECT channel_id, name, about, picture, creator_pubkey, relay, unread_count, last_message, last_message_time
         FROM nostr_channels ORDER BY last_message_time DESC NULLS LAST"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(NostrChannelRow {
            channel_id: row.get(0)?,
            name: row.get(1)?,
            about: row.get(2)?,
            picture: row.get(3)?,
            creator_pubkey: row.get(4)?,
            relay: row.get(5)?,
            unread_count: row.get(6)?,
            last_message: row.get(7)?,
            last_message_time: row.get(8)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn nostr_join_channel(conn: &Connection, channel_id: &str, relay: &str) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO nostr_channels (channel_id, name, relay, joined_at) VALUES (?1, '', ?2, ?3)",
        params![channel_id, relay, now],
    )?;
    Ok(())
}

pub fn nostr_leave_channel(conn: &Connection, channel_id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM nostr_channels WHERE channel_id=?1", params![channel_id])?;
    conn.execute("DELETE FROM nostr_messages WHERE channel_id=?1", params![channel_id])?;
    Ok(())
}

pub fn delete_direct_chat(conn: &Connection, chat_id: i64) -> anyhow::Result<()> {
    conn.execute("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE chat_id=?1)", params![chat_id])?;
    conn.execute("DELETE FROM messages WHERE chat_id=?1", params![chat_id])?;
    conn.execute("DELETE FROM chats WHERE id=?1", params![chat_id])?;
    Ok(())
}

pub fn nostr_delete_channel(conn: &Connection, channel_id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM nostr_messages WHERE channel_id=?1", params![channel_id])?;
    conn.execute("DELETE FROM nostr_channels WHERE channel_id=?1", params![channel_id])?;
    Ok(())
}

pub fn nostr_get_subscriber_count(conn: &Connection, channel_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT sender_pubkey) FROM nostr_messages WHERE channel_id=?1",
        params![channel_id],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok(count)
}

pub fn nostr_update_channel_meta_info(
    conn: &Connection,
    channel_id: &str,
    name: &str,
    about: &str,
    picture: &str,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE nostr_channels SET name=?1, about=?2, picture=?3 WHERE channel_id=?4",
        params![name, about, picture, channel_id],
    )?;
    Ok(())
}

pub fn nostr_update_channel_meta(
    conn: &Connection,
    channel_id: &str,
    name: &str,
    about: &str,
    picture: &str,
    creator_pubkey: &str,
) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE nostr_channels SET name=?1, about=?2, picture=?3, creator_pubkey=?4 WHERE channel_id=?5",
        params![name, about, picture, creator_pubkey, channel_id],
    )?;
    Ok(())
}

pub fn nostr_save_message(
    conn: &Connection,
    event_id: &str,
    channel_id: &str,
    sender_pubkey: &str,
    content: &str,
    timestamp: i64,
    reply_to: Option<&str>,
    is_mine: bool,
) -> anyhow::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO nostr_messages (event_id, channel_id, sender_pubkey, content, timestamp, reply_to, is_mine)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![event_id, channel_id, sender_pubkey, content, timestamp, reply_to, is_mine as i64],
    )?;
    // Update channel last_message
    conn.execute(
        "UPDATE nostr_channels SET last_message=?1, last_message_time=?2,
         unread_count = CASE WHEN ?3 = 0 THEN unread_count + 1 ELSE unread_count END
         WHERE channel_id=?4",
        params![content, timestamp, is_mine as i64, channel_id],
    )?;
    Ok(())
}

pub fn nostr_get_messages(conn: &Connection, channel_id: &str, limit: i64) -> anyhow::Result<Vec<NostrMessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, event_id, channel_id, sender_pubkey, sender_name, content, timestamp, reply_to, is_mine,
                edited_at, is_deleted
         FROM nostr_messages WHERE channel_id=?1 ORDER BY timestamp ASC LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![channel_id, limit], |row| {
        Ok(NostrMessageRow {
            id: row.get(0)?,
            event_id: row.get(1)?,
            channel_id: row.get(2)?,
            sender_pubkey: row.get(3)?,
            sender_name: row.get(4)?,
            content: row.get(5)?,
            timestamp: row.get(6)?,
            reply_to: row.get(7)?,
            is_mine: row.get::<_, i64>(8)? != 0,
            edited_at: row.get(9)?,
            is_deleted: row.get::<_, i64>(10).unwrap_or(0) != 0,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn nostr_edit_message(conn: &Connection, event_id: &str, new_content: &str, edited_at: i64) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE nostr_messages SET content=?1, edited_at=?2 WHERE event_id=?3",
        params![new_content, edited_at, event_id],
    )?;
    Ok(())
}

pub fn nostr_soft_delete_message(conn: &Connection, event_id: &str) -> anyhow::Result<()> {
    conn.execute(
        "UPDATE nostr_messages SET is_deleted=1 WHERE event_id=?1",
        params![event_id],
    )?;
    Ok(())
}

pub fn nostr_save_reaction(
    conn: &Connection,
    event_id: &str,
    channel_id: &str,
    reactor_pubkey: &str,
    emoji: &str,
    reaction_event_id: &str,
) -> anyhow::Result<()> {
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO nostr_reactions(event_id,channel_id,reactor_pubkey,emoji,reaction_event_id,created_at)
         VALUES(?1,?2,?3,?4,?5,?6)",
        params![event_id, channel_id, reactor_pubkey, emoji, reaction_event_id, now],
    )?;
    Ok(())
}

pub fn nostr_remove_reaction(conn: &Connection, reaction_event_id: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM nostr_reactions WHERE reaction_event_id=?1",
        params![reaction_event_id],
    )?;
    Ok(())
}

pub fn nostr_get_reactions(conn: &Connection, channel_id: &str) -> anyhow::Result<Vec<NostrReactionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, event_id, channel_id, reactor_pubkey, emoji, reaction_event_id, created_at
         FROM nostr_reactions WHERE channel_id=?1 ORDER BY created_at ASC"
    )?;
    let rows = stmt.query_map(params![channel_id], |row| {
        Ok(NostrReactionRow {
            id: row.get(0)?,
            event_id: row.get(1)?,
            channel_id: row.get(2)?,
            reactor_pubkey: row.get(3)?,
            emoji: row.get(4)?,
            reaction_event_id: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}


pub fn nostr_mark_channel_read(conn: &Connection, channel_id: &str) -> anyhow::Result<()> {
    conn.execute("UPDATE nostr_channels SET unread_count=0 WHERE channel_id=?1", params![channel_id])?;
    Ok(())
}
