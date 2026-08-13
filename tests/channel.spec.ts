import { expect, test } from '@playwright/test';

import { MOBILE_MAX_WIDTH } from '@/config/layout';

import {
    ALBATROS,
    DEMO,
    VYMPEL,
    bubbles,
    join,
    openChannel,
    openNewChannel,
    openSheet,
    readState,
    send,
    ships,
    systemLines,
} from '@tests/helpers';

/**
 * Основные дороги через приложение: завести канал, встать в строй, поговорить, уйти.
 * Здесь проверяется, что путь проходится целиком, а не что каждая кнопка на месте.
 */

test('канал заводится с главной, и в него можно встать в строй', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Эскадра «Полночь»').fill('Отряд 7');

    // Адрес предлагается из названия, транслитерацией, и цифры в нём разрешены.
    await expect(page.locator('input[placeholder="eskadra-polnoch"]')).toHaveValue('otryad-7');
    await page.locator('button[type=submit]').click();

    await expect(page).toHaveURL(/\?channel=otryad-7/);
    await join(page, 'Буря', '321');

    // Корабль в кадре, и канал знает, кто это.
    await expect(ships(page)).toHaveCount(1);
    await expect(page.locator('[class*="chatStatus"]')).toHaveText('1 на связи');
    await expect(systemLines(page)).toHaveText(['Малый противолодочный корабль «Буря» 321 встал на рейд']);
});

test('реплика уходит и привязывается ответом', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await send(page, 'Курс норд');
    await expect(bubbles(page)).toHaveCount(before + 1);

    // Тап по чужому сообщению — ответ на него. Отвечаем на самое верхнее, и щёлкнуть по нему
    // мало: лента сама прыгает к последнему сообщению (см. MessageList), а щелчок по верхнему
    // пузырю приходится как раз на этот прыжок. Промахнувшись, он достаётся соседнему пузырю
    // или своему собственному — и цитата над строкой ввода не появляется вовсе. Ловится это
    // только на неспешной машине и без окна на экране, поэтому щёлкаем с повтором: попытка
    // засчитана, когда над строкой ввода встала цитата того самого сообщения.
    const target = (await readState(page)).channels['ch-demo'].messages[0];
    await expect(async () => {
        await bubbles(page).first().click();
        await expect(page.locator('[class*="replyBar"]')).toContainText(target.text, { timeout: 2000 });
    }, 'лента так и не показала, на что отвечает').toPass({ timeout: 20_000 });
    await send(page, 'Идём следом');

    const state = await readState(page);
    const messages = state.channels['ch-demo'].messages;
    const reply = messages.at(-1)!;
    expect(reply.text).toBe('Идём следом');
    expect(reply.thread?.messageId).toBe(messages[0].messageId);
    expect(reply.author.memberId).toBe(ALBATROS);
});

test('сообщение из соседней вкладки доезжает', async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);
    const before = await bubbles(mine).count();

    await send(theirs, 'Швартовы отданы');

    await expect(bubbles(mine)).toHaveCount(before + 1);
    await expect(bubbles(mine).last()).toContainText('Швартовы отданы');
});

test('уход с рейда отмечается в ленте и возвращает к постановке в строй', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();

    // Вкладка возвращается к форме — тупика нет, встать в строй можно снова.
    await expect(page.getByPlaceholder('Гром')).toBeVisible();
    const state = await readState(page);
    expect(state.channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(ALBATROS);
    expect(state.channels['ch-demo'].messages.at(-1)!.text).toBe(
        'Пограничный сторожевой катер «Альбатрос» 317 снялся с рейда'
    );
});

test('переоснащение пишет в ленту, что было и что стало', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await join(page, 'Буран', '512', 'Рейдовый тральщик');

    await expect(systemLines(page).last()).toHaveText(
        'Пограничный сторожевой катер «Альбатрос» 317 теперь рейдовый тральщик «Буран» 512'
    );
});

