import { Page, expect, test } from '@playwright/test';

import { MOBILE_MAX_WIDTH, PINNED_ACTIONS_MIN_HEIGHT } from '@/config/layout';
import { SLOT_COUNT, slotDepth, slotScale, slotShare } from '@/types/channel';

import { ALBATROS, DEMO, openChannel, openSheet, readState, shipNames, ships } from '@tests/helpers';

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

/**
 * Огонёк места на рейде: та самая точка, что горит на свободном месте, и она же — круг света,
 * когда место выбрано или под указателем. Отдельного пятна под точкой нет, поэтому и мерка одна.
 */
interface BerthShape {
    /** Место, которому огонёк принадлежит. */
    key: string;
    width: number;
    height: number;
    /** Насколько место ниже горизонта, px: по этому и видно, ближнее оно или дальнее. */
    below: number;
    /** Чем нарисован огонёк. Ждём ровный свет с ореолом, без градиента и без обвода. */
    background: string;
    glow: string;
    border: string;
}

const berthShapes = (page: Page): Promise<BerthShape[]> =>
    page.evaluate(() => {
        // Сцена — родитель слоя воды: под этот же класс попадает обёртка в шапке приложения.
        const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
        return [...document.querySelectorAll<HTMLElement>('[data-lit]')].map((light) => {
            const paint = getComputedStyle(light);
            const box = light.getBoundingClientRect();
            return {
                key: light.dataset.lit!,
                width: box.width,
                height: box.height,
                // Нижняя кромка дорожки — сама точка стоянки, на ней огонёк и стоит серединой.
                below: light.closest('[class*="berthLane"]')!.getBoundingClientRect().bottom - horizon,
                background: paint.backgroundImage,
                glow: paint.boxShadow,
                border: paint.borderTopWidth,
            };
        });
    });

/** Навести указатель на место и дождаться, пока его точка вырастет в круг света. */
const hoverBerth = async (page: Page, key: string): Promise<BerthShape> => {
    const light = page.locator(`[data-lit="${key}"]`);
    const dot = (await light.boundingBox())!;
    await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
    // Растёт круг переходом, поэтому ждём: сразу после наведения он ещё точка.
    await expect
        .poll(async () => (await light.boundingBox())!.width, `место ${key} под указателем не подсветилось`)
        .toBeGreaterThan(dot.width * 2);
    return (await berthShapes(page)).find((shape) => shape.key === key)!;
};

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
 * Всё, что стоит на рейде, стоит по глубине слота: высота под горизонтом идёт за ней, а не
 * за номером линии. Концы рейда приколочены отступами от горизонта и от нижней кромки кадра,
 * поэтому сравниваем не сами высоты, а их доли пройденного пути от дальней линии к ближней:
 * отступы из такой доли уходят сами, а перспектива в ней остаётся.
 *
 * Так проверка не зависит ни от высоты воды, ни от отступов, ни от того, какие именно линии
 * ей достались, — и ловит то, ради чего заведена: лесенку, разъехавшуюся с перспективой.
 */
