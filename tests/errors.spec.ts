import { expect } from '@playwright/test';

import {
    ALBATROS,
    DEMO,
    bubbles,
    expectWayOut,
    join,
    leaveButton,
    openChannel,
    openSheet,
    sceneReady,
    send,
    ships,
    systemLines,
    test,
} from '@tests/helpers';

/**
 * Что происходит, когда сделано не то. Проверяется не только текст отказа, но и то,
 * что из состояния есть выход: экран, из которого некуда нажать, — тупик.
 */

test('канала по адресу нет: сказано прямо и есть куда уйти', async ({ page }) => {
    await page.goto('/?channel=nesushchestvuyushchiy');

    await expect(page.getByText('Канала по адресу «nesushchestvuyushchiy» нет')).toBeVisible();
    await expectWayOut(page);

    // Кнопка и правда уводит на главную, где канал заводится заново.
    await page.getByRole('button', { name: 'Создать свой канал' }).click();
    await expect(page.getByPlaceholder('Эскадра «Полночь»')).toBeVisible();
});

test('позывной и бортовой номер заняты: отказ показан, форма остаётся рабочей', async ({ page }) => {
    await openChannel(page, DEMO);

    await join(page, 'Альбатрос', '777');
    await expect(page.getByText('Корабль с таким позывным уже на связи')).toBeVisible();

    await join(page, 'Гроза', '317');
    await expect(page.getByText('Этот бортовой номер уже занят')).toBeVisible();

    // Форма никуда не делась: с исправленными данными вход проходит.
    await join(page, 'Гроза', '777');
    // Вошли четвёртыми к трём кораблям демо-канала.
    await expect(page.locator('[class*="chatStatus"]')).toHaveText('4 на связи');
});

test('адрес канала не той формы: отправить нельзя, подсказка на месте', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Эскадра «Полночь»').fill('Полночь');
    await page.locator('input[placeholder="eskadra-polnoch"]').fill('-');

    // Кириллица и знаки в адрес не проходят, а один дефис — не адрес.
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    await expect(page.getByText('латинские буквы, цифры и дефис')).toBeVisible();
});

test('слишком длинное сообщение не уходит, и сказано насколько', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await send(page, 'я'.repeat(505));

    await expect(page.locator('[class*="snackbar"]')).toHaveText('Максимум 500 символов, у вас 505');
    await expect(bubbles(page)).toHaveCount(before);
    // Набранное не потеряно: обрезать чужой текст нельзя.
    await expect(page.getByPlaceholder('Сообщение')).toHaveValue('я'.repeat(505));
});

/**
 * Тот же предел длины и в других полях приложения: правило одно на все — набранное сверх
 * не обрезается, поле краснеет, а по нажатию говорится, насколько перебрали (`@/utils/limit`).
 * Проверяется он на новом курсе: это самое молодое поле с пределом, и в нём заодно видно,
 * что перебор не уводит с рейда.
 */
test('слишком длинный курс не уводит с рейда, и сказано насколько', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await leaveButton(page).click();

    const course = page.getByLabel('Задайте новый курс');
    await course.fill('я'.repeat(101));
    await page.getByRole('button', { name: 'Курс верный' }).click();

    await expect(page.locator('[class*="snackbar"]')).toHaveText('Максимум 100 символов, у вас 101');
    // Набранное на месте, корабль тоже: отказ ничего не сделал за человека.
    await expect(course).toHaveValue('я'.repeat(101));
    await expect(ships(page)).toHaveCount(3);
    await expectWayOut(page);
});

/**
 * Полоска «нет связи» — общая на всё приложение, не снекбар на каждое действие
 * (см. docs/FIREBASE.md, «Состояние связи»). Местный бэкенд отвечает на настоящий
 * navigator.onLine ровно затем, чтобы это можно было проверить здесь: context.setOffline
 * роняет сеть браузеру взаправду, события online/offline доходят до страницы как в жизни.
 */
