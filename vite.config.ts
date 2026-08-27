import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig, loadEnv } from 'vite';

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

/**
 * Просили Firebase — значит, он и должен собраться.
 *
 * Приложение умеет обходиться без настроек: нет ключей — работает на локальном бэкенде
 * (см. `backend/index.ts`), и это правильно для свежей копии репозитория, где `VITE_BACKEND`
 * никто не задавал. Но когда его задали руками и написали там `firebase`, тихий откат
 * на localStorage — не запасной путь, а подмена: собирается и выкладывается совсем другое
 * приложение, без входа и без общей базы, и внешне оно выглядит целым.
 *
 * Так и вышло на выкладке: сборка попросила Firebase, ключей в окружении не оказалось,
 * никто нигде не пикнул — и на GitHub Pages уехала версия на localStorage, где кнопки входа
 * нет вовсе. Заметили это не по сборке, а глазами на живом сайте.
 *
 * Поэтому здесь отказ, а не предупреждение: предупреждение в логе сборки читают только тогда,
 * когда уже что-то ищут, а красная сборка не даёт выложить подменённое приложение вовсе.
 */
const assertBackend = (env: Record<string, string>): void => {
    if ((env.VITE_BACKEND ?? 'local') !== 'firebase') {
        return;
    }
    // Тот же счёт, что и `isFirebaseConfigured` в src/config/firebase.ts: эмулятору ключи
    // не нужны, он принимает любые, а настоящему проекту нужны и ключ, и приложение.
    if (env.VITE_FIREBASE_EMULATOR === '1' || (env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_APP_ID)) {
        return;
    }
    const missing = [
        !env.VITE_FIREBASE_API_KEY && 'VITE_FIREBASE_API_KEY',
        !env.VITE_FIREBASE_APP_ID && 'VITE_FIREBASE_APP_ID',
    ].filter(Boolean);
    throw new Error(
        `VITE_BACKEND=firebase, но настроек проекта нет: ${missing.join(', ')}. ` +
            'Без них собралась бы версия на localStorage — без входа и без общей базы. ' +
            'Значения берутся в консоли Firebase (Project settings → Your apps → SDK setup and ' +
            'configuration) и кладутся в .env.local при разработке или в переменные репозитория ' +
            'на выкладке (см. .env.example и docs/FIREBASE.md, «Конфигурация и запуск»).'
    );
};

export default defineConfig(({ mode }) => {
    // Через loadEnv, а не process.env: у разработчика значения лежат в .env.local, и проверка
    // должна видеть ровно то же, что увидит сама сборка.
    assertBackend(loadEnv(mode, __dirname, 'VITE_'));

    return {
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
                '@shared': path.resolve(__dirname, './shared'),
                '~': path.resolve(__dirname, './node_modules'),
            },
        },
        build: {
            target: 'esnext',
            outDir: 'build',
        },
        // Юниты лежат рядом с тем, что проверяют, — в src и в shared. Набор для браузера живёт
        // отдельно, в tests/, и берёт его Playwright; сюда он попадать не должен, иначе vitest
        // подхватит его по общему шаблону *.spec.ts и свалится на первом же `page`.
        test: {
            include: ['src/**/*.test.ts', 'shared/**/*.test.ts'],
        },
        server: {
            port: 3000,
            open: true,
        },
    };
});
