import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `public/site.webmanifest` — статический файл, и его никто не проверяет типами: опечатка
 * в имени иконки или сломанный JSON всплыли бы только на настоящем телефоне, при попытке
 * установить приложение. Здесь — то немногое, что можно проверить не глядя на экран:
 * файл читается, поля на месте, и каждая иконка существует там, где манифест её называет.
 */

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

const readManifest = (): Record<string, unknown> =>
    JSON.parse(readFileSync(path.join(PUBLIC_DIR, 'site.webmanifest'), 'utf-8')) as Record<string, unknown>;

describe('site.webmanifest', () => {
    it('содержит обязательные поля для установки на телефон', () => {
        const manifest = readManifest();
        expect(manifest.name).toBeTruthy();
        expect(manifest.short_name).toBeTruthy();
        expect(manifest.display).toBe('standalone');
        expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('держит start_url и scope относительными — под подпуть /navy/ на GitHub Pages', () => {
        const manifest = readManifest();
        // Абсолютный путь ('/...') увёл бы приложение с https://ipetropolsky.github.io/navy/
        // в корень домена, где ничего нет, — ровно то, из-за чего build: base стоит './'.
        expect(manifest.start_url).toBe('./');
        expect(manifest.scope).toBe('./');
    });

    it('ссылается только на существующие иконки', () => {
        const manifest = readManifest();
        const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
        expect(icons.length).toBeGreaterThan(0);
        for (const icon of icons) {
            expect(existsSync(path.join(PUBLIC_DIR, icon.src)), `иконка не найдена: ${icon.src}`).toBe(true);
        }
    });

    it('несёт maskable-вариант — иначе Android обрежет иконку своей маской', () => {
        const manifest = readManifest();
        const icons = manifest.icons as Array<{ purpose?: string }>;
        expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    });
});
