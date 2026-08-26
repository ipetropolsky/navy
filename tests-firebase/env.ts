/**
 * Общие числа прогона поверх Firebase: адрес эмулятора и заглушка настроек, которыми
 * приложение собирается (playwright.firebase.config.ts) и которыми мост входа говорит
 * с тем же эмулятором (helpers.ts). Одно место, а не счёт дважды в две стороны.
 */

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
