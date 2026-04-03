# 🐻 Soviet — Децентрализованный мессенджер

<p align="center">
  <img src="assets/logo/bear_icon.svg" alt="Soviet Logo" width="120"/>
</p>

<p align="center">
  <b>Простой. Безопасный. Работает везде — даже без интернета.</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg"/>
  <img src="https://img.shields.io/badge/stack-Tauri%202.1%20%2B%20React%20%2B%20Rust-blue.svg"/>
</p>

---

## 📖 О проекте

**Soviet** — децентрализованный мессенджер, вдохновлённый классическим ICQ. Работает на **Tauri 2.1 + Rust + React/TypeScript** с поддержкой четырёх режимов связи:

1. **Прямые чаты** — E2E шифрование (ChaCha20-Poly1305 через ECDH)
2. **Локальная сеть** — без интернета через mDNS и TCP
3. **P2P mesh** — libp2p Kademlia DHT через интернет
4. **Nostr DM / каналы** — fallback через public relay (Kind 4444 / Kind 40-42)

Никакого email. Никакого телефона. Только никнейм и пара криптографических ключей — и ты в сети.

Логотип — **белый медведь**. В системном трее белый медведь, а при новых сообщениях — медведь с конвертиком.

---

## 🎯 Ключевые особенности

- 🔑 **Без регистрации** — только никнейм + публичный/приватный ключ (Ed25519 + X25519)
- 🌐 **Четыре режима связи** — LAN (без интернета) → P2P mesh (libp2p DHT) → Nostr DM relay (интернет-fallback)
- 🔒 **End-to-End шифрование** — сообщения в прямых чатах расшифровываются только у получателя
- 📱 **Кроссплатформенность** — Windows (основная), macOS/Linux (дополнительно)
- 🎨 **Адаптация под тему ОС** — автоматически светлая/тёмная тема, без перезапуска
- 🐻 **Белый медведь в трее** — с конвертиком при новых сообщениях
- 📂 **Открытый исходный код** — MIT License, без рекламы

---

## 🚀 Реализованная функциональность (v1.1)

### Идентичность
| Функция | Описание |
|---|---|
| Генерация ключей | Ed25519 для подписей + X25519 для шифрования (производный) |
| Никнейм | Отображаемое имя (видно другим пользователям) |
| Custom ID | 3-10 символов, уникальный пользовательский идентификатор |
| Хранение ключей | В защищённом хранилище ОС (DPAPI/Keychain/libsecret) |
| Экспорт/импорт | Сохранение и восстановление идентичности |

### Личные сообщения
| Функция | Описание |
|---|---|
| Прямые чаты | Один-на-один, E2E шифрование |
| Редактирование | Отправленные сообщения можно отредактировать |
| Удаление | Отправленные сообщения можно удалить |
| Реакции | Эмодзи-реакции на сообщения |
| Ответы (Reply) | Цитирование в ответе |
| Форвард | Переотправка сообщений |
| Code blocks | Поддержка ``` и ` для кода, кнопка </> вставки |
| Файлы | Отправка файлов до 10 МБ, изображения показываются inline |

### Групповые чаты
| Функция | Описание |
|---|---|
| Создание | Любой участник может создать группу |
| Приглашение | Добавление участников по ключу |
| Участие | Вступление, выход, система уведомлений |
| Удаление | Только создатель может удалить группу |
| Системные сообщения | Автоматические сообщения при входе/выходе |

### Nostr каналы
| Функция | Описание |
|---|---|
| Создание | Создатель генерирует уникальный ID канала |
| Присоединение | Вступление по ID канала |
| Публичное чтение | Чтение сообщений всеми подписчиками |
| Писатель | Только создатель может отправлять сообщения |
| Метаданные | Имя, описание (about), аватар (base64) |
| Удаление | Только создатель может удалить канал |
| Подписчики | Счётчик количества подписчиков |

### Локальная сеть (LAN)
| Функция | Описание |
|---|---|
| Обнаружение | mDNS (libp2p) + UDP broadcast fallback (порт 7433) |
| Прямое соединение | TCP по пользовательскому JSON-протоколу |
| Работа без интернета | Полноценная связь в одной подсети |

