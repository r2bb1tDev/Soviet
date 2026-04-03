# Архитектура Soviet Messenger

## Обзор

Soviet Messenger (v1.2) построен на **Tauri 2.1** с Rust-бэкенд и React/TypeScript-фронтенд. Это децентрализованный мессенджер с поддержкой:

1. **Прямых E2E чатов** — шифрование ChaCha20-Poly1305 через ECDH
2. **Групповых чатов** — групповой симметричный ключ
3. **LAN-режима** — без интернета, mDNS + TCP
4. **P2P mesh-сети** — libp2p Kademlia DHT через интернет
5. **Nostr каналов v2** — публичные каналы с редактированием, удалением, реакциями, комментариями и медиа (Telegram-parity)
6. **Nostr DM fallback** — Kind 4444 E2E-шифрованные личные сообщения через relay

---

## Компоненты системы

```
┌────────────────────────────────────────────────────────────────┐
│                      TAURI 2.1 ПРИЛОЖЕНИЕ                      │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              REACT FRONTEND (TypeScript)                │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │  │
│  │  │ChatWindow│  │Sidebar   │  │ChannelWindow, etc    │  │  │
│  │  └──────────┘  └──────────┘  └──────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │           Zustand Store (State)                  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         IPC Bridge (invoke/listen)              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   RUST BACKEND (Tauri)                   │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │  │
│  │  │Identity│ │Crypto  │ │Network │ │Storage │            │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘            │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐            │  │
│  │  │Contacts│ │ Tray   │ │Nostr   │ │  P2P   │            │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                      WebView2 / WebKit / WebKitGTK              │
└────────────────────────────────────────────────────────────────┘
   ↓↑ mDNS+TCP      ↓↑ libp2p (TCP/QUIC)    ↓↑ WebSocket (Nostr)
┌─────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ LAN (7433)  │  │ P2P mesh (Kademlia)  │  │ Nostr Relay      │
│ mDNS+TCP    │  │ libp2p 0.53 DHT      │  │ каналы + DM 4444 │
└─────────────┘  └──────────────────────┘  └──────────────────┘
```

---

## Фронтенд (React 18 + TypeScript)

### Компоненты

```
src/
├── components/
│   ├── ChatWindow.tsx           # Основное окно чата
│   ├── ChannelWindow.tsx        # Окно Nostr-канала
│   ├── Sidebar.tsx              # Боковая панель (контакты + P2P-секция)
│   ├── UserSearchModal.tsx      # Поиск пользователей (контакты/LAN/P2P)
│   ├── ShareCard.tsx            # Share card / invite card
│   └── ...
├── pages/
│   ├── Main.tsx                 # Главная страница
│   ├── Settings.tsx             # Настройки (в т.ч. раздел "Сеть")
│   └── Onboarding.tsx           # Первый запуск
├── store/
│   └── index.ts                 # Zustand store (contacts, messages, p2pPeers, ...)
├── App.tsx
└── main.tsx
```

### Zustand Store

Глобальное состояние приложения:
```typescript
{
  contacts: Contact[]
  messages: { [chatId]: Message[] }
  channels: NostrChannel[]
  channelMessages: { [channelId]: Message[] }
  settings: UserSettings
  ui: { theme: 'light' | 'dark', windowWidth, ... }
}
```

### Темы

- **Светлая тема** — белый фон, тёмный текст
- **Тёмная тема** — тёмный фон, светлый текст
- **Автоматическая смена** — следует теме ОС (prefers-color-scheme)
- **Ручной выбор** — в настройках

CSS-переменные переключаются глобально через `:root { --bg-primary, --text-primary, ... }`.

---

## Бэкенд (Rust + Tauri)

### Структура модулей

```
src-tauri/src/
├── lib.rs                    # Tauri commands entry point + AppState
├── crypto/
│   ├── mod.rs               # Экспорт
│   ├── keys.rs              # Ed25519/X25519 генерация, ECDH
│   └── cipher.rs            # ChaCha20-Poly1305, HKDF
├── identity/
│   ├── mod.rs               # Управление идентичностью
│   └── keystore.rs          # Хранилище ОС (DPAPI/Keychain/libsecret)
├── network/
│   └── mod.rs               # LAN: mDNS обнаружение + TCP (порт 7778)
├── p2p/
│   └── mod.rs               # libp2p mesh: mDNS + Kademlia DHT + RequestResponse
├── nostr.rs                  # Nostr: каналы (40/41/42) + DM fallback (Kind 4444)
└── storage/
    └── mod.rs               # SQLite операции + schema
```

