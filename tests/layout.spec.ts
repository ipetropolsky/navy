import { Page, expect, test } from '@playwright/test';

import { MOBILE_MAX_WIDTH } from '@/config/layout';
import { SLOT_COUNT, slotDepth } from '@/types/channel';

import { ALBATROS, DEMO, openChannel, readState, shipNames, ships } from '@tests/helpers';

/**
 * Раскладка на телефоне и на десктопе. Здесь тоже только то, на чём наступали: вода однажды
 * занимала верхнюю треть своей области, а ниже стоял голый фон; месяц уезжал под заголовок;
 * корабли жались к нижней кромке, оставляя у горизонта пустую полосу.
 */

interface Geometry {
    scene: { width: number; height: number };
    /** Линия горизонта: верх воды, px от верха сцены. */
    horizon: number;
    /** Плитка воды: должна закрывать свою область целиком. */
    seaTile: { width: number; height: number };
    seaBox: { width: number; height: number };
    /** Месяц: где он стоит и докуда достаёт шапка чата. */
    moon: { top: number; bottom: number };
    headerBottom: number;
    /** Корабли: самый дальний и самый ближний, px от верха сцены. */
    farShipTop: number;
    nearShipBottom: number;
}

const geometry = (page: Page): Promise<Geometry> =>
    page.evaluate(() => {
        const box = (selector: string): DOMRect => document.querySelector(selector)!.getBoundingClientRect();
        const scene = box('[class*="scene_"]');
        const sea = box('[class*="sea_"]');
        const tile = box('[class*="seaTile"]');
        const moon = box('[class*="moon"]');
        const status = box('[class*="chatStatus"]');
        const slots = [...document.querySelectorAll('[class*="shipSlot"]')].map((el) => el.getBoundingClientRect());
        const tops = slots.map((slot) => slot.top - scene.top);
        const bottoms = slots.map((slot) => slot.bottom - scene.top);
        return {
            scene: { width: Math.round(scene.width), height: Math.round(scene.height) },
            horizon: Math.round(sea.top - scene.top),
            seaTile: { width: Math.round(tile.width), height: Math.round(tile.height) },
            seaBox: { width: Math.round(sea.width), height: Math.round(sea.height) },
            moon: { top: Math.round(moon.top - scene.top), bottom: Math.round(moon.bottom - scene.top) },
            headerBottom: Math.round(status.bottom - scene.top),
            farShipTop: Math.round(Math.min(...tops)),
            nearShipBottom: Math.round(Math.max(...bottoms)),
        };
    });

/** Общее для любой ширины: вода закрывает свою область, корабли целиком в кадре. */
const expectSaneScene = (view: Geometry): void => {
    expect(view.seaTile.height, 'под водой осталась полоса фона').toBeGreaterThanOrEqual(view.seaBox.height);
    expect(view.nearShipBottom, 'ближний корабль вылез за низ сцены').toBeLessThanOrEqual(view.scene.height);
    // Корпус дальнего корабля ниже горизонта; надстройка выше — это нормально, мачты
    // и должны торчать над водой, поэтому сравниваем не верх спрайта, а его нижнюю треть.
    expect(view.farShipTop, 'дальний корабль оторвался от воды').toBeLessThan(view.scene.height);
};

/** Подсветка места на рейде: круг света вокруг точки — насколько он велик и чем нарисован. */
interface BerthShape {
    /** Место, которому подсветка принадлежит: по нему находится и его же точка. */
    key: string;
    width: number;
    height: number;
    /** Ширина точки на этом же месте: подсветка отмеряется от неё. */
    dot: number;
    /** Насколько место ниже горизонта, px: по этому и видно, ближнее оно или дальнее. */
    below: number;
    /** Чем нарисована подсветка. Ждём ровный свет с ореолом, без градиента и без обвода. */
    background: string;
    color: string;
    glow: string;
    border: string;
}

const berthShapes = (page: Page): Promise<BerthShape[]> =>
    page.evaluate(() => {
        // Сцена — родитель слоя воды: под этот же класс попадает обёртка в шапке приложения.
        const sea = document.querySelector('[class*="sea_"]')!;
        const horizon = sea.getBoundingClientRect().top;
        // Точки лежат в своём слое, поверх кораблей, и связаны с подсветкой только местом.
        const dots = new Map(
            [...document.querySelectorAll<HTMLElement>('[data-berth]')].map((dot) => [
                dot.dataset.berth!,
                dot.getBoundingClientRect().width,
            ])
        );
        return [...document.querySelectorAll<HTMLElement>('[data-mark]')].map((mark) => {
            const paint = getComputedStyle(mark);
            const box = mark.getBoundingClientRect();
            return {
                key: mark.dataset.mark!,
                width: box.width,
                height: box.height,
                dot: dots.get(mark.dataset.mark!) ?? 0,
                // Нижняя кромка дорожки — сама точка стоянки, на ней подсветка и стоит серединой.
                below: mark.parentElement!.getBoundingClientRect().bottom - horizon,
                background: paint.backgroundImage,
                color: paint.backgroundColor,
                glow: paint.boxShadow,
                border: paint.borderTopWidth,
            };
        });
    });