### P2P mesh (интернет)
| Функция | Описание |
|---|---|
| Транспорт | libp2p 0.53: TCP + QUIC, Noise encryption, Yamux |
| Обнаружение | Kademlia DHT через bootstrap-ноды (public IPFS) |
| Идентификатор | PeerId детерминированно из Ed25519-ключа Soviet |
| Маршрутизация | RequestResponse protocol `/soviet/msg/1.0.0` |
| Статус | Отображается в сайдбаре (🌐 ИНТЕРНЕТ) и в Настройках |

### Nostr DM / каналы
| Функция | Описание |
|---|---|
| Личные DM | Kind 4444 — зашифрованные E2E сообщения через relay |
| Каналы | Kind 40/41/42 публичные каналы |
| Relay | damus.io, nos.lol, relay.nostr.band |
| Дедупликация | Защита от повторной доставки событий |

### Контакты
| Функция | Описание |
|---|---|
| Добавление | По публичному ключу, из LAN/P2P-обнаружения или QR |
| QR-код | Генерация и сканирование QR для быстрого добавления |
| Share card | Формат `Soviet \| nickname \| pubkey \| @customId` |
| Поиск пользователей | По никнейму или ключу среди контактов, LAN и P2P пиров |
| Статусы | Online / Away / Busy / Offline + пользовательский текст |
| Аватар | Загрузка и хранение base64-аватара в настройках |

### Интерфейс
| Функция | Описание |
|---|---|
| Системный трей | Иконка белого медведя + меню статусов |
| Темы | Светлая/тёмная автоматически по ОС + ручной выбор |
| Чат-окно | Список контактов слева, чат справа |
| Уведомления | ОС-уведомления о новых сообщениях |
| Индикатор набора | "Никнейм печатает..." |
| Статусы доставки | ✓ отправлено / ✓✓ доставлено / ✓✓ прочитано |

### Поиск
| Функция | Описание |
|---|---|
| Контакты | По имени или публичному ключу |
| Каналы | По имени Nostr-канала |

---

## 🌐 Режимы работы

```
┌──────────────────────────────────────────────────────────┐
│  Режим 1 — ЛОКАЛЬНАЯ СЕТЬ (без интернета)               │
│  mDNS (libp2p) + TCP direct (порт 7778)                  │
│  Работает в офисе, дома, на мероприятии без интернета.   │
├──────────────────────────────────────────────────────────┤
│  Режим 2 — P2P MESH (интернет)                          │
│  libp2p Kademlia DHT + RequestResponse                   │
│  Прямое соединение через интернет без серверов.          │
├──────────────────────────────────────────────────────────┤
│  Режим 3 — NOSTR DM FALLBACK (интернет)                 │
│  Kind 4444 E2E DM через public relay                     │
│  Работает если P2P-соединение недоступно.                │
├──────────────────────────────────────────────────────────┤
│  Режим 4 — NOSTR КАНАЛЫ                                  │
│  Kind 40/41/42 — публичные каналы для рассылки.         │
└──────────────────────────────────────────────────────────┘
```

Транспортная цепочка для прямых чатов (автовыбор):
```
Отправить сообщение →
  1. LAN доступен?      → TCP напрямую (быстро, без интернета)
  2. P2P пир найден?    → libp2p RequestResponse (интернет)
  3. Иначе              → Nostr Kind 4444 DM (relay fallback)
```

Подробнее:
- [Режим LAN](docs/LAN_MODE.md)
- [Mesh-сеть P2P](docs/MESH_NETWORK.md)
- [Протокол](protocol/PROTOCOL.md)

---

## 🔐 Система идентификации

Вместо традиционной регистрации:

1. При первом запуске вводите **никнейм**
2. Автоматически генерируется пара ключей:
   - **Публичный ключ Ed25519** — ваш адрес в сети (как UIN в ICQ)
   - **Приватный ключ** — хранится в защищённом хранилище ОС, никуда не отправляется
3. **Custom ID** (3-10 символов) — дополнительный уникальный идентификатор (опционально)
4. Для добавления контакта достаточно знать публичный ключ собеседника
5. Ключи можно экспортировать — при переустановке они восстановят вашу идентичность

```
Пример публичного ключа:
5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx

Или в виде QR-кода:
Soviet | PolarBear | 5KYZdUEo39C1shXXPRJ4FxHPCcMHbhcVVxjBkzmV9Mfx | @polarbear
```

