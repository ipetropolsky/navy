import { Page, expect, test } from '@playwright/test';

import { EDGE_MARGIN } from '@/backend/placement';
import {
    COLUMN_WIDTH,
    MOBILE_MAX_WIDTH,
    PINNED_ACTIONS_MIN_HEIGHT,
    SHADE_PEEK_HEIGHT,
    SHADE_TOP_GAP,
} from '@/config/layout';
import { SLOT_COUNT, slotDepth, slotShare } from '@/types/channel';

import {
    ALBATROS,
    DEMO,
    join,
    openChannel,
    openNewChannel,
    openSheet,
    readState,
    shipNames,
    ships,
} from '@tests/helpers';

/**
 * Раскладка на телефоне и на десктопе. Здесь тоже только то, на чём наступали: вода однажды
 * занимала верхнюю треть своей области, а ниже стоял голый фон; месяц уезжал под заголовок;
 * корабли жались к нижней кромке, оставляя у горизонта пустую полосу.
 */

/** Прямоугольник в координатах сцены, px. */
interface Frame {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/** Пересекаются ли два прямоугольника хоть краем. */
const overlaps = (one: Frame, other: Frame): boolean =>
    one.left < other.right && other.left < one.right && one.top < other.bottom && other.top < one.bottom;

interface Geometry {
    scene: { width: number; height: number };
    /** Линия горизонта: верх воды, px от верха сцены. */
    horizon: number;
    /** Плитка воды: должна закрывать свою область целиком. */
    seaTile: { width: number; height: number };
    seaBox: { width: number; height: number };
    /** Диск месяца целиком: он стоит рядом со строчками шапки и не должен их задевать. */
    moon: Frame;
    /**
     * Строчки шапки, обмеренные по самому тексту. Блоки под них растянуты во всю ширину чата,
     * и по блокам месяц «под текстом» всегда, хотя текст кончается задолго до лунной дорожки.
     */
    headerText: Frame[];
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
        const moon = box('[class*="moon_"]');
        const slots = [...document.querySelectorAll('[class*="shipSlot"]')].map((el) => el.getBoundingClientRect());
        const tops = slots.map((slot) => slot.top - scene.top);
        const bottoms = slots.map((slot) => slot.bottom - scene.top);
        // Текст строчки, а не блок под ней: Range охватывает ровно набранные буквы.
        const textFrame = (selector: string) => {
            const range = document.createRange();
            range.selectNodeContents(document.querySelector(selector)!);
            const spot = range.getBoundingClientRect();
            return {
                top: Math.round(spot.top - scene.top),
                bottom: Math.round(spot.bottom - scene.top),
                left: Math.round(spot.left - scene.left),
                right: Math.round(spot.right - scene.left),
            };
        };
        return {
            scene: { width: Math.round(scene.width), height: Math.round(scene.height) },
            horizon: Math.round(sea.top - scene.top),
            seaTile: { width: Math.round(tile.width), height: Math.round(tile.height) },
            seaBox: { width: Math.round(sea.width), height: Math.round(sea.height) },
            moon: {
                top: Math.round(moon.top - scene.top),
                bottom: Math.round(moon.bottom - scene.top),
                left: Math.round(moon.left - scene.left),
                right: Math.round(moon.right - scene.left),
            },
            headerText: [textFrame('[class*="chatTitle"]'), textFrame('[class*="chatStatus"]')],
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
 * Мерки круга подсветки: во сколько раз он больше точки и насколько сплющен на обоих концах
 * рейда. Продублированы из стилей (@berth-mark-times, @berth-mark-flat-near,
 * @berth-mark-flat-far) — переменные Less в проверку не дотянуть.
 */
const MARK_TIMES = 4;
const MARK_FLAT_FAR = 0.26;
const MARK_FLAT_NEAR = 0.36;
const markFlat = (slot: number): number => MARK_FLAT_FAR + (MARK_FLAT_NEAR - MARK_FLAT_FAR) * slotShare(slot);

/**
 * Подсветка места — та же точка, выросшая в круг света: второго пятна под ней нет, иначе свет
 * на выбранном месте складывался бы из двух и горел бы вдвое ярче соседних.
 *
 * Уходит круг в даль вместе с точкой, потому что он и есть она: размер задан кратностью, одной
 * и той же на любой линии, — значит перспектива у них общая, а не две согласованные лесенки.
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
    for (const [what, dot, mark] of [
        ['дальнего', dots[0], far],
        ['ближнего', dots.at(-1)!, near],
    ] as [string, BerthShape, BerthShape][]) {
        const slot = slotOf(mark);
        expect(mark.width, `круг ${what} места вырос из точки не во столько раз`).toBeCloseTo(
            dot.width * MARK_TIMES,
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
 * Качается подпись той же волной, что и корабль над ней, — потому и допуск ниже не нулевой.
 *
 * По ширине подпись стоит на своей стоянке, а не под серединой корпуса: корабль над ней может
 * быть отведён в сторону — у края кадра его отодвигает внутрь собственная ширина, на тесной
 * линии он уступает воду соседу, — а имя остаётся на точке, которую собой закрывает. Поэтому
 * здесь сверяется не совпадение осей, а то, что имя осталось при своём корабле: разъехаться
 * дальше, чем на треть коридора, они не могут ни от клампа, ни от расхождения. Точное же
 * совпадение подписи с точкой стоянки проверяется в scene.spec, где эту точку видно.
 *
 * Написаны они позывным: цветом участника и той же меркой, что подпись под репликой в ленте.
 * Цвет проверяем не по значению — какой кому достался, решает бэкенд, — а по тому, что он
 * у каждого свой и не общий текстовый.
 */
/** Насколько подпись может уехать от своей отметки, качаясь на волне, px: см. WAVE_NEAR. */
const NAME_SWING = 2.5;

/**
 * Насколько подпись может разойтись со своим корпусом по ширине, доля кадра. Расходятся они
 * на отступ корабля от края кадра и на расхождение с тесным соседом — и то и другое меньше
 * трети шага между коридорами (30% кадра), то есть имя заведомо остаётся при своём корабле,
 * а не перебирается к соседнему месту.
 */
const NAME_DRIFT_SHARE = 0.1;

const expectNamesStandOnBerths = async (page: Page): Promise<void> => {
    // Подчёркивание в конце обязательно: подпись ездит по своей дорожке (shipNameLane),
    // и без него в набор попадала бы ещё и она.
    const marks = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[class*="shipName_"]')].map((mark) => {
            const box = mark.getBoundingClientRect();
            const paint = getComputedStyle(mark.firstElementChild ?? mark);
            return {
                middle: box.top + box.height / 2,
                berth: mark.closest('[class*="shipNameLane"]')!.getBoundingClientRect().bottom,
                // Ось имени — его собственная середина: сама надпись отходит от коридора
                // разбегом перспективы, ровно как точка внутри своей дорожки.
                axis: box.left + box.width / 2,
                size: paint.fontSize,
                color: paint.color,
            };
        })
    );
    // Оси корпусов — середины самих корпусов. Порядок в кадре у имён и кораблей один и тот же,
    // так что сортировки хватает, чтобы составить пары.
    const { hulls, frame } = await page.evaluate(() => ({
        hulls: [...document.querySelectorAll('[class*="shipSlot"]')].map((hull) => {
            const box = hull.getBoundingClientRect();
            return box.left + box.width / 2;
        }),
        frame: document.querySelector('[class*="scene_"]')!.getBoundingClientRect().width,
    }));
    const sorted = (values: number[]): number[] => [...values].sort((one, other) => one - other);
    const drift = sorted(marks.map((mark) => mark.axis)).map((axis, index) => Math.abs(axis - sorted(hulls)[index]));
    expect(Math.max(...drift), 'подпись уехала от своего корабля').toBeLessThan(frame * NAME_DRIFT_SHARE);
    expect(marks.length, 'занятые места не подписаны вовсе').toBeGreaterThan(0);
    for (const mark of marks) {
        // Не «ровно на отметке», а «в пределах хода волны»: подпись качается вместе с кораблём,
        // и в кадре замера она может стоять на гребне или в подошве. Ход этот — @heave, у самого
        // ближнего места около двух пикселей (см. WAVE_NEAR), их и допускаем в обе стороны.
        expect(Math.abs(mark.middle - mark.berth), 'подпись висит не на отметке стоянки').toBeLessThan(NAME_SWING);
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
    /** Ширина, которую делят кнопки: сама полоса за вычетом своих полей. */
    width: number;
    /** Ширина полосы целиком: она доходит фоном и чертой до краёв хозяина. */
    bandWidth: number;
    /** Ширина хозяина по внешней кромке: до неё полосе и положено доходить. */
    ownerWidth: number;
    /** Толщина черты сверху: полоса отбита ею так же, как панель с полем ввода. */
    rule: number;
    /** Фон полосы: он поднятый, а не прозрачный — иначе панели не видно. */
    background: string;
    position: string;
    /** Сколько строк заняли кнопки: разные верхние кромки — разные строки. */
    rows: number;
    buttons: { left: number; right: number; width: number }[];
}

/**
 * Ряд кнопок внизу формы или шторки: где он стоит и как в нём поделена ширина.
 *
 * Мерка тут по внутренней кромке полосы, а не по внешней: полоса — панель со своим фоном
 * и своими полями, и «кнопки взяли всю ширину» значит всю ширину внутри неё. Саму полосу
 * меряем отдельно: ей положено доходить фоном и чертой до краёв хозяина, гася его поля
 * отрицательными margin и возвращая их своими padding.
 */
const actionsBar = (page: Page): Promise<ActionsBar> =>
    page.evaluate(() => {
        const bar = document.querySelector('[class*="actions"]')!;
        const box = bar.getBoundingClientRect();
        const style = getComputedStyle(bar);
        const left = box.left + Number.parseFloat(style.paddingLeft);
        const right = box.right - Number.parseFloat(style.paddingRight);
        const buttons = [...bar.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
        return {
            width: right - left,
            bandWidth: box.width,
            ownerWidth: bar.parentElement!.getBoundingClientRect().width,
            rule: Number.parseFloat(style.borderTopWidth),
            background: style.backgroundColor,
            position: style.position,
            rows: new Set(buttons.map((button) => Math.round(button.top))).size,
            buttons: buttons.map((button) => ({
                left: button.left - left,
                right: right - button.right,
                width: button.width,
            })),
        };
    });

/**
 * Полоса кнопок — такая же панель, как та, в которой стоит поле ввода в ленте: черта сверху,
 * поднятый фон, и оба доходят до краёв хозяина, а не обрываются по его полям. Прилипла полоса
 * или просто стоит внизу — выглядит она одинаково, поэтому и проверка одна на оба случая.
 */
const expectBandLooksLikePanel = (bar: ActionsBar): void => {
    expect(bar.bandWidth, 'полоса кнопок не дотянулась фоном до краёв').toBeCloseTo(bar.ownerWidth, 0);
    expect(bar.rule, 'полоса кнопок не отчёркнута сверху').toBeGreaterThan(0);
    expect(bar.background, 'у полосы кнопок нет своего фона').not.toBe('rgba(0, 0, 0, 0)');
    expect(bar.width, 'поля полосы съели всю её ширину').toBeLessThan(bar.bandWidth);
};

test.describe('телефон', () => {
    // Ширина заведомо мобильная: точка перехода одна на стили и на код, и берём мы её оттуда же.
    test.use({ viewport: { width: MOBILE_MAX_WIDTH - 90, height: 844 } });

    test('форма занимает ширину целиком и без скруглений, и поле на одно слово тоже', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'форма не дотянулась до краёв').toBe(panel.parentWidth);
        expect(panel.radius, 'на всю ширину скругления не нужны').toBe(0);

        // Мерка «половина, но не уже 350px» на телефоне сходится к ширине формы: отдельного
        // правила для узкого экрана нет, и проверяем мы как раз то, что оно не понадобилось.
        const field = await page.getByPlaceholder('Гром').evaluate((input) => {
            const form = input.closest('[class*="card"]')!;
            return {
                width: input.getBoundingClientRect().width,
                inner: form.clientWidth - 2 * parseFloat(getComputedStyle(form).paddingLeft),
            };
        });
        expect(field.width, 'поле позывного не заняло ширину формы').toBeCloseTo(field.inner, 0);
    });

    test('кнопки берут всю ширину: в строку, пока подписи влезают, и столбиком, когда нет', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);

        // Две кнопки в строку делят ширину слота целиком: они и промежуток между ними —
        // это вся ширина, и по краям не остаётся ничего.
        const row = await actionsBar(page);
        expectBandLooksLikePanel(row);
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

        // Месяц стоит на небе рядом со строчками шапки, а не под ними. На телефоне он поднят
        // на строку состояния: от заголовка его отводит высота — диск встаёт под ним, — а от
        // самой строки ширина: строчка короткая и кончается задолго до лунной дорожки.
        for (const line of view.headerText) {
            expect(overlaps(view.moon, line), 'месяц наехал на строчку шапки').toBe(false);
        }
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

    // Плашка формы одна на все экраны: карточки по центру на широком больше нет. Тянется
    // за ней не всё — поле на одно слово держит половину ширины, но не уже 350px, иначе
    // строка под позывной читалась бы полем для абзаца.
    test('форма занимает ширину целиком, а поле на одно слово — половину', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'форма не дотянулась до краёв').toBe(panel.parentWidth);
        expect(panel.radius, 'на всю ширину скругления не нужны').toBe(0);

        const field = await page.getByPlaceholder('Гром').evaluate((input) => {
            const form = input.closest('[class*="card"]')!;
            const inner = form.clientWidth - 2 * parseFloat(getComputedStyle(form).paddingLeft);
            return { width: input.getBoundingClientRect().width, inner };
        });
        expect(field.width, 'поле позывного уже половины формы').toBeCloseTo(field.inner / 2, 0);
        expect(field.width, 'поле позывного не дотянуло до нижней мерки').toBeGreaterThanOrEqual(350);
    });

    // Раскладка кнопок идёт от ширины блока, а не от ширины экрана: в широком блоке им незачем
    // растягиваться, в узком — незачем жаться к краю. Оба случая мы знаем наперёд, поэтому
    // и заданы они классом; на телефоне разницы нет — там любой блок узкий.
    test('в шторке кнопки стоят у левого края по ширине подписей', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);
        const bar = await actionsBar(page);
        expect(bar.rows, 'на широком экране кнопкам хватает одной строки').toBe(1);
        const filled = bar.buttons.reduce((total, button) => total + button.width, 0);
        expect(filled, 'кнопки растянулись через всю ширину вместо ширины подписей').toBeLessThan(bar.width * 0.8);
        expect(bar.buttons[0].left, 'кнопки отошли от левого края').toBeCloseTo(0, 0);
    });

    test('в форме кнопки делят ширину так же, как на телефоне', async ({ page }) => {
        await openChannel(page, DEMO);
        const bar = await actionsBar(page);
        expectBandLooksLikePanel(bar);
        expect(bar.buttons[0].width, 'одинокая кнопка не заняла ширину формы').toBeCloseTo(bar.width, 0);
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

/**
 * Где на картинке острова лежит его ватерлиния — доля высоты. Ось отражения стоит на 168-й
 * строке из 325, ей же задан и сдвиг острова в стилях. Число продублировано сюда нарочно:
 * проверка должна знать, что считать берегом, сама по себе — возьми она долю из стилей,
 * ошибка именно в этой доле осталась бы незамеченной, а с неё всё и началось.
 */
const ISLAND_WATERLINE = 168 / 325;

/** На сколько пикселей ниже горизонта лежит берег острова. */
const islandBelowHorizon = (page: Page): Promise<number> =>
    page.evaluate((waterline) => {
        const island = document.querySelector('img[class*="island"]')!.getBoundingClientRect();
        const sky = document.querySelector('[class*="sky"]')!.getBoundingClientRect();
        return island.top + waterline * island.height - sky.bottom;
    }, ISLAND_WATERLINE);

/**
 * Берег острова стоит на своей дальности и никуда с неё не сходит. Отступ ему задан от горизонта
 * в пикселях, а сдвиг картинки — долей её собственной высоты, и высота эта идёт за шириной сцены.
 * Пока доля верна, одно гасит другое; наврали в доле — и остаток растёт вместе с экраном.
 * Так и было: 19px под горизонтом на десктопе против 22px на телефоне при одном заданном числе.
 */
test('берег острова стоит на горизонте, а не отъезжает от него вместе с шириной экрана', async ({ page }) => {
    await openChannel(page, DEMO);
    const wide = await islandBelowHorizon(page);
    expect(wide, 'берег вылез на небо').toBeGreaterThan(0);
    expect(wide, 'берег уехал от горизонта на середину рейда').toBeLessThan(30);

    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    expect(await islandBelowHorizon(page), 'на телефоне берег встал не там, где на десктопе').toBeCloseTo(wide, 0);

    await page.setViewportSize({ width: 330, height: 700 });
    expect(await islandBelowHorizon(page), 'в узком кадре берег отошёл от горизонта').toBeCloseTo(wide, 0);
});

/**
 * Поля по краям кадра. Рейд занимает не весь кадр, а воду между полями: и коридоры, и разброс
 * внутри полосы, и расхождение тесной пары, и отметки мест считаются внутри них. Раньше поля
 * не было вовсе — крайний корабль вставал бортом ровно на обрез, — а отметки держались от края
 * тридцатью пикселями, то есть на телефоне втрое большей долей кадра, чем на десктопе.
 *
 * Меряется поле у самого крупного корабля на ближней линии бокового коридора: там корпус шире
 * своей полосы, вода вся под ним, и в кромку он упирается наверняка. На мелком или дальнем
 * корабле поле не проверить — он до кромки попросту не достаёт.
 *
 * Число сверяется на всех трёх ширинах, а не только на телефоне: силуэт отмерен долей кадра
 * от начала и до конца, и доля эта одна и та же везде. Пиксельного потолка, из-за которого
 * на десктопе корабль рисовался уже отведённого, больше нет — см. «Ширина силуэта в пикселях»
 * в истории шагов.
 */
const edgeGap = (page: Page): Promise<number> =>
    page.evaluate(() => {
        const scene = document.querySelector('[class*="scene"]')!.getBoundingClientRect();
        const hull = document.querySelector('[class*="shipBody"] img')!.getBoundingClientRect();
        return (Math.min(hull.left - scene.left, scene.right - hull.right) / scene.width) * 100;
    });

test('корабль не встаёт бортом на обрез кадра, и поле у него одно на всех экранах', async ({ page }) => {
    await openNewChannel(page, 'polya');
    // Самый крупный корабль справочника стоит в списке первым: проекты идут по убыванию длины.
    await page.locator('button:has([class*="kindShip"])').first().click();
    await page.locator('[data-berth="9-left"]').click();
    await join(page, 'Гроза', '404');
    // Ход у самого крупного корабля на ближней линии долгий, и меряться он мешает: по дороге
    // корабль к кромке ближе, чем когда встанет. Ждём не срок, а конца хода — сцена сама
    // снимает пометку движения, когда корабль пришёл.
    await ships(page).first().waitFor();
    await expect(page.locator('[data-motion]'), 'корабль так и не дошёл до места').toHaveCount(0, { timeout: 40000 });

    // Допуск здесь и ниже — на качку: корпус на волне ещё и кренится, а прямоугольник вокруг
    // повёрнутой картинки шире самого корпуса. Замер даёт до трёх десятых процента кадра.
    const desktop = await edgeGap(page);
    expect(desktop, 'корабль зашёл в поле по краю кадра').toBeGreaterThan(EDGE_MARGIN - 0.35);
    expect(desktop, 'корабль не дошёл до кромки поля').toBeLessThan(EDGE_MARGIN + 0.35);

    // Телефон и узкий кадр: та же доля кадра, что и на десктопе. Здесь и была видна разница,
    // пока ширину силуэта держал потолок в пикселях, — на широком экране он жал, на телефоне нет.
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    const phone = await edgeGap(page);
    expect(phone, 'на телефоне поле вышло другой доли кадра').toBeCloseTo(desktop, 0);

    await page.setViewportSize({ width: 330, height: 700 });
    expect(await edgeGap(page), 'в узком кадре поле вышло другой доли кадра').toBeCloseTo(phone, 0);
});

/**
 * Сцена во весь экран. Кадр у сцены в обычной раскладке узкий — приложение держит колонку
 * в 760px, — и выбирать в нём место на рейде тесно: отметки стоят близко, на телефоне
 * попасть в нужную трудно. Разворот снимает ограничение колонки: кадр занимает окно целиком,
 * и та же геометрия рейда раскладывается на всю его ширину и высоту.
 *
 * Меряется здесь не картинка, а три обещания: кадр действительно вырос до окна — до всего,
 * кроме щёлки шторки внизу, — и вернулся обратно; шапка выросла вместе с ним; чат никуда
 * не делся, он в шторке.
 */
const sceneBox = async (page: Page): Promise<{ width: number; height: number }> => {
    const box = await page.locator('[class*="scene"]').first().boundingBox();
    return { width: Math.round(box!.width), height: Math.round(box!.height) };
};

/** Ширина кнопки в шапке: на укрупнённой раскладке круг больше. */
const buttonWidth = async (page: Page): Promise<number> => {
    const box = await page.getByRole('button', { name: 'Корабли на связи' }).boundingBox();
    return Math.round(box!.width);
};

test('сцена разворачивается во весь экран и сворачивается обратно', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const window = page.viewportSize()!;
    const small = await sceneBox(page);
    expect(small.width, 'сцена и без разворота во всю ширину окна').toBeLessThan(window.width);
    const smallButton = await buttonWidth(page);

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    // Разворот плавный, и сразу после нажатия кадр ещё в пути. Ждём не срок, а конец перехода:
    // размер перестаёт меняться сам, когда сцена дошла до окна.
    await expect
        .poll(async () => (await sceneBox(page)).width, { message: 'сцена не разошлась на всю ширину окна' })
        .toBe(window.width);
    // Не всё окно: снизу сцену поджимает щёлка шторки — из-под кадра всегда торчит её край.
    expect((await sceneBox(page)).height, 'сцена не заняла окно по высоте').toBe(window.height - SHADE_PEEK_HEIGHT);
    expect(await buttonWidth(page), 'кнопки в шапке остались прежними').toBeGreaterThan(smallButton);

    // Полноэкранная сцена не съедает остальное: чат никуда не делся, он в щёлке шторки,
    // и поле ввода из неё видно сразу, без единого движения.
    await expect(page.getByPlaceholder('Сообщение'), 'в щёлке шторки не осталось чата').toBeVisible();

    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await expect
        .poll(async () => (await sceneBox(page)).width, { message: 'сцена не вернулась в колонку' })
        .toBe(small.width);
    expect(await buttonWidth(page), 'кнопки в шапке остались крупными').toBe(smallButton);
});

/**
 * Главный случай разворота — форма настройки корабля: место на рейде выбирают именно там.
 * Режим один на всё приложение, поэтому с формой он не сбрасывается, а отметки свободных мест
 * разъезжаются вместе с кадром — ровно ради этого всё и затевалось.
 */
const berthSpan = (page: Page): Promise<number> =>
    page.evaluate(() => {
        const marks = [...document.querySelectorAll('[data-berth]')].map((el) => el.getBoundingClientRect());
        const top = Math.min(...marks.map((mark) => mark.top));
        const bottom = Math.max(...marks.map((mark) => mark.bottom));
        return bottom - top;
    });

test('на форме настройки корабля разворот разводит отметки мест', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    const marks = page.locator('[data-berth]');
    const count = await marks.count();
    expect(count, 'на форме не показали свободных мест').toBeGreaterThan(0);
    const tight = await berthSpan(page);

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(() => berthSpan(page), { message: 'рейд на форме не растянулся вместе с кадром' })
        .toBeGreaterThan(tight * 1.5);
    // Мест ровно столько же: развернулась картинка, а не расклад рейда.
    await expect(marks, 'вместе с кадром изменился и расклад мест').toHaveCount(count);
    // Форма никуда не делась и работает: она в шторке под кадром, и место в ней выбирается.
    await marks.first().click();
    await expect(page.getByRole('button', { name: 'Готово' }), 'форма в шторке потерялась').toBeVisible();
});

