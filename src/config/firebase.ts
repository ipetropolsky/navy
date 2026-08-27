import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import {
    Firestore,
    connectFirestoreEmulator,
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
} from 'firebase/firestore';
import { Functions, connectFunctionsEmulator, getFunctions } from 'firebase/functions';

/**
 * Подключение к Firebase: настройки проекта и ленивая сборка того, чем пользуются остальные.
 *
 * Настройки не секрет — они уезжают в бандл к каждому, кто откроет страницу, — но у разных
 * проектов свои, поэтому приходят из окружения (`.env.local` при разработке, переменные
 * репозитория на выкладке; полный список — в `.env.example`). Пустые настройки не ломают
 * приложение: без них оно работает на локальном бэкенде (см. `backend/index.ts`).
 *
 * Молчаливым этот откат остаётся ровно до тех пор, пока Firebase никто не просил. Если
 * `VITE_BACKEND=firebase` задан, а ключей нет, сборка не соберётся вовсе — см. `assertBackend`
 * в vite.config.ts и повод, по которому он там появился.
 */

const env = import.meta.env;

export const FIREBASE_CONFIG = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'navy-chat',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
};

/** Эмуляторы поднимает `npm run functions:dev`; порты те же, что в `firebase.json`. */
export const EMULATORS = {
    firestore: { host: '127.0.0.1', port: 8080 },
    auth: { url: 'http://127.0.0.1:9099' },
    functions: { host: '127.0.0.1', port: 5001 },
};

/**
 * Регион функций — тот же, что `setGlobalOptions` в `functions/src/index.ts`, и тот же,
 * что `firestore.location` в `firebase.json`. Функция физически развёрнута в одном регионе,
 * и если клиент попросит вызов в другом, `httpsCallable` уйдёт не туда, куда доехала функция —
 * не ошибкой, а молчаливым тайм-аутом, потому что там просто нет обработчика с таким именем.
 */
const FUNCTIONS_REGION = 'europe-central2';

/** Ходим ли в эмуляторы. Не `useEmulator`: имя с `use` линтер принимает за хук. */
export const emulated = (): boolean => env.VITE_FIREBASE_EMULATOR === '1';

/**
 * Есть ли чем подключаться. С эмулятором ключ не нужен вовсе — он принимает любой, — а вот
 * настоящему проекту нужны и ключ, и приложение.
 */
export const isFirebaseConfigured = (): boolean =>
    emulated() || Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.appId);

/**
 * Собирается по первому обращению, а не на импорте: модуль читают и там, где до Firebase
 * дело не дойдёт вовсе (локальный бэкенд, юниты), и поднимать соединение ради этого незачем.
 */
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let fns: Functions | null = null;

export const firebaseApp = (): FirebaseApp => {
    app ??= initializeApp(FIREBASE_CONFIG);
    return app;
};

/**
 * Firestore с кэшем на диске. Кэш на вебе выключен по умолчанию и включается здесь —
 * до первого чтения или записи, иначе он не включится вовсе. Он даёт три вещи разом:
 * работу без сети, мгновенную отрисовку своих записей и общий кэш на вкладки, то есть
 * всё то, ради чего в эмуляторе стоял `BroadcastChannel`.
 */
export const firestore = (): Firestore => {
    if (!db) {
        db = initializeFirestore(firebaseApp(), {
            localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
        if (emulated()) {
            connectFirestoreEmulator(db, EMULATORS.firestore.host, EMULATORS.firestore.port);
        }
    }
    return db;
};

export const firebaseAuth = (): Auth => {
    if (!auth) {
        auth = getAuth(firebaseApp());
        if (emulated()) {
            // Предупреждение в консоли эмулятору не нужно: и так видно, куда мы ходим.
            connectAuthEmulator(auth, EMULATORS.auth.url, { disableWarnings: true });
        }
    }
    return auth;
};

/** См. `FUNCTIONS_REGION` — регион передаём явно, иначе `getFunctions` берёт дефолтный. */
export const functions = (): Functions => {
    if (!fns) {
        fns = getFunctions(firebaseApp(), FUNCTIONS_REGION);
        if (emulated()) {
            connectFunctionsEmulator(fns, EMULATORS.functions.host, EMULATORS.functions.port);
        }
    }
    return fns;
};