### Tauri Commands

Команды, доступные из React через `invoke`:

```rust
// Identity
fn create_identity(nickname: String) -> Result<IdentityInfo, String>
fn export_keys() -> Result<String, String>
fn import_keys(encoded: String) -> Result<IdentityInfo, String>
fn get_identity() -> IdentityInfo

// Messages
fn send_message(recipient_pk: String, message_type: String, content: String, ...) -> Result<i64, String>
fn get_messages(chat_id: i64) -> Result<Vec<DbMessage>, String>
fn edit_message(message_id: i64, new_encrypted: String) -> Result<(), String>
fn delete_message(message_id: i64, recipient_pk: String) -> Result<(), String>
fn send_reaction(message_id: i64, emoji: String, ...) -> Result<(), String>

// Contacts
fn add_contact(public_key: String, nickname: String) -> Result<(), String>
fn get_contacts() -> Result<Vec<DbContact>, String>
fn get_or_create_chat(contact_pk: String) -> Result<i64, String>

// LAN Discovery
fn get_lan_peers() -> Vec<LanPeer>

// P2P mesh (libp2p)
fn get_p2p_peers() -> Vec<P2pPeer>

// Nostr Channels
fn nostr_create_channel(name: String, about: String) -> Result<String, String>
fn nostr_join_channel(channel_id: String) -> Result<(), String>
fn nostr_send_message(channel_id: String, content: String, ...) -> Result<(), String>
fn get_nostr_channels() -> Result<Vec<NostrChannel>, String>

// Nostr Channels v2 (новое в v1.2)
fn nostr_edit_channel_message(event_id: String, channel_id: String, new_content: String) -> Result<(), String>
fn nostr_delete_channel_message(event_id: String, channel_id: String) -> Result<(), String>
fn nostr_send_channel_reaction(event_id: String, channel_id: String, emoji: String) -> Result<(), String>
fn nostr_remove_channel_reaction(event_id: String, channel_id: String, emoji: String) -> Result<(), String>
fn nostr_get_channel_reactions(channel_id: String) -> Result<HashMap<String, Vec<ChannelReaction>>, String>
fn nostr_send_comment(channel_id: String, parent_event_id: String, content: String) -> Result<(), String>

// Groups
fn create_group(name: String, member_pks: Vec<String>) -> Result<String, String>
fn send_group_message(group_id: String, content: String) -> Result<(), String>

// Settings
fn get_setting(key: String) -> Result<String, String>
fn set_setting(key: String, value: String) -> Result<(), String>
```

---

## Модуль Identity

Управляет идентичностью пользователя:

```rust
pub struct Identity {
    pub public_key: String,        // Base58 Ed25519 PK
    pub nickname: String,
    pub custom_id: Option<String>, // 3-10 символов
    // Приватный ключ хранится в защищённом хранилище, не в памяти
}

impl Identity {
    pub fn generate() -> Result<Self>
    pub fn export() -> Result<String>  // JSON для сохранения
    pub fn import(data: &str) -> Result<Self>
    pub fn get_public_key() -> String
}
```

### Хранилище ключей

| ОС | Технология |
|----|-----------|
| Windows | DPAPI (Data Protection API) / Windows Credential Manager |
| macOS | Keychain |
| Linux | libsecret / KWallet / fallback с шифрованием |

Приватный ключ никогда не покидает устройство.

---

## Модуль Crypto

Все криптографические операции:

```rust
pub mod keys {
    pub fn generate_ed25519() -> (SecretKey, PublicKey)
    pub fn derive_x25519(ed25519_sk: &SecretKey) -> PublicKey
}

pub mod ecdh {
    pub fn ephemeral_key_pair() -> (X25519SecretKey, X25519PublicKey)
    pub fn shared_secret(
        ephemeral_sk: &X25519SecretKey,
        recipient_pk: &X25519PublicKey
    ) -> [u8; 32]
}

pub mod hkdf {
    pub fn derive_key(
        shared_secret: &[u8],
        salt: &[u8],
        info: &[u8]
    ) -> [u8; 32]
}

pub mod cipher {
    pub fn encrypt(
        key: &[u8; 32],
        nonce: &[u8; 12],
        plaintext: &[u8],
        aad: &[u8]
    ) -> Vec<u8>

    pub fn decrypt(
        key: &[u8; 32],
        nonce: &[u8; 12],
        ciphertext: &[u8],
        aad: &[u8]
    ) -> Result<Vec<u8>, String>
}

pub mod signing {
    pub fn sign(private_key: &SecretKey, message: &[u8]) -> Signature
    pub fn verify(public_key: &PublicKey, message: &[u8], signature: &Signature) -> bool
}
```