/**
 * Шторка полноэкранного вида. Три ступени — щёлка, половина, верх, — и обещаны они так:
 * «дёргаем — выезжает до половины, ещё раз двигаем — до верха, можно сразу дотянуть до верха
 * одним движением».
 *
 * Отдельного кода под каждое из этих движений нет: отпущенная шторка встаёт на ближайшую
 * ступень, и короткий рывок оказывается рядом с той, откуда тянули, а длинный — рядом с верхом.
 * Проверять поэтому надо не «сработал ли шаг», а именно расстояния: рывок на четверть пути
 * возвращает назад, рывок за середину переставляет на соседнюю, длинный доводит до верха.
 * Арифметика ступеней покрыта юнитами (`shadeStops.test.ts`); здесь — что палец и нажатие
 * доходят до неё живыми.
 */
// Именно ручка: слово «шторку» стоит ещё и на затемнении, которым её закрывают нажатием мимо.
const SHADE_HANDLE = /(Поднять|Опустить) шторку/;

const shadeHeight = async (page: Page): Promise<number> => {
    const box = await page.getByRole('region').first().boundingBox();
    return Math.round(box!.height);
};

/** Ступени в пикселях для окна такой высоты — те же числа, что считает `shadeStops`. */
const shadeStops = (height: number) => ({
    peek: SHADE_PEEK_HEIGHT,
    half: Math.round(height / 2),
    full: height - SHADE_TOP_GAP,
});

