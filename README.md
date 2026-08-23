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
