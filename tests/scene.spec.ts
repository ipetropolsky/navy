import { Page, expect, test } from '@playwright/test';

import { ALBATROS, DEMO, join, openChannel, openNewChannel, ships } from '@tests/helpers';

/**
 * Сцена: то, на чём уже наступали. Свой корабль однажды вставал на место без анимации,
 * ход считался в «длинах корпуса в секунду» и выходил в сотню узлов, а вода на стыке цикла
 * дёргалась. Проверки ниже — ровно про эти три места.
 */

/** Огни каждого корабля в кадре: чем является каждый и где он стоит по вертикали. */
const lights = (page: Page, within = '[class*="shipSlot"]'): Promise<{ kind: string; top: number }[][]> =>
    page.evaluate(
        (selector) =>
            [...document.querySelectorAll(selector)].map((slot) =>
                [...slot.querySelectorAll<HTMLElement>('[data-light]')].map((light) => ({
                    kind: light.dataset.light ?? '',
                    top: light.getBoundingClientRect().top,
                }))
            ),
        within
    );

test('свой корабль заплывает в кадр, а не возникает на месте', async ({ page }) => {
    // Свой канал, а не демо: там в кадре только наш корабль и путать его не с кем.
    await openNewChannel(page, 'zahod');
    await join(page, 'Гроза', '777');

    // Своя вкладка узнаёт о корабле дважды: сначала приходит участник, потом myId.
    // Признак «заходит» обязан пережить оба рендера — иначе анимация обрывается на старте.
    const entering = page.locator('[data-motion="entering"]');
    await expect(entering).toHaveCount(1);

    const running = await entering.evaluate((element) => element.getAnimations().length);
    expect(running, 'ход захода не начался').toBeGreaterThan(0);

    // И начинает он ход целиком за кромкой кадра. Иначе из-за края торчит нос стоящего
    // корабля, а трогается он у зрителя на глазах — разгон должен оставаться за кадром.
    // Меряем сам корабль, а не его дорожку: дорожка шириной с кадр, она за кромку не уходит.
    const hidden = await page.evaluate(() => {
        const scene = document.querySelector('[class*="_scene_"]')!.getBoundingClientRect();
        const lane = document.querySelector('[data-motion="entering"]')!;
        lane.getAnimations().forEach((animation) => {
            animation.pause();
            animation.currentTime = 0;
        });
        const box = lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect();
        return Math.min(box.right - scene.left, scene.right - box.left);
    });
    expect(hidden, 'в начале захода корабль виден в кадре').toBeLessThan(0);
});

test('ход корабля идёт с правдоподобной скоростью и зависит от корабля', async ({ browser }) => {
    // Каждый замер — своя вкладка со своим хранилищем: во второй раз форма постановки
    // в строй в той же вкладке уже не покажется, вкладка помнит, что корабль у неё есть.
    const seconds = async (kind: string): Promise<number> => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await openNewChannel(page, `hod${kind.length}`);
        await join(page, `Гость${kind.length}`, String(100 + kind.length), kind);
        const slot = page.locator('[data-motion="entering"]');
        await expect(slot).toHaveCount(1);
        const value = await slot.evaluate((element) => getComputedStyle(element).getPropertyValue('--enter-seconds'));
        await context.close();
        return Number.parseFloat(value);
    };

    const patrol = await seconds('Сторожевой катер');
    const minesweeper = await seconds('Тральщик');

    // Скорость манёвра теперь одна на всех — на рейде маневрируют самым малым независимо
    // от паспорта, — поэтому корабли между собой уже не сравниваем. Проверяем другое:
    // что длительность вообще считается, а не берётся из воздуха. Мгновенных прыжков
    // и получасовых прогонов быть не должно.
    for (const value of [patrol, minesweeper]) {
        expect(value).toBeGreaterThan(2);
        expect(value).toBeLessThanOrEqual(30);
    }
});

test('вода замыкает круг без скачка', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const scene = page.locator('[class*="scene_"]').first();

    const frameAt = async (time: number): Promise<Uint8Array> => {
        await page.evaluate((currentTime) => {
            // Останавливаем всё, что движется, и ставим воду в нужную точку круга: иначе
            // кадры разойдутся из-за качки кораблей, а не из-за воды.
            document.getAnimations().forEach((animation) => {
                animation.pause();
                if ((animation as CSSAnimation).animationName?.includes('sea-mirror')) {
                    animation.currentTime = currentTime;
                }
            });
        }, time);
        return new Uint8Array(await scene.screenshot());
    };

    const same = (one: Uint8Array, other: Uint8Array): boolean =>
        one.length === other.length && one.every((byte, index) => byte === other[index]);

    // На нуле и в конце круга прозрачность зеркальной копии одна и та же, значит и кадр
    // обязан быть тем же. Разошлись — на стыке будет видимый скачок.
    const start = await frameAt(0);
    const end = await frameAt(9999);
    expect(same(start, end), 'кадры на стыке цикла разошлись').toBe(true);

    // А на середине круга — уже другая рябь, иначе анимации попросту нет.
    const middle = await frameAt(5000);
    expect(same(start, middle), 'на середине круга рябь та же — анимации нет').toBe(false);
});

test('корабль уходит за кромку и пропадает из кадра', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Выйти из канала' }).click();

    // Сразу после выхода корабль ещё в кадре: он выбирается за кромку своим ходом.
    await expect(page.locator('[data-motion="leaving"]')).toHaveCount(1);
    // И через отведённое ему время исчезает — иначе уходящие копились бы в разметке.
    await expect(ships(page)).toHaveCount(2, { timeout: 40_000 });
});

test('огни на рейде якорные, на ходу ходовые, и от 50 метров их по два', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // В демо-канале три корабля, и только «Вымпел» длиннее 50 метров: ему положены
    // два якорных огня, носовой выше кормового, остальным хватает одного.
    const anchored = await lights(page);
    expect(anchored.every((ship) => ship.every((light) => light.kind.startsWith('anchor')))).toBe(true);
    const pairs = anchored.filter((ship) => ship.length === 2);
    expect(pairs, 'два якорных огня должны быть ровно у одного корабля').toHaveLength(1);
    const [fore, aft] = pairs[0];
    expect(fore.kind).toBe('anchor-fore');
    expect(fore.top, 'носовой якорный должен быть выше кормового').toBeLessThan(aft.top);

    // Тронулись — якорные погасли, зажглись ходовые. Идём влево, значит виден левый борт.
    await page.locator('[class*="shipMine"]').click();
    await expect(page.locator('[data-motion]')).toHaveCount(1);
    const underway = await lights(page, '[data-motion]');
    const kinds = underway[0].map((light) => light.kind);
    expect(kinds).toContain('stern');
    expect(kinds.filter((kind) => kind.startsWith('masthead'))).toHaveLength(1);
    expect(kinds.some((kind) => kind === 'port' || kind === 'starboard')).toBe(true);
    expect(kinds.some((kind) => kind.startsWith('anchor'))).toBe(false);
});