/** Потянуть за ручку вверх на `by` пикселей и отпустить. */
const dragShade = async (page: Page, by: number): Promise<void> => {
    const box = (await page.getByRole('button', { name: SHADE_HANDLE }).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Шагами, а не прыжком: перетаскивание считается по pointermove, и одного события
    // хватило бы шторке, но не браузеру — он на прыжок курсора отвечает не всегда.
    await page.mouse.move(x, y - by, { steps: 12 });
    await page.mouse.up();
};

const expectShade = (page: Page, height: number, message: string) =>
    expect.poll(() => shadeHeight(page), { message }).toBe(height);

test('шторка ходит по ступеням от нажатия на ручку', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    const stops = shadeStops(page.viewportSize()!.height);

    await expectShade(page, stops.peek, 'развёрнутая сцена открылась не со щёлкой');
    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.half, 'с первого нажатия шторка не дошла до половины');
    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.full, 'со второго нажатия шторка не дошла до верха');
    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.peek, 'с верхней ступени шторка не вернулась в щёлку');
});

test('шторку можно дотянуть до верха одним движением, а коротким рывком — не сдвинуть', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    const stops = shadeStops(page.viewportSize()!.height);
    await expectShade(page, stops.peek, 'развёрнутая сцена открылась не со щёлкой');

    // Четверть пути до половины: ближе к тому месту, откуда тянули.
    await dragShade(page, Math.round((stops.half - stops.peek) / 4));
    await expectShade(page, stops.peek, 'короткий рывок сдвинул шторку со ступени');

    // За середину промежутка — на соседнюю ступень.
    await dragShade(page, Math.round((stops.half - stops.peek) * 0.75));
    await expectShade(page, stops.half, 'рывок за середину не переставил шторку на половину');

    // И одним длинным движением — сразу до верха, минуя половину.
    await expectShade(page, stops.half, 'шторка не успокоилась на половине');
    await dragShade(page, stops.full - stops.half);
    await expectShade(page, stops.full, 'длинное движение не довело шторку до верха');
});

