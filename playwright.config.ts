import { defineConfig, devices } from '@playwright/test';

/**
 * Сценарные проверки в настоящем браузере. Проверять сцену иначе не выходит: половина правок
 * ловится только замером — совпадают ли кадры воды на стыке цикла, помещаются ли корабли
 * на телефоне, доезжает ли сообщение во вторую вкладку.
 *
 * Запуск: `npm run test:e2e`. Собирать и поднимать сервер руками не нужно — это делает
 * webServer ниже. На чужой машине нужен один разовый шаг: `npx playwright install chromium`.
 */

const PORT = 4173;

/**
 * Готовый браузер в обход `playwright install`. Нужен там, где Chromium уже стоит и качать
 * его нельзя или незачем, — например в контейнере с предустановленными браузерами. На обычной
 * машине переменная не задана, и Playwright берёт свой, как и полагается.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
    testDir: './tests',
    // Мерка не с потолка: самый длинный ход в кадре — уход с ближней линии через весь рейд —
    // идёт около 53 с (`MIN_SAIL_PACE` в shipMotion), а браузерный прогон идёт по ускоренному
    // времени (`TIME_SCALE` в tests/helpers), и от тех 53 с остаётся около пяти. Самая долгая
    // проверка набора укладывается в семнадцать секунд, и сорок пять оставляют ей запас
    // на вдвое более медленную машину; упавшая же проверка перестаёт висеть по две минуты.
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'on-first-retry',
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
    },
    // Проект один: гонять весь набор ещё раз в телефонном разрешении незачем — раскладка
    // и так проверяется отдельным файлом, который сам задаёт себе размеры экрана.
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 900 } } }],
    webServer: {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