test('набранный номер стоит на выбранном корабле, и только на нём', async ({ page }) => {
    await openNewChannel(page, 'nomer-na-bortu');
    await page.locator('input[inputmode="numeric"]').fill('317');

    // Спрашиваем не «есть ли номер на выбранном», а «на скольких он вообще есть»: правило
    // тут в том, что борт с номером один, — на всех сразу номер читался бы как часть рисунка.
    const onHulls = (): Promise<string[]> =>
        page
            .locator('[class*="kindShip"] [class*="hullNumber"]')
            .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').filter(Boolean));

    expect(await onHulls(), 'номер сел не на один борт').toEqual(['317']);
    await expect(
        page.locator('[class*="kindActive"] [class*="hullNumber"]'),
        'номер стоит не на выбранном корабле'
    ).toHaveText('317');

    // Выбрали другой силуэт — номер перешёл вместе с выбором, прежний борт остался чистым.
    const kinds = page.locator('button:has([class*="kindShip"])');
    await kinds.nth(3).click();
    expect(await onHulls(), 'номер остался на прежнем борту').toEqual(['317']);
    await expect(kinds.nth(3).locator('[class*="hullNumber"]'), 'номер не перешёл на новый выбор').toHaveText('317');

    // И правится он тут же: борт показывает набранное, а не то, с чем форма открылась.
    await page.locator('input[inputmode="numeric"]').fill('42');
    await expect(kinds.nth(3).locator('[class*="hullNumber"]'), 'борт не пошёл за набором').toHaveText('42');
});

/** Звание старшего одной строкой: им подписан и бэдж, и снекбар под вымпелом. */
const SENIOR = 'Старший на рейде';

/**
 * Старший на рейде. Правило простое: старший в канале один, это тот, кто встал первым,
 * и только он может высадить чужой корабль. Проверяем обе стороны — что старшему это можно
 * и что остальным нечем даже попробовать.
 */
test('старший на рейде отмечен бэджем и высаживает чужие корабли', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await page.getByLabel('Корабли на связи').click();
    await expect(page.getByText(SENIOR)).toHaveCount(1);

    // Высадка — из строчки того, кого высаживают: свою кнопку старший в списке не находит.
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(2);
    await page.getByLabel('Высадить «Вымпел»').click();

    // Считаем не корабли в кадре, а канал: высаженный ещё уходит за кромку и висит в сцене
    // столько же, сколько ушедший сам.
    await expect(systemLines(page).last()).toHaveText('Малый ракетный корабль «Вымпел» 561 выдворен с рейда');
    const crew = await readState(page);
    expect(crew.channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(VYMPEL);
});

/**
 * Вымпел у позывного старшего. Он стоит на любом экране, а вот подпись словами — только там,
 * где на неё есть ширина, и от этого зависит, кнопка вымпел или картинка. Проверяем оба
 * состояния подряд на одной странице: важно, что переход между ними работает на живом списке,
 * а не только на свежеоткрытом.
 */
test('вымпел старшего: с подписью — просто отметка, без подписи — кнопка со снекбаром', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    // Широкий экран: вымпел один (старший в канале один), рядом бэдж, и нажимать не на что —
    // звание уже написано словами.
    const pennants = page.locator('svg[class*="pennant"]');
    await expect(pennants, 'вымпел стоит не у одного корабля').toHaveCount(1);
    await expect(page.getByText(SENIOR), 'бэджа старшего нет на широком экране').toHaveCount(1);
    await expect(page.getByRole('button', { name: SENIOR }), 'вымпел с подписью зачем-то нажимается').toHaveCount(0);

    // Телефон: подписи нет — строка занята позывным, типом и кнопкой, — и вымпел остаётся
    // единственным ответом на вопрос «что это за флажок». Значит, он кнопка.
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await expect(page.getByText(SENIOR), 'бэдж остался на телефоне').toHaveCount(0);
    await expect(pennants, 'вымпел пропал вместе с бэджем').toHaveCount(1);

    const flag = page.getByRole('button', { name: SENIOR });
    await expect(flag, 'на телефоне вымпел не стал кнопкой').toHaveCount(1);
    await flag.click();
    await expect(page.locator('[class*="snackbar"]'), 'вымпел не ответил званием').toHaveText(SENIOR);
});

test('не старшему высаживать нечем, а после его ухода старшинство переходит дальше', async ({ page }) => {
    await openChannel(page, DEMO, VYMPEL);
    await page.getByLabel('Корабли на связи').click();
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(0);

    // Старший ушёл — канал не остаётся без него: старшинство берёт тот, кто дольше всех
    // из оставшихся. Иначе высаживать было бы уже некому.
    await openChannel(page, DEMO, ALBATROS);
    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();
    await expect(page.getByPlaceholder('Гром')).toBeVisible();

    const state = await readState(page);
    expect(state.channels['ch-demo'].channel.owner?.memberId).toBe(VYMPEL);

    // И это видно в списке: бэдж переехал на нового старшего, а с ним и кнопки высадки.
    await openChannel(page, DEMO, VYMPEL);
    await page.getByLabel('Корабли на связи').click();
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(1);
});
