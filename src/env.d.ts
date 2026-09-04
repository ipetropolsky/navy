/**
 * Типы виртуального модуля `virtual:pwa-register` (см. `src/index.tsx`) — его саму сборку
 * подставляет vite-plugin-pwa, а тайпинги для неё берутся отдельно: `injectRegister: false`
 * в vite.config.ts не порождает готового скрипта, только объявление модуля для TypeScript.
 */
// eslint-disable-next-line spaced-comment -- тройной слэш это ссылка на типы, а не обычный комментарий
/// <reference types="vite-plugin-pwa/client" />

/**
 * Переменные сборки. Перечислены поимённо, а не подтянуты типами Vite целиком: список
 * того, чем настраивается приложение, — тоже часть его описания, и держать его на виду
 * дешевле, чем искать по коду, откуда взялась очередная строка из окружения.
 */
interface ImportMetaEnv {
    /** Какой бэкенд собирать: эмулятор на localStorage или настоящий Firestore. */
    readonly VITE_BACKEND?: 'local' | 'firebase';
    /** `1` — ходить в локальные эмуляторы Firebase вместо настоящего проекта. */
    readonly VITE_FIREBASE_EMULATOR?: string;

    /**
     * Настройки веб-приложения Firebase. Секретом не являются — они всё равно уезжают
     * в бандл, — но у разных проектов свои, поэтому берутся из окружения.
     */
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
