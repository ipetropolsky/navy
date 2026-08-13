import { expect, test } from '@playwright/test';

import {
    ALBATROS,
    DEMO,
    VYMPEL,
    bubbles,
    join,
    openChannel,
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

    // Тап по чужому сообщению — ответ на него.
    await bubbles(page).first().click();
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
    expect(state.channels['ch-demo'].messages.at(-1)!.text).toBe('Сторожевой катер «Альбатрос» 317 снялся с рейда');
});

test('переоснащение пишет в ленту, что было и что стало', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await join(page, 'Буран', '512', 'Тральщик');

    await expect(systemLines(page).last()).toHaveText('Сторожевой катер «Альбатрос» 317 теперь тральщик «Буран» 512');
});

/**
 * Старший на рейде. Правило простое: старший в канале один, это тот, кто встал первым,
 * и только он может высадить чужой корабль. Проверяем обе стороны — что старшему это можно
 * и что остальным нечем даже попробовать.
 */
test('старший на рейде отмечен бэджем и высаживает чужие корабли', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await page.getByLabel('Корабли на связи').click();
    await expect(page.getByText('Старший на рейде')).toHaveCount(1);

    // Высадка — из строчки того, кого высаживают: свою кнопку старший в списке не находит.
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(2);
    await page.getByLabel('Высадить «Вымпел»').click();

    // Считаем не корабли в кадре, а канал: высаженный ещё уходит за кромку и висит в сцене
    // столько же, сколько ушедший сам.
    await expect(systemLines(page).last()).toHaveText('Малый ракетный корабль «Вымпел» 561 выдворен с рейда');
    const crew = await readState(page);
    expect(crew.channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(VYMPEL);
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