test('нет связи — сказано одной строкой в шапке, и она уходит, когда связь вернулась', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByPlaceholder('Эскадра «Полночь»')).toBeVisible();

    const strip = page.locator('[class*="connectionStrip"]');
    await expect(strip).not.toBeVisible();

    await context.setOffline(true);
    await expect(strip).toBeVisible();
    await expect(strip).toHaveText('Связи нет. Ждём, когда вернётся');

    await context.setOffline(false);
    await expect(strip).not.toBeVisible();
});

/**
 * Значок доставки у своей же реплики (issue #69, docs/FIREBASE.md «Статус отправки»): нет
 * сети — сообщение остаётся в ленте пузырём со значком (!), а не пропадает и не виснет
 * неопределённо; набранное переживает даже перезагрузку вкладки — ящик неотправленного
 * лежит в sessionStorage (см. backend/outbox.ts), а не только в памяти вкладки; когда связь
 * возвращается, сообщение уходит само — без клика по значку (см. localBackend.ts, подписка
 * на watchOnlineStatus, «автоподхват при восстановлении связи»).
 *
 * Здесь, в отличие от соседних проверок, сеть контекста (`context.setOffline`) не трогаем
 * вовсе: странице предстоит по-настоящему перезагрузиться, а с обрывом взаправду это не
 * совмещается ни в одну сторону, ни в другую. С выключенной сетью загрузке неоткуда
 * взяться (`net::ERR_INTERNET_DISCONNECTED`), а обратное включение, без которого
 * перезагрузку не устроить, CDP тут же отмечает собственным, взаправдашним `online` на
 * свежем документе — раньше проверки и независимо от того, что к тому моменту подложено
 * через JS, так что и включать связь взаправду перед подложным обрывом незачем. Вместо
 * этого подделываем ровно то, чем пользуется само приложение: `navigator.onLine` (см.
 * `isOnline()` в utils/connection.ts, читает его заново при каждом обращении, не однажды
 * при загрузке) — геттер на подложном флаге в sessionStorage, который потому и переживает
 * перезагрузку точно так же, как ящик неотправленного. Оба перехода — что обрыв, что
 * возврат связи — подаём тем же событием `window`, каким их встречает настоящий браузер
 * (`dispatchEvent(new Event('online' | 'offline'))`), только не CDP, а сама проверка.
 */
test('нет связи — сообщение остаётся в ленте со значком, переживает перезагрузку, а по возврату связи уходит само', async ({
    page,
}) => {
    await page.addInitScript(() => {
        Object.defineProperty(window.navigator, 'onLine', {
            configurable: true,
            // eslint-disable-next-line no-restricted-syntax -- взгляд снаружи, а не код приложения
            get: () => sessionStorage.getItem('kilvater-test.forceOffline') !== '1',
        });
    });

    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await page.evaluate(() => {
        // eslint-disable-next-line no-restricted-syntax -- взгляд снаружи, а не код приложения
        sessionStorage.setItem('kilvater-test.forceOffline', '1');
        window.dispatchEvent(new Event('offline'));
    });
    await expect(page.locator('[class*="connectionStrip"]')).toBeVisible();
    await send(page, 'Курс без связи');

    // Не «последний пузырь»: реплики демо-канала датированы сегодняшним же днём, но чуть
    // позже (см. seed.ts, minutesAfterMidnight до 21:48) — стоит неотправленному пережить
    // перезагрузку, как оно подмешается в ленту уже отсортированным по sentAt (mergeOutbox
    // в outbox.ts) и окажется среди своих ровесников по времени, а не обязательно с краю.
    // Ищем его по тексту, а счётом проверяем, что оно ровно одно — не пропало и не удвоилось.
    const mine = bubbles(page).filter({ hasText: 'Курс без связи' });
    const failedIcon = page.getByRole('button', { name: 'Не отправлено. Нажмите, чтобы отправить снова', exact: true });
    await expect(failedIcon).toBeVisible();
    await expect(bubbles(page)).toHaveCount(before + 1);
    await expect(mine).toHaveCount(1);

    // Настоящая перезагрузка: сеть контекста всё это время оставалась настоящей, странице
    // есть откуда взяться. Флаг в sessionStorage переживает её так же, как и ящик
    // неотправленного (тот же sessionStorage той же вкладки), так что navigator.onLine
    // сразу после перезагрузки снова отвечает «нет связи» — без единого чужого события.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sceneReady(page);

    // Пережило перезагрузку целиком: и сам пузырь, и его текст, и значок незавершённой
    // отправки — не выдумка по одному лишь наличию записи, а то же самое неотправленное.
    await expect(bubbles(page)).toHaveCount(before + 1);
    await expect(mine).toHaveCount(1);
    await expect(failedIcon).toBeVisible();

    // Только теперь — настоящий приход связи: то же самое событие window, каким его и
    // встречает браузер по-настоящему, отправляем сами (см. комментарий над тестом), сняв
    // прежде подложный флаг.
    await page.evaluate(() => {
        // eslint-disable-next-line no-restricted-syntax -- взгляд снаружи, а не код приложения
        sessionStorage.removeItem('kilvater-test.forceOffline');
        window.dispatchEvent(new Event('online'));
    });

    await expect(failedIcon).toBeHidden();
    await expect(bubbles(page)).toHaveCount(before + 1);
    await expect(mine).toHaveCount(1);
});

