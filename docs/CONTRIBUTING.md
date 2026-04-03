# Участие в разработке (Contributing Guide)

Добро пожаловать в Soviet Messenger! Мы рады любому вкладу в проект.

---

## С чего начать

### 1. Форкни репозиторий

```bash
git clone https://github.com/YOUR_USERNAME/soviet-messenger.git
cd soviet-messenger
```

### 2. Настрой окружение

**Требования:**
- Rust 1.75+ (`rustup update`)
- Node.js 20+ 
- pnpm (`npm install -g pnpm`)
- Tauri CLI (`cargo install tauri-cli`)

**Windows:** дополнительно установи [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)  
**Linux:** `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev`

### 3. Установи зависимости

```bash
cd client
pnpm install
```

### 4. Запусти в dev-режиме

```bash
pnpm tauri dev
```

---

## Структура веток

| Ветка | Назначение |
|-------|-----------|
| `main` | Стабильный код, только релизы |
| `develop` | Основная ветка разработки |
| `feature/xxx` | Новая функция |
| `fix/xxx` | Исправление бага |
| `docs/xxx` | Документация |

---

## Процесс Pull Request

1. Создай ветку от `develop`:
   ```bash
   git checkout -b feature/my-feature develop
   ```

2. Пиши код, соблюдай стиль проекта

3. Убедись, что тесты проходят:
   ```bash
   cargo test  # Rust тесты
   pnpm test   # Frontend тесты
   ```

4. Создай Pull Request в `develop`

5. Дождись ревью от мейнтейнера

---

## Стиль кода

### Rust
- Используй `rustfmt` (`cargo fmt`)
- Lint через `clippy` (`cargo clippy`)
- Документируй публичные функции (`///`)

### TypeScript/React
- Prettier для форматирования (`pnpm format`)
- ESLint (`pnpm lint`)
- Компоненты — функциональные, с TypeScript типами

---

## Баги и предложения

- **Баг** → [GitHub Issues](https://github.com/YOUR_USERNAME/soviet-messenger/issues) с шаблоном Bug Report
- **Идея** → [GitHub Discussions](https://github.com/YOUR_USERNAME/soviet-messenger/discussions)
- **Безопасность** → ТОЛЬКО на email, не в публичных Issues (см. SECURITY.md)

---

## Кодекс поведения

Этот проект придерживается [Contributor Covenant](https://www.contributor-covenant.org/). Будьте уважительны к другим участникам.

---

## Вопросы?

Открой Discussion на GitHub или напиши в чате проекта.
