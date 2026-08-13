import { Page, expect, test } from '@playwright/test';

import { slotShare } from '@/types/channel';

import { ALBATROS, DEMO, berths, join, openChannel, openNewChannel, readState, ships } from '@tests/helpers';

/**
 * Сцена: то, на чём уже наступали. Свой корабль однажды вставал на место без анимации,
 * ход считался в «длинах корпуса в секунду» и выходил в сотню узлов, а вода на стыке цикла
 * дёргалась. Проверки ниже — ровно про эти три места.
 */

/**
 * Разметка рейда по ширине, доли ширины кадра: шаг между коридорами (CORRIDOR_CENTERS
 * в placement.ts — там он в процентах, от 20 до 80) и оба конца разбега, на который боковые
 * места отходят от своего коридора (@berth-spread-far и @berth-spread-near в стилях сцены).
 * Продублированы сюда: переменные Less в проверку не дотянуть, а вывести разбег из самих
 * замеров нельзя — какие места окажутся свободными, решает расстановка.
 *
 * Значения десктопные: проверки этого файла идут в окне 1200×900.
 */
const CORRIDOR_STEP = 0.3;
const SPREAD_FAR = -0.04;
const SPREAD_NEAR = 0.1;

/** Насколько боковое место этой линии отстоит от середины кадра, доля его ширины. */
const berthOffset = (slot: number): number => CORRIDOR_STEP + SPREAD_FAR + (SPREAD_NEAR - SPREAD_FAR) * slotShare(slot);

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

test('на одной линии помещаются двое, и борта не налезают друг на друга', async ({ page }) => {
    // Двое на одной дальности были в правилах и раньше, но сходились едва ли не случайно:
    // вместимость линии считалась числом, а не размером кораблей. Теперь это решает геометрия,
    // и два катера расходятся бортами на любой линии — с этого и проверка.
    //
    // Рейд для неё свой, а не демо-канал: там расстановка каждый раз новая, и попадётся ли
    // в ней линия со свободным местом рядом с соседом — как повезёт (замер: в 84% раскладов).
    // Здесь же сосед один и стоит ровно там, где нам нужно.
    await openNewChannel(page, 'para');

    // Силуэт выбираем до того, как смотреть на воду: от размера зависит, куда этот корабль
    // влезет, и точки свободных мест пересчитываются под него.
    await page.getByText('Сторожевой катер', { exact: true }).click();
    await page.locator('[data-berth="5-center"]').click();
    await join(page, 'Малыш', '111');

    // Возвращаемся тем, кого в канале нет: форма открывается заново, а сосед остаётся стоять.
    await openChannel(page, 'para', 'gost');
    await page.getByText('Сторожевой катер', { exact: true }).click();

    // Щёлкаем по воде, а не по самому огоньку: круг света у выбранного места широкий и вполне
    // может лечь поверх соседнего огонька. Место всё равно достанется тому, чья точка ближе.
    const shared = '5-left';
    const spot = await page.locator(`[data-berth="${shared}"]`).boundingBox();
    expect(spot, 'рядом с соседом не нашлось места').toBeTruthy();
    await page.mouse.click(spot!.x + spot!.width / 2, spot!.y + spot!.height / 2);
    await expect(page.locator(`[data-berth="${shared}"][aria-pressed="true"]`)).toHaveCount(1);
    await join(page, 'Гроза', '777');
    await page.waitForTimeout(1200);

    const after = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'para')!.members
    );
    const line = Number(shared.split('-')[0]);
    expect(
        after.filter((member) => member.place.slot === line),
        'на линии не оказалось двоих'
    ).toHaveLength(2);

    // И это видно в кадре: корабли одной дальности стоят на одной высоте, и борта у них
    // не пересекаются. Высоту сравниваем с допуском — корабли качает.
    const hulls = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="shipSlot"]')].map((slot) => {
            const box = slot.getBoundingClientRect();
            return { bottom: box.bottom, left: box.left, right: box.right };
        })
    );
    // Пара тут одна, но ищем их все — так же, как выше искали место: правило про борта общее.
    const pairs = hulls.flatMap((one, index) =>
        hulls
            .slice(index + 1)
            .filter((other) => Math.abs(one.bottom - other.bottom) < 6)
            .map((other) => [one, other].sort((first, second) => first.left - second.left))
    );
    expect(pairs.length, 'в кадре не нашлось двух кораблей на одной дальности').toBeGreaterThan(0);
    for (const [near, far] of pairs) {
        expect(near.right, 'корабли на одной линии налезли друг на друга').toBeLessThan(far.left);
    }
});