/**
 * Шторка на широком окне. Кадр в полноэкранном режиме раскинут на всё окно, а шторка — нет:
 * во весь экран просили сцену, и лента сообщений на два монитора этого обещания не исполняет.
 * Ширину она держит ту же, что колонка в обычном виде, и стоит по центру кадра.
 *
 * Второе обещание — про кнопки внутри. Прилипшая полоса кнопок в щёлке заняла бы почти всю
 * видимую часть, и вместо «видно, что там лежит» из-под кадра торчали бы одни кнопки. Поэтому
 * в щёлке прилипание снято, а с половины и выше возвращается — там уже есть что листать.
 */
const actionsPosition = (page: Page): Promise<string> =>
    page
        .locator('[class*="actionsPinned"]')
        .first()
        .evaluate((node) => getComputedStyle(node).position);

test('на широком окне шторка держит колонку, а кнопки в ней липнут не раньше половины', async ({ page }) => {
    // Окно шире колонки вдвое: на нём и видно, что шторка за кадром не растянулась. Высота
    // выше отсечки прилипания, иначе кнопки не липли бы ни на одной ступени.
    await page.setViewportSize({ width: 2 * COLUMN_WIDTH, height: PINNED_ACTIONS_MIN_HEIGHT + 100 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    const window = page.viewportSize()!;
    const stops = shadeStops(window.height);
    await expectShade(page, stops.peek, 'развёрнутая сцена открылась не со щёлкой');

    const box = (await page.getByRole('region').first().boundingBox())!;
    expect(Math.round(box.width), 'шторка растянулась вслед за кадром').toBe(COLUMN_WIDTH);
    expect(Math.round(box.x + box.width / 2), 'шторка встала не по центру кадра').toBe(window.width / 2);

    // Список кораблей — там кнопки как раз прилипающие. Открывается он сразу на половине:
    // из щёлки списка не видно.
    await openSheet(page);
    await expectShade(page, stops.half, 'список кораблей открылся не на половине');
    expect(await actionsPosition(page), 'на половине кнопки не прилипли').toBe('sticky');

    // Половина → верх → щёлка: список остаётся тот же, меняется только ступень.
    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.full, 'шторка не дошла до верха');
    expect(await actionsPosition(page), 'на верхней ступени кнопки не прилипли').toBe('sticky');

    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.peek, 'шторка не вернулась в щёлку');
    expect(await actionsPosition(page), 'в щёлке кнопки всё равно прилипли').toBe('static');
});

