import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// Путь относительный нарочно: конфиг собирается раньше, чем становится известен алиас '@',
// который в нём же и объявлен.
// eslint-disable-next-line no-restricted-imports
import {
    COLUMN_WIDTH,
    MOBILE_MAX_WIDTH,
    PINNED_ACTIONS_MIN_HEIGHT,
    SHADE_DESK_PEEK_HEIGHT,
    SHADE_PEEK_HEIGHT,
    SHADE_SEA_OVERLAP,
    SHADE_TOP_GAP,
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
                    `@pinned-actions-height: ${PINNED_ACTIONS_MIN_HEIGHT}px;\n` +
                    `@shade-peek: ${SHADE_PEEK_HEIGHT}px;\n` +
                    `@shade-desk-peek: ${SHADE_DESK_PEEK_HEIGHT}px;\n` +
                    `@shade-top-gap: ${SHADE_TOP_GAP}px;\n` +
                    `@shade-sea-overlap: ${SHADE_SEA_OVERLAP}px;\n` +
                    `@column-width: ${COLUMN_WIDTH}px;\n`,
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