const expectFollowsDepth = (points: [number, number][], what: string): void => {
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
const expectSlotsFollowDepth = (lines: [number, number][]): void => {
    expect(lines.length, 'свободных линий слишком мало, шаг не проверить').toBeGreaterThan(3);
    expectFollowsDepth(lines, 'линия');

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
const expectFleetStandsByDepth = (waterlines: number[], slots: number[]): void => {
    expect(waterlines.length, 'кораблей в кадре нет').toBe(slots.length);
    const order = [...slots].sort((one, other) => one - other);
    expectFollowsDepth(
        order.map((slot, index) => [slot, waterlines[index]]),
        'корабль на линии'
    );
};

/**
 * Точки мест лежат на воде и идут за дальностью: ближняя крупнее дальней, и растут они
 * непрерывно. Непрерывность тут не придирка: точки уже округляли до целого пикселя, и рейд
 * от этого шёл ступеньками — четыре линии одного размера, потом разом другой.
 *
 * Подсвеченные места из этого счёта выпадают: там точка выросла в круг света и мерить её
 * заодно со всеми нельзя.
 */
const expectBerthsLieOnWater = (lights: BerthShape[]): void => {
    expect(lights.length, 'свободных мест на рейде не показано вовсе').toBeGreaterThan(3);
    const dots = [...lights.filter((light) => light.width === light.height)].sort(
        (one, other) => one.below - other.below
    );
    expect(dots.length, 'точек на рейде не видно вовсе').toBeGreaterThan(3);

    // Размер идёт за дальностью, а дальность — за линией: в одной линии все три коридора
    // помечены одинаково, а от линии к линии точка растёт, и растёт на каждой.
    const byLine = new Map<number, number[]>();
    for (const dot of dots) {
        const line = Number(dot.key.split('-')[0]);
        byLine.set(line, [...(byLine.get(line) ?? []), dot.width]);
    }
    const lines = [...byLine.entries()].sort((one, other) => one[0] - other[0]);
    for (const [line, widths] of lines) {
        for (const width of widths) {
            expect(width, `в линии ${line} точки разного размера`).toBeCloseTo(widths[0], 5);
        }
    }
    for (const [index, [line, widths]] of lines.entries()) {
        if (index > 0) {
            expect(widths[0], `точка линии ${line} мельче, чем у линии дальше`).toBeGreaterThan(lines[index - 1][1][0]);
        }
    }
    // И растёт точка не как попало, а по той же глубине, что и всё остальное на рейде.
    // Счёт долями: сколько именно линий досталось свободными, решает бэкенд случаем, и мерить
    // разбег в пикселях нельзя — от расстановки он каждый раз другой.
    expectFollowsDepth(
        lines.map(([line, widths]) => [line, widths[0]]),
        'точка линии'
    );
    // Дробный размер и есть непрерывность: округли его до пикселя — и соседние линии слипнутся.
    expect(
        dots.some((dot) => Math.abs(dot.width - Math.round(dot.width)) > 0.05),
        'точки снова растут ступеньками по целому пикселю'
    ).toBe(true);

    // Точка помечена светом, а не чертой: ровная заливка и ореол вокруг. Обвод — хоть сплошной,
    // хоть пунктирный — на воде выглядит чужим: черта на ней не держится, вода не бумага.
    // Градиента у точки нет: она мелкая, и растяжка на ней читается грязноватым краем, —
    // растянут свет у выросшего круга, и мерят его отдельно (см. expectBerthLightGrows).
    for (const dot of dots) {
        expect(dot.background, 'точка места разрисована градиентом').toBe('none');
        expect(dot.glow, 'у точки на воде нет ореола').not.toBe('none');
        expect(dot.border, 'у места опять появился обвод').toBe('0px');
    }
};

/**
 * Мерки круга подсветки: ширина на ближней линии и сплющенность на обоих концах рейда.
 * Продублированы из стилей (@berth-mark-near, @berth-mark-flat-near, @berth-mark-flat-far) —
 * переменные Less в проверку не дотянуть, а мерить круг в долях от чего-то ещё не выйдет:
 * он единственное на рейде, что задано прямо в пикселях, а не долей кадра.
 */
const MARK_NEAR = 50;
const MARK_FLAT_FAR = 0.3;
const MARK_FLAT_NEAR = 0.5;
const markFlat = (slot: number): number => MARK_FLAT_FAR + (MARK_FLAT_NEAR - MARK_FLAT_FAR) * slotShare(slot);

/**
 * Подсветка места — та же точка, выросшая в круг света: второго пятна под ней нет, иначе свет
 * на выбранном месте складывался бы из двух и горел бы вдвое ярче соседних.
 *
 * Уходит круг в даль по той же формуле, что и корпус (slotScale): он лежит на воде рядом
 * с кораблём и обязан мельчать с ним вровень, иначе разметка и флот живут в разных перспективах.
 *
 * Круг лежит на воде, а не стоит в кадре, и потому сплющен. Сплющен неодинаково: чем дальше
 * место, тем острее угол, под которым видна вода, и тем площе выходит круг.
 *
 * И не в черту: настоящая проекция вырождала дальнюю подсветку в двухпиксельную полоску,
 * и видно её на дальних линиях попросту переставало быть.
 */
const expectBerthLightGrows = async (page: Page): Promise<void> => {
    const dots = [...(await berthShapes(page)).filter((light) => light.width === light.height)].sort(
        (one, other) => one.below - other.below
    );
    const slotOf = (shape: BerthShape): number => Number(shape.key.split('-')[0]);
    const far = await hoverBerth(page, dots[0].key);
    const near = await hoverBerth(page, dots.at(-1)!.key);

    expect(near.width, 'ближнее место подсвечено как дальнее').toBeGreaterThan(far.width);
    for (const [what, mark] of [
        ['дальнего', far],
        ['ближнего', near],
    ] as [string, BerthShape][]) {
        const slot = slotOf(mark);
        expect(mark.width, `круг ${what} места уходит в даль не так, как корпус`).toBeCloseTo(
            MARK_NEAR * slotScale(slot),
            1
        );
        expect(mark.height / mark.width, `круг ${what} места сплющен не своей перспективой`).toBeCloseTo(
            markFlat(slot),
            2
        );
        // Свет неровный: гуще к середине, к краю сходит на нет. Ровная заливка читается
        // нашлёпкой на воде — у неё виден край; а ореол этот край бы и вернул, только светящийся.
        expect(mark.background, `свет ${what} места залит ровно, без растяжки`).toContain('radial-gradient');
        expect(mark.glow, `у круга ${what} места остался ореол`).toBe('none');
    }
    expect(near.height / near.width, 'подсветка ближнего места стоит в кадре, а не лежит на воде').toBeLessThan(0.8);
    expect(far.height, 'подсветка дальнего места выродилась в черту').toBeGreaterThan(3);
};

/**
 * Подписи занятых мест. Стоят они там же, где у свободного места горит точка, — серединой
 * на отметке стоянки. Раньше имя висело над мачтами, и рейд читался двумя ярусами: огоньки
 * на воде, надписи в небе, — а сводить их приходилось глазу.
 *
 * Написаны они позывным: цветом участника и той же меркой, что подпись под репликой в ленте.
 * Цвет проверяем не по значению — какой кому достался, решает бэкенд, — а по тому, что он
 * у каждого свой и не общий текстовый.
 */
const expectNamesStandOnBerths = async (page: Page): Promise<void> => {
    const marks = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[class*="shipName"]')].map((mark) => {
            const box = mark.getBoundingClientRect();
            const paint = getComputedStyle(mark.firstElementChild ?? mark);
            return {
                middle: box.top + box.height / 2,
                berth: mark.closest('[class*="shipLane"]')!.getBoundingClientRect().bottom,
                size: paint.fontSize,
                color: paint.color,
            };
        })
    );
    expect(marks.length, 'занятые места не подписаны вовсе').toBeGreaterThan(0);
    for (const mark of marks) {
        expect(mark.middle, 'подпись висит не на отметке стоянки').toBeCloseTo(mark.berth, 0);
        expect(mark.size, 'подпись на воде набрана не той же меркой, что позывной в ленте').toBe('14px');
    }
    expect(new Set(marks.map((mark) => mark.color)).size, 'подписи на воде набраны одним цветом').toBe(marks.length);
};