/**
 * Нажатие мимо шторки её закрывает — но только с той ступени, где «мимо» и правда мимо.
 * Полностью выехавшая шторка накрывает всё, и кроме неё в кадре одно затемнение; на половине
 * же под ней живой кадр, по которому выбирают место на рейде, — и нажатие по воде там
 * означает выбор места, а не «закрой».
 */
test('нажатие мимо шторки опускает её в щёлку, а с половины — не трогает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    const stops = shadeStops(page.viewportSize()!.height);
    await expectShade(page, stops.peek, 'развёрнутая сцена открылась не со щёлкой');

    // Точка у левого края: мимо шторки она и на половине, и на верхней ступени — шторка
    // держит колонку по центру.
    const aside = { x: 60, y: 300 };

    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.half, 'шторка не встала на половину');
    await page.mouse.click(aside.x, aside.y);
    await expectShade(page, stops.half, 'нажатие по живому кадру опустило шторку с половины');

    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.full, 'шторка не дошла до верха');
    await page.mouse.click(aside.x, aside.y);
    await expectShade(page, stops.peek, 'нажатие мимо шторки не опустило её в щёлку');
});

/**
 * Клавиатура. Определить её нечем — браузер о ней не сообщает, — поэтому ориентир один:
 * фокус в текстовом поле. Пока он там, считаем, что клавиатура выехала и съела пол-экрана,
 * и держим шторку раскрытой до верха; ушёл фокус — возвращаем ту ступень, на которой шторку
 * оставил человек, а не ту, с которой начинали.
 *
 * Окно телефонное нарочно: правило работает только в мобильном виде. На десктопе экранной
 * клавиатуры нет, а фокус в поле есть — и шторка уезжала бы до верха от каждой формы,
 * которая сама встаёт фокусом в первое поле.
 */
