# Протокол связи Soviet Messenger

## Версия протокола: 1.0

---

## Обзор

Soviet Messenger использует **три независимых транспорта**, выбираемых автоматически:

1. **LAN Protocol** — mDNS + TCP direct для локальной сети (без интернета)
2. **P2P mesh Protocol** — libp2p Kademlia DHT для связи через интернет
3. **Nostr Protocol** — WebSocket relay для публичных каналов и DM-fallback

---

## Часть 1: LAN Protocol

### Транспорт

- **UDP** — broadcast на `255.255.255.255:7433` для обнаружения
- **TCP** — прямое соединение на порт 7433 для сообщений
- **Сериализация** — JSON (текстовый формат)
- **Кодирование** — UTF-8

### Формат пакета (TCP)

```
[4-byte length (big-endian)][JSON payload]

Пример:
00 00 00 5C     ← длина 92 байта (big-endian)
{"type":"hello","public_key":"5KYZ...","nickname":"PolarBear","version":1}
```

### Базовая структура пакета

```json
{
  "type": "<packet-type>",
  "sender_pk": "<Base58 публичный ключ>",
  "timestamp": 1700000000,
  ... тип-специфичные поля ...
}
```

---

## Типы пакетов LAN

### `hello` — Handshake

Отправляется при установке соединения:

```json
{
  "type": "hello",
  "public_key": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "nickname": "PolarBear",
  "custom_id": "@polarbear",
  "version": 1,
  "timestamp": 1700000000
}
```

**Проверки:**
- ✓ Версия совместима (version == 1)
- ✓ Pubkey не пустой
- ✓ Nickname не пустой

### `message` — Личное сообщение

```json
{
  "type": "message",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "ephemeral_pk": "3dq9KJzV5qpL8xXXvV4h1YXKLMoY6zS1nNPp8rRqT2V",
  "nonce": "b2ZZNE5YZJjkM2RxFgH5",
  "ciphertext": "RmOPm7vvXXUPLLmDxKL...",
  "signature": "KpX5kZ7vMV...",
  "timestamp": 1700000000,
  "content_type": "text"
}
```

**Поля:**
- `message_id` — UUID уникального сообщения
- `ephemeral_pk` — эфемерный публичный ключ для ECDH
- `nonce` — 12 bytes в Base64 для ChaCha20
- `ciphertext` — Base64-кодированное зашифрованное сообщение
- `signature` — Base64-кодированная Ed25519 подпись
- `content_type` — "text", "image", "file", "voice"

### `file` — Передача файла

```json
{
  "type": "file",
  "file_id": "550e8400-e29b-41d4-a716-446655440001",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "filename": "document.pdf",
  "filesize": 2400000,
  "chunk_index": 0,
  "chunk_total": 37,
  "chunk_size": 65536,
  "chunk_data": "<base64-chunk>",
  "checksum": "sha256-hash-of-chunk",
  "timestamp": 1700000000
}
```

**Поля:**
- `file_id` — UUID файла
- `chunk_index` — порядковый номер чанка (0-based)
- `chunk_total` — всего чанков
- `chunk_size` — размер одного чанка (обычно 64 КБ)
- `chunk_data` — Base64 данные чанка
- `checksum` — SHA256 хэш чанка (контроль целости)

**Макс размер файла:** 10 МБ (10 * 1024 * 1024 bytes)

### `group_invite` — Приглашение в группу

```json
{
  "type": "group_invite",
  "group_id": "group-12345678-1234-1234-1234-123456789012",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "group_name": "Рабочая группа",
  "group_key_encrypted": "<зашифрованный GroupKey через ECDH>",
  "timestamp": 1700000000
}
```

### `group_message` — Сообщение в группе

```json
{
  "type": "group_message",
  "message_id": "550e8400-e29b-41d4-a716-446655440002",
  "group_id": "group-12345678-1234-1234-1234-123456789012",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "nonce": "b2ZZNE5YZJjkM2RxFgH5",
  "ciphertext": "<зашифровано GroupKey>",
  "signature": "<подпись отправителя>",
  "timestamp": 1700000000
}
```

### `member_left` — Участник вышел из группы

```json
{
  "type": "member_left",
  "group_id": "group-12345678-1234-1234-1234-123456789012",
  "member_pk": "3dq9KJzV5qpL8xXXvV4h1YXKLMoY6zS1nNPp8rRqT2V",
  "timestamp": 1700000000
}
```

