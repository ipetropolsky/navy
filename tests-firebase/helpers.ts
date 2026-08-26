import { fileURLToPath } from 'node:url';
import { Browser, Page, expect, test as base } from '@playwright/test';
import * as esbuild from 'esbuild';
import { initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

import { WRITE_TIMEOUT } from '@/config/network';

import { AUTH_EMULATOR_URL, FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from '@tests-firebase/env';

/**
 * Общее для прогона поверх Firebase: как войти через эмулятор в обход всплывающего окна,
 * как завести канал и встать на рейд, как дождаться реплики от соседней вкладки.
 *
 * Файл нарочно не делит код с tests/helpers.ts: там «сервер» — это localStorage вкладки,
 * здесь — настоящие Firestore и Cloud Functions за эмулятором, и ждать в проверке приходится
 * не то же самое (см. `join` и его отличие от местного тёзки).
 */

/** См. tests/helpers.ts — тот же смысл: ускоряем ход корабля, а не сеть. */
export const TIME_SCALE = 10;

/**
 * Ускорение хода ставится вкладке до того, как та выполнит хоть строчку своего кода
 * (`addInitScript`): `config/time.ts` читает `window.timeScale` при первом же обращении,
 * и поставить его после `goto` уже поздно.
 *
 * Отдельной функцией, а не фикстурой `context`: проверке здесь нужны две вкладки от разных
 * людей, то есть два своих контекста, — а фикстура даёт один, и созданные руками
 * `browser.newContext()` мимо неё проходят вовсе. Это не мелочь: без ускорения корабль идёт
 * на место все шестьдесят секунд вместо шести, и проверка утыкается в собственные сроки
 * там, где к приложению претензий нет (замерено — заходы упирались в 31 с и не дожидались).
 */
export const newTab = async (browser: Browser): Promise<Page> => {
    const context = await browser.newContext();
    await context.addInitScript((scale) => {
        window.timeScale = scale;
    }, TIME_SCALE);
    return context.newPage();
};

/** Та же поправка для проверок с одной вкладкой — тем, кому хватает фикстуры `page`. */
export const test = base.extend({
    context: async ({ context }, run) => {
        await context.addInitScript((scale) => {
            window.timeScale = scale;
        }, TIME_SCALE);
        await run(context);
    },
});

/**
 * Сколько ждать конца манёвра после входа на рейд, мс. Считается так же, как SAIL_TIMEOUT
 * в tests/helpers.ts (самый длинный ход в кадре, поделённый на ускорение, плюс запас) —
 * и сверху ещё запас на настоящую сеть: тут перед самим ходом стоит вызов Cloud Function.
 */
export const SAIL_TIMEOUT = 60_000 / TIME_SCALE + 15_000;

/** См. TIME_MARGIN в tests/helpers.ts — тот же запас поверх замера, не поверх догадки. */
const TIME_MARGIN = 1.5;

/**
 * Свой срок для этой проверки — первой строкой в теле, см. tests/helpers.ts. Общий срок набора
 * (playwright.firebase.config.ts) считан на обычную проверку; той, что ходит двумя вкладками
 * по настоящей сети, он мал.
 *
 * Число обычно замер, как и в основном наборе. Но проверке, внутри которой стоят свои
 * поимённые ожидания, общий срок ставится не по замеру, а поверх их суммы: иначе он сработает
 * первым и заменит внятное «чего не дождались» на безличное «Test timeout». Такой случай
 * объясняется на месте (см. `takes` в e2e.spec.ts).
 */
export const takes = (seconds: number): void => base.setTimeout(Math.ceil(seconds * TIME_MARGIN) * 1000);

/**
 * Собранный в один файл мост входа (см. authBridge.ts) — держим в памяти между вызовами:
 * esbuild гоняет доли секунды, но звать его на каждый вход в проверке незачем.
 */
let bridgeCode: string | null = null;
const authBridgeCode = async (): Promise<string> => {
    if (!bridgeCode) {
        const entry = fileURLToPath(new URL('./authBridge.ts', import.meta.url));
        const result = await esbuild.build({
            entryPoints: [entry],
            bundle: true,
            write: false,
            format: 'iife',
            platform: 'browser',
        });
        bridgeCode = result.outputFiles[0].text;
    }
    return bridgeCode;
};

/**
 * Admin-приложение для чеканки кастомных токенов — тем же способом, каким tools/seed-firestore.ts
 * говорит с эмулятором Firestore. Заводится один раз на процесс (`initializeApp` второй раз
 * для приложения по умолчанию падает), а не по вызову.
 */
let adminReady = false;
const adminAuth = () => {
    if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error(
            'FIREBASE_AUTH_EMULATOR_HOST не задан. Этот набор говорит только с эмулятором — ' +
                'запускайте его через npm run test:e2e:firebase'
        );
    }
    if (!adminReady) {
        initializeApp({ projectId: FIREBASE_PROJECT_ID });
        adminReady = true;
    }
    return getAdminAuth();
};

/**
 * Войти без всплывающего окна. Настоящий вход (signInWithPopup в src/backend/auth.ts) под
 * проверками недостижим: попапу нужен gapi с apis.google.com, и нужен всегда — эмулятор этой
 * зависимости не снимает (подробнее в authBridge.ts). Подмена: чеканим эмулятором подписанный
 * токен на имя uid (Admin SDK, как и seed-firestore.ts) и вводим его тем же
 * signInWithCustomToken, каким пользуется сам SDK, — из отдельно собранной копии (authBridge.ts),
 * без единой правки в src/. Итог тот же, что и у настоящего входа: onAuthStateChanged
 * приложения получает пользователя и не отличает, откуда тот пришёл.
 *
 * Ждём не сам факт входа, а его следствие на экране — форму создания канала: гостя, как
 * и посетителя без канала в адресе, встречает именно она (см. App.tsx).
 */
export const signIn = async (page: Page, uid: string, name: string): Promise<void> => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Войти' }), 'экран входа не показался').toBeVisible();

    const token = await adminAuth().createCustomToken(uid, { name });
    await page.evaluate(
        (input) => {
            window.__authBridgeInput = input;
        },
        { apiKey: FIREBASE_API_KEY, projectId: FIREBASE_PROJECT_ID, emulatorUrl: AUTH_EMULATOR_URL, token }
    );
    await page.addScriptTag({ content: await authBridgeCode() });
    await page.waitForFunction(() => window.__authBridgeResult !== undefined, undefined, { timeout: 8_000 });
    const result = await page.evaluate(() => window.__authBridgeResult);
    if (!result?.startsWith('ok:')) {
        throw new Error(`мост входа отказал: ${result}`);
    }

    await expect(
        page.getByPlaceholder('Эскадра «Полночь»'),
        'после входа не появился экран создания канала'
    ).toBeVisible();
};

