import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

// Путь относительный нарочно: конфиг собирается раньше, чем становится известен алиас '@',
// который в нём же и объявлен.
// eslint-disable-next-line no-restricted-imports
import {
    CHAT_GRIP,
    CHAT_OVERLAP,
    COLUMN_WIDTH,
    MOBILE_MAX_WIDTH,
    RAID_SPREAD_FAR,
    RAID_SPREAD_NEAR,
    SCENE_MIN_HEIGHT,
    SCENE_MIN_SHARE,
    SHEET_HANDLE,
    SHEET_INSET,
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
                    `@scene-min-height: ${SCENE_MIN_HEIGHT}px;\n` +
                    // Долей, а не готовой высотой: в стилях от неё берут долю окна (dvh),
                    // и второе число — те же проценты — разошлось бы с этим при первой правке.
                    `@scene-min-share: ${SCENE_MIN_SHARE.toFixed(4)};\n` +
                    // Числами, а не процентами: из размаха рейда в стилях считается и ширина
                    // переднего края, и множитель проекции, — а множителю единицы ни к чему.
                    `@raid-spread-near: ${RAID_SPREAD_NEAR};\n` +
                    `@raid-spread-far: ${RAID_SPREAD_FAR};\n` +
                    `@chat-overlap: ${CHAT_OVERLAP}px;\n` +
                    `@sheet-width: ${SHEET_WIDTH}px;\n` +
                    `@sheet-inset: ${SHEET_INSET}px;\n` +
                    `@sheet-top-gap: ${SHEET_TOP_GAP}px;\n` +
                    `@sheet-handle: ${SHEET_HANDLE}px;\n` +
                    `@chat-grip: ${CHAT_GRIP}px;\n`,
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
