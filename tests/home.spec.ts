import { expect } from '@playwright/test';

import {
    DEMO,
    expectWayOut,
    join,
    openChannel,
    openCreateForm,
    openNewChannel,
    sceneReady,
    takes,
    test,
} from '@tests/helpers';

/**
 * Главная вошедшего: список рейдов, на которых стоит его корабль. Прежде на этом месте сразу
 * стояла форма создания канала, и вернуться в уже заведённый можно было только по сохранённой
 * ссылке.
 *
 * Личность у местного бэкенда одна на вкладку (`localAccount`, sessionStorage), и «свой»
 * здесь значит ровно то же, что и на настоящем сервере: канал, в котором стоит корабль этой
 * личности. Поэтому и заводятся каналы в проверках честно, через форму и постановку в строй,
 * а не подкладыванием состояния: подложенное состояние проверило бы разметку, а не то, что
 * список и правда собирается из участий.
 */

test('главная показывает каналы, в которых стоит корабль, и ведёт в них', async ({ page }) => {
    // Замер: канал заводится, корабль встаёт на рейд, а сцена проступает трижды — свой канал,
    // главная и он же снова по строчке списка (см. `takes`).
    takes(4);
    // Заведённый канал сам по себе своим не становится: своим его делает корабль на рейде.
    await openNewChannel(page, 'nochnoy-dozor');
    await join(page, 'Буря', '321');

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
    const row = page.getByRole('button', { name: 'Канал «nochnoy-dozor»' });
    await expect(row).toBeVisible();

    // Строчка нажимается целиком и открывает канал — тем же адресом, каким он заведён.
    await row.click();
    await expect(page).toHaveURL(/\?channel=nochnoy-dozor/);
    await sceneReady(page);
});

test('чужой канал в список не попадает', async ({ page }) => {
    // В демо-канале уже стоит эскадра, но своего корабля в нём нет — значит, и в списке
    // его быть не должно.
    await openChannel(page, DEMO);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Канал «${DEMO}»` })).toHaveCount(0);
    // Пустой список — не пустой экран: сказано, что рейдов пока нет, и оба хода на месте.
    await expect(page.getByText('Пока ни одного')).toBeVisible();
    await expectWayOut(page);
});

test('«Создать канал» раскрывает форму, а крестик и «Отставить» возвращают к списку', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openCreateForm(page);

    // Крестик у заголовка — тот же выход, что и у любой другой панели с ним (ui/Panel).
    await page.getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
    await expect(page.getByPlaceholder('Эскадра «Полночь»')).toHaveCount(0);

    // «Отставить» рядом с «Создать канал» в полосе кнопок — тот же ход вторым путём.
    await openCreateForm(page);
    await page.getByRole('button', { name: 'Отставить' }).click();
    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
    await expect(page.getByPlaceholder('Эскадра «Полночь»')).toHaveCount(0);

    // На самом списке возвращаться некуда — и выхода там нет: главная и есть дом.
    await expect(page.getByRole('button', { name: 'Закрыть' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Отставить' })).toHaveCount(0);
});

test('«Назад» уводит с канала по чужой ссылке на главную', async ({ page }) => {
    // Пришли по ссылке в чужой канал: корабля в нём нет, на месте разговора — форма входа.
    await openChannel(page, DEMO);
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toBeVisible();

    await page.getByRole('button', { name: 'Назад' }).click();
    await expect(page).not.toHaveURL(/\?channel=/);
    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
});

test('«Назад» остаётся на месте, когда форма входа раскрыта', async ({ page }) => {
    // Раскрытая форма — не повод запирать человека: передумать встать на рейд можно
    // и после того, как он нажал «Встать на рейд».
    await openChannel(page, DEMO);
    await page.getByRole('button', { name: 'Встать на рейд' }).click();
    await expect(page.getByPlaceholder('Гром')).toBeVisible();

    await page.getByRole('button', { name: 'Назад' }).click();
    await expect(page.getByRole('heading', { name: 'Ваши каналы' })).toBeVisible();
});

test('в разговоре «Назад» в шапке нет: с рейда уходят, а не отступают', async ({ page }) => {
    await openNewChannel(page, 'svoy-reyd');
    await join(page, 'Гроза', '404');

    await expect(page.getByRole('button', { name: 'Назад' })).toHaveCount(0);
});