/** Где стоят линии рейда: номер линии и насколько её точка ниже горизонта, px. */
const slotLines = (page: Page): Promise<[number, number][]> =>
    page.evaluate(() => {
        const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
        const lines = new Map<number, number>();
        for (const dot of document.querySelectorAll<HTMLElement>('[data-berth]')) {
            const spot = dot.getBoundingClientRect();
            lines.set(Number(dot.dataset.berth!.split('-')[0]), spot.top + spot.height / 2 - horizon);
        }
        return [...lines.entries()].sort((one, other) => one[0] - other[0]);
    });

/**
 * Отдельная добавка первой линии, px. Общий подъём рейда счёту по глубине не мешает — он
 * одинаков на всех линиях и уходит сам, когда высоты сравнивают долями. А эта добавка
 * достаётся одной ближней линии, и её из замера вычитают. Величину берём из самих стилей:
 * она и так заведена там в одном месте, второй раз её называть незачем.
 */
const nearLift = (page: Page): Promise<number> =>
    page.evaluate(
        () =>
            parseFloat(
                getComputedStyle(document.querySelector('[class*="scene_"]')!).getPropertyValue('--berth-lift-near')
            ) || 0
    );

/**
 * Всё, что стоит на рейде, стоит по глубине слота: высота под горизонтом идёт за ней, а не
 * за номером линии. Сверху на это ложится подъём рейда в пикселях, один на все линии, поэтому
 * сравниваем не сами высоты, а их доли пройденного пути от дальней линии к ближней: подъём
 * из такой доли уходит сам, а перспектива в ней остаётся.
 *
 * Так проверка не зависит ни от высоты воды, ни от подъёма, ни от того, какие именно линии
 * ей достались, — и ловит то, ради чего заведена: лесенку, разъехавшуюся с перспективой.
 *
 * Общей эта отговорка остаётся только для общего подъёма. Ближней линии достаётся ещё своя
 * добавка, и из долей она сама не уходит, поэтому её здесь снимают. Заодно это и проверка
 * добавки: не будь её в стилях, лесенка после вычитания разъехалась бы.
 */
const expectFollowsDepth = (measured: [number, number][], what: string, lift: number): void => {
    const points: [number, number][] = measured.map(([slot, below]) => [
        slot,
        slot === SLOT_COUNT - 1 ? below + lift : below,
    ]);
    const first = points[0];
    const last = points[points.length - 1];
    const span = slotDepth(last[0]) - slotDepth(first[0]);
    // Линии могли достаться все с одной дальности — тогда и разойтись им не по чему.
    if (span === 0) {
        for (const [slot, below] of points) {
            expect(below, `${what} ${slot} на общей дальности стоит не там же, где остальные`).toBeCloseTo(first[1], 0);
        }
        return;
    }
    for (const [slot, below] of points) {
        expect((below - first[1]) / (last[1] - first[1]), `${what} ${slot} стоит не на своей глубине`).toBeCloseTo(
            (slotDepth(slot) - slotDepth(first[0])) / span,
            1
        );
    }
};

/**
 * Линии рейда: стоят по глубине, и перспектива в них именно перспектива, но смягчённая —
 * ближние разнесены заметно шире дальних и всё же не настолько, чтобы дальняя половина рейда
 * слиплась в кашу. Обе границы здесь по делу: без нижней разметка становится лесенкой
 * в таблице, без верхней — пятачком у горизонта, каким рейд однажды и был.
 *
 * Шаг лесенки считаем по всем десяти линиям, а не по тем, что достались свободными: какие
 * места заняты, решает бэкенд случаем, а на пропущенных линиях шаг усредняется по промежутку
 * и разница между ближним и дальним концом смазывается. Пиксели при этом не выпадают
 * из проверки — их к этой же лесенке привязывает счёт выше.
 */
const expectSlotsFollowDepth = (lines: [number, number][], lift: number): void => {
    expect(lines.length, 'свободных линий слишком мало, шаг не проверить').toBeGreaterThan(3);
    expectFollowsDepth(lines, 'линия', lift);

    const ladder = [...Array(SLOT_COUNT).keys()].map(slotDepth);
    const gaps = ladder.slice(1).map((depth, index) => depth - ladder[index]);
    expect(gaps.at(-1)!, 'ближние линии не разнесены шире дальних').toBeGreaterThan(gaps[0] * 1.8);
    expect(gaps.at(-1)!, 'дальние линии сбиты в кучу у горизонта').toBeLessThan(gaps[0] * 6);
};