### `group_dissolved` — Группа удалена

```json
{
  "type": "group_dissolved",
  "group_id": "group-12345678-1234-1234-1234-123456789012",
  "deleted_by": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "timestamp": 1700000000
}
```

### `reaction` — Emoji-реакция

```json
{
  "type": "reaction",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "reactor_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "emoji": "👍",
  "timestamp": 1700000000
}
```

### `edit` — Редактирование сообщения

```json
{
  "type": "edit",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "new_ciphertext": "<новое зашифрованное содержимое>",
  "signature": "<подпись для нового содержимого>",
  "edited_at": 1700000000,
  "timestamp": 1700000001
}
```

### `delete` — Удаление сообщения

```json
{
  "type": "delete",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "timestamp": 1700000000
}
```

### `typing` — Индикатор набора текста

```json
{
  "type": "typing",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "is_typing": true,
  "timestamp": 1700000000
}
```

**Отправляется:**
- Каждые 500 мс пока пользователь печатает
- С `is_typing: true` когда начал печать
- С `is_typing: false` когда остановился

### `read_receipt` — Подтверждение прочтения

```json
{
  "type": "read_receipt",
  "message_id": "550e8400-e29b-41d4-a716-446655440000",
  "reader_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "timestamp": 1700000000
}
```

### `contact_request` — Запрос на добавление в контакты

```json
{
  "type": "contact_request",
  "sender_pk": "5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx",
  "nickname": "PolarBear",
  "custom_id": "@polarbear",
  "message": "Привет, давай добавимся в контакты!",
  "timestamp": 1700000000
}
```

---

## Часть 2: P2P mesh Protocol (libp2p)

### Транспорт

- **TCP + QUIC** — зашифрованные соединения через интернет
- **Noise protocol** — аутентификация транспортного уровня
- **Yamux** — мультиплексирование потоков
- **Сериализация сообщений** — CBOR

### Протоколы libp2p

| Протокол | ID | Назначение |
|----------|----|-----------|
| Сообщения | `/soviet/msg/1.0.0` | Передача `LanPacket` JSON между пирами |
| Kademlia DHT | `/soviet/kad/1.0.0` | Маршрутизация и поиск пиров в интернете |
| Identify | `/soviet/id/1.0.0` | Обмен адресами и метаданными пира |
| mDNS | (системный) | Обнаружение пиров в локальной сети |
| Ping | (системный) | Keepalive |

### PeerId

PeerId libp2p генерируется детерминированно из Soviet Ed25519 ключа:

```
PeerId = SHA256-multihash(Ed25519 PublicKey bytes)
```

Зная Soviet pubkey контакта, можно вычислить его PeerId без дополнительного обмена.

### Формат сообщения

Сообщения передаются как `LanPacket` JSON (тот же формат, что и в LAN-режиме), сериализованный в CBOR:

```
[CBOR bytes] → RequestResponse → получатель декодирует в LanPacket → обрабатывается тем же pipeline
```

### Bootstrap DHT

Начальная связность через публичные IPFS bootstrap-ноды:

```
/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN
/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa
```

---

## Часть 3: Nostr Protocol

### Транспорт

