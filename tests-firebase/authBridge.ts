/**
 * Мост входа для прогона поверх Firebase: signInWithCredential с поддельным Google-токеном
 * (см. GOOGLE_ID_TOKEN в env.ts) на приложении по умолчанию — тот же apiKey, то же неявное
 * имя `[DEFAULT]`, что и у вкладки, — но из отдельно собранной копии SDK, а не из кода
 * приложения. В src/ этот файл не попадает и приложением не собирается: его подключает только
 * helpers.ts, вставляя готовый код тегом script прямо в открытую вкладку.
 *
 * Провайдер тот же, что и в живом приложении: эмулятор заводит по такому токену пользователя
 * с `providerId: google.com`. Кастомный токен, стоявший тут раньше, давал `providerId: custom` —
 * приложению это безразлично, но правилам Firestore, случись им однажды спросить провайдера,
 * уже нет, и проверка такого не поймала бы.
 *
 * Нужен он вот почему. Настоящий вход — signInWithPopup в src/backend/auth.ts — открывает
 * окно, а окну для служебной переписки с открывшей его вкладкой нужен gapi-загрузчик
 * с apis.google.com. Это так независимо от того, эмулятор за окном или настоящий Google, —
 * signInWithPopup несёт эту зависимость всегда, и `connectAuthEmulator` её не снимает
 * (проверено: с поднятым эмулятором окно всё равно идёт за загрузчиком наружу). А там, где
 * выхода к хостам Google нет — закрытая сеть, прокси без этого хоста, машина без интернета
 * вовсе, — загрузчик не приходит, и окно до выбора аккаунта не доходит: дело не в приложении
 * и не в эмуляторе, а в сети вокруг.
 *
 * Подмена не трогает то, что проверяется дальше: вкладка получает подписанный эмулятором
 * токен через тот же onAuthStateChanged, каким получила бы его после настоящего входа,
 * и код приложения не отличает, откуда пришла личность, — persistence в IndexedDB общая
 * для всех копий SDK на одном источнике, ключ собирается из apiKey и имени приложения,
 * а не из того, кто именно ввёл личность.
 */
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, signInWithCredential } from 'firebase/auth';

// Тип window.__authBridgeInput/__authBridgeResult объявлен в env.ts — один на оба файла,
// подключённых в один и тот же проект tsc (см. tsconfig.json).

const run = async (): Promise<void> => {
    const input = window.__authBridgeInput;
    if (!input) {
        window.__authBridgeResult = 'error:no-input';
        return;
    }
    try {
        const app = initializeApp({ apiKey: input.apiKey, projectId: input.projectId });
        const auth = getAuth(app);
        connectAuthEmulator(auth, input.emulatorUrl, { disableWarnings: true });
        const credential = await signInWithCredential(auth, GoogleAuthProvider.credential(input.token));
        window.__authBridgeResult = `ok:${credential.user.uid}`;
    } catch (error) {
        window.__authBridgeResult = `error:${error instanceof Error ? error.message : String(error)}`;
    }
};

void run();