test('тесному соседу корабль уступает воду и возвращается, когда тот ушёл', async ({ page }) => {
    // Рейд предлагает и такие линии, где двоим на серединах коридоров не разойтись: место
    // там есть, просто вставать придётся теснее. Кто уже стоял, тот и подвинется — а когда
    // сосед уйдёт, вернётся на свою точку. Сохранённое место при этом не меняется: расхождение
    // живёт только в кадре.
    await openNewChannel(page, 'rezinka');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    await page.locator('[data-berth="5-center"]').click();
    await join(page, 'Гром', '404');

    // Меряем самый широкий корпус в кадре: на линию встанет катер, и спутать их не с чем.
    const bigShip = (): Promise<{ middle: number; width: number }> =>
        page.evaluate(() => {
            const boxes = [...document.querySelectorAll('[class*="shipSlot"]')].map((slot) =>
                slot.getBoundingClientRect()
            );
            const widest = boxes.sort((one, other) => other.width - one.width)[0];
            return { middle: widest.left + widest.width / 2, width: widest.width };
        });

    await openChannel(page, 'rezinka', 'gost');
    await page.getByText('Сторожевой катер', { exact: true }).click();
    const alone = await bigShip();

    // Встаём слева от него — на линию, где вдвоём тесно.
    const spot = await page.locator('[data-berth="5-left"]').boundingBox();
    expect(spot, 'слева от соседа не нашлось места').toBeTruthy();
    await page.mouse.click(spot!.x + spot!.width / 2, spot!.y + spot!.height / 2);
    await join(page, 'Малыш', '111');
    await page.waitForTimeout(4000);

    // Отошёл, и отошёл вправо — от соседа, а не куда попало. Мерка в долях собственной ширины:
    // на другом экране и корпус, и расхождение считаются в процентах кадра.
    const pressed = await bigShip();
    expect((pressed.middle - alone.middle) / pressed.width, 'корабль не уступил воду тесному соседу').toBeGreaterThan(
        0.08
    );

    // А место осталось прежним: в канале корабль по-прежнему стоит на середине своего коридора.
    const fleet = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'rezinka')!.members
    );
    const resident = fleet.find((member) => member.name === 'Гром')!;
    expect(`${resident.place.slot}-${resident.place.corridor}`, 'расхождение переписало место').toBe('5-center');

    // Сосед ушёл — резинка тянет корабль обратно на свою точку.
    await page.getByLabel('Корабли на связи').click();
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();
    await page.waitForTimeout(4000);
    const back = await bigShip();
    expect(Math.abs(back.middle - alone.middle) / back.width, 'корабль не вернулся на своё место').toBeLessThan(0.05);
});