/** Насколько ниже горизонта стоят корабли, px, от дальнего к ближнему. */
const shipWaterlines = (page: Page): Promise<number[]> =>
    page.evaluate(() => {
        const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
        // Нижняя кромка дорожки — сама точка стоянки: по ней корабль и поставлен.
        return [...document.querySelectorAll('[class*="shipLane"]')]
            .map((lane) => lane.getBoundingClientRect().bottom - horizon)
            .sort((one, other) => one - other);
    });

/**
 * Корабли стоят по тому же закону, что и разметка, и проверяются тем же счётом. Слоты
 * демо-эскадре раздаёт бэкенд и раздаёт случайно, поэтому какие именно линии достанутся,
 * известно только из хранилища — оттуда их и берём. Так проверка и не зависит от расстановки,
 * и ловит то, ради чего заведена: собранный в кучу флот или лесенку, разъехавшуюся
 * с перспективой.
 */
const expectFleetStandsByDepth = (waterlines: number[], slots: number[], lift: number): void => {
    expect(waterlines.length, 'кораблей в кадре нет').toBe(slots.length);
    const order = [...slots].sort((one, other) => one - other);
    expectFollowsDepth(
        order.map((slot, index) => [slot, waterlines[index]]),
        'корабль на линии',
        lift
    );
};

/**
 * Подсветка места должна лежать на воде, а не стоять в кадре, и читаться на любой дальности.
 * Перспектива у неё в размере, а не в форме: круг втрое больше точки, а точка уже идёт
 * за дальностью — значит и подсветка дальнего места мельче ближней ровно во столько же раз.
 * Сплющена она при этом одинаково на всех дальностях: настоящая проекция вдали вырождала
 * подсветку в полоску, и на дальних линиях её попросту переставало быть видно.
 *
 * Точки может и не быть — под своим кораблём её не рисуют, — тогда сверять подсветку не с чем
 * и в счёт идёт только то, чем она нарисована.
 */
const expectBerthsLieOnWater = (marks: BerthShape[]): void => {
    expect(marks.length, 'свободных мест на рейде не показано вовсе').toBeGreaterThan(3);
    const measured = marks.filter((mark) => mark.dot > 0);
    expect(measured.length, 'точек на рейде не видно вовсе').toBeGreaterThan(3);

    for (const mark of measured) {
        expect(mark.width / mark.dot, `подсветка места ${mark.key} не втрое больше точки`).toBeCloseTo(3, 1);
        // Сплющено — но не в черту: доля одна на все дальности, и обе границы тут по делу.
        expect(mark.height / mark.width, `подсветка места ${mark.key} лежит не на воде`).toBeCloseTo(0.5, 1);
    }

    // И перспектива именно перспектива: с дальностью подсветка только растёт, а ближняя
    // заметно крупнее дальней. Порог здесь в пикселях, а не в разах: точка округляется
    // до целого пикселя, а какие именно линии останутся свободными — дело случая, и на
    // соседних линиях любая доля оказывается на волосок от границы.
    const byDepth = [...measured].sort((one, other) => one.below - other.below);
    for (const [index, mark] of byDepth.entries()) {
        if (index > 0) {
            expect(mark.width, `подсветка места ${mark.key} мельче, чем у места дальше`).toBeGreaterThanOrEqual(
                byDepth[index - 1].width
            );
        }
    }
    expect(byDepth.at(-1)!.width - byDepth[0].width, 'ближнее место подсвечено как дальнее').toBeGreaterThanOrEqual(3);

    // Место помечено светом, а не чертой: ровная заливка и ореол вокруг. Обвод — хоть сплошной,
    // хоть пунктирный — на воде выглядит чужим: черта на ней не держится, вода не бумага.
    // Градиента тоже нет: пятно маленькое, и растяжка на нём читается грязноватым краем.
    for (const mark of marks) {
        expect(mark.background, 'подсветка места разрисована градиентом').toBe('none');
        expect(mark.color, 'место помечено не светом на воде').toMatch(/^rgba\(/);
        expect(mark.glow, 'у света на воде нет ореола').not.toBe('none');
        expect(mark.border, 'у места опять появился обвод').toBe('0px');
    }
};

/** Плашка формы: её ширина и скругление и отличают мобильный вид от десктопного. */
const panelBox = (page: Page): Promise<{ width: number; radius: number; parentWidth: number }> =>
    page.evaluate(() => {
        const panel = document.querySelector('[class*="card"]')!;
        return {
            width: Math.round(panel.getBoundingClientRect().width),
            radius: parseFloat(getComputedStyle(panel).borderTopLeftRadius),
            parentWidth: Math.round(panel.parentElement!.getBoundingClientRect().width),
        };
    });

test.describe('телефон', () => {
    // Ширина заведомо мобильная: точка перехода одна на стили и на код, и берём мы её оттуда же.
    test.use({ viewport: { width: MOBILE_MAX_WIDTH - 90, height: 844 } });

    test('форма занимает ширину целиком и без скруглений', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'форма не дотянулась до краёв').toBe(panel.parentWidth);
        expect(panel.radius, 'на всю ширину скругления не нужны').toBe(0);
    });

    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        expectBerthsLieOnWater(await berthShapes(page));
        expectSlotsFollowDepth(await slotLines(page), await nearLift(page));
        // Занятые места подписаны все: рейд читается целиком — где свободно, а где «Вымпел».
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
    });

    test('вода закрывает своё место, месяц не под текстом, корабли по всей воде', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // Месяц стоит в просвете между нижней строкой шапки и горизонтом.
        expect(view.moon.top, 'месяц заехал под заголовок').toBeGreaterThan(view.headerBottom);
        expect(view.moon.bottom, 'месяц ушёл в воду').toBeLessThan(view.horizon);

        // Корабли разнесены по воде перспективой, а не собраны в кучу.
        const fleet = Object.values((await readState(page)).channels)[0].members;
        expectFleetStandsByDepth(
            await shipWaterlines(page),
            fleet.map((member) => member.place.slot),
            await nearLift(page)
        );
    });
});

