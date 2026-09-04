import { expect } from '@playwright/test';

import { test } from '@tests/helpers';

/**
 * Приложение должно ставиться на телефон: манифест валиден и ссылается на существующие
 * иконки, service worker регистрируется и активируется без ошибок в консоли. Собственно
 * установку («Добавить на главный экран») Playwright не умеет позвать — этот шаг браузерный
 * и целиком на стороне ОС, — а вот всё, из чего он складывается, проверить можно и здесь.
 */

interface ManifestIcon {
    src: string;
    purpose?: string;
}

interface Manifest {
    display: string;
    start_url: string;
    scope: string;
    icons: ManifestIcon[];
}

test('манифест подключён, валиден и ссылается на существующие иконки', async ({ page, request }) => {
    await page.goto('/');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    // Без ведущего слэша — тем же способом, каким собраны stylesheet и script в index.html:
    // на GitHub Pages сайт живёт в подпути /navy/, и абсолютный путь увёл бы манифест в корень.
    expect(manifestHref).toBe('site.webmanifest');

    const manifestUrl = new URL(manifestHref!, page.url()).toString();
    const response = await request.get(manifestUrl);
    expect(response.ok()).toBe(true);

    const manifest = (await response.json()) as Manifest;
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    // Разом, а не по очереди: иконок горстка, и ни одна не ждёт другую.
    const iconChecks = manifest.icons.map(async (icon) => {
        const iconResponse = await request.get(new URL(icon.src, manifestUrl).toString());
        expect(iconResponse.ok(), `иконка недоступна: ${icon.src}`).toBe(true);
    });
    await Promise.all(iconChecks);
});

test('service worker регистрируется и активируется без ошибок в консоли', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    await page.goto('/');

    // `ready` разрешается, как только у регистрации появился активный воркер, — но «появился»
    // не значит «уже провёл activate до конца»: состояние в этот самый миг бывает ещё
    // 'activating'. Ждём следствие (dev/TESTING.md, «Ждать следствие, а не время»), а не первый
    // же снимок состояния.
    const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.scope));
    await expect
        .poll(() => page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active?.state ?? null)))
        .toBe('activated');

    // Скоуп относительный: страница открыта с localhost:4173/ (корень превью), и на реальной
    // выкладке та же логика даст /navy/ — путь до страницы, а не до корня домена.
    expect(new URL(scope).pathname).toBe('/');
    expect(consoleErrors).toEqual([]);
});

test('service worker не подменяет собой ни один запрос к Firebase', async ({ page }) => {
    // Правило нельзя проверить наблюдением за местным бэкендом — он вообще не ходит в сеть.
    // Но убедиться, что раздача самого приложения не завела ни одного runtimeCaching-правила
    // (см. vite.config.ts), можно и по содержимому service worker: правило на чужой домен
    // оставило бы в нём строку с origin, а его там нет и быть не может.
    const sw = await (await page.request.get('/sw.js')).text();
    expect(sw).not.toMatch(/googleapis|firebaseapp|cloudfunctions|identitytoolkit/);
});
