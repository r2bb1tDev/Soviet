# Каналы v2 — Полный функционал (Telegram-parity)

## Обзор

Начиная с v1.2, каналы Soviet поддерживают полный набор функций, аналогичных каналам Telegram:
редактирование, удаление, реакции, пересылка, комментарии и медиа-вложения (фото, видео, аудио, GIF).

---

## Новые возможности

### 1. Контекстное меню (правая кнопка мыши)

По правому клику на любом сообщении канала открывается меню:

| Пункт | Кто может | Действие |
|-------|-----------|---------|
| ✏️ Редактировать | Только создатель (свои посты) | Открывает редактор с текстом |
| 🗑 Удалить | Только создатель | Soft-delete + Kind 5 на relay |
| ↩️ Ответить | Все подписчики | Комментарий к посту |
| 📤 Переслать | Все подписчики | Цитата в текущем или другом чате |
| 😊 Реакция | Все подписчики | Открывает emoji-picker |

---

### 2. Редактирование сообщений

- Только **создатель канала** может редактировать свои посты
- При редактировании отправляется новый Kind 42 с тегом `["e", original_event_id, "", "edit"]`
- Отображается пометка **✏️ изменено** с временем правки
- Relay хранит оба события; клиент показывает последнее

**Nostr-событие редактирования:**
```json
{
  "kind": 42,
  "content": "<новый текст или JSON с медиа>",
  "tags": [
    ["e", "<channel_id>", "<relay>", "root"],
    ["e", "<original_event_id>", "", "edit"]
  ]
}
```

---

### 3. Удаление сообщений

- Только **создатель канала** может удалять любые посты
- Отправляется Kind 5 с тегом `["e", event_id]`
- Локально сообщение помечается `is_deleted = true`
- Вместо текста отображается плашка **🗑 Сообщение удалено**

---

### 4. Реакции

- **Все подписчики** могут ставить реакции на любой пост
- Используется **Kind 7** (стандартный Nostr NIP-25)
- До 5 уникальных emoji от одного пользователя на одно сообщение
- Повторный клик на уже поставленную реакцию — снимает её (Kind 5 на reaction event)
- Реакции отображаются под постом в виде пузырьков: `👍 12  ❤️ 5  🔥 3`

**Nostr-событие реакции (Kind 7):**
```json
{
  "kind": 7,
  "content": "👍",
  "tags": [
    ["e", "<target_event_id>"],
    ["p", "<target_author_pubkey>"],
    ["t", "soviet-channel"]
  ]
}
```

**Подписка на реакции:**
```json
["REQ", "reactions-<ch_id[:8]>", {"kinds": [7], "#e": ["<event_id1>", "..."], "limit": 500}]
```

---

### 5. Комментарии (ответы на посты)

- **Все подписчики** могут комментировать посты (не только создатель)
- Комментарий — это Kind 42 с тегом `reply`
- Под постом отображается счётчик **💬 N комментариев**
- Нажатие раскрывает тред комментариев

**Nostr-событие комментария:**
```json
{
  "kind": 42,
  "content": "<текст комментария>",
  "tags": [
    ["e", "<channel_id>", "<relay>", "root"],
    ["e", "<parent_post_event_id>", "", "reply"]
  ]
}
```

---

### 6. Пересылка (Forward)

- **Все подписчики** могут пересылать посты
- Пересылка в **другой чат** (прямой или групповой) — отправляется как текстовое сообщение с цитатой
- Пересылка в **другой канал** — новый Kind 42 с атрибуцией

**Формат пересланного сообщения:**
```
📤 Переслано из #<ChannelName>:
─────────────────────
<оригинальный текст>
```

---

### 7. Медиа-вложения

Поддерживаются следующие типы медиа в постах канала:

| Тип | Форматы | Лимит | Отображение |
|-----|---------|-------|-------------|
| 🖼 Изображение | jpg, png, webp, svg | 512 KB | Inline thumbnail + lightbox |
| 🎬 Видео | mp4, webm | 2 MB | HTML5 `<video>` плеер |
| 🎵 Аудио/Музыка | mp3, ogg, wav | 2 MB | HTML5 `<audio>` плеер |
| 🎞 GIF | gif | 512 KB | Анимированное inline |

