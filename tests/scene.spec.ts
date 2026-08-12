import { Page, expect, test } from '@playwright/test';

import { ALBATROS, DEMO, berths, join, openChannel, openNewChannel, readState, ships } from '@tests/helpers';

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

test('место на рейде выбирается щелчком по воде, и корабль встаёт на выбранное', async ({ page }) => {
    // На главной мест нет вовсе: канала ещё нет, вставать некуда, и рейд там ничего
    // не предлагает — выбор места живёт в форме корабля и только в ней.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(berths(page)).toHaveCount(0);

    await openNewChannel(page, 'mesto');

    // Свободные места помечены огоньками, и одно из них выбрано заранее: человек, который
    // ничего не трогал, всё равно должен видеть, куда встанет его корабль.
    await expect(berths(page).first()).toBeVisible();
    await expect(page.locator('[aria-pressed="true"][data-berth]')).toHaveCount(1);

    // Выбираем другое место — не то, что предложили. Целиться в сам огонёк не нужно:
    // щелчок по воде достаётся месту с ближайшей точкой, и восемь пикселей ниже огонька —
    // это по-прежнему он: соседняя дальность вдвое дальше.
    const free = page.locator('[data-berth][aria-pressed="false"]').last();
    const chosen = await free.getAttribute('data-berth');
    const spot = (await free.boundingBox())!;
    await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2 + 8);
    await expect(page.locator(`[data-berth="${chosen}"][aria-pressed="true"]`)).toHaveCount(1);
    await join(page, 'Гроза', '777');

    // И корабль оказывается ровно там: место выбирает человек, а не расстановка.
    const state = await readState(page);
    const [member] = Object.values(state.channels).find((item) => item.channel.slug === 'mesto')!.members;
    expect(`${member.place.slot}-${member.place.corridor}`).toBe(chosen);
});

test('рейд подсвечивает одно место и только под указателем на воде', async ({ page }) => {
    await openNewChannel(page, 'podskazka');
    const scene = page.locator('[class*="scene_"]').first();
    const frame = (await scene.boundingBox())!;

    // Что где стоит: линия горизонта и точки свободных мест — в координатах страницы,
    // чтобы можно было целиться мышью.
    const view = await page.evaluate(() => ({
        horizon: document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top,
        dots: [...document.querySelectorAll<HTMLElement>('[data-berth]')].map((dot) => {
            const spot = dot.getBoundingClientRect();
            return {
                berth: dot.dataset.berth!,
                x: spot.left + spot.width / 2,
                y: spot.top + spot.height / 2,
            };
        }),
    }));

    // Коридоры идут отвесно: место в коридоре стоит на своей доле ширины на любой дальности.
    for (const corridor of ['left', 'center', 'right']) {
        const columns = new Set(
            view.dots.filter((dot) => dot.berth.endsWith(corridor)).map((dot) => Math.round(dot.x))
        );
        expect(columns.size, `коридор ${corridor} разъехался по ширине`).toBe(1);
    }

    // Какие места подсвечены. Подсветка и точка лежат в разных слоях — подсветка под кораблями,
    // точка над ними, — и общего родителя у них нет, поэтому место подсветки написано на ней
    // самой. Проявляется она переходом, поэтому смотреть на неё надо ожидающей проверкой.
    //
    // Порог низкий: горит подсветка с разной силой — у выбранного места в полную, у того, что
    // под указателем, вполовину, — а погашенная стоит на нуле. Гаснущая пройдёт порог сверху
    // за 160мс перехода, и ожидающая проверка это переждёт.
    const litMarks = (): Promise<string[]> =>
        page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-mark]')]
                .filter((mark) => parseFloat(getComputedStyle(mark).opacity) > 0.1)
                .map((mark) => mark.dataset.mark!)
                .sort()
        );

    const picked = (await page.locator('[data-berth][aria-pressed="true"]').getAttribute('data-berth'))!;
    await expect.poll(litMarks, 'до наведения показано не только выбранное место').toEqual([picked]);

    // Указатель по небу: рейд не размечается — там не вода, вставать некуда.
    await page.mouse.move(frame.x + frame.width / 2, view.horizon - 20);
    await expect.poll(litMarks, 'над небом рейд размечает места').toEqual([picked]);

    // Указатель по воде: подсвечивается ровно одно место — ближайшее к указателю,
    // а не весь рейд разом.
    const spot = view.dots.find((dot) => dot.berth !== picked)!;
    await page.mouse.move(spot.x, spot.y);
    await expect
        .poll(litMarks, 'над водой подсвечено не ближайшее место')
        .toEqual(expect.arrayContaining([picked, spot.berth]));
    expect(await litMarks(), 'над водой размечен весь рейд, а не одно место').toHaveLength(2);
});

