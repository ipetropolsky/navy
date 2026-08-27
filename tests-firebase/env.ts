/**
 * Общие числа прогона поверх Firebase: адрес эмулятора и заглушка настроек, которыми
 * приложение собирается (playwright.firebase.config.ts) и которыми мост входа говорит
 * с тем же эмулятором (helpers.ts). Одно место, а не счёт дважды в две стороны.
 */
import { loadEnv } from 'vite';

/**
 * `.env.local` читаем тем же способом, что и сборка (vite.config.ts): «положил в .env.local»
 * должно значить одно и то же и для приложения, и для проверок. Файла нет — и ладно: всё,
 * что берётся отсюда, имеет значение по умолчанию. Настоящее окружение перекрывает файл —
 * так устроен сам `loadEnv`.
 */
const env = loadEnv('test', process.cwd(), 'E2E_');

/** Тот же id, что и --project у emulators:exec в package.json → test:e2e:firebase. */
export const FIREBASE_PROJECT_ID = 'demo-navy';

/**
 * Ключ ненастоящий. Эмулятору он не нужен вовсе — он принимает любой (см. `isFirebaseConfigured`
 * в src/config/firebase.ts), — но клиентский SDK проверяет, что apiKey не пустая строка,
 * ещё до того, как дело доходит до эмулятора: initializeApp() с пустым ключом падает
 * с `auth/invalid-api-key`, не дав даже открыть окно входа.
 */
export const FIREBASE_API_KEY = 'demo-api-key';

/** См. firebase.json → emulators.auth.port. */
export const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099';

/**
 * Поддельный Google-токен, которым проверки входят вместо всплывающего окна.
 *
 * Эмулятор Auth принимает вместо подписанного JWT обычный JSON и заводит по нему настоящего
 * пользователя — с `providerId: google.com`, почтой и именем из полей. Замерено на живом
 * эмуляторе: `accounts:signInWithIdp` с таким `id_token` отвечает `localId`, `idToken`
 * и `providerId: google.com`. То есть проверки входят тем же провайдером, что и живое
 * приложение, — но без окна, которому всегда нужен gapi с apis.google.com (см. authBridge.ts).
 *
 * Секрета тут нет и быть не может: за пределами эмулятора такой токен не примет никто.
 * Подменяют его через `E2E_GOOGLE_ID_TOKEN` (см. .env.example) — когда проверке нужна другая
 * личность, скажем почта в другом домене или лишние поля вроде `hd`.
 *
 * Общее здесь только то, что у всех проверок одинаково. `sub`, `name` и почту подставляет
 * `signIn` в helpers.ts, и почту — обязательно: по ней Firebase сводит аккаунты, и одна
 * на всех склеила бы разные uid в одного человека. Из значения ниже в почту идёт только домен.
 */
export const GOOGLE_ID_TOKEN = env.E2E_GOOGLE_ID_TOKEN || '{"email":"skipper@example.com","email_verified":true}';

/**
 * Окно моста входа (см. authBridge.ts): helpers.ts кладёт вход перед вставкой файла,
 * сам мост кладёт исход после. Объявлено здесь одним местом — оба файла делят один
 * и тот же глобальный тип, а не заводят его каждый по-своему.
 */
declare global {
    interface Window {
        __authBridgeInput?: { apiKey: string; projectId: string; emulatorUrl: string; token: string };
        __authBridgeResult?: string;
    }
}