Все операции используют:
- **Ed25519** для подписей (через sodiumoxide или ed25519-dalek)
- **X25519** для ECDH (через curve25519-dalek)
- **ChaCha20-Poly1305** для AEAD (через chacha20poly1305 crate)
- **HKDF-SHA256** для вывода ключей (через hkdf crate)

---

## Модуль Network

### LAN-режим (UDP + TCP)

```rust
pub struct LANManager {
    local_port: u16,               // 7433
    broadcast_socket: UdpSocket,   // для объявления
    listener: TcpListener,         // для входящих соединений
}

impl LANManager {
    pub async fn announce(&self) -> Result<()>
    pub async fn discover(&self) -> Result<Vec<LanPeer>>
    pub async fn send_message(&self, peer: &LanPeer, message: Message) -> Result<()>
    pub async fn listen(&self) -> Result<()>
}

// Пакет UDP broadcast
{
    "type": "presence",
    "public_key": "<Base58>",
    "nickname": "Имя",
    "custom_id": "@myid",
    "port": 7433,
    "version": 1
}
```

### Nostr-режим (WebSocket)

```rust
pub struct NostrManager {
    relay_url: String,              // wss://relay.damus.io
    ws: WebSocket,
    subscriptions: HashMap<String, Subscription>,
}

impl NostrManager {
    pub async fn connect() -> Result<Self>
    pub async fn send_event(&self, event: NostrEvent) -> Result<String>
    pub async fn subscribe_to_channel(&self, channel_id: &str) -> Result<()>
    pub async fn listen(&self) -> Result<()>
}

// Nostr события
kind=40:   Create channel
kind=41:   Update channel metadata
kind=42:   Channel message / edit (тег "edit") / comment (тег "reply")
kind=5:    Delete event (soft-delete)
kind=7:    Reaction (NIP-25) — новое в v1.2
kind=4444: Soviet DM fallback (E2E)
```

---

## Модуль Storage (SQLite)

### Схема таблиц

```sql
-- Идентичность пользователя
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
-- key: "nickname", "custom_id", "avatar_base64", "theme", ...

-- Контакты
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT UNIQUE NOT NULL,
    nickname TEXT NOT NULL,
    custom_id TEXT,
    status TEXT DEFAULT 'offline',
    status_text TEXT,
    avatar BLOB,
    last_seen INTEGER,
    added_at INTEGER NOT NULL
);

-- Запросы на добавление в контакты
CREATE TABLE contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    nickname TEXT NOT NULL,
    direction TEXT NOT NULL,  -- 'incoming' | 'outgoing'
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL
);

-- Чаты (личные и групповые)
CREATE TABLE chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_type TEXT NOT NULL,  -- 'direct' | 'group'
    contact_id INTEGER REFERENCES contacts(id),  -- для direct
    group_id TEXT,            -- для group (UUID)
    created_at INTEGER NOT NULL
);

-- Сообщения
CREATE TABLE messages (
    id TEXT PRIMARY KEY,       -- UUID
    chat_id INTEGER REFERENCES chats(id),
    sender_key TEXT NOT NULL,
    content TEXT NOT NULL,     -- plaintext (уже расшифрованное)
    content_type TEXT,         -- 'text' | 'file' | 'image'
    timestamp INTEGER NOT NULL,
    status TEXT DEFAULT 'sent', -- 'sent' | 'delivered' | 'read'
    edited_at INTEGER,
    deleted_at INTEGER,
    reply_to TEXT REFERENCES messages(id)
);

-- Реакции на сообщения
CREATE TABLE message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT REFERENCES messages(id),
    reactor_key TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- Участники групповых чатов
CREATE TABLE group_members (
    group_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    role TEXT DEFAULT 'member',  -- 'admin' | 'member'
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, public_key)
);

-- Nostr каналы
CREATE TABLE nostr_channels (
    id TEXT PRIMARY KEY,        -- Channel ID
    creator_pk TEXT NOT NULL,
    name TEXT NOT NULL,
    about TEXT,
    avatar BLOB,
    subscriber_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- Сообщения в Nostr каналах
CREATE TABLE nostr_messages (
    id TEXT PRIMARY KEY,        -- Event ID
    channel_id TEXT REFERENCES nostr_channels(id),
    sender_key TEXT NOT NULL,
    content TEXT NOT NULL,      -- plaintext или JSON {v:1, text, media:{type,data,name,size}}
    timestamp INTEGER NOT NULL,
    deleted_at INTEGER,
    -- Новое в v1.2:
    edited_at INTEGER,          -- unix timestamp последнего редактирования
    is_deleted INTEGER DEFAULT 0,  -- 1 = soft-deleted (Kind 5 получен)
    reply_to TEXT               -- event_id родительского поста (для комментариев)
);

-- Реакции на сообщения в Nostr каналах (новое в v1.2)
CREATE TABLE nostr_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,         -- target event ID
    channel_id TEXT NOT NULL,
    reactor_pubkey TEXT NOT NULL,
    emoji TEXT NOT NULL,
    reaction_event_id TEXT,         -- Nostr Kind 7 event ID (для удаления)
    created_at INTEGER NOT NULL,
    UNIQUE(event_id, reactor_pubkey, emoji)
);
```

