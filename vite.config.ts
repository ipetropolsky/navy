import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// Путь относительный нарочно: конфиг собирается раньше, чем становится известен алиас '@',
// который в нём же и объявлен.
// eslint-disable-next-line no-restricted-imports
import {
    COLUMN_WIDTH,
    COMPACT_HEIGHT,
    CONTENT_DESKTOP_HEIGHT,
    CONTENT_GAP,
    CONTENT_OVERLAP,
    FADE_HEIGHT,
    MOBILE_MAX_WIDTH,
    SHEET_TOP_GAP,
    SHEET_WIDTH,
} from './src/config/layout';

export default defineConfig({
    plugins: [react()],
    css: {
        preprocessorOptions: {
            less: {
                // Точка перехода в мобильный вид приезжает в стили из того же файла, откуда её
                // берёт код: @mobile-width доступен в любом .less без импортов.
                additionalData:
                    `@mobile-width: ${MOBILE_MAX_WIDTH}px;\n` +
                    `@column-width: ${COLUMN_WIDTH}px;\n` +
                    `@compact-height: ${COMPACT_HEIGHT}px;\n` +
                    `@content-desktop-height: ${CONTENT_DESKTOP_HEIGHT}px;\n` +
                    `@content-overlap: ${CONTENT_OVERLAP}px;\n` +
                    `@content-gap: ${CONTENT_GAP}px;\n` +
                    `@sheet-width: ${SHEET_WIDTH}px;\n` +
                    `@sheet-top-gap: ${SHEET_TOP_GAP}px;\n` +
                    `@fade-height: ${FADE_HEIGHT}px;\n`,
            },
        },
    },
    // base: process.env.NODE_ENV === 'production' ? '/project-name/' : '/',
    base: './',
    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
            '@': path.resolve(__dirname, './src'),
            '~': path.resolve(__dirname, './node_modules'),
        },
    },
    build: {
        target: 'esnext',
        outDir: 'build',
    },
    // Юниты лежат рядом с тем, что проверяют, — в src. Набор для браузера живёт отдельно,
    // в tests/, и берёт его Playwright; сюда он попадать не должен, иначе vitest подхватит
    // его по общему шаблону *.spec.ts и свалится на первом же `page`.
    test: {
        include: ['src/**/*.test.ts'],
    },
    server: {
        port: 3000,
        open: true,
    },
});