test('фокус в поле поднимает шторку до верха, а уход из поля возвращает её как было', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    const stops = shadeStops(page.viewportSize()!.height);

    // Человек выставил половину — это и есть то, что придётся вернуть.
    await page.getByRole('button', { name: SHADE_HANDLE }).click();
    await expectShade(page, stops.half, 'шторка не встала на половину');

    const input = page.getByPlaceholder('Сообщение');
    await input.click();
    await expectShade(page, stops.full, 'с фокусом в поле шторка не раскрылась до верха');

    await input.blur();
    await expectShade(page, stops.half, 'без фокуса шторка не вернулась на половину');
});

/**
 * Небо и вода собраны одинаково: полоса из трёх плиток шириной с кадр, соседние зеркальны.
 * И беда у них одна. Край плитки почти никогда не ложится ровно на пиксель, браузер смешивает
 * крайний столбец с тем, что под ним, — и по кадру от неба до нижней кромки идёт тонкая тёмная
 * черта. Лечится тем, что плитки заходят друг на друга на пиксель: рисунок у них по стыку общий,
 * лишний столбец глазу незаметен, а шов — заметен.
 *
 * Ловилось это дважды: сперва на небе, потом, той же правкой мимо, на воде. Проверять сам
 * пиксель отсюда нечем — снимок в набор не затащить, — зато условие, при котором черта
 * появляется, видно по разметке: соседние плитки обязаны перекрываться, а не смыкаться.
 */