test('качка идёт по рейду волной, а не вразнобой', async ({ page }) => {
    await openNewChannel(page, 'volna');

    // Фаза качки места — отрицательная задержка его анимации, круг — её длительность.
    // Берём и то и другое из самой сцены: длительность цикла живёт в стилях, и знать её
    // проверке неоткуда.
    const phases = await page.evaluate(() => {
        const seconds = (value: string): number => parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1);
        const dots = [...document.querySelectorAll<HTMLElement>('[data-berth]')];
        const style = getComputedStyle(dots[0].querySelector('span')!);
        return {
            cycle: seconds(style.animationDuration),
            marks: dots.map((dot) => {
                const [slot, corridor] = dot.dataset.berth!.split('-');
                return {
                    slot: Number(slot),
                    corridor,
                    phase: -seconds(getComputedStyle(dot.querySelector('span')!).animationDelay),
                };
            }),
        };
    });

    expect(phases.cycle, 'у качки нет цикла, сдвиг не с чем сравнивать').toBeGreaterThan(0);

    /** Насколько вторая фаза отстаёт от первой, с. По кругу: сдвиг на цикл — это ноль. */
    const lag = (from: number, to: number): number => (((to - from) % phases.cycle) + phases.cycle) % phases.cycle;

    /** Сдвиг между соседями по ряду обязан быть один и тот же, иначе это не волна. */
    const expectEvenLag = (row: { key: number; phase: number }[], what: string): void => {
        const order = [...row].sort((one, other) => one.key - other.key);
        const lags = order
            .slice(1)
            .map((item, index) => lag(order[index].phase, item.phase) / (item.key - order[index].key));
        expect(lags.length, `${what}: сравнивать не с чем`).toBeGreaterThan(0);
        for (const step of lags) {
            expect(step, `${what}: соседи качаются в такт`).toBeGreaterThan(0);
            expect(step, `${what}: сдвиг между соседями неровный`).toBeCloseTo(lags[0], 2);
        }
    };

    // Вдоль коридора: волна идёт с горизонта на наблюдателя, каждая следующая линия
    // повторяет за предыдущей через один и тот же промежуток.
    for (const corridor of ['left', 'center', 'right']) {
        const row = phases.marks.filter((mark) => mark.corridor === corridor);
        expectEvenLag(
            row.map((mark) => ({ key: mark.slot, phase: mark.phase })),
            `коридор ${corridor}`
        );
    }

    // И поперёк: фронт идёт наискось, поэтому у соседних коридоров на одной линии
    // тоже свой постоянный сдвиг.
    const corridors = ['left', 'center', 'right'];
    for (const slot of new Set(phases.marks.map((mark) => mark.slot))) {
        const row = phases.marks.filter((mark) => mark.slot === slot);
        if (row.length === corridors.length) {
            expectEvenLag(
                row.map((mark) => ({ key: corridors.indexOf(mark.corridor), phase: mark.phase })),
                `линия ${slot}`
            );
        }
    }
});

test('качка идёт по одним часам, и пришедший позже попадает в ту же волну', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    // Форма корабля открывает выбор места, и точки на воде появляются много позже кораблей.
    // Вода у них общая, значит и часы общие: начни точка свой круг с нуля — она качалась бы
    // вразрез с корпусом, который на неё же и встанет. Тем же держится качка перезаходящего:
    // он появляется в кадре заново и обязан попасть в ту волну, которая уже идёт по рейду.
    await page.locator('[class*="shipMine"]').click();
    await expect(berths(page).first()).toBeVisible();

    const clocks = await page.evaluate(() => {
        const seconds = (value: string): number => parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1);
        return [...document.querySelectorAll<HTMLElement>('[data-wave]')].map((element) => {
            const heave = element
                .getAnimations()
                .find((animation) => (animation as CSSAnimation).animationName?.includes('heave'));
            return {
                phase: Number(element.dataset.wave),
                at: Number(heave?.currentTime ?? 0) / 1000,
                cycle: seconds(getComputedStyle(element).animationDuration),
            };
        });
    });

    expect(clocks.length, 'качающегося в кадре нет вовсе').toBeGreaterThan(3);
    const cycle = clocks[0].cycle;
    expect(cycle, 'у качки нет цикла, сверять не с чем').toBeGreaterThan(0);

    // У каждого своя фаза — тем волна и идёт по рейду, — но часы за этой фазой одни.
    // Отняли фазу и получили точку общих часов: она обязана сойтись у всех.
    const origin = ({ at, phase }: { at: number; phase: number }): number => (((at - phase) % cycle) + cycle) % cycle;
    const first = origin(clocks[0]);
    for (const clock of clocks) {
        const apart = Math.abs(origin(clock) - first);
        expect(Math.min(apart, cycle - apart), 'качка идёт по своим часам у каждого').toBeLessThan(0.05);
    }
});

test('точка под своим кораблём гаснет, пока выбрано его же место', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const mine = fleet.find((member) => member.memberId === ALBATROS)!;
    const key = `${mine.place.slot}-${mine.place.corridor}`;

    await page.locator('[class*="shipMine"]').click();
    await expect(berths(page).first()).toBeVisible();

    // Своё место рейд предлагает всегда — иначе не видно, где корабль стоит сейчас, — но точки
    // под собственным килем нет: там и без неё горит подсветка выбора.
    await expect(page.locator(`[data-berth="${key}"]`), 'под своим кораблём горит точка').toHaveCount(0);
    await expect(page.locator(`[data-mark="${key}"]`), 'своё место осталось без подсветки').toHaveCount(1);

    // Переключились на другое — своё стало обычным свободным местом, и точка на нём загорелась:
    // иначе вернуться на своё место было бы некуда.
    await page.locator('[data-berth][aria-pressed="false"]').last().click();
    await expect(page.locator(`[data-berth="${key}"]`), 'на покинутое место некуда вернуться').toHaveCount(1);
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

    // Тронулись — якорные погасли, зажглись ходовые. Снимает корабль с места смена стоянки:
    // щелчок по своему кораблю открывает форму, там выбирается другое место, и корабль уходит.
    await page.locator('[class*="shipMine"]').click();
    await page.locator('[data-berth][aria-pressed="false"]').last().click();
    await page.locator('button[type=submit]').click();
    await expect(page.locator('[data-motion]')).toHaveCount(1);
    const underway = await lights(page, '[data-motion]');
    const kinds = underway[0].map((light) => light.kind);
    expect(kinds).toContain('stern');
    expect(kinds.filter((kind) => kind.startsWith('masthead'))).toHaveLength(1);
    expect(kinds.some((kind) => kind === 'port' || kind === 'starboard')).toBe(true);
    expect(kinds.some((kind) => kind.startsWith('anchor'))).toBe(false);
});