/** Как устроен кадр по высоте: сцена, небо и вода, px. */
const seaFrame = (page: Page): Promise<{ scene: number; sky: number; sea: number; share: number }> =>
    page.evaluate(() => {
        const scene = document.querySelector('[class*="scene_"]')!.getBoundingClientRect();
        const sea = document.querySelector('[class*="sea_"]')!.getBoundingClientRect();
        const sky = sea.top - scene.top;
        return { scene: scene.height, sky, sea: sea.height, share: sky / scene.height };
    });

/** Доля неба в пределе: ниже этой отметки сцена уже не сжимается, а ужимается целиком. */
const SKY_SHARE = 0.4;

/**
 * Кадр по высотам окна: что в нём остаётся от неба и воды. Окно тут одно на весь замер,
 * поэтому и высоты идут по очереди — параллелить нечего.
 */
/* eslint-disable no-await-in-loop -- окно одно, размеры примеряются по очереди */
const measureHeights = async (page: Page, width: number, heights: number[]) => {
    const frames = [];
    for (const height of heights) {
        await page.setViewportSize({ width, height });
        // Сцена меняет высоту не в тот же кадр: ждём, пока раскладка устоится.
        await page.waitForTimeout(200);
        frames.push({ height, ...(await seaFrame(page)) });
    }
    return frames;
};
/* eslint-enable no-await-in-loop */

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