test('плитки неба и воды заходят друг на друга, а не смыкаются встык', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    // Во весь экран: там плитки крупнее всего, и там же черту было видно невооружённым глазом.
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await sceneBox(page)).width, { message: 'сцена не разошлась на всю ширину окна' })
        .toBe(page.viewportSize()!.width);

    const seams = await page.evaluate(() =>
        ['skyStrip', 'seaStrip'].flatMap((strip) => {
            // Полос воды две, прямая и перевёрнутая, и швы у них свои — берём все.
            const strips = [...document.querySelectorAll(`[class*="${strip}"]`)];
            return strips.flatMap((one) => {
                const tiles = [...one.children].map((tile) => tile.getBoundingClientRect());
                return tiles.slice(1).map((next, index) => ({
                    strip,
                    // Плюс — плитки перекрылись, ноль и минус — встык или со щелью.
                    overlap: Math.round((tiles[index].right - next.left) * 100) / 100,
                }));
            });
        })
    );
    expect(seams.length, 'полос со стыками не нашлось').toBeGreaterThan(2);
    expect(
        seams.filter((seam) => seam.overlap < 0.9),
        'плитки сомкнулись встык — по кадру пойдёт тёмная черта'
    ).toHaveLength(0);
});

/**
 * Снимок неба вытянут вширь почти 1:3.2, и, отмеренный по ширине кадра, на телефоне он выходит
 * ниже самого неба: 121 px картинки против 135 px неба. Верх неба оставался ровной заливкой
 * без единой звезды, а по верхней кромке снимка шёл стык — не по цвету (верхняя строка снимка
 * и есть цвет подложки), а по рисунку: выше границы звёзд нет вовсе, ниже они начинаются разом.
 * Месяц на телефоне стоит в 31 px от верха сцены, то есть ровно на этой границе, — оттого стык
 * и бросался в глаза прежде всего рядом с ним.
 *
 * Проверяем то же условие, что и починили: снимок обязан накрывать небо сверху. Ширины ему
 * для этого не жалко — обрезается он с боков, где запаса втрое.
 */