- **WebSocket** — подключение к relay серверу (wss://)
- **Формат** — JSON (Nostr NIP-01)
- **Relay по умолчанию** — `wss://relay.damus.io`
- **Резервные relay** — конфигурируются в настройках (v2.0)

### Формат события (Nostr NIP-01)

```json
{
  "id": "4376c65d2f232afbe9b882a35baa4960fe2f7a6a40010d86e1cd0e87ac3ff147",
  "pubkey": "6e0bd995c3f0cb8900200984987286b8b6e30146194d4c3f6ffc490d7a427221",
  "created_at": 1687360671,
  "kind": 42,
  "tags": [
    ["e", "<event-id>", "<relay-url>"],
    ["p", "<pubkey>"]
  ],
  "content": "<encrypted-message>",
  "sig": "5ed9d8ec958bc854fd92ac1a0a38b4e1a6b2e37a4d8a06f86f5fdd1f7b04a9fe"
}
```

### Виды событий в Soviet

| Kind | Название | Использование |
|------|----------|----------------|
| 40 | Channel Create | Создание нового канала |
| 41 | Channel Metadata | Обновление имени, описания, аватара канала |
| 42 | Channel Message | Сообщение в канале |
| 5 | Delete Event | Удаление события (канала или сообщения) |
| 4444 | Soviet DM | E2E-шифрованное личное сообщение (fallback при недоступности LAN/P2P) |

### Kind 40: Create Channel

```json
{
  "kind": 40,
  "content": "",
  "tags": [
    ["name", "Мой канал"],
    ["about", "Описание канала"],
    ["picture", "data:image/png;base64,..."]
  ]
}
```

**Поля:**
- `pubkey` → creator публичный ключ
- `tags[0]` → name канала
- `tags[1]` → about (описание)
- `tags[2]` → picture (base64 изображение)

### Kind 41: Channel Metadata

Обновление метаданных существующего канала:

```json
{
  "kind": 41,
  "content": "",
  "tags": [
    ["d", "<channel-id>"],
    ["name", "Обновлённое имя"],
    ["about", "Новое описание"],
    ["picture", "data:image/png;base64,..."]
  ]
}
```

**Поле `d`** — идентификатор канала (должен совпадать с `event.id` kind=40 события)

### Kind 42: Channel Message

```json
{
  "kind": 42,
  "content": "Это сообщение в канале",
  "tags": [
    ["e", "<channel-event-id>", "<relay-url>"],
    ["p", "<creator-pubkey>"]
  ]
}
```

**Поля:**
- `pubkey` → публичный ключ отправителя
- `content` → текст сообщения (в v1.0 не шифруется, публичное)
- `tags[0]` → ссылка на kind=40 событие (ID канала)
- `tags[1]` → ссылка на creator

### Kind 5: Delete Event

Удаление события (канала или сообщения):

```json
{
  "kind": 5,
  "content": "",
  "tags": [
    ["e", "<event-id-to-delete>"]
  ]
}
```

**Использование:**
- Удаление канала: `["e", "<kind-40-event-id>"]`
- Удаление сообщения: `["e", "<kind-42-event-id>"]`

Relay получает это событие и удаляет (`delete` или `soft-delete`) целевое событие.

### Kind 4444: Soviet DM (личное сообщение — fallback)

Используется как fallback-транспорт когда ни LAN, ни P2P-соединение недоступны.

```json
{
  "kind": 4444,
  "pubkey": "<Nostr pubkey отправителя>",
  "created_at": 1700000000,
  "tags": [
    ["p", "<hex Soviet pubkey получателя>"],
    ["t", "soviet-dm"]
  ],
  "content": "<Soviet EncryptedMessage JSON>",
  "sig": "<Schnorr подпись>"
}
```

**Поля:**
- `tags[p]` — hex-кодированный Soviet Ed25519 публичный ключ получателя (для подписки)
- `tags[t]` — тег `"soviet-dm"` для фильтрации
- `content` — JSON объект `EncryptedMessage` (Soviet формат, ChaCha20-Poly1305):
  ```json
  {
    "sender_pk": "<Base58 Ed25519 Soviet pubkey>",
    "ephemeral_pk": "<Base58 X25519 ephemeral key>",
    "nonce": "<Base64 12 bytes>",
    "ciphertext": "<Base64>",
    "signature": "<Base64 Ed25519>",
    "timestamp": 1700000000
  }
  ```

**Подписка получателя:**
```json
["REQ", "soviet-dms", {"kinds": [4444], "#p": ["<hex Soviet pubkey>"], "limit": 500}]
```

**Безопасность:**
- Relay видит только зашифрованный blob, hex-ключ получателя и timestamp
- Расшифровать содержимое может только получатель своим Soviet X25519 ключом
- Дедупликация на стороне получателя по `timestamp + sender_pk`

---

## Подписка на события (NIP-01)

Клиент отправляет `REQ` (request) relay серверу:

```json
["REQ", "<subscription-id>", {"kinds": [42], "tags": {"e": ["<channel-id>"]}}]
```

Relay отвечает `EVENT` сообщениями:

```json
["EVENT", "<subscription-id>", { ... event object ... }]
```

При закрытии подписки:

```json
["CLOSE", "<subscription-id>"]
```

---

## Отправка события (NIP-01)

Клиент отправляет `EVENT`:

```json
["EVENT", { ... event object ... }]
```

Relay отвечает `OK`:

```json
["OK", "<event-id>", true, ""]  // true = принято
```

или

```json
["OK", "<event-id>", false, "invalid: kind not allowed"]  // false = отклонено
```

---

## Примеры обмена

### Пример 1: Создание канала в Nostr

```
[Client] →
{
  "kind": 40,
  "pubkey": "6e0bd995c3f0cb8900200984987286b8b6e30146194d4c3f6ffc490d7a427221",
  "created_at": 1687360671,
  "tags": [
    ["name", "Рабочая группа"],
    ["about", "Обсуждение проектов"],
    ["picture", "data:image/png;base64,iVBORw0KGgo..."]
  ],
  "content": "",
  "sig": "5ed9d8ec958bc854fd92ac1a0a38b4e1a6b2e37a4d8a06f86f5fdd1f7b04a9fe"
}

[Relay] ← OK
{
  "id": "4376c65d2f232afbe9b882a35baa4960fe2f7a6a40010d86e1cd0e87ac3ff147",
  ...
}
```

### Пример 2: Отправка сообщения в канал

```
[Client] →
{
  "kind": 42,
  "pubkey": "6e0bd995c3f0cb8900200984987286b8b6e30146194d4c3f6ffc490d7a427221",
  "created_at": 1687360672,
  "tags": [
    ["e", "4376c65d2f232afbe9b882a35baa4960fe2f7a6a40010d86e1cd0e87ac3ff147"],
    ["p", "6e0bd995c3f0cb8900200984987286b8b6e30146194d4c3f6ffc490d7a427221"]
  ],
  "content": "Привет всем в канале!",
  "sig": "..."
}

[Relay] ← OK
```

### Пример 3: Подписка на сообщения канала

```
[Client] →
["REQ", "sub1", {"kinds": [42], "tags": {"e": ["4376c65d2f232afbe9b882a35baa4960fe2f7a6a40010d86e1cd0e87ac3ff147"]}}]

[Relay] ←
["EVENT", "sub1", {"kind": 42, "content": "Первое сообщение", ...}]
["EVENT", "sub1", {"kind": 42, "content": "Второе сообщение", ...}]
["EVENT", "sub1", {"kind": 42, "content": "Третье сообщение", ...}]
["EOSE", "sub1"]  // End of Stored Events
```

---

## Коды состояния и ошибки

### LAN ошибки (TCP)

При ошибке соединение просто закрывается. Клиент пытается переподключиться.

### Nostr ошибки (relay)

Relay отправляет `NOTICE` сообщение:

```json
["NOTICE", "<error-message>"]
```

Примеры:
- `"invalid: too-many-filters"`
- `"rate-limited: Please wait before sending again"`
- `"invalid: kind not allowed"`

---

## Версионирование протокола

| Версия | Транспорты | Изменения |
|--------|-----------|-----------|
| **v1.0** | LAN (UDP broadcast + TCP), Nostr каналы | Первый стабильный релиз |
| **v1.1** | LAN (mDNS + TCP), P2P libp2p, Nostr каналы + DM Kind 4444 | Интернет P2P, Nostr DM fallback |
| **v2.0** (план) | + NAT hole-punching (DCUtR), relay | GossipSub store-and-forward |

Клиент всегда проверяет версию в `hello` пакете и отказывает несовместимым версиям.

---

## Безопасность на протоколе

- ✅ Все сообщения подписаны (Ed25519)
- ✅ Все прямые сообщения зашифрованы (ChaCha20-Poly1305)
- ✅ Защита от replay (nonce + timestamp)
- ✅ Защита от подделки (Ed25519 verify)
- ✅ Защита от MITM (подпись каждого пакета)

---

## Производительность протокола

| Метрика | Значение |
|---------|----------|
| LAN сообщение (TCP direct) | 5-20 мс |
| P2P сообщение (libp2p, прямое) | 50-200 мс |
| P2P сообщение (через relay/NAT) | 200-500 мс |
| Nostr DM Kind 4444 (fallback) | 500-2000 мс (зависит от relay) |
| Nostr канальное сообщение | 100-1000 мс |
| Размер hello пакета | ~200 bytes |
| Размер message пакета (зашифрованное) | 200-500 bytes |
| Пакеты в секунду (LAN) | > 1000 |
| Одновременных подписок (Nostr) | зависит от relay |