interface ActionsBar {
    /** Ширина самого слота: ею меряем, взяли кнопки всю ширину или нет. */
    width: number;
    position: string;
    /** Сколько строк заняли кнопки: разные верхние кромки — разные строки. */
    rows: number;
    buttons: { left: number; right: number; width: number }[];
}

/** Ряд кнопок внизу формы или шторки: где он стоит и как в нём поделена ширина. */
const actionsBar = (page: Page): Promise<ActionsBar> =>
    page.evaluate(() => {
        const bar = document.querySelector('[class*="actions"]')!;
        const box = bar.getBoundingClientRect();
        const buttons = [...bar.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        return {
            width: box.width,
            position: getComputedStyle(bar).position,
            rows: new Set(buttons.map((button) => Math.round(button.top))).size,
            buttons: buttons.map((button) => ({
                left: button.left - box.left,
                right: box.right - button.right,
                width: button.width,
            })),
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

    test('кнопки берут всю ширину: в строку, пока подписи влезают, и столбиком, когда нет', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);

        // Две кнопки в строку делят ширину слота целиком: они и промежуток между ними —
        // это вся ширина, и по краям не остаётся ничего.
        const row = await actionsBar(page);
        expect(row.rows, 'кнопки разъехались по строкам там, где влезали в одну').toBe(1);
        expect(row.buttons[0].left, 'первая кнопка отошла от левого края').toBeCloseTo(0, 0);
        expect(row.buttons.at(-1)!.right, 'последняя кнопка не дотянулась до правого края').toBeCloseTo(0, 0);

        // Ужимаем окно так, чтобы подписи в строку не влезли: тогда каждая кнопка встаёт
        // на свою строку и там разворачивается во всю ширину.
        await page.setViewportSize({ width: 320, height: 844 });
        const stack = await actionsBar(page);
        expect(stack.rows, 'подписи не влезли в строку, а кнопки остались в ней').toBe(2);
        for (const button of stack.buttons) {
            expect(button.width, 'кнопка на своей строке не заняла всю ширину').toBeCloseTo(stack.width, 0);
        }
    });

    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        expectBerthsLieOnWater(await berthShapes(page));
        expectSlotsFollowDepth(await slotLines(page));
        await expectBerthLightGrows(page);
        // Занятые места подписаны все: рейд читается целиком — где свободно, а где «Вымпел».
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
        await expectNamesStandOnBerths(page);
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
            fleet.map((member) => member.place.slot)
        );
    });

    // Кадр на телефоне жмут постоянно: выехала клавиатура — и от сцены осталась треть.
    // Небо тут отступает первым и в два приёма, а море держится до последнего: рейд — это
    // и есть сцена, и ужимать его вместе с небом значит уводить корабли к самому горизонту.
    test('под клавиатурой отступает небо, а не море', async ({ page }) => {
        await openChannel(page, DEMO);
        const [tall, high, mid, low, tight] = await measureHeights(
            page,
            MOBILE_MAX_WIDTH - 90,
            [900, 780, 640, 500, 380]
        );

        // Сперва небу отдают весь остаток: воды в кадре сколько положено, и она не двигается.
        expect(high.sea, 'вода сжалась раньше неба').toBeCloseTo(tall.sea, 0);
        expect(high.sky, 'небо не отдало кадр под чат').toBeLessThan(tall.sky);
        // Дальше небо упирается в свою мерку и стоит, а сжимается уже вода.
        expect(low.sky, 'небо провалилось ниже своей мерки').toBeCloseTo(mid.sky, 0);
        expect(low.sea, 'вода не начала сжиматься следом за небом').toBeLessThan(mid.sea);
        // И только в самом тесном кадре обе половины идут вниз вместе, сохраняя пропорцию.
        expect(tight.share, 'в тесном кадре небо съедено целиком').toBeCloseTo(SKY_SHARE, 2);
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
        expectSlotsFollowDepth(await slotLines(page));
        await expectBerthLightGrows(page);
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
        await expectNamesStandOnBerths(page);
    });

    // Рейд однажды уже съезжал на горизонт: вода стояла в долях сцены, окно уменьшали —
    // и дальние линии оказывались на небе. Теперь у воды своя высота, а концы рейда и берег
    // приколочены к горизонту и к нижней кромке кадра.
    test('вода держит свою высоту, а рейд с берегом не съезжают на небо', async ({ page }) => {
        await openChannel(page, DEMO);
        const frames = await measureHeights(page, 1200, [900, 700, 500, 400]);

        // Пока в кадре есть чем жертвовать, воды в нём ровно столько, сколько положено.
        expect(frames[1].sea, 'вода сжалась вместе с окном').toBeCloseTo(frames[0].sea, 0);
        expect(frames[1].sky, 'небо не отдало кадр под чат').toBeLessThan(frames[0].sky);
        // Дальше сжимаются обе половины разом и в одной и той же пропорции.
        expect(frames[2].share, 'небо съедено ниже своей доли').toBeCloseTo(SKY_SHARE, 2);
        expect(frames[3].share, 'в тесном кадре пропорция кадра поехала').toBeCloseTo(SKY_SHARE, 2);

        // И в самом тесном кадре рейд остаётся на воде: дальняя линия под горизонтом,
        // ближняя над кромкой кадра, берег острова — тоже под горизонтом.
        const lines = await slotLines(page);
        expect(lines[0][1], 'дальняя линия рейда выехала на небо').toBeGreaterThan(0);
        expect(lines.at(-1)![1], 'ближняя линия рейда ушла под кромку кадра').toBeLessThan(frames[3].sea);
        expectSlotsFollowDepth(lines);
        const islandLine = await page.evaluate(() => {
            const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
            // Ватерлиния берега — не низ картинки: под ней в той же картинке лежит отражение.
            const island = document.querySelector('[class*="island"]')!.getBoundingClientRect();
            return island.bottom - island.height * 0.445 - horizon;
        });
        expect(islandLine, 'берег острова выехал на небо').toBeGreaterThan(0);
        expect(islandLine, 'берег съехал на середину рейда').toBeLessThan(frames[3].sea / 2);
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

    test('кнопки стоят в строку по ширине подписей и вместе по центру', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);
        const bar = await actionsBar(page);
        expect(bar.rows, 'на широком экране кнопкам хватает одной строки').toBe(1);
        const filled = bar.buttons.reduce((total, button) => total + button.width, 0);
        expect(filled, 'кнопки растянулись через всю ширину вместо ширины подписей').toBeLessThan(bar.width * 0.8);
        expect(bar.buttons[0].left, 'ряд кнопок сдвинут от середины').toBeCloseTo(bar.buttons.at(-1)!.right, 0);
    });
});

/**
 * Прилипание кнопок. Отсечка здесь по высоте окна, а не по тому, сколько места досталось
 * форме: место зависит от сцены, сцена сжимается плавно, и на границе кнопки то прилипали бы,
 * то отлипали от пары пикселей.
 */
test.describe('кнопки у нижней кромки', () => {
    test.use({ viewport: { width: 390, height: PINNED_ACTIONS_MIN_HEIGHT } });

    test('на высоком окне кнопка видна сразу, на низком — отлипает и уезжает под обрез', async ({ page }) => {
        await openChannel(page, DEMO);
        expect((await actionsBar(page)).position, 'кнопки не прилипли на высоком окне').toBe('sticky');
        await expect(page.locator('button[type=submit]'), 'прилипшая кнопка не видна').toBeInViewport();

        // Ниже отсечки прилипания нет совсем, и длинная форма снова уезжает кнопкой под обрез.
        await page.setViewportSize({ width: 390, height: PINNED_ACTIONS_MIN_HEIGHT - 1 });
        expect((await actionsBar(page)).position, 'кнопки прилипли ниже отсечки').toBe('static');
        await expect(
            page.locator('button[type=submit]'),
            'на низком окне кнопка осталась приклеенной'
        ).not.toBeInViewport();
    });
});
