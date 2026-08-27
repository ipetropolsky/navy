import { expect } from '@playwright/test';

import { WRITE_TIMEOUT } from '@/config/network';

import {
    bubbles,
    createChannel,
    failedIcon,
    join,
    pendingIcon,
    pushRoute,
    send,
    signIn,
    takes,
    test,
} from '@tests-firebase/helpers';

/**
 * Что видно на экране, когда настоящая сеть подводит: местный набор такого не ловит вовсе —
 * там «сервер» отвечает в том же кадре, что и вопрос, и обрывать в нём нечего (см.
 * docs/FIREBASE.md, «Проверки»). Здесь сеть настоящая (`context.setOffline`), и обрывается
 * взаправду.
 *
 * Чтения (`withTimeout`) и запись сообщения (`attemptWrite`) устроены по-разному — это не
 * мелочь, а то, ради чего часть проверок здесь ждёт взаправду секунд десять. Чтение видит
 * offline сразу и не ждёт вовсе (см. `withTimeout`, `isOnline()` в src/backend/firebaseBackend.ts) —
 * ответ известен заранее, ждать нечего. Запись сообщения — нет: `attemptWrite` должен дать
 * дойти до `setDoc()`, даже когда сети нет вовсе, — тогда в дело вступает локальный кеш
 * Firestore, и запись остаётся в очереди, а не отклоняется (см. docs/FIREBASE.md, «Онлайн:
 * из чего складывается задержка»). Поэтому отказ по отправленному сообщению виден только
 * по-настоящему подождав WRITE_TIMEOUT (10 с, не ускоряется TIME_SCALE — это сетевой срок,
 * а не ход корабля в кадре).
 */

test('оборванная сеть не теряет набранное: реплика остаётся в ленте со значком неотправленного', async ({
    page,
    context,
}) => {
    // Единственный по-настоящему долгий кусок — ожидание значка отказа: WRITE_TIMEOUT
    // взаправду (10 с) плюс запас. Остальное — вход, свой канал, вход в строй — секунды,
    // но общий срок поставлен поверх суммы, а не по замеру целиком: если что-то из этого
    // случайно потянет дольше обычного, в отчёте должно остаться «не показался значок отказа»,
    // а не безличное «Test timeout» (см. рассуждение в e2e.spec.ts).
    takes(50);

    const slug = `offline-draft-${Date.now()}`;
    await signIn(page, 'offline-draft-uid', 'Экипаж на связи');
    await createChannel(page, 'Без связи', slug);
    await join(page, 'Гроза', '101');

    const before = await bubbles(page).count();

    await context.setOffline(true);
    await expect(page.locator('[class*="connectionStrip"]'), 'полоска «нет связи» не появилась').toBeVisible();

    await send(page, 'Курс без связи');

    // Набранное не пропадает ни на миг: Firestore кладёт запись в локальный снимок раньше
    // сети (latency compensation) — пузырь и значок «доставляется» встают сразу, без всякого
    // ожидания сервера.
    const mine = bubbles(page).filter({ hasText: 'Курс без связи' });
    await expect(mine, 'реплика не встала в ленту сразу же, до всякого ответа сети').toBeVisible();
    await expect(pendingIcon(page), 'значок «доставляется» не появился сразу').toBeVisible();

    // А вот отказ — по-настоящему не раньше среза записи: сеть выключена взаправду, и раньше
    // WRITE_TIMEOUT сказать «не вышло» нечем.
    await expect(failedIcon(page), 'реплика так и не показала отказ по истечении срока записи').toBeVisible({
        timeout: WRITE_TIMEOUT + 5_000,
    });

    // И набранное всё ещё цело: тот же текст, тот же единственный пузырь — не пропал
    // и не задвоился, пока сеть была выключена.
    await expect(bubbles(page), 'реплики в ленте стало больше или меньше, чем было').toHaveCount(before + 1);
    await expect(mine).toHaveCount(1);

    await context.setOffline(false);
});

/**
 * Идентификатор сообщения назначает клиент и держит его при повторе (docs/FIREBASE.md,
 * «Повтор без двойников»): что настоящий обрыв, что нажатый повтор ведут к тому же документу,
 * а не заводят второй. Проверка требует обеих половин разом — не только клика по значку
 * (это уже покрыто местным набором на другом бэкенде), но и того, что сама Firebase-часть
 * повтора (`retryMessage`: `waitForPendingWrites` + проверка документа перед повторным
 * `setDoc`, см. src/backend/firebaseBackend.ts) не плодит второй копии, когда повтор нажат
 * ещё при выключенной сети, а потом сеть по-настоящему возвращается.
 */
