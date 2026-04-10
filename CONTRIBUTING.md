# Вклад в проект Soviet

Спасибо, что хотите помочь развитию Soviet! Этот документ описывает процесс участия в разработке.

---

## 🤝 Кодекс поведения

Проект придерживается принципа уважения и конструктивного общения. Любая форма дискриминации, оскорблений или харассмента недопустима.

---

## 🚀 С чего начать

### Нашли ошибку?

1. Убедитесь, что баг ещё не зарегистрирован в [Issues](../../issues)
2. Создайте новый Issue с тегом `bug`
3. Опишите:
   - Версию Soviet
   - ОС и версию (Windows 10, macOS 13, Ubuntu 22.04, etc.)
   - Шаги воспроизведения (пошагово)
   - Ожидаемое поведение
   - Фактическое поведение
   - Логи (если есть в `~/.config/Soviet/` или `%APPDATA%\Soviet\`)

### Хотите предложить функцию?

1. Проверьте [Issues](../../issues) и [Discussions](../../discussions)
2. Создайте Issue с тегом `enhancement`
3. Опишите:
   - Зачем эта функция нужна
   - Как она должна работать
   - Возможные альтернативы

### Хотите улучшить документацию?

1. Форкните репозиторий
2. Создайте ветку `docs/description`
3. Внесите изменения в `.md` файлы
4. Создайте PR

---

## 💻 Локальная разработка

### Требования

- **Rust** 1.75+ (установить с rustup.rs)
- **Node.js** 18+ и npm 9+
- **Tauri CLI** — установится через `npm install`

#### Windows
- Visual Studio Build Tools 2022+ или Microsoft C++ Build Tools

#### macOS
- Xcode Command Line Tools (`xcode-select --install`)

#### Linux (Ubuntu/Debian)
```bash
sudo apt install build-essential libssl-dev libgtk-3-dev libayatana-appindicator3-dev
```

### Клонирование и установка

```bash
# Клонируйте репозиторий
git clone https://github.com/r2bb1tDev/Soviet.git
cd Soviet

# Установите зависимости Node.js
npm install

# Запустите приложение в режиме разработки
npm run tauri dev

# Или соберите для продакшена
npm run tauri build
```

### Структура проекта

```
soviet/
├── src/                    # React/TypeScript фронтенд
│   ├── components/         # React компоненты
│   ├── pages/
│   ├── store/              # Zustand state management
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/              # Rust бэкенд (Tauri)
│   └── src/
│       ├── lib.rs          # Tauri commands
│       ├── crypto/         # Криптография
│       ├── network/        # Сеть (LAN + Nostr)
│       ├── storage/        # SQLite
│       └── ...
├── docs/                   # Документация
├── protocol/               # Протокол
└── package.json
```

---

## 📝 Процесс разработки

### Ветки

- `main` — стабильная версия, только через PR
- `dev` — основная ветка разработки
- `feature/xxx` — новые функции
- `fix/xxx` — исправления багов
- `docs/xxx` — изменения документации

### Соглашение о коммитах

Используем [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add message reactions support
fix: correct ECDH key derivation on Windows
docs: update LAN protocol documentation
refactor: simplify storage module
test: add crypto unit tests
chore: update dependencies
```

**Формат:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` — новая функция
- `fix` — исправление бага
- `docs` — документация
- `refactor` — переписывание без изменения функции
- `test` — добавление тестов
- `chore` — обновления, конфиги
- `perf` — оптимизация производительности

**Примеры:**
```
feat(crypto): implement HKDF key derivation

Implement HKDF-SHA256 for key derivation in E2E messaging.
Uses hkdf crate v0.12.

Fixes #42

feat(ui): add dark mode support
fix(network): handle TCP connection reset
docs(CRYPTO.md): update Ed25519 section
```

### Код-стайл

#### Rust

- Стандарт: **Edition 2021**
- Форматирование: `rustfmt` (встроен в Rust)
- Linting: `clippy` (встроен в Rust)

```bash
# Форматирование
cargo fmt

# Linting
cargo clippy --all-targets --all-features -- -D warnings
```

**Соглашения:**
- Функции и переменные: `snake_case`
- Типы и структуры: `CamelCase`
- Константы: `UPPER_SNAKE_CASE`
- Приватные функции: префикс нет, только в модулях `mod.rs`

#### TypeScript/React

- Форматирование: **Prettier** (install locally)
- Linting: **ESLint**

```bash
# Форматирование
npx prettier --write src/

# Linting
npx eslint src/
```

**Соглашения:**
- Компоненты: `PascalCase` (ChatWindow.tsx)
- Функции/переменные: `camelCase`
- Файлы компонентов: `PascalCase.tsx`
- Файлы утилит: `camelCase.ts`

### Тестирование

#### Rust

```bash
# Запустить все тесты
cargo test

# Запустить с выводом
cargo test -- --nocapture

# Тестировать криптографию
cargo test crypto::
```

#### TypeScript

```bash
# Запустить тесты (при наличии)
npm run test

# Или используйте vitest/jest
npx vitest
```

---

## 📤 Pull Request

### Процесс создания PR

1. **Форкните** репозиторий на GitHub
2. **Клонируйте** ваш fork:
   ```bash
   git clone https://github.com/r2bb1tDev/Soviet.git
   cd Soviet
   git remote add upstream https://github.com/r2bb1tDev/Soviet.git
   ```

3. **Создайте ветку** от `dev`:
   ```bash
   git checkout -b feature/my-feature dev
   ```

4. **Внесите изменения** и коммитьте:
   ```bash
   git add .
   git commit -m "feat(module): description"
   ```

5. **Синхронизируйте** с upstream:
   ```bash
   git fetch upstream
   git rebase upstream/dev
   ```

6. **Запушьте** в ваш fork:
   ```bash
   git push origin feature/my-feature
   ```

7. **Создайте PR** на GitHub
   - Заполните шаблон PR
   - Опишите изменения
   - Укажите связанные Issues (`Fixes #123`)
   - Добавьте скриншоты если нужно

### Чек-лист перед PR

- [ ] Код следует style guide
- [ ] Выполнены все тесты (`cargo test`, `npm test`)
- [ ] Код отформатирован (`cargo fmt`, `prettier`)
- [ ] Нет linting ошибок (`cargo clippy`, `eslint`)
- [ ] Документация обновлена
- [ ] Коммит-сообщение следует Conventional Commits
- [ ] PR описание содержит контекст
- [ ] Нет конфликтов с `dev` веткой

---

## 🔍 Код-ревью

### Что ревьюеры проверят

1. **Функциональность** — работает ли как задумано?
2. **Безопасность** — есть ли уязвимости?
3. **Производительность** — не замедляет ли приложение?
4. **Качество кода** — следует ли conventions?
5. **Тесты** — покрыты ли новые функции?
6. **Документация** — обновлена ли документация?

### Как реагировать на комментарии

- ✅ Обсудите предложения в PR
- ✅ Согласитесь или предложите альтернативу
- ✅ Обновите код и коммитьте изменения
- ❌ Не удаляйте коммиты (история должна быть видна)

---

## 🎯 Приоритетные области

Нам особенно нужна помощь в:

### 1. Криптография и безопасность
- Аудит криптографического кода
- Тестирование Edge cases (граничные случаи)
- Проверка на timing attacks
- Анализ ECDH/HKDF реализации

### 2. LAN Discovery
- Тестирование на разных ОС
- Оптимизация UDP broadcast / mDNS (libp2p)
- Обработка Network partitions
- Store-and-Forward для оффлайн-участников

### 3. UI/UX
- Дизайн иконок и логотипов
- Улучшение макетов
- Анимации и переходы
- Доступность (a11y)

### 4. Тестирование
- Unit тесты для Rust модулей
- Integration тесты для протокола
- E2E тесты для UI
- Тестирование на Windows/macOS/Linux

### 5. Документация
- Дополнение документации
- Примеры использования
- Переводы (русский, английский, etc.)
- Видео-туториалы

### 6. Производительность
- Оптимизация Rust кода
- Снижение потребления памяти
- Ускорение криптографических операций
- Профилирование и benchmarking

---

## ✅ Рекомендуемые задачи для новичков

Если вы новичок, начните с этих задач:

- [ ] Добавить unit тесты для существующих функций
- [ ] Улучшить документацию в коде (comments)
- [ ] Исправить typo в документации
- [ ] Добавить обработку ошибок в модуле
- [ ] Оптимизировать простую функцию
- [ ] Добавить логирование (debug prints)

Ищите Issues с меткой `good first issue` или `help wanted`.

---

## 🆘 Вопросы?

- **GitHub Discussions:** https://github.com/r2bb1tDev/Soviet/discussions
- **Email:** r2bb1t.Dev@gmail.com
- **Issues:** https://github.com/r2bb1tDev/Soviet/issues

---

## 📊 Статистика вклада

Мы ценим все виды вклада:

- 💻 Код
- 🐛 Баг-репорты
- 📚 Документация
- 🎨 Дизайн
- 🧪 Тесты
- 🌍 Переводы
- 💬 Обсуждения и идеи

Спасибо за поддержку Soviet! 🐻