test('свободные места на рейде зависят от выбранного корабля', async ({ page }) => {
    // Вместимость линии считается размером кораблей, а значит, свободные места у катера
    // и у корабля в полсотни метров разные. Знать об этом должна не форма, а сцена: силуэт
    // выбирают в форме, а огоньки на воде обязаны тут же пересчитаться.
    //
    // Рейд для этого строим сами, а не берём демо-канал: там расстановка каждый раз своя,
    // и попадётся ли в ней линия, где катеру место есть, а кораблю нет, — как повезёт.
    // Здесь же ровно один сосед и ровно на той дальности, где разница и должна быть видна.
    await openNewChannel(page, 'razmer');
    await page.getByText('Сторожевой катер', { exact: true }).click();
    await page.locator('[data-berth="5-center"]').click();
    await join(page, 'Малыш', '111');

    // Возвращаемся тем, кого в канале нет: форма открывается заново, а катер остаётся стоять.
    await openChannel(page, 'razmer', 'gost');

    const offered = async (ship: string): Promise<string[]> => {
        await page.getByText(ship, { exact: true }).click();
        return berths(page).evaluateAll((dots) => dots.map((dot) => (dot as HTMLElement).dataset.berth ?? '').sort());
    };

    const forCutter = await offered('Сторожевой катер');
    const forShip = await offered('Малый ракетный корабль');

    // Рядом с катером на пятой линии второму катеру место есть — в обоих соседних коридорах.
    expect(forCutter, 'катеру не предложили место борт о борт').toContain('5-left');
    expect(forCutter, 'катеру не предложили место борт о борт').toContain('5-right');

    // А кораблю в полсотни метров — нет: между серединами соседних коридоров треть кадра,
    // и его корпус этой трети не оставляет. Линия занята им целиком.
    expect(
        forShip.filter((berth) => berth.startsWith('5-')),
        'крупному кораблю предложили занятую линию'
    ).toHaveLength(0);

    // И это не единственная потеря, но и не произвол: всё, что осталось кораблю, есть и у катера.
    expect(forShip.length, 'крупному кораблю предложили не меньше мест, чем катеру').toBeLessThan(forCutter.length);
    expect(
        forShip.filter((berth) => !forCutter.includes(berth)),
        'кораблю предложили место, которого нет у катера'
    ).toHaveLength(0);
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

    // Центральный коридор идёт отвесно: его места стоят на середине кадра на любой дальности.
    const middle = view.dots.filter((dot) => dot.berth.endsWith('center'));
    const columns = new Set(middle.map((dot) => Math.round(dot.x)));
    expect(columns.size, 'центральный коридор разъехался по ширине').toBe(1);

    // Боковые сходятся к горизонту и расходятся к наблюдателю, как рельсы: у дальнего конца
    // рейда место стоит ближе к середине, чем сам коридор, у ближнего — заметно дальше.
    //
    // Считаем это долями ширины кадра, а не пикселями: и шаг коридоров, и оба конца разбега
    // заданы в долях, и на любом окне отношение между ними одно.
    const spread = (corridor: string): [number, number][] =>
        view.dots
            .filter((dot) => dot.berth.endsWith(corridor))
            .map((dot): [number, number] => [Number(dot.berth.split('-')[0]), Math.abs(dot.x - middle[0].x)])
            .sort((one, other) => one[0] - other[0]);

    for (const corridor of ['left', 'right']) {
        const places = spread(corridor);
        expect(places.length, `коридор ${corridor} свободными местами не размечен`).toBeGreaterThan(1);
        for (const [slot, offset] of places) {
            expect(offset / frame.width, `место ${slot}-${corridor} отошло от середины не на свою долю`).toBeCloseTo(
                berthOffset(slot),
                3
            );
        }
        expect(places.at(-1)![1], `коридор ${corridor} не разошёлся к наблюдателю`).toBeGreaterThan(places[0][1]);
    }
    // Симметрию проверять отдельно не нужно: доля выше одна на оба коридора, и меряется
    // она модулем расстояния до середины — значит и сходятся они к ней одинаково.

    // Какие места подсвечены. Подсветка — не отдельное пятно, а сама точка места, выросшая
    // в круг света, поэтому и признак у неё размерный: круг втрое шире точки. Растёт он
    // переходом, поэтому смотреть на него надо ожидающей проверкой.
    //
    // Порог посередине между точкой и кругом: и растущий, и гаснущий огонёк проходят его
    // за 160мс перехода, и ожидающая проверка это переждёт.
    const litMarks = (): Promise<string[]> =>
        page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-lit]')]
                .filter((light) => light.getBoundingClientRect().width > light.getBoundingClientRect().height * 1.5)
                .map((light) => light.dataset.lit!)
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

test('под своим кораблём разметки нет, а отошёл — место снова помечено точкой', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const mine = fleet.find((member) => member.memberId === ALBATROS)!;
    const key = `${mine.place.slot}-${mine.place.corridor}`;

    await page.locator('[class*="shipMine"]').click();
    await expect(berths(page).first()).toBeVisible();

    // Пока выбрано своё же место, под килем не горит ничего: круг света показывает, куда
    // корабль переедет, а где он стоит сейчас — видно по самому кораблю.
    await expect(page.locator(`[data-berth="${key}"]`), 'под своим кораблём горит разметка').toHaveCount(0);

    // Переключились на другое — своё стало обычным свободным местом, и точка на нём
    // загорелась: иначе некуда возвращаться. Точка, а не круг: выбрано теперь не оно.
    // Круг лежит на воде и потому сплющен — по этому его от точки и отличаем.
    await page.locator('[data-berth][aria-pressed="false"]').last().click();
    await expect(page.locator(`[data-berth="${key}"]`), 'на покинутое место некуда вернуться').toHaveCount(1);
    const flatness = (): Promise<number> =>
        page.locator(`[data-lit="${key}"]`).evaluate((light) => {
            const box = light.getBoundingClientRect();
            return box.width / box.height;
        });
    await expect.poll(flatness, { message: 'покинутое место осталось подсвеченным' }).toBeCloseTo(1, 1);
});