> Лимиты обусловлены ограничениями Nostr relay (события ~64 KB в base64).
> Для крупных файлов рекомендуется вставить URL (YouTube, SoundCloud и т.д.).

**Формат сообщения с медиа (JSON в поле `content`):**
```json
{
  "v": 1,
  "text": "Подпись к медиа (опционально)",
  "media": {
    "type": "image",
    "data": "data:image/jpeg;base64,...",
    "name": "photo.jpg",
    "size": 12345
  }
}
```

Обратная совместимость: если `content` — обычная строка (не JSON), обрабатывается как plaintext.

---

## Архитектура реализации

### Nostr Kinds

| Kind | Назначение | Новое в v1.2 |
|------|-----------|-------------|
| 40 | Create channel | — |
| 41 | Update channel meta | — |
| 42 | Channel message / comment / edit | edit-тег, reply от всех |
| 5 | Delete event | soft-delete UI |
| 7 | Reaction | ✅ новое |
| 4444 | Soviet DM (fallback) | — |

### Изменения DB

**Новые колонки `nostr_messages`:**
```sql
ALTER TABLE nostr_messages ADD COLUMN edited_at INTEGER;
ALTER TABLE nostr_messages ADD COLUMN is_deleted INTEGER DEFAULT 0;
ALTER TABLE nostr_messages ADD COLUMN media_type TEXT;   -- 'image'|'video'|'audio'|'gif'
ALTER TABLE nostr_messages ADD COLUMN media_data TEXT;   -- base64 data URL (локально)
```

**Новая таблица `nostr_reactions`:**
```sql
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
```

### Новые Tauri команды

```typescript
// Редактирование
invoke('nostr_edit_channel_message', { eventId: string, channelId: string, newContent: string })

// Удаление
invoke('nostr_delete_channel_message', { eventId: string, channelId: string })

// Реакции
invoke('nostr_send_channel_reaction', { eventId: string, channelId: string, emoji: string })
invoke('nostr_remove_channel_reaction', { eventId: string, channelId: string, emoji: string })
invoke('nostr_get_channel_reactions', { channelId: string }) → Record<string, ChannelReaction[]>

// Комментарии
invoke('nostr_send_comment', { channelId: string, parentEventId: string, content: string })
```

### Frontend события (Tauri emit)

| Событие | Данные | Триггер |
|---------|--------|---------|
| `nostr-message-edited` | `{ event_id, new_content, edited_at }` | Входящий Kind 42 с edit-тегом |
| `nostr-message-deleted` | `{ event_id, channel_id }` | Входящий Kind 5 |
| `nostr-reaction` | `{ event_id, channel_id, reactor_pubkey, emoji, reaction_event_id }` | Входящий Kind 7 |
| `nostr-comment` | `{ ... NostrMessage }` | Входящий Kind 42 с reply-тегом |

---

## UX / Поведение

### Создатель канала
- Видит кнопки: ✏️ Edit, 🗑 Delete для своих постов
- Может публиковать посты с медиа
- Может удалять любые комментарии

### Подписчик (читатель)
- Может комментировать любой пост
- Может ставить реакции
- Может пересылать посты
- Не может редактировать/удалять чужие посты

### Медиа-пикер (панель создания поста)
```
[ 📎 Фото ] [ 🎬 Видео ] [ 🎵 Аудио ] [ GIF ] | [Textarea] | [→ Отправить]
```
- При выборе файла — предпросмотр перед отправкой
- Кнопка удаления вложения (×)
- Счётчик символов / индикатор размера файла

---

## Roadmap

- [x] v1.2 — Edit, Delete, Reactions (Kind 7), Comments, Media (image/gif/audio/video)
- [x] v2.1 — терминальный стиль постов, поиск каналов, описание в шапке, копирование ID, вставка кода (`</>`)
- [x] v2.2 — авто-обновление реакций/комментариев каждые 10 сек, фикс пересылки, позиционирование emoji-picker
- [ ] v2.3 — NIP-96 file hosting (крупные файлы), Polls (Kind 1068), Zaps