test('снимок неба накрывает небо целиком, а не кончается на полпути', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Плюс — над снимком осталась полоса голой подложки, ноль и минус — накрыл.
    const gapAbovePhoto = () =>
        page.evaluate(() => {
            const sky = document.querySelector('[class*="sky_"]')!.getBoundingClientRect();
            const tile = document.querySelector('[class*="skyTile"]')!.getBoundingClientRect();
            return Math.round((tile.top - sky.top) * 100) / 100;
        });

    // Ожидающим expect, а не разовым замером: смена размера окна доходит до вёрстки не мгновенно
    // — высота сцены считается через dvh, — и первый же замер после resize застаёт прежний кадр.
    const expectCovered = (label: string) =>
        expect
            .poll(gapAbovePhoto, { message: `${label}: над снимком неба голая подложка, по его кромке пойдёт стык` })
            .toBeLessThanOrEqual(0);

    // Мерка одного кадра: сперва обычная сцена, потом развёрнутая, и обратно — следующему
    // кадру достаётся то же состояние, с которого начали.
    const measure = async (frame: { width: number; height: number }) => {
        const size = `${frame.width}×${frame.height}`;
        await page.setViewportSize(frame);
        await expectCovered(`${size}, обычная сцена`);
        await page.getByRole('button', { name: 'Развернуть сцену' }).click();
        await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();
        await expectCovered(`${size}, во весь экран`);
        await page.getByRole('button', { name: 'Свернуть сцену' }).click();
        await expect(page.getByRole('button', { name: 'Развернуть сцену' })).toBeVisible();
    };

    // Кадры разной высоты: у сцены свой предел (300px), а небо в ней продолжает расти, и стык
    // с высотой окна уезжает вниз — на 390×844 он был на 13-й строке, на 390×1000 на 26-й.
    const frames = [
        { width: 390, height: 700 },
        { width: 390, height: 844 },
        { width: 390, height: 1000 },
        { width: 1200, height: 900 },
    ];
    // Цепочкой, а не циклом: кадры меряются строго по очереди, но await внутри цикла тут
    // не наш приём — см. правила линтера.
    await frames.reduce(async (before, frame) => {
        await before;
        return measure(frame);
    }, Promise.resolve());
});
