# «Кильватер» — ночной морской чат

Чат ко Дню ВМФ: участники — корабли, дело происходит ночью, в шапке живая сцена спокойного
моря под луной. Когда кто-то печатает, его корабль передаёт сигнальной лампой азбукой Морзе.

## Документация

- [Архитектура](docs/ARCHITECTURE.md) — как устроено приложение: слои, состояния сервиса,
  поток данных.
- [API бэкенда](docs/BACKEND-API.md) — интерфейс `ChannelBackend` с примерами кода:
  каналы, участники, сообщения, события, ошибки.
- [Принципы разработки API](docs/API-PRINCIPLES.md) — как проектируем контракты, чтобы
  их можно было расширять, и чему нынешний контракт пока не соответствует.
- [Firebase](docs/FIREBASE.md) — план переезда на настоящий бэкенд: коллекции и пути,
  что меняется в контракте, что происходит без сети.
- [Оформление](docs/STYLEGUIDE.md) — кегли, цвета и принципы: как выглядит интерфейс
  и почему именно так.
- [Проект](docs/PROJECT.md) — исходное задание, продуктовые решения, устройство сцены
  и план по шагам.
- [Раскладка](docs/LAYOUT.md) — как устроены экран и шторка во всех случаях: мерки, режимы,
  анимации, кто и что прокручивает.
- [Шторки](docs/SHEETS.md) — коробки, которые тянут пальцем: оси настройки, жест,
  физика и что в них осталось свести.
- [Проверки](docs/TESTING.md) — как гонять набор целиком и по одной, смотреть на него глазами,
  отлаживать и разбирать упавшее.
- [Задачи](https://github.com/ipetropolsky/navy/issues) — отложенные задачи и технический долг.

## Настройка проекта

```bash
# Install dependencies
npm i

# Start dev server (localhost:3000)
npm run dev
```

Без настроек Firebase приложение работает на эмуляторе бэкенда (localStorage) и входит
«местным» — так и идут проверки и разработка без сети. Чтобы поднять его на настоящем
Firestore, нужен `.env.local`:

```bash
VITE_BACKEND=firebase
# Либо настоящий проект — настройки из консоли Firebase (Project settings → Your apps),
VITE_FIREBASE_API_KEY=…
VITE_FIREBASE_AUTH_DOMAIN=…
VITE_FIREBASE_PROJECT_ID=navy-chat
VITE_FIREBASE_APP_ID=…
# либо локальные эмуляторы, которым ключи не нужны вовсе:
VITE_FIREBASE_EMULATOR=1
```

Эмуляторы поднимает `npm run functions:dev` (Auth, Firestore и функции). Что за коллекции
и правила за этим стоят — в [docs/FIREBASE.md](docs/FIREBASE.md).

## Проверка кода

```bash
# Check types
npm run ts-check

# Format specific files
npm run format-files file1 file2 ...

# Check types, lint and format entire repo
npm run check

# Run browser tests (Playwright, builds and serves the app itself)
npm run test:e2e
```

## Сборка и деплой

```bash
# Production build to /build
npm run build

# Deploy to GitHub Pages
npm run deploy
```

## Другие скрипты

```bash
# Install all dependencies with latest versions
npm install $(npm run deps-latest --silent)

# Inspect ESLint config
npx eslint --inspect-config

# Print ESLint config
npx eslint --print-config src/index.tsx
```