test('подпись стоит на точке своего места, даже когда корабль отведён от края кадра', async ({ page }) => {
    // Подпись подписывает место, а не корпус. Корабль над ней может стоять чуть в стороне:
    // у края кадра его отодвигает внутрь собственная ширина (shownLeft), а на тесной линии
    // он уступает воду соседу. Возьми подпись мерки корпуса — у ближних боковых мест имя
    // уехало бы вместе с ним и повисло между двумя стоянками.
    //
    // Берём для этого самый крупный корабль на ближней боковой линии: там отступ от края
    // кадра больше всего, и разойтись корпусу с точкой есть куда.
    await openNewChannel(page, 'podpis');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    const mine = '9-left';
    await page.locator(`[data-berth="${mine}"]`).click();
    await join(page, 'Гром', '404');

    // Открываем форму заново и переносим выбор на другое место: своё становится обычным
    // свободным, и точка на нём загорается — с ней и сверяем подпись. Сам корабль никуда
    // не идёт, место меняется только отправкой.
    await page.locator('[class*="shipMine"]').click();
    await expect(berths(page).first()).toBeVisible();
    await page.locator('[data-berth][aria-pressed="false"]').last().click();

    const axes = await page.evaluate((key) => {
        // Ось — середина самой отметки: и точка, и надпись, и корпус стоят серединой
        // на своём месте, а дорожки под ними — полосы во весь кадр.
        const middle = (node: Element): number => {
            const box = node.getBoundingClientRect();
            return box.left + box.width / 2;
        };
        return {
            dot: middle(document.querySelector(`[data-berth="${key}"]`)!),
            name: middle(document.querySelector(`[data-berth-name="${key}"] [class*="shipName_"]`)!),
            hull: middle(document.querySelector('[class*="shipSlot"]')!),
        };
    }, mine);
    expect(Math.abs(axes.name - axes.dot), 'подпись сошла с точки своего места').toBeLessThan(1);
    expect(Math.abs(axes.hull - axes.dot), 'корабль не отошёл от края кадра, и проверять нечего').toBeGreaterThan(20);
});

test('пока выбирают место, призраками становятся все корабли, а подписи не кренятся', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);
    await page.locator('[class*="shipMine"]').click();
    await expect(berths(page).first()).toBeVisible();

    // Свой корабль высветляется наравне с чужими: место под ним закрыто им же, и, останься
    // он плотным, единственной невидимой стоянкой на рейде была бы как раз его собственная.
    const solid = await page
        .locator('[class*="shipBody"]')
        .evaluateAll((bodies) => bodies.filter((body) => getComputedStyle(body).filter === 'none').length);
    expect(solid, 'кто-то из кораблей остался плотным').toBe(0);

    // Высветляется корпус, а не тень: тень тёмная, и то же осветление вывернуло бы её
    // в светлое пятно под кораблём. Свой размывающий фильтр у тени есть всегда, поэтому
    // сравнивать не с «none», а с отсутствием осветления.
    const shadows = await page
        .locator('[class*="shipShadow"]')
        .evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).filter));
    expect(shadows.length, 'теней в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        shadows.every((filter) => !filter.includes('brightness')),
        'тень на воде высветлилась вместе с кораблём'
    ).toBe(true);

    // Имя написано на воде: волна поднимает и опускает его вместе с корпусом, но крена ему
    // не передаёт — тангаж качает корабль, а не надпись под ним.
    const motion = await page.evaluate(() => {
        const styles = (selector: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(selector)!);
        return {
            hull: styles('[class*="shipRock"]').animationName,
            name: styles('[class*="shipName_"]').animationName,
            tilt: styles('[class*="shipName_"]').rotate,
        };
    });
    expect(motion.hull, 'корабль перестал качаться').toContain('pitch');
    expect(motion.name, 'подпись перестала ходить с волной').toContain('heave');
    expect(motion.name, 'подпись кренится вместе с кораблём').not.toContain('pitch');
    expect(motion.tilt, 'подпись наклонена').toBe('none');
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
    //
    // Верхняя мерка — это ход через весь кадр на самом малом: она идёт за MIN_SAIL_PACE
    // и меняется вместе с ним, поэтому и стоит с запасом, а не впритык к замеру.
    for (const value of [patrol, minesweeper]) {
        expect(value).toBeGreaterThan(2);
        expect(value).toBeLessThanOrEqual(45);
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
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();

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

/**
 * Вспышки сигнальных ламп, по кораблям. Считаем не состояние в момент замера, а сами
 * включения: буква Морзе — это несколько коротких вспышек, и застать лампу горящей
 * ожидающей проверкой можно, а вот отличить «мигнула трижды» от «мигнула однажды» — нет.
 */
declare global {
    interface Window {
        __flashes: Record<string, number>;
    }
}

const watchLamps = (page: Page, within = '[class*="shipLane"]'): Promise<void> =>
    page.evaluate((selector) => {
        window.__flashes = {};
        for (const lane of document.querySelectorAll(selector)) {
            const lamp = lane.querySelector('[class*="lamp"]')!;
            // Корабли различаем по подписи спрайта: своего имени у дорожки нет.
            const name = lane.querySelector('img')?.alt ?? '?';
            window.__flashes[name] = 0;
            new MutationObserver(() => {
                if (lamp.className.includes('lampOn')) {
                    window.__flashes[name] += 1;
                }
            }).observe(lamp, { attributes: true, attributeFilter: ['class'] });
        }
    }, within);

const flashes = (page: Page): Promise<Record<string, number>> => page.evaluate(() => window.__flashes);

test('оклик: тычок в аватарку — и корабль отвечает лампой', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await watchLamps(page);

    // Аватарка окликаемая — значит кнопка. Кого именно окликаем, написано на ней самой.
    const avatar = page.locator('button[title^="Окликнуть"]').first();
    const hailed = (await avatar.getAttribute('title'))!.replace(/^Окликнуть «|»$/g, '');
    await avatar.click();

    // K — это «−·−», три вспышки. Ждём именно трёх: одной хватило бы и на случайное мигание.
    await expect
        .poll(async () => (await flashes(page))[`Корабль «${hailed}»`], 'окликнутый корабль не ответил лампой')
        .toBe(3);
    // И отвечает только он: оклик — это «который из них твой», а не «мигните все разом».
    const all = await flashes(page);
    expect(
        Object.values(all).filter((count) => count > 0),
        'на оклик ответил не один корабль'
    ).toHaveLength(1);
});

