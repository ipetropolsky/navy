# Project template

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
