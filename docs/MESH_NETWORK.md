# Mesh-сеть и P2P через интернет

## Статус

**✅ РЕАЛИЗОВАНО в v1.1** — libp2p Kademlia DHT + mDNS

---

## Обзор

Начиная с v1.1, Soviet поддерживает полноценную P2P-связь через интернет на базе **libp2p 0.53**.

```
Транспортная цепочка:
┌─────────────────────────────────────────────────────┐
│  Уровень 1 — LAN (без интернета)                   │
│  mDNS обнаружение + TCP (порт 7778)                │
├─────────────────────────────────────────────────────┤
│  Уровень 2 — P2P mesh (интернет)                   │
│  libp2p Kademlia DHT + RequestResponse             │
├─────────────────────────────────────────────────────┤
│  Уровень 3 — Nostr DM relay fallback               │
│  Kind 4444 E2E через public relay                  │
└─────────────────────────────────────────────────────┘
```

---

## Реализация (v1.1)

### Стек

| Компонент | Технология |
|---|---|
| Библиотека | libp2p 0.53 |
| Транспорт | TCP + QUIC |
| Шифрование | Noise protocol |
| Мультиплексор | Yamux |
| LAN-обнаружение | mDNS (`/soviet/id/1.0.0`) |
| Интернет-маршрутизация | Kademlia DHT (`/soviet/kad/1.0.0`) |
| Идентификация | Identify protocol |
| Сообщения | RequestResponse CBOR (`/soviet/msg/1.0.0`) |

### Детерминированный PeerID

PeerID libp2p генерируется детерминированно из Ed25519-ключа Soviet:

```rust
pub fn peer_id_from_soviet_pk(soviet_pk_base58: &str) -> Option<PeerId> {
    let pk_bytes = bs58::decode(soviet_pk_base58).into_vec().ok()?;
    let ed_pub = identity::ed25519::PublicKey::try_from_bytes(&pk_bytes).ok()?;
    Some(PeerId::from(identity::PublicKey::from(ed_pub)))
}
```

**Преимущество:** не нужен отдельный обмен ключами — зная Soviet-ключ контакта, можно сразу вычислить его PeerId.

### SovietBehaviour

```rust
#[derive(NetworkBehaviour)]
struct SovietBehaviour {
    mdns:     mdns::tokio::Behaviour,        // LAN
    kad:      kad::Behaviour<MemoryStore>,   // DHT
    identify: identify::Behaviour,           // обмен метаданными
    ping:     ping::Behaviour,               // keepalive
    msg:      request_response::cbor::Behaviour<Vec<u8>, Vec<u8>>, // сообщения
}
```

### Обработка входящих сообщений

Входящие P2P-сообщения передаются в тот же канал `message_tx`, что и LAN-сообщения. Функция `handle_lan_packet` обрабатывает их одинаково — независимо от транспорта.

---

## Nostr DM Fallback (Kind 4444)

Если ни LAN, ни P2P-соединение недоступны:

1. Сообщение упаковывается в `EncryptedMessage` JSON
2. Шифруется ключом получателя (ChaCha20-Poly1305, как обычно)
3. Отправляется как Nostr Kind 4444 событие с тегом `p: <получатель hex>`
4. Relay хранит событие; получатель подписывается на свой hex-ключ
5. При получении: проверка тега, дешифровка, дедупликация, сохранение в БД

```
Relay видит только:
├─ Зашифрованный blob (не может расшифровать)
├─ hex-ключ получателя (pubkey tag)
└─ timestamp
```

---

## Bootstrap-ноды DHT

По умолчанию используются публичные IPFS bootstrap-ноды:

```
/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN
/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa
/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb
/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt
```

Для приватного Soviet-кластера можно поднять собственный bootstrap-узел и изменить список в `p2p/mod.rs`.

---

## Frontend

### Сайдбар (Sidebar)

```
🌐 ИНТЕРНЕТ (P2P)
  PeerID: 12D3KooW...  [статус]
```

### Настройки (Settings → Сеть)

- 🌐 libp2p DHT: `N пиров` / `поиск...`
- 📡 Nostr relay: `активен`
- 🔗 Relay серверы: `damus · nos.lol · nostr.band`
- Ваш P2P ID: `<PeerId>` [📋 копировать]

### Поиск пользователей (UserSearchModal)

Кнопка 🔎 в сайдбаре открывает поиск по никнейму или публичному ключу среди:
- Контактов
- LAN-пиров
- P2P-пиров

---

## Планируется в v2.0

| Функция | Статус |
|---|---|
| NAT hole-punching (DCUtR + relay) | 🔜 Следующий |
| GossipSub store-and-forward | 🔜 Планируется |
| Onion routing | 💡 Идея |
| Wi-Fi Direct + BLE (mobile) | 💡 Идея |

---

## Ссылки

- [libp2p docs](https://docs.libp2p.io)
- [Kademlia DHT paper](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf)
- [Noise protocol](https://noiseprotocol.org)
- [Nostr protocol](https://github.com/nostr-protocol/nostr)