test('лампа передаёт и то, что набрано поверх выделения', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const mine = 'Корабль «Альбатрос»';
    await watchLamps(page);

    // Набираем и ждём, пока лампа отработает набранное: А — две вспышки, Б — четыре.
    const input = page.getByPlaceholder('Сообщение');
    await input.pressSequentially('аб');
    await expect.poll(async () => (await flashes(page))[mine], 'лампа не передала набранное').toBe(6);

    // Теперь выделяем всё и набираем поверх. Так правят текст постоянно, и передавать это
    // надо: раньше правка поверх выделения не доходила до лампы вовсе — строка стала короче,
    // значит стёрли, — и корабль на неё молчал.
    await page.keyboard.press('ControlOrMeta+a');
    await input.pressSequentially('ш');
    // Ш — «−−−−», ровно четыре вспышки. Их и ждём: лишние две означали бы, что вместо буквы
    // передан знак стирания, а он тут ни при чём — человек не стёр, а переписал.
    await expect.poll(async () => (await flashes(page))[mine], 'набранное поверх выделения не ушло в лампу').toBe(10);
});

test('в списке кораблей выбранный стоит под парами и отзывается лампой', async ({ page }) => {
    const KINDS = '[class*="kinds_"] > button';
    // Канал открываем, но в строй не встаём: список кораблей — это и есть форма входа.
    await openChannel(page, DEMO);
    const buttons = page.locator(KINDS);
    await expect(buttons.first()).toBeVisible();
    await watchLamps(page, KINDS);

    // Тычок в третий силуэт: не в первый, который выбран и так, — иначе выбор ничего не менял бы,
    // и проверка прошла бы на неподвижной картинке.
    const picked = 2;
    const label = (await buttons.nth(picked).locator('img').getAttribute('alt'))!;
    await buttons.nth(picked).click();

    // Выбранный корабль стоит под парами: у него ходовые огни, у остальных якорные. Так видно,
    // который из них твой, и сразу показана разница между двумя наборами огней.
    const sets = await lights(page, KINDS);
    expect(sets.length, 'список кораблей пуст').toBeGreaterThan(1);
    const kinds = (index: number): string[] => sets[index].map((light) => light.kind);
    expect(kinds(picked), 'у выбранного корабля не горит топовый').toContain('masthead');
    expect(kinds(picked), 'у выбранного корабля не горит кормовой').toContain('stern');
    expect(
        kinds(picked).some((kind) => kind.startsWith('anchor')),
        'выбранный корабль остался на якоре'
    ).toBe(false);
    const others = sets.filter((_, index) => index !== picked);
    expect(
        others.every((set) => set.length > 0 && set.every((light) => light.kind.startsWith('anchor'))),
        'невыбранный корабль пошёл ходом'
    ).toBe(true);

    // И отзывается он тем же сигналом, что корабль в кадре на оклик: K — «−·−», три вспышки.
    await expect.poll(async () => (await flashes(page))[label], 'выбранный корабль не мигнул лампой').toBe(3);
    const all = await flashes(page);
    expect(
        Object.values(all).filter((count) => count > 0),
        'на выбор мигнул не один корабль'
    ).toHaveLength(1);
});