Подробнее: [Криптография](docs/CRYPTO.md) | [Контакты](docs/CONTACTS.md)

---

## 🏗️ Архитектура

```
Soviet (Tauri 2.1)
├── UI Layer          React 18 + TypeScript + Vite
│   ├── Components    ChatWindow, ChannelWindow, Sidebar, ShareCard,
│   │                 UserSearchModal
│   ├── Pages         Main, Settings, Onboarding
│   └── Store         Zustand (contacts, chats, p2pPeers, lanPeers…)
├── Tauri Bridge      IPC между React и Rust
└── Core Layer (Rust)
    ├── Identity      Ed25519/X25519 ключи, хранилище ОС
    ├── Crypto        ChaCha20-Poly1305, ECDH, HKDF
    ├── Network       LAN (mDNS + TCP)
    ├── P2P           libp2p 0.53: mDNS, Kademlia DHT, RequestResponse
    ├── Nostr         WebSocket relay: каналы (40-42) + DM (4444)
    ├── Storage       SQLite (rusqlite)
    └── Tray          Системный трей (bear icon)
```

Подробнее: [Архитектура](docs/ARCHITECTURE.md)

---

## 💻 Технологический стек

| Компонент | Технология |
|---|---|
| **Фреймворк** | Tauri 2.1 |
| **Бэкенд** | Rust (1.75+) |
| **Фронтенд** | React 18 + TypeScript + Vite |
| **State** | Zustand |
| **Шифрование** | Ed25519, X25519, ChaCha20-Poly1305 |
| **Сеть** | mDNS + TCP (LAN); libp2p DHT (P2P); WebSocket (Nostr) |
| **База данных** | SQLite (rusqlite) |
| **ОС** | Windows 10+ (основная), macOS 11+, Linux (Ubuntu 20.04+) |
| **Сборка** | `npm run tauri build` |
| **Инсталлер** | NSIS (Windows), DMG (macOS), AppImage/deb (Linux) |

---

## 📁 Структура проекта

```
soviet/
├── README.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── SECURITY.md
├── LICENSE
├── package.json
├── tsconfig.json
│
├── src/                    # React/TypeScript фронтенд
│   ├── components/         # UI компоненты
│   │   ├── ChatWindow.tsx
│   │   ├── ChannelWindow.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ShareCard.tsx
│   │   └── ...
│   ├── pages/
│   │   ├── Main.tsx
│   │   ├── Settings.tsx
│   │   └── Onboarding.tsx
│   ├── store/
│   │   └── index.ts        # Zustand store
│   ├── App.tsx
│   └── main.tsx
│
├── src-tauri/              # Rust бэкенд (Tauri)
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs          # Tauri commands (~1500 строк)
│       ├── crypto/         # Ed25519, X25519, ChaCha20
│       │   ├── mod.rs
│       │   ├── keys.rs
│       │   └── cipher.rs
│       ├── identity/       # Key management
│       │   ├── mod.rs
│       │   └── keystore.rs
│       ├── network/        # LAN + Nostr
│       │   ├── mod.rs
│       │   ├── lan.rs      # UDP/TCP
│       │   └── nostr.rs    # WebSocket relay
│       ├── storage/        # SQLite
│       │   ├── mod.rs
│       │   └── db.rs
│       └── tray/           # Системный трей
│           └── mod.rs
│
├── docs/
│   ├── ARCHITECTURE.md     # Архитектура системы
│   ├── CONTACTS.md         # Система контактов
│   ├── CRYPTO.md           # Криптография и безопасность
│   ├── LAN_MODE.md         # Работа в локальной сети
│   ├── MESH_NETWORK.md     # Планируется (mesh-сеть)
│   └── UI_DESIGN.md        # UI, дизайн, иконки, темы
│
├── protocol/
│   └── PROTOCOL.md         # Протокол LAN + Nostr
│
├── assets/
│   ├── logo/               # SVG логотипы
│   └── icons/              # Иконки (tray, app)
│
└── tests/
    └── ...                 # Тесты
```

---

## 🛠️ Установка зависимостей

### Требования

- **Node.js** 18+ и npm 9+
- **Rust** 1.75+ (установить через rustup.rs)
- **Tauri CLI** (установится автоматически)
- Windows: Visual Studio Build Tools 2022+ или Microsoft C++ Build Tools
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Linux (Ubuntu/Debian): build-essential, libssl-dev