### Операции

```rust
pub struct Database {
    conn: SqliteConnection,
}

impl Database {
    // Settings
    pub async fn get_setting(&self, key: &str) -> Result<String>
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()>

    // Contacts
    pub async fn add_contact(&self, contact: Contact) -> Result<()>
    pub async fn get_contacts(&self) -> Result<Vec<Contact>>
    pub async fn update_contact_status(&self, pk: &str, status: &str) -> Result<()>

    // Messages
    pub async fn save_message(&self, msg: Message) -> Result<()>
    pub async fn get_messages(&self, chat_id: &str) -> Result<Vec<Message>>
    pub async fn edit_message(&self, msg_id: &str, content: &str) -> Result<()>
    pub async fn delete_message(&self, msg_id: &str) -> Result<()>

    // Groups
    pub async fn create_group(&self, group_id: &str, creator: &str) -> Result<()>
    pub async fn add_group_member(&self, group_id: &str, member_pk: &str) -> Result<()>
    pub async fn remove_group_member(&self, group_id: &str, member_pk: &str) -> Result<()>

    // Nostr
    pub async fn save_nostr_channel(&self, channel: NostrChannel) -> Result<()>
    pub async fn get_nostr_channels(&self) -> Result<Vec<NostrChannel>>
    pub async fn save_channel_message(&self, msg: Message) -> Result<()>
}
```

---

## Модуль Tray

Системный трей с иконкой белого медведя:

```rust
pub struct TrayManager {
    tray_handle: SystemTrayHandle,
}

impl TrayManager {
    pub fn new() -> Result<Self>
    pub fn show_new_message_indicator(&self) -> Result<()>
    pub fn clear_indicator(&self) -> Result<()>
    pub fn set_status(&self, status: &str) -> Result<()>
}
```

### Иконки

- `bear_idle.svg` — нет новых сообщений (монохромная версия для тёмного фона)
- `bear_message.svg` — есть новые сообщения (с конвертиком, может мигать)

---

## Поток сообщения

### Отправка личного сообщения

```
1. React вызывает send_message (content: "Привет")
                ↓
2. Tauri command в Rust:
   - Загружает приватный ключ из хранилища
   - Генерирует эфемерную X25519 пару
   - Вычисляет shared_secret = ECDH(ephemeral_sk, recipient_pk)
   - Выводит ключ: encryption_key = HKDF(shared_secret, salt, info)
   - Шифрует: ciphertext = ChaCha20Poly1305.encrypt(encryption_key, nonce, plaintext, aad)
   - Подписывает: signature = Ed25519.sign(my_sk, ephemeral_pk || nonce || ciphertext)
                ↓
3. Формирует JSON-пакет:
   {
     "version": 1,
     "sender_pk": "5KYZ...",
     "ephemeral_pk": "...",
     "nonce": "...",
     "ciphertext": "...",
     "signature": "...",
     "timestamp": 1700000000
   }
                ↓
4. Выбирает транспорт (приоритет):
   1. Получатель в LAN?      → TCP direct (порт 7778)
   2. Получатель в P2P DHT?  → libp2p RequestResponse
   3. Иначе                  → Nostr Kind 4444 DM relay (fallback)
                ↓
5. Сохраняет в БД с status='sent'
   Отправляет React: { message_id, status: 'sent' }
                ↓
6. React обновляет UI (пузырь сообщения появляется)
```

