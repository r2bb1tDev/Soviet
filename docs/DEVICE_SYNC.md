# Device-to-Device History Sync (протокол, draft)

**Статус:** спецификация, не реализовано. Целевой релиз — v3.0.

## Мотивация

После v2.10.0 пользователь может иметь одну identity на двух устройствах (QR-перенос seed). Но сообщения, отправленные/полученные на устройстве A до момента подключения устройства B, **на B недоступны** — history локально в SQLite, никогда не покидает устройство.

Цель v3.0: опционально синхронизировать шифрованный дамп истории между своими устройствами (не между разными пользователями) через LAN/P2P без передачи на серверы.

## Модель угроз

- **Доверяемся:** двум своим устройствам, оба имеют нашу identity.
- **Не доверяемся:** никому иному, в т.ч. Nostr-relay, P2P-пирам-посредникам, провайдеру сети.
- **Цель атакующего:** получить историю переписки.
- **Защита:** содержимое синка всегда end-to-end зашифровано одноразовым session-ключом, который согласован через ECDH между двумя копиями identity.

## Общий поток

```
Устройство A (source)         Устройство B (new)
  |                              |
  |  1. B announces "I'm here"   |
  |  <------  sync-announce -----|
  |                              |
  |  2. A verifies B ownership   |
  |     (challenge-response на   |
  |      identity ключе)         |
  |                              |
  |  3. ECDH session key         |
  |     derive(x25519(A_priv,    |
  |            B_pub, "sync-v1")|
  |                              |
  |  4. A стримит шифрованный    |
  |     SQLite дамп → B          |
  |     -----  sync-chunk  ----> |
  |                              |
  |  5. B мерджит в свою БД      |
  |     (LWW по message_id)      |
```

## Детали

### 1. Announce

Устройство B при первом запуске отправляет в LAN (UDP broadcast) и P2P (DHT-подписка) пакет:

```json
{
  "packet_type": "sync-announce",
  "identity_pk": "<base58 ed25519 pubkey>",
  "device_nonce": "<32 random bytes base64>",
  "since_ts": null
}
```

`since_ts` = `null` означает «дай мне всё». При следующих ре-синках B ставит `since_ts = last_known_ts`, чтобы получить только инкремент.

### 2. Challenge

Устройство A, увидев `sync-announce` со своим `identity_pk`, отвечает:

```json
{
  "packet_type": "sync-challenge",
  "challenge": "<32 random bytes base64>"
}
```

B подписывает `challenge || device_nonce` своим Ed25519 ключом и шлёт обратно. Это предотвращает подмену: тот, кто делает announce с чужой identity, не сможет подписать challenge.

### 3. Session key

После успешной проверки обе стороны делают:

```
shared = X25519(own_priv, peer_pub)
session_key = HKDF-SHA256(shared, salt=device_nonce, info="soviet-sync-v1", 32 bytes)
```

Та же логика, что уже используется в `crypto::encrypt_message` для обычных сообщений — переиспользуем код.

### 4. Стриминг дампа

A читает из SQLite все строки таблицы `messages` с `timestamp > since_ts`, плюс ассоциированные `contacts` (если нужны для отображения), и отправляет чанками по 256 KB:

```json
{
  "packet_type": "sync-chunk",
  "seq": 0,
  "total": 37,
  "payload_b64": "<ChaCha20-Poly1305(session_key, chunk_bytes)>"
}
```

Последний чанк помечается `done: true`.

### 5. Merge

B декриптует чанки, парсит JSON (список `DbMessage`), применяет в локальной БД:
- INSERT OR IGNORE по `(sender_key, timestamp, content_hash)` — идемпотентно.
- Не затираем локально прочитанные флаги.

## Транспорт

- **LAN:** тот же UDP-broadcast, что для hello, с типом `sync-*`. Чанки — по уже установленному TCP-каналу (`net::tcp`).
- **P2P:** request-response protocol `/soviet/sync/1.0.0` в libp2p Behaviour. Реалистичный размер истории — десятки MB, quic или yamux-стримы справятся.
- **Nostr:** НЕ подходит — relay видят размер пакетов, это утечка метаданных. Sync только локально или P2P.

## Неочевидные решения

1. **Почему не делаем sync через Nostr?** Метаданные (размер, частота) видны relay, плюс relay'ы ограничивают размер ивентов (~64 KB). Дампы истории могут быть десятки MB.

2. **Почему не мерджим по `message_id` PK?** `message_id` — локальный autoincrement, различается между устройствами. Идентификатор дедупликации — кортеж `(sender_key, timestamp, content_hash)`.

3. **Что делать с конфликтами?** Не возникают: каждое сообщение иммутабельно после отправки. Редактирования (`applyMessageEdit`) тоже идемпотентны по `edit_id`. Last-Write-Wins по timestamp.

4. **Нужен ли пароль пользователя?** Нет, если оба устройства уже имеют identity secret в OS keyring. Если identity ещё не импортирована — sync невозможен (ECDH нельзя сделать без приватного ключа).

## План реализации

| Этап | LOC estimate | Где |
|------|---|---|
| LanPacket typs `sync-announce` / `sync-challenge` / `sync-chunk` | ~80 | `src-tauri/src/net/packet.rs` |
| Handler в `on_lan_packet` | ~200 | `src-tauri/src/net/lan.rs` |
| Дамп-итератор SQLite с пагинацией | ~120 | `src-tauri/src/storage/sync.rs` (новый файл) |
| Merge-функция с dedup | ~100 | `src-tauri/src/storage/sync.rs` |
| libp2p `/soviet/sync/1.0.0` behaviour | ~180 | `src-tauri/src/p2p/mod.rs` |
| UI: «🔄 Синхронизировать историю с другим устройством» в Settings | ~60 | `src/pages/Settings.tsx` |
| Tests | ~200 | `src-tauri/tests/sync.rs` |

Итого: ~940 LOC. 2-3 дня работы одного разработчика.

## Что ЯВНО не входит в v3.0

- Sync контактов (уже синхронизируются через сеть сами).
- Sync настроек (они per-device — разный `theme_skin`, `ui_scale`).
- Multi-master с 3+ устройствами (пока только 1↔1).
- Realtime push новых сообщений на все устройства (отдельная задача, требует device-registry в Nostr DM — v3.1).

## Связанные задачи

- v2.10.0 — перенос identity через QR (уже есть).
- v2.11.0 — passphrase-encryption seed (Argon2id), чтобы QR можно было хранить в облаке без утечки. Пред-запрос к этому: sync без паролей, но с Argon2id для seed-backup.
- v3.1 — Multi-master push (все устройства получают сообщения в реальном времени, не только через sync на запрос).