### Windows

```bash
# Установка Rust (выполнить один раз)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Клонирование репозитория
git clone https://github.com/YOUR_USERNAME/Soviet.git
cd Soviet

# Установка зависимостей Node.js
npm install

# Запуск в режиме разработки
npm run tauri dev

# Сборка для продакшена
npm run tauri build
```

### macOS

```bash
# Установка Rust (выполнить один раз)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Установка Xcode Command Line Tools
xcode-select --install

# Клонирование репозитория
git clone https://github.com/YOUR_USERNAME/Soviet.git
cd Soviet

# Установка зависимостей Node.js
npm install

# Запуск в режиме разработки
npm run tauri dev

# Сборка для продакшена
npm run tauri build
```

### Linux (Ubuntu/Debian)

```bash
# Установка зависимостей системы
sudo apt install build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev

# Установка Rust (выполнить один раз)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Клонирование репозитория
git clone https://github.com/YOUR_USERNAME/Soviet.git
cd Soviet

# Установка зависимостей Node.js
npm install

# Запуск в режиме разработки
npm run tauri dev

# Сборка для продакшена
npm run tauri build
```

---

## 📦 Установка (готовые сборки)

Готовые инсталляторы будут доступны на странице [Releases](../../releases):

- **Windows** — `Soviet-Setup-x.x.x.exe` (NSIS installer) или `Soviet-x.x.x_x64-setup.exe`
- **macOS** — `Soviet-x.x.x.dmg` (Intel + Apple Silicon universal binary)
- **Linux** — `.AppImage`, `.deb` (для Ubuntu/Debian)

### Запуск после установки

После установки запустите приложение из меню приложений:
- **Windows**: Start Menu → Soviet
- **macOS**: Applications → Soviet
- **Linux**: Applications menu или `soviet-msg` в терминале

---

## 🗺️ Roadmap

- [x] **v1.0** — Стабильный релиз (2026-04-02)
  - [x] Identity (Ed25519/X25519)
  - [x] Прямые E2E чаты
  - [x] Групповые чаты
  - [x] LAN-режим (mDNS + TCP)
  - [x] Nostr каналы (WebSocket)
  - [x] Файлы (до 10 МБ)
  - [x] Системный трей
  - [x] Темы ОС

- [x] **v1.1** — Интернет + P2P mesh (2026-04-03)
  - [x] libp2p Kademlia DHT — P2P через интернет
  - [x] Nostr DM Kind 4444 — relay fallback для личных сообщений
  - [x] Транспортная цепочка: LAN → P2P → Nostr DM
  - [x] Поиск пользователей по никнейму / ключу
  - [x] Статус P2P в Настройках (пиры, relay, P2P ID)
  - [x] Исправлен layout Onboarding
  - [x] Импорт ключей без ручного никнейма
  - [x] Copy feedback для ключей в Настройках

- [ ] **v2.0** — Расширенная функциональность
  - [ ] NAT hole-punching (DCUtR через relay) — *в разработке*
  - [ ] GossipSub store-and-forward — *планируется*
  - [ ] Multi-device sync — *планируется*
  - [ ] Голосовые сообщения — *планируется*
  - [ ] Шифрование БД (SQLCipher) — *планируется*

- [ ] **Постоянно** — Улучшения
  - [ ] Оптимизация производительности
  - [ ] Улучшение UX
  - [ ] Переводы
  - [ ] Поддержка новых платформ

---

## 🤝 Вклад в проект

Рады любой помощи! Смотрите [CONTRIBUTING.md](CONTRIBUTING.md).

Особенно нужна помощь:
- Тестирование на разных ОС и конфигурациях
- Криптография и код-ревью безопасности
- UI/UX дизайн и иконки
- Документация и переводы
- Оптимизация Rust-кода

---

## 📄 Лицензия

MIT License — см. [LICENSE](LICENSE).

---

## 🔒 Безопасность

Если вы обнаружили уязвимость, пожалуйста, **не публикуйте** её в Issues. Напишите на security@... (см. [SECURITY.md](SECURITY.md)).

---

<p align="center">
  Сделано с ❤️ и открытым кодом · Без рекламы · Без слежки · <b>Для людей</b>
</p>