/**
 * Клик по значку (!), пока связи всё ещё нет, не заводит второй копии (issue #69: «Повторное
 * нажатие не плодит двойников»). Решение здесь одномоментное (см. retryMessage в localBackend.ts:
 * `isOnline()`, без ожидания) — оба клика при выключенной сети возвращают то же самое
 * неотправленное как есть, ни один не пишет в общее состояние второй записи.
 */
test('значок (!), нажатый дважды подряд без связи, не заводит второго пузыря', async ({ page, context }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await context.setOffline(true);
    await expect(page.locator('[class*="connectionStrip"]')).toBeVisible();
    await send(page, 'Двойной клик по значку');

    const failedIcon = page.getByRole('button', { name: 'Не отправлено. Нажмите, чтобы отправить снова', exact: true });
    await expect(failedIcon).toBeVisible();
    await expect(bubbles(page)).toHaveCount(before + 1);

    // Оба нажатия разом, в обход актёрства мыши — тот же приём, что и у двойной высадки ниже:
    // уходят раньше, чем первое успевает отработать и убрать элемент из разметки.
    await failedIcon.evaluate((button: HTMLElement) => {
        button.click();
        button.click();
    });

    await expect(bubbles(page)).toHaveCount(before + 1);
    await expect(failedIcon).toBeVisible();

    // Связь вернулась — доставилось само, ровно одним сообщением, а не двумя копиями.
    await context.setOffline(false);
    await expect(
        page.getByRole('button', { name: 'Не отправлено. Нажмите, чтобы отправить снова', exact: true })
    ).toBeHidden();
    await expect(bubbles(page)).toHaveCount(before + 1);
    await expect(bubbles(page).last()).toContainText('Двойной клик по значку');
});

/**
 * Высадка молчала об отказе (issue #67): промис без .catch просто гас в консоли. Настоящий
 * отказ в один клик не устроить — кнопку высадки видит только старший, и только на чужой
 * корабль, — поэтому по одной и той же кнопке жмём дважды сразу, в обход актёрства мыши
 * (`button.click()` из evaluate — синхронно, оба вызова уходят раньше, чем первый успеет
 * отработать и убрать кнопку из разметки). Первый высаживает, второй застаёт Вымпела уже
 * высаженным (member-not-found): очередь у местного бэкенда общая (Web Locks, см.
 * localBackend.ts), и порядок между двумя вызовами гарантирован.
 */
test('высадка одним и тем же нажатием дважды: вторая попытка не пропадает молча', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const kickButton = page.getByLabel('Высадить «Вымпел»');
    await expect(kickButton).toBeVisible();
    await kickButton.evaluate((button: HTMLElement) => {
        button.click();
        button.click();
    });

    // Высадили ровно один раз: записи в ленте от второй попытки нет, ей нечего было писать.
    await expect(systemLines(page).filter({ hasText: 'выдворен' })).toHaveCount(1);

    // И вторая попытка не пропала молча — снекбар про неё виден.
    await expect(page.getByText('Такого корабля в канале нет')).toBeVisible();
});