### Получение сообщения

```
1. TCP listener получает пакет от соседа в LAN
                ↓
2. Rust:
   - Загружает мой приватный ключ
   - Верифицирует подпись: Ed25519.verify(sender_pk, ephemeral_pk || nonce || ciphertext, signature)
   - Вычисляет shared_secret = ECDH(my_sk, ephemeral_pk)
   - Выводит ключ: encryption_key = HKDF(shared_secret, salt, info)
   - Расшифровывает: plaintext = ChaCha20Poly1305.decrypt(encryption_key, nonce, ciphertext, aad)
                ↓
3. Сохраняет в БД, генерирует message_id
   Отправляет read receipt: { message_id, status: 'delivered' }
                ↓
4. Tauri emit event к React через IPC: message_received_event
                ↓
5. React обновляет Zustand store
   UI обновляется (пузырь сообщения появляется в чате)
   Проигрывается звук уведомления
   Системное уведомление ОС
```

---

## Схема доставки

```
┌─────────────────────┐
│ Отправитель (A)     │
└──────────┬──────────┘
           │ send_message()
           ↓
   ┌───────────────────┐
   │  Шифрование       │
   │  ChaCha20+ECDH    │
   └────────┬──────────┘
            ↓
   ┌──────────────────────────────┐
   │ B в LAN (mDNS/TCP)?          │──Yes──→ TCP direct (7778)
   └────────┬─────────────────────┘              │
            │ No                                 │
   ┌──────────────────────────────┐              │
   │ B в P2P DHT (libp2p)?        │──Yes──→ libp2p RequestResponse
   └────────┬─────────────────────┘              │
            │ No                                 │
            ↓                                    │
   Nostr Kind 4444 relay                         │
   (зашифрованный fallback)                      │
            │                                    │
            └─────────────┬──────────────────────┘
                          ↓
              ┌──────────────────────┐
              │ Verify + Decrypt     │
              │ Save to DB           │
              │ Emit IPC → React UI  │
              └──────────────────────┘
```

---

## Темы и интернационализация

### Темы (v1.0)

- **Light** — белый фон (#FFFFFF), тёмный текст (#1A1A1A)
- **Dark** — тёмный фон (#1E1E2E), светлый текст (#CDD6F4)
- **Auto** — следует prefers-color-scheme

### Интернационализация (v2.0)

В v1.0 только русский. Планируется поддержка i18n в v2.0.

---

## Производительность

| Метрика | Целевое значение |
|---------|-----------------|
| Запуск приложения | < 2 сек |
| Загрузка чата (500 сообщений) | < 500 мс |
| Шифрование сообщения | < 10 мс |
| Расшифровка сообщения | < 10 мс |
| Размер инсталлятора | < 50 МБ (Windows NSIS) |
| Потребление RAM (idle) | < 100 МБ |
| Потребление CPU (idle) | < 1% |

---

## Развёртывание

### Локальная разработка

```bash
npm run tauri dev   # Hot reload, dev console
```

### Сборка для продакшена

```bash
npm run tauri build # Generates installers for current platform
```

### Поддерживаемые платформы

- **Windows 10+** — NSIS installer (.exe) или MSI
- **macOS 11+** — DMG (universal binary: Intel + Apple Silicon)
- **Linux** — AppImage, .deb (Ubuntu 20.04+)

---

## CI/CD

GitHub Actions автоматически собирает бинарники при создании тага (`v1.0.0`):

```yaml
name: Release Build
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        platform: [windows-latest, macos-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v3
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Результаты публикуются на странице Releases.

---

## Безопасность при разработке

- ✅ Все криптографические операции в `src-tauri/src/crypto/`
- ✅ Приватные ключи никогда не выводятся в логи
- ✅ Все сообщения подписаны и расшифровываются
- ✅ Защита от replay-атак (timestamp + nonce)
- ✅ ECDH для Perfect Forward Secrecy

Для аудита криптографического кода см. [CRYPTO.md](CRYPTO.md).