/**
 * Дождаться, пока сцена проступит. См. sceneReady в tests/helpers.ts — тот же признак,
 * тот же смысл: приложение готово к нажатиям, задники и рейд на месте.
 */
export const sceneReady = async (page: Page): Promise<void> => {
    await page.locator('[data-scene-painted][data-scene-ready]').first().waitFor({ timeout: 10_000 });
};

/** Завести канал с указанным адресом и остаться в нём — форма своего канала откроется сама. */
export const createChannel = async (page: Page, title: string, slug: string): Promise<void> => {
    await page.getByPlaceholder('Эскадра «Полночь»').fill(title);
    await page.locator('input[placeholder="eskadra-polnoch"]').fill(slug);
    await page.locator('button[type=submit]').click();
    await sceneReady(page);
};

/** Открыть канал по адресу — тем, кто не его завёл. */
export const openChannel = async (page: Page, slug: string): Promise<void> => {
    await page.goto(`/?channel=${slug}`, { waitUntil: 'domcontentloaded' });
    await sceneReady(page);
};

/**
 * Встать на рейд: открыть форму, если она ещё не открыта (свой только что заведённый канал
 * открывает её сам, а канал по ссылке встречает закрытой — см. openJoinForm в tests/helpers.ts),
 * заполнить и отправить.
 *
 * Ждём не отметку в хранилище (её здесь нет — «сервер» настоящий), а сам корабль на рейде:
 * метку `shipMine` сцена вешает только на вставший на место корабль, и раньше её взяться
 * неоткуда. Срок захода — WRITE_TIMEOUT (вызов joinChannel) плюс SAIL_TIMEOUT (сам ход
 * в кадре следом за ответом): то и другое здесь идёт не параллельно, а друг за другом, —
 * сцена не начинает вести корабль на место, пока не пришёл ответ с тем, куда его вести.
 *
 * Нажатие одно, и повторять его не за чем. Первая сборка этой проверки жала кнопку дважды —
 * будто первого нажатия «иногда не хватает»; замер показал, что дело было не в нажатии вовсе,
 * а в том, что вкладки заводились мимо ускорения времени (см. `newTab`) и корабль честно шёл
 * на место все шестьдесят секунд. Повтор эту поломку прятал, а не чинил, и потому убран:
 * проверка, которая жмёт кнопку ещё раз, пока не сработает, перестаёт что-либо утверждать.
 */
export const join = async (page: Page, name: string, hullNumber: string): Promise<void> => {
    if (await page.getByRole('button', { name: 'Встать на рейд' }).isVisible()) {
        await page.getByRole('button', { name: 'Встать на рейд' }).click();
        await expect(page.getByPlaceholder('Гром'), 'форма постановки в строй не открылась').toBeVisible();
    }
    await page.getByPlaceholder('Гром').fill(name);
    await page.locator('input[inputmode="numeric"]').fill(hullNumber);

    const submit = page
        .locator('form')
        .filter({ has: page.getByPlaceholder('Гром') })
        .locator('button[type=submit]');
    await submit.click();
    await expect(page.locator('[class*="shipMine"]'), 'свой корабль так и не встал на рейд').toBeVisible({
        timeout: WRITE_TIMEOUT + SAIL_TIMEOUT,
    });
};

/** Написать в ленту. */
export const send = async (page: Page, text: string): Promise<void> => {
    await page.getByPlaceholder('Сообщение').fill(text);
    await page.keyboard.press('Enter');
};

/** Пузыри с репликами в ленте. */
export const bubbles = (page: Page) => page.locator('[class*="bubble"]');