test.describe('десктоп', () => {
    test.use({ viewport: { width: 1200, height: 900 } });

    test('колонка ограничена по ширине, сцена собрана так же', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // Приложение — колонка по центру, а не во весь экран.
        expect(view.scene.width).toBeLessThanOrEqual(760);
        // На широком экране небо выше: воде отдано меньше половины сцены.
        expect(view.horizon / view.scene.height).toBeGreaterThan(0.5);
    });

    // Масштаб в списке один на всех, и линейка — единственное, что переводит его в метры.
    // Ошибись тут на шаг — и катер молча станет корветом.
    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        expectBerthsLieOnWater(await berthShapes(page));
        expectSlotsFollowDepth(await slotLines(page), await nearLift(page));
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
    });

    test('масштабная линейка не врёт: метр на ней и метр корабля — один и тот же', async ({ page }) => {
        await openChannel(page, DEMO);
        const drawings = await page.evaluate(() =>
            [...document.querySelectorAll('[class*="kind_"], [class*="kindActive"]')].map((button) => ({
                // Длину корабля берём из его же подписи: «71,2 м · 1 070 т · 32 узла».
                shipMetres: parseFloat(button.querySelector('[class*="kindSpec"]')!.textContent.replace(',', '.')),
                scaleMetres: parseFloat(button.querySelector('[class*="scaleLabel"]')!.textContent),
                shipWidth: button.querySelector('img')!.getBoundingClientRect().width,
                scaleWidth: button.querySelector('[class*="scaleBar"]')!.getBoundingClientRect().width,
                buttonWidth: button.querySelector('[class*="kindImageBox"]')!.getBoundingClientRect().width,
            }))
        );

        expect(drawings.length).toBeGreaterThan(1);
        // У каждого корабля масштаб свой — размеры в списке поджаты, чтобы катер было видно, —
        // и линейка под ним обязана быть в этом же масштабе. Точность до третьего знака:
        // доли процента съедают округление процентов в разметке и пиксельная сетка браузера.
        for (const drawing of drawings) {
            expect(drawing.shipMetres / drawing.shipWidth, 'линейка и корабль в разных масштабах').toBeCloseTo(
                drawing.scaleMetres / drawing.scaleWidth,
                3
            );
            expect(drawing.shipWidth).toBeLessThanOrEqual(drawing.buttonWidth);
        }

        // Поджато, но не перевёрнуто: длиннее корабль — шире силуэт, а самый короткий занимает
        // не меньше половины кнопки, иначе его не разглядеть.
        const bySize = [...drawings].sort((a, b) => a.shipMetres - b.shipMetres);
        for (let i = 1; i < bySize.length; i++) {
            expect(bySize[i].shipWidth, 'корабль длиннее, а нарисован уже').toBeGreaterThanOrEqual(
                bySize[i - 1].shipWidth
            );
        }
        expect(bySize[0].shipWidth / bySize[0].buttonWidth, 'самый маленький корабль потерялся').toBeGreaterThanOrEqual(
            0.5
        );
        expect(bySize.at(-1)!.shipWidth).toBeCloseTo(bySize.at(-1)!.buttonWidth, 0);
    });

    test('форма — карточка, а не полоса во всю панель', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'карточка растеклась по всей панели').toBeLessThan(panel.parentWidth);
        expect(panel.radius, 'у карточки должны быть скруглённые края').toBeGreaterThan(0);
    });
});