test('связь вернулась и следом нажат повтор — реплика уходит одна, а не две', async ({ page, context }) => {
    // Тот же расчёт, что и в соседней проверке: два по-настоящему долгих ожидания подряд
    // (значок отказа — WRITE_TIMEOUT, и снятие значка после возврата связи — тоже до
    // WRITE_TIMEOUT), и общий срок стоит поверх их суммы.
    takes(60);

    const slug = `retry-no-dup-${Date.now()}`;
    await signIn(page, 'retry-no-dup-uid', 'Экипаж на связи');
    await createChannel(page, 'Без двойников', slug);
    await join(page, 'Отзвук', '202');

    const before = await bubbles(page).count();

    await context.setOffline(true);
    await expect(page.locator('[class*="connectionStrip"]')).toBeVisible();
    await send(page, 'Повтор без двойников');
    await expect(failedIcon(page), 'реплика не дошла до отказа, чтобы было что повторять').toBeVisible({
        timeout: WRITE_TIMEOUT + 5_000,
    });

    // Оба клика — пока сеть всё ещё выключена, в обход актёрства мыши (тот же приём,
    // что и в местном наборе): каждый вызов retryMessage сам встаёт в ожидание связи
    // (waitForPendingWrites) и ничего не пишет, пока её нет.
    await failedIcon(page).evaluate((button: HTMLElement) => {
        button.click();
        button.click();
    });

    await context.setOffline(false);

    // Связь настоящая, и вместе с ней получает свой шанс и первая попытка (её setDoc всё
    // это время простоял в очереди Firestore), и оба отложенных повтора: каждый, прежде чем
    // писать второй раз, спрашивает сам документ и не пишет, если тот уже на месте.
    await expect(failedIcon(page), 'значок отказа не снялся после возврата связи').toBeHidden({
        timeout: WRITE_TIMEOUT,
    });

    const mine = bubbles(page).filter({ hasText: 'Повтор без двойников' });
    await expect(bubbles(page), 'после повтора в ленте оказалось больше одной новой реплики').toHaveCount(before + 1);
    await expect(mine, 'повтор задвоил реплику').toHaveCount(1);
});

/**
 * «Канала нет» — законный ответ: адрес существует, а канала по нему не завели или уже снесли
 * (см. `useChannel.ts` — этот случай отдельная ветка `channel === null` без `loadError`).
 * Офлайн — другая причина: канал есть, спросить о нём не вышло. Спутать одно с другим значит
 * предложить «Создать свой канал» там, где верный ответ — «Ещё раз», когда вернётся связь
 * (см. App.tsx, две разные плашки).
 *
 * Канал в проверке настоящий, заведён в её же начале, — иначе офлайн-заход ничем не отличался
 * бы от захода на выдуманный слаг и не доказывал бы разницу между этими двумя причинами.
 *
 * Настоящей навигации (`page.goto`) с выключенной сетью не устроить: `context.setOffline`
 * рвёт её тоже. `pushRoute` меняет адрес в обход сети — так же, как это делает сама вкладка
 * при переходе вперёд-назад (см. tests-firebase/helpers.ts).
 */
test('канал открыт офлайн — «нет связи», а не «канала нет»', async ({ page, context }) => {
    // Долгих ожиданий тут нет вовсе: withTimeout (чтение канала) видит offline сразу и не ждёт
    // ни секунды, в отличие от отправки сообщения в соседних проверках, — идёт проверка
    // две секунды. Но срок и здесь не по замеру: без запаса поверх выхода сцены (десять секунд)
    // и обычного срока ожидания (восемь, см. `expect.timeout` в конфигурации) общий срок
    // сработал бы раньше них и съел бы имена — см. ту же оговорку в e2e.spec.ts.
    takes(20);

    const slug = `offline-open-${Date.now()}`;
    await signIn(page, 'offline-open-uid', 'Экипаж на связи');
    await createChannel(page, 'Есть на самом деле', slug);

    // Уходим на главную, пока сеть ещё настоящая: слаг должен и правда смениться — эффект
    // useChannel перечитывает канал по смене slug, а не по каждому кадру, и повторный заход
    // на тот же адрес без этого не заставил бы его спросить канал заново.
    await pushRoute(page, null);
    await expect(page.getByPlaceholder('Эскадра «Полночь»'), 'уход на главную не сработал').toBeVisible();

    await context.setOffline(true);
    await pushRoute(page, slug);

    // Ответ — «Канал не открылся», а не «Канала нет»: канал существует, просто спросить
    // о нём не вышло.
    await expect(page.getByText('Канал не открылся'), 'офлайн-заход принят за пустой адрес').toBeVisible();
    await expect(page.getByText('Нет связи. Попробуйте, когда она появится')).toBeVisible();
    await expect(
        page.getByText(`Канала по адресу «${slug}» нет`),
        'офлайн-заход ошибочно показан как «канала нет»'
    ).toHaveCount(0);

    // Короткая строчка в шапке говорит то же самое, а не «канал не найден».
    await expect(page.locator('[class*="chatStatus"]')).toHaveText('нет связи');

    await context.setOffline(false);
});
