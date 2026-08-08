// Генерация PNG-ассетов сцены из assets.html (прозрачные слои — через скриншоты Chromium).
// Запуск: npx -y playwright-core@latest не нужен, если playwright-core уже доступен:
//   node tools/scene-assets/generate.mjs
// Требуется установленный Chromium; путь можно передать через CHROMIUM_PATH.
/* eslint-disable no-await-in-loop, no-console, import/no-unresolved --
   одноразовый генератор ассетов: скриншоты снимаются последовательно,
   playwright-core ставится ad hoc и в devDependencies не входит. */
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../../src/assets/scene');

// sky, sea и moon готовятся отдельно из src/assets/sources (tools/scene-assets/prepare-backgrounds.py).
const ASSETS = [
    'stars',
    'orion',
    'cloud-1',
    'cloud-2',
    'island-far',
    'island-mid',
    'island-near',
    'wave-1',
    'wave-2',
    'wave-3',
    'wave-4',
    'wave-5',
    'wave-6',
    'wave-7',
    'wave-8',
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
await page.goto(`file://${path.join(here, 'assets.html')}`);
await page.waitForTimeout(300);
for (const id of ASSETS) {
    await page.locator(`#${id}`).screenshot({ path: path.join(outDir, `${id}.png`), omitBackground: true });
    console.log('saved', id);
}
await browser.close();
