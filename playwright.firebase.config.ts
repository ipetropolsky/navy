import { defineConfig, devices } from '@playwright/test';

import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from '@tests-firebase/env';

/**
 * Отдельный прогон поверх Firebase: тот же браузер, что и в playwright.config.ts, но вместо
 * localStorage вкладки — настоящие Firestore, Auth и Cloud Functions, поднятые эмулятором.
 *
 * Не часть основного набора нарочно: у него свой testDir (`tests-firebase`, а не `tests`),
 * свой сервер предпросмотра и свои сроки ожидания — здесь по сети ходят взаправду, и то,
 * что в основном наборе стоит долей секунды, тут стоит настоящего сетевого запроса.
 * Обычный набор (tests/, playwright.config.ts) эта проверка не трогает и продолжает
 * ходить в местный бэкенд как раньше.
 *
 * Запуск: `npm run test:e2e:firebase`. Он сам поднимает эмуляторы auth+firestore+functions
 * (`firebase emulators:exec`) и внутри них — сборку и предпросмотр; руками поднимать ничего
 * не нужно. Про то, что именно здесь проверяется и что нарочно не проверяется ещё, — см.
 * docs/FIREBASE.md, «Проверки».
 */

const PORT = 4174;

/** Куда собирается приложение для этого набора — см. комментарий у webServer.command ниже. */
const BUILD_DIR = 'build-firebase';

/** См. playwright.config.ts — тот же смысл, тот же путь до готового Chromium в контейнере. */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
    testDir: './tests-firebase',
    // Сроки заметно шире, чем в playwright.config.ts: там за секундой в интерфейсе стоит
    // синхронная запись в localStorage, здесь — настоящий Firestore и вызов Cloud Function
    // через эмулятор. Числа не с потолка: READ_TIMEOUT и WRITE_TIMEOUT в src/config/network.ts —
    // это сроки, которые сам интерфейс готов ждать от сервера, и проверке нельзя быть строже
    // собственного приложения.
    timeout: 20_000,
    expect: { timeout: 8_000 },
    // Один общий эмулятор на весь прогон (его поднимает npm run test:e2e:firebase, не эта
    // конфигурация) — в отличие от местного бэкенда, где у каждой проверки свой localStorage,
    // здесь база одна на все файлы. Раздельные каналы со своим slug снимают большую часть
    // помех, но гонять несколько файлов вперемешку по эмулятору всё равно незачем: сегодня
    // здесь один файл на одну сквозную проверку, и параллелить нечего.
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        actionTimeout: 5_000,
        navigationTimeout: 10_000,
        trace: 'on-first-retry',
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 900 } } }],
    webServer: {
        // Сборка с бэкендом Firebase и подключением к эмулятору — переменные читаются один раз,
        // на сборке (см. src/config/firebase.ts), поэтому здесь, а не в use.extraHTTPHeaders
        // или где-то на стороне теста. VITE_FIREBASE_PROJECT_ID совпадает с --project
        // у emulators:exec: singleProjectMode в firebase.json держит эмулятор на одном
        // проекте, и указывать какой-то другой id незачем и рискованно.
        // Своя папка сборки, а не общая `build/`. Оба набора собирают одно и то же приложение,
        // но с разными бэкендами внутри, а `vite preview` отдаёт то, что лежит в папке на миг
        // запроса, — не то, что там лежало на миг запуска. Собирайся оба в одну папку, и один
        // прогон, начатый рядом с другим, молча подменил бы соседу бандл: набор на местном
        // бэкенде получил бы сборку с Firebase и падал бы там, где к его коду претензий нет.
        // Замерено, а не предположено: так и вышло при первом же совместном прогоне.
        command:
            'VITE_BACKEND=firebase VITE_FIREBASE_EMULATOR=1' +
            ` VITE_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID} VITE_FIREBASE_API_KEY=${FIREBASE_API_KEY}` +
            ` npx vite build --outDir ${BUILD_DIR} && npx vite preview --outDir ${BUILD_DIR} --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
});
