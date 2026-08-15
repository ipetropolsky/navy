import { Page, expect, test } from '@playwright/test';

import { EDGE_MARGIN } from '@/backend/placement';
import {
    COLUMN_WIDTH,
    COMPACT_HEIGHT,
    CONTENT_DESKTOP_HEIGHT,
    CONTENT_OVERLAP,
    MOBILE_MAX_WIDTH,
    SHEET_TOP_GAP,
    SHEET_WIDTH,
} from '@/config/layout';
import { SLOT_COUNT, slotDepth, slotShare } from '@/types/channel';

import {
    ALBATROS,
    DEMO,
    bubbles,
    join,
    openChannel,
    openNewChannel,
    openSheet,
    readState,
    send,
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
        // Сцена меняет высоту не в тот же кадр: ждём, пока раскладка устоится. Ждать приходится
        // дольше самого перехода (@expand-seconds в motion.less): по нему едет не только коробка
        // кадра, но и горизонт внутри — а меряем мы как раз его.
        await page.waitForTimeout(600);
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
        // Форма настройки корабля: в ней кнопок две — «Готово» и «Отмена», — и делить между
        // ними ширину есть что. Форма выезжает поверх разговора, но полоса кнопок у неё та же,
        // что и у формы постановки в строй: слот один на все формы приложения.
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);
        await page.getByRole('button', { name: 'Настроить корабль' }).click();

        // Две кнопки в строку делят ширину слота целиком: они и промежуток между ними —
        // это вся ширина, и по краям не остаётся ничего.
        const row = await actionsBar(page);
        expectBandLooksLikePanel(row);
        expect(row.rows, 'кнопки разъехались по строкам там, где влезали в одну').toBe(1);
        expect(row.buttons[0].left, 'первая кнопка отошла от левого края').toBeCloseTo(0, 0);
        expect(row.buttons.at(-1)!.right, 'последняя кнопка не дотянулась до правого края').toBeCloseTo(0, 0);

        // Ужимаем окно так, чтобы подписи в строку не влезли: тогда каждая кнопка встаёт
        // на свою строку и там разворачивается во всю ширину. Ширина тут уже любого настоящего
        // телефона: «Готово» с «Отменой» коротки и на 320px стоят в строку свободно, — но
        // проверяется само правило, а не ширина, на которой оно срабатывает. Подписи в формах
        // ещё будут меняться, и переносить их по одной на строку слот обязан уметь всегда.
        await page.setViewportSize({ width: 240, height: 844 });
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
    // Кадр этот считается долей окна (min(300px, 40dvh)), а делится он ровно так же, как
    // на десктопе: 40% неба, 60% воды — при любой высоте окна и в любой раскладке.
    //
    // Своё правило тут было: воде отмеряли 165px, небу оставался остаток, но не меньше
    // шестидесяти. Оно и разводило две телефонные раскладки — в свёрнутом кадре неба
    // выходило 135px, в развёрнутом больше двух третей кадра, — а вместе с раскладками
    // разъезжались месяц, облака и снимок неба, каждый со своей телефонной поправкой.
    test('кадр на телефоне держит ту же пропорцию, что и на десктопе', async ({ page }) => {
        await openChannel(page, DEMO);
        const frames = await measureHeights(page, MOBILE_MAX_WIDTH - 90, [900, 700, 560, 440]);
        const [tall, high] = frames;

        // Кадр идёт за окном: ниже окно — ниже кадр, и мерка ему та же доля.
        expect(high.scene, 'кадр не пошёл вниз вместе с окном').toBeLessThan(tall.scene);
        // А внутри кадра доля неба одна на все высоты окна: обе половины идут вниз вместе.
        for (const frame of frames) {
            expect(frame.share, `в кадре на ${frame.height}px пропорция поехала`).toBeCloseTo(SKY_SHARE, 2);
        }
        expect(high.sea, 'вода не пошла вниз вместе с окном').toBeLessThan(tall.sea);
        expect(high.sky, 'небо не отдало кадр под чат').toBeLessThan(tall.sky);
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
        // Кадр на десктопе разделён раз и навсегда: 40% неба, 60% воды. Прежде здесь стояло
        // обратное — небу отдавали больше половины, — но тогда вода держалась своей пиксельной
        // нормы, и пропорция кадра выходила разной в свёрнутом и развёрнутом виде.
        expect(view.horizon / view.scene.height, 'небо на десктопе взяло не свою долю').toBeCloseTo(SKY_SHARE, 2);
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
    // и дальние линии оказывались на небе. Держится он теперь не тем, что вода не сжимается,
    // а тем, что концы рейда и берег приколочены к горизонту и к нижней кромке кадра и ужимаются
    // вместе с водой. Сама пропорция на десктопе неподвижна: 40 на 60 при любой высоте окна.
    test('кадр держит свою пропорцию, а рейд с берегом не съезжают на небо', async ({ page }) => {
        await openChannel(page, DEMO);
        const frames = await measureHeights(page, 1200, [900, 700, 500, 400]);

        // Доля неба одна на все высоты окна: обе половины кадра идут вниз вместе. Раньше вода
        // держалась своей нормы в пикселях, а небо отступало первым, — но с тех пор развёрнутый
        // кадр считает пропорцию долями, и два разных расклада на один десктоп разъезжались
        // на развороте (см. --horizon-to в SeaScene.module.less).
        for (const frame of frames) {
            expect(frame.share, `в кадре на ${frame.height}px пропорция поехала`).toBeCloseTo(SKY_SHARE, 2);
        }
        // И вода тут именно сжимается, а не стоит: кадр ниже — воды меньше.
        expect(frames[1].sea, 'вода не пошла вниз вместе с окном').toBeLessThan(frames[0].sea);
        expect(frames[1].sky, 'небо не отдало кадр под чат').toBeLessThan(frames[0].sky);

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
    //
    // Обе мерки на десктопной колонке сошлись почти в одну: блок контента шириной 744px даёт
    // форме 694 внутри, то есть 347 на половину, — и нижняя мерка перевешивает её на три
    // пикселя. Проверяется поэтому само правило, а не та его половина, которая сейчас победила.
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
        expect(field.width, 'поле позывного взяло не свою ширину').toBeCloseTo(Math.max(350, field.inner / 2), 0);
    });

    test('в форме кнопки делят ширину так же, как на телефоне', async ({ page }) => {
        await openChannel(page, DEMO);
        const bar = await actionsBar(page);
        expectBandLooksLikePanel(bar);
        expect(bar.buttons[0].width, 'одинокая кнопка не заняла ширину формы').toBeCloseTo(bar.width, 0);
    });
});

/**
 * Прилипание кнопок. Прилипают они всегда и на любом окне: отсечка по высоте тут была, пока
 * раскладок было шесть и на низком окне форме доставалась ладонь. Теперь рост блока контента
 * задаёт само приложение, и меньше своей мерки он не бывает, — а отсечка на границе давала
 * худшее из двух: кнопки то прилипали, то отлипали от пары пикселей высоты окна.
 */
test.describe('кнопки у нижней кромки', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('кнопка формы видна сразу и на высоком окне, и на низком', async ({ page }) => {
        await openChannel(page, DEMO);
        expect((await actionsBar(page)).position, 'кнопки не прилипли на высоком окне').toBe('sticky');
        await expect(page.locator('button[type=submit]'), 'прилипшая кнопка не видна').toBeInViewport();

        // Телефон на боку: окно ниже всего, что бывает, — и кнопка всё так же на виду.
        await page.setViewportSize({ width: 844, height: 390 });
        expect((await actionsBar(page)).position, 'на низком окне кнопки отлипли').toBe('sticky');
        await expect(page.locator('button[type=submit]'), 'на низком окне кнопка уехала под обрез').toBeInViewport();
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
 * долей воды, а сдвиг картинки — долей её собственной высоты, и высота эта идёт за шириной сцены.
 * Пока доля верна, одно гасит другое; наврали в доле — и остаток растёт вместе с экраном.
 * Так и было: 19px под горизонтом на десктопе против 22px на телефоне при одном заданном числе.
 *
 * Сравнивается это внутри своей раскладки, а не поперёк. Воды в кадре у телефона и десктопа
 * разное количество, и разметка рейда меряется у них разной нормой (@sea-height против всей
 * воды кадра), так что берег и правда стоит у них на разной глубине — 16px против 22px. От
 * ширины же экрана он не зависит ни там, ни там: это и есть та ошибка, ради которой всё
 * затевалось, и ловится она сравнением широкого кадра с узким при одной и той же высоте окна.
 */
test('берег острова стоит на горизонте, а не отъезжает от него вместе с шириной экрана', async ({ page }) => {
    await openChannel(page, DEMO);

    // Замер после перемены окна — только когда кадр устоялся: и горизонт, и высота воды едут
    // переходом (@expand-seconds), а берег стоит по одному, меряется по другому, и на ходу
    // они не сходятся.
    const afterResize = async (width: number, height: number): Promise<number> => {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(600);
        return islandBelowHorizon(page);
    };

    const wide = await afterResize(1200, 900);
    expect(wide, 'берег вылез на небо').toBeGreaterThan(0);
    expect(wide, 'берег уехал от горизонта на середину рейда').toBeLessThan(30);
    expect(await afterResize(600, 900), 'в узкой колонке берег отошёл от горизонта').toBeCloseTo(wide, 0);

    const phone = await afterResize(MOBILE_MAX_WIDTH - 90, 844);
    expect(phone, 'на телефоне берег вылез на небо').toBeGreaterThan(0);
    expect(phone, 'на телефоне берег уехал от горизонта на середину рейда').toBeLessThan(30);
    expect(await afterResize(330, 844), 'в узком телефонном кадре берег отошёл от горизонта').toBeCloseTo(phone, 0);
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
 * Две раскладки. В «больше контента» сжат кадр — приложение держит колонку в 760px, и выбирать
 * в таком кадре место на рейде тесно: отметки стоят близко, на телефоне попасть в нужную
 * трудно. В «больше сцены» сжат блок контента, а кадр забирает остаток окна и раздаётся
 * во всю его ширину; та же геометрия рейда раскладывается на весь этот простор.
 *
 * Меряются здесь четыре обещания: кадр вырос до окна и вернулся обратно; блок контента ужался
 * до своей мерки; ширина блока при этом не менялась вовсе — раздаётся только кадр; шапка
 * выросла вместе с ним, а разговор в сжатом блоке остался читаемым.
 */
const sceneBox = async (page: Page): Promise<{ width: number; height: number }> => {
    const box = await page.locator('[class*="scene"]').first().boundingBox();
    return { width: Math.round(box!.width), height: Math.round(box!.height) };
};

/** Блок контента: разговор с формой корабля поверх него. Он же — второй участник обеих раскладок. */
const contentBox = async (page: Page): Promise<{ width: number; height: number; left: number; top: number }> => {
    const box = await page.locator('main').boundingBox();
    return {
        width: Math.round(box!.width),
        height: Math.round(box!.height),
        left: Math.round(box!.x),
        top: Math.round(box!.y),
    };
};

/** Ширина кнопки в шапке: на укрупнённой раскладке круг больше. */
const buttonWidth = async (page: Page): Promise<number> => {
    const box = await page.getByRole('button', { name: 'Корабли на связи' }).boundingBox();
    return Math.round(box!.width);
};

test('раскладка переключается: кадр раздаётся во всё окно, а блок контента сжимается', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const window = page.viewportSize()!;
    const small = await sceneBox(page);
    const roomy = await contentBox(page);
    expect(small.width, 'кадр и в сжатой раскладке во всю ширину окна').toBeLessThan(window.width);
    // Ширина блока отмерена от окна, а не от приложения: вся колонка целиком, от края до края.
    expect(roomy.width, 'блок контента взял не ширину колонки').toBe(Math.min(window.width, COLUMN_WIDTH));
    // И до нижней кромки окна тоже: поля вокруг блока нет ни с боков, ни снизу.
    expect(roomy.top + roomy.height, 'блок контента не дошёл до нижней кромки окна').toBe(window.height);
    // Скруглены и обведены только верхние углы: блок не плашка на воде, а начало нижней
    // половины экрана.
    const corners = await page.locator('main').evaluate((node) => {
        const style = getComputedStyle(node);
        return {
            top: [style.borderTopLeftRadius, style.borderTopRightRadius],
            bottom: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
            borders: [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth],
        };
    });
    expect(corners.top, 'верхние углы блока контента не скруглены').toEqual(['16px', '16px']);
    expect(corners.bottom, 'нижние углы блока контента скруглены, а не доходят до кромки').toEqual(['0px', '0px']);
    expect(corners.borders, 'рамка стоит не только сверху').toEqual(['1px', '0px', '0px', '0px']);
    const smallButton = await buttonWidth(page);

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    // Переключение плавное, и сразу после нажатия кадр ещё в пути. Ждём не срок, а конец
    // перехода: размер перестаёт меняться сам, когда кадр дошёл до окна.
    await expect
        .poll(async () => (await sceneBox(page)).width, { message: 'кадр не разошёлся на всю ширину окна' })
        .toBe(window.width);

    const tight = await contentBox(page);
    // Сжатому блоку на десктопе достаётся своя мерка, чуть больше общей: на широком окне
    // реплики стоят по краям, и те же три сообщения с полем ввода просят больше высоты.
    expect(tight.height, 'блок контента ужался не до своей мерки').toBe(
        Math.min(CONTENT_DESKTOP_HEIGHT, Math.round(window.height * 0.6))
    );
    // Ширина блока при переключении не меняется вовсе — ни сама, ни местом на экране.
    expect(tight.width, 'блок контента поехал в ширину вслед за кадром').toBe(roomy.width);
    expect(tight.left, 'блок контента съехал вбок').toBe(roomy.left);
    // Кадр забрал ровно остаток окна, заехав блоку под верхнюю кромку на @content-overlap.
    expect((await sceneBox(page)).height, 'кадр занял не тот остаток окна').toBe(
        window.height - tight.height + CONTENT_OVERLAP
    );
    expect(await buttonWidth(page), 'кнопки в шапке остались прежними').toBeGreaterThan(smallButton);

    // Большой кадр не съедает остальное: разговор никуда не делся, и поле ввода из сжатого
    // блока видно сразу, без единого движения.
    await expect(page.getByPlaceholder('Сообщение'), 'в сжатом блоке не осталось разговора').toBeVisible();

    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await expect
        .poll(async () => (await sceneBox(page)).width, { message: 'кадр не вернулся в колонку' })
        .toBe(small.width);
    expect(await contentBox(page), 'блок контента вернулся не туда, где стоял').toEqual(roomy);
    expect(await buttonWidth(page), 'кнопки в шапке остались крупными').toBe(smallButton);
});

/**
 * Свайп по кадру: провести пальцем и получить ту же смену раскладки, что и кнопкой.
 *
 * Дальше по нему проверяется и обратное — что чужие движения кадр не забирает. Поэтому
 * возвращается не «сработало ли», а отменено ли движение пальца: именно отмена запрещает
 * браузеру тянуть страницу к обновлению, и на чужом жесте её быть не должно.
 */
const swipeScene = (page: Page, by: number): Promise<boolean> =>
    page.evaluate((shift) => {
        const node = document.querySelector('[class*="scene"]')!;
        const box = node.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        const at = (offset: number) => {
            const touch = new Touch({ identifier: 1, target: node, clientX: x, clientY: y + offset });
            return { touches: [touch], targetTouches: [touch], changedTouches: [touch] };
        };
        const options = { bubbles: true, cancelable: true };
        node.dispatchEvent(new TouchEvent('touchstart', { ...options, ...at(0) }));
        // Шагами, а не одним прыжком: жест опознаётся по первым миллиметрам, и одно движение
        // сразу на всю длину прошло бы мимо этого разбора.
        let prevented = false;
        for (const share of [0.25, 0.5, 0.75, 1]) {
            const step = new TouchEvent('touchmove', { ...options, ...at(Math.round(shift * share)) });
            prevented = !node.dispatchEvent(step) || prevented;
        }
        node.dispatchEvent(new TouchEvent('touchend', { ...options, ...at(shift), touches: [] }));
        return prevented;
    }, by);

/**
 * Свайп по кадру меняет раскладку — и только в свою сторону. Сторона на каждую раскладку
 * своя: сжатый кадр раздаётся движением вниз, раздутый сжимается движением вверх — палец
 * ведёт нижнюю кромку кадра туда, куда она и поедет.
 *
 * Обратное движение кадр не забирает, и это здесь половина проверки: на нём браузер тянет
 * страницу к обновлению, и перехваченным оказался бы заодно и этот жест.
 */
test('свайп по кадру меняет раскладку в свою сторону, а обратное движение отдаёт системе', async ({ page }) => {
    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await openChannel(page, DEMO, ALBATROS);
    const compact = Math.min(COMPACT_HEIGHT, Math.round(phone.height * 0.4));
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр встал не в свою сжатую мерку' })
        .toBe(compact);

    // Вверх по сжатому кадру — чужое движение: раскладка на месте, отмены нет.
    expect(await swipeScene(page, -120), 'кадр отменил чужое движение пальца').toBe(false);
    await page.waitForTimeout(400);
    expect((await sceneBox(page)).height, 'кадр раздался от чужого движения').toBe(compact);

    // Вниз — своё: кадр раздаётся, и потяг страницы к обновлению на нём запрещён.
    expect(await swipeScene(page, 120), 'кадр не отменил своё движение пальца').toBe(true);
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр не раздался от свайпа вниз' })
        .toBe(phone.height - Math.min(COMPACT_HEIGHT, Math.round(phone.height * 0.6)) + CONTENT_OVERLAP);

    // И обратно: по раздутому кадру своё движение — вверх.
    expect(await swipeScene(page, 120), 'раздутый кадр забрал движение вниз').toBe(false);
    expect(await swipeScene(page, -120), 'кадр не отменил своё движение пальца').toBe(true);
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр не сжался от свайпа вверх' })
        .toBe(compact);

    // Короткое движение — не свайп: так кадр возит палец, который просто ткнули мимо корабля.
    expect(await swipeScene(page, 24), 'короткий свайп сменил раскладку').toBe(true);
    await page.waitForTimeout(400);
    expect((await sceneBox(page)).height, 'кадр раздался от короткого движения').toBe(compact);
});

/**
 * Смена раскладки — движение вниз, а не прыжок вверх и обратно. Держится это на двух вещах.
 *
 * Первая: --scene-height объявлена длиной (@property в index.less) и потому переходит
 * во времени. Пока она менялась скачком, коробка шапки ехала своим переходом, а всё, что
 * от этой мерки отмерено, вставало в конечное значение первым же кадром — и море под сценой
 * полперехода не доставало до блока контента, отчего в прогалине светился фон чата.
 *
 * Вторая: сама сцена в развёрнутом кадре считается другими правилами (см. .sceneFull), и её
 * мерки — горизонт, вода под ним, месяц, отметки — переходят каждая сама, теми же секундами
 * и той же кривой. Без этого смена класса в один кадр поднимала горизонт на полсотни пикселей,
 * а месяц вместе с ним уходил под верхнюю кромку и менялся в размере.
 *
 * Проверяем поэтому не одну мерку, а всё, что должно ехать вместе, и в обе стороны: кадр,
 * линию воды, месяц и его диск. Порознь каждая из них выглядела бы правильной — расходились
 * они именно между собой.
 */
test('смена раскладки растекается, а не прыгает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Замер идёт покадрово и изнутри страницы: снаружи каждый заход стоит миллисекунд, и весь
    // переход в четыре десятых секунды успел бы кончиться за три замера.
    const record = (label: string) =>
        page.evaluate(async (name) => {
            const probe = () => {
                const moon = document.querySelector('[class*="moon_"]')!.getBoundingClientRect();
                return {
                    header: document.querySelector('header')!.getBoundingClientRect().height,
                    sea: document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top,
                    moon: moon.top,
                    disc: moon.height,
                };
            };
            const taken = [probe()];
            document.querySelector<HTMLElement>(`[aria-label="${name}"]`)!.click();
            await new Promise<void>((resolve) => {
                const tick = (): void => {
                    taken.push(probe());
                    if (taken.length < 40) {
                        requestAnimationFrame(tick);
                    } else {
                        resolve();
                    }
                };
                requestAnimationFrame(tick);
            });
            return taken;
        }, label);

    // Каждая мерка идёт подряд в одну сторону, без возвратов. Допуск в полпикселя — на дробную
    // высоту и округление разметки, а не на движение: прыжки, которые ловит проверка, были
    // в десятки пикселей.
    const SLACK = 0.5;
    const monotone = (values: number[], up: boolean): boolean =>
        values.every((value, i) => i === 0 || (up ? value >= values[i - 1] - SLACK : value <= values[i - 1] + SLACK));
    const check = (frames: Awaited<ReturnType<typeof record>>, up: boolean): void => {
        const names = ['header', 'sea', 'moon', 'disc'] as const;
        for (const name of names) {
            const values = frames.map((frame) => frame[name]);
            expect(monotone(values, up), `${name}: движение с возвратом`).toBe(true);
        }
    };

    const out = await record('Развернуть сцену');
    expect(out[out.length - 1].header, 'сцена не дошла до полного экрана').toBeGreaterThan(out[0].header * 1.4);
    check(out, true);

    const back = await record('Свернуть сцену');
    expect(back[back.length - 1].header, 'сцена не вернулась в колонку').toBeLessThan(back[0].header * 0.6);
    check(back, false);
});

/** То же число, что @haze-height в стилях сцены: рост полоски дымки над водой, px. */
const HAZE_HEIGHT = 72;

/**
 * Дымка над водой: полоска, гасящая звёзды у горизонта. Проверяем не красоту, а два числа,
 * на которых она держится, — рост и место: ровно над линией воды и одной высоты в любом кадре.
 */
test('дымка стоит над водой полоской в семьдесят два пикселя', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    const measure = () =>
        page.evaluate(() => {
            const haze = document.querySelector('[class*="haze"]')!.getBoundingClientRect();
            const sea = document.querySelector('[class*="_sea_"]')!.getBoundingClientRect();
            return { height: haze.height, gap: haze.bottom - sea.top };
        });

    const small = await measure();
    expect(small.height, 'дымка не в семьдесят два пикселя').toBe(HAZE_HEIGHT);
    expect(Math.abs(small.gap), 'дымка не лежит на линии воды').toBeLessThan(1);

    // На весь экран рост тот же: это слой воздуха у воды, а не часть рисунка, которую
    // перспектива тянет вместе с кадром.
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await measure()).height, { message: 'дымка выросла вместе с кадром' })
        .toBe(HAZE_HEIGHT);
    expect(Math.abs((await measure()).gap), 'дымка сошла с линии воды').toBeLessThan(1);
});

/**
 * Главный случай большого кадра — форма настройки корабля: место на рейде выбирают именно там.
 * Раскладка одна на всё приложение, поэтому с формой она не сбрасывается, а отметки свободных
 * мест разъезжаются вместе с кадром — ровно ради этого всё и затевалось.
 */
const berthSpan = (page: Page): Promise<number> =>
    page.evaluate(() => {
        const marks = [...document.querySelectorAll('[data-berth]')].map((el) => el.getBoundingClientRect());
        const top = Math.min(...marks.map((mark) => mark.top));
        const bottom = Math.max(...marks.map((mark) => mark.bottom));
        return bottom - top;
    });

test('на форме настройки корабля большой кадр разводит отметки мест', async ({ page }) => {
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
    // Форма никуда не делась и работает: она в блоке контента под кадром, и место в ней
    // выбирается.
    await marks.first().click();
    await expect(page.getByRole('button', { name: 'Готово' }), 'форма потерялась вместе с раскладкой').toBeVisible();
});

/**
 * Шторка. Она одна на всё приложение, и в ней список кораблей: открыта или закрыта, третьего
 * положения нет. Ступеней, щёлки и второго этажа больше не существует — вместе с ними ушла
 * и вся арифметика, которую они за собой тянули.
 *
 * Обещаний у неё пять, и все проверяются ниже: рост по содержимому с потолком в окно за вычетом
 * шапки; ширина уже блока контента на десктопе и во весь экран на телефоне; затемнение под ней
 * всегда; выходов три — крестик, нажатие мимо и потяг вниз; и разговор под ней остаётся
 * собранным.
 */
const MEMBERS_SHADE = 'Корабли на связи';

const shadeRegion = (page: Page) => page.getByRole('region', { name: MEMBERS_SHADE });

const shadeBox = async (page: Page) => {
    const box = await shadeRegion(page).boundingBox();
    return { top: Math.round(box!.y), height: Math.round(box!.height), width: Math.round(box!.width), left: box!.x };
};

/**
 * Список кораблей внутри шторки. Через саму шторку, а не по имени класса: `.list` есть
 * и у ленты сообщений, и в разметке она стоит первой.
 */
const SHEET_LIST = '[class*="shade_"] [class*="list_"]';

/**
 * Развесить список так, чтобы он перестал помещаться в окно: строчки размножаются копиями
 * последней. Кораблей в демо-канале трое, и заводить полсотни настоящих ради проверки роста
 * шторки незачем — правило тут про высоту содержимого, а не про то, откуда оно взялось.
 */
const growSheetList = (page: Page): Promise<void> =>
    page.evaluate((selector) => {
        const list = document.querySelector(selector)!;
        const row = list.lastElementChild!;
        for (let i = 0; i < 40; i++) {
            list.append(row.cloneNode(true));
        }
    }, SHEET_LIST);

/** Потянуть от точки вниз на `by` пикселей и отпустить. */
const dragAt = async (page: Page, x: number, y: number, by: number): Promise<void> => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Шагами, а не прыжком: перетаскивание считается по pointermove, и одного события
    // хватило бы шторке, но не браузеру — он на прыжок курсора отвечает не всегда.
    await page.mouse.move(x, y + by, { steps: 12 });
    await page.mouse.up();
};

/** Потянуть за середину блока: за ручку, за заголовок — за что дали. */
const dragBox = (page: Page, box: { x: number; y: number; width: number; height: number }, by: number) =>
    dragAt(page, box.x + box.width / 2, box.y + box.height / 2, by);

/**
 * Рост шторки задаёт её содержимое, а не мерка: короткий список показан коротким блоком,
 * и снизу под ним ничего не остаётся. Потолок один — окно за вычетом полоски шапки, которую
 * отдавать нельзя: кнопками из неё шторка и открывается.
 *
 * Проверяется и то и другое: троим кораблям до потолка далеко, а полусотне — некуда, и там
 * шторка упирается в него и мотается внутри сама.
 */
test('шторка ростом по содержимому и не выше окна за вычетом шапки', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const window = page.viewportSize()!;
    const short = await shadeBox(page);
    expect(short.top + short.height, 'шторка не дошла до нижней кромки окна').toBe(window.height);
    expect(short.height, 'короткий список растянулся до потолка').toBeLessThan(window.height - SHEET_TOP_GAP);
    // Список кончается там же, где и шторка: пустого поля под последней строкой нет.
    const rows = page.locator('[class*="row_"], [class*="rowActive"]');
    const lastRow = (await rows.last().boundingBox())!;
    expect(short.top + short.height - (lastRow.y + lastRow.height), 'под списком осталось пустое поле').toBeLessThan(
        60
    );

    // Длинный список упирается в потолок и мотается внутри себя.
    await growSheetList(page);
    await expect
        .poll(async () => (await shadeBox(page)).height, { message: 'длинный список не упёрся в потолок' })
        .toBe(window.height - SHEET_TOP_GAP);
});

/**
 * Ширина шторки. На десктопе она чуть уже блока контента и стоит по центру: шторка приезжает
 * поверх него, и по краям должно быть видно, что под ней что-то есть. На телефоне предел
 * ни на что не влияет — там окно и так уже колонки.
 */
test('шторка на десктопе уже блока контента и по центру, а на телефоне во всю ширину', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const window = page.viewportSize()!;
    const desk = await shadeBox(page);
    expect(desk.width, 'шторка на десктопе взяла не свою ширину').toBe(SHEET_WIDTH);
    expect(desk.width, 'шторка не уже блока контента').toBeLessThan((await contentBox(page)).width);
    expect(Math.round(desk.left + desk.width / 2), 'шторка встала не по центру окна').toBe(window.width / 2);

    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await expect
        .poll(async () => (await shadeBox(page)).width, { message: 'на телефоне шторка не во всю ширину' })
        .toBe(phone.width);
});

/**
 * Затемнение под шторкой есть всегда: выбирать под ней нечего — сцена в этот момент только фон,
 * а нажатие мимо означает «убери». Шапка при этом остаётся нажимаемой: она лежит выше шторки
 * и затемнения, и кнопками из неё шторка и закрывается.
 */
test('под шторкой всегда затемнение, а шапка над ним остаётся нажимаемой', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const layers = await page.evaluate(() => {
        const zIndex = (node: Element) => Number(getComputedStyle(node).zIndex);
        return {
            backdrop: zIndex(document.querySelector('[class*="backdrop"]')!),
            shade: zIndex(document.querySelector('[class*="shade_"]')!),
            header: zIndex(document.querySelector('[class*="headerBar"]')!),
        };
    });
    expect(layers.backdrop, 'затемнение легло поверх шторки').toBeLessThan(layers.shade);
    expect(layers.shade, 'шторка накрыла шапку, которой её закрывают').toBeLessThan(layers.header);

    // Кнопка списка в шапке доступна и с открытой шторкой: ею список и закрывают обратно.
    await page.getByRole('button', { name: 'Вернуться к разговору' }).click();
    await expect(shadeRegion(page), 'кнопка шапки не закрыла шторку').toHaveCount(0);
});

/**
 * Выходов из шторки три: крестик в верхнем углу, нажатие мимо и потяг вниз. Тянут за любое
 * место, у которого нет своей прокрутки и которое не текстовое поле, — попадать пальцем
 * в полоску шириной в палец занятие для тех, кому некуда спешить.
 *
 * Потяг закрывает не всякий: утянул больше трети высоты — закрылась, меньше — вернулась.
 * Короткий рывок вниз бывает и промахом.
 */
test('шторку закрывают крестиком, нажатием мимо и потягом вниз, а коротким рывком — нет', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    await openSheet(page);
    await shadeRegion(page).getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(shadeRegion(page), 'крестик не закрыл шторку').toHaveCount(0);

    // Точка у левого края: мимо шторки она наверняка — шторка держит середину окна.
    await openSheet(page);
    await page.mouse.click(60, 300);
    await expect(shadeRegion(page), 'нажатие мимо не закрыло шторку').toHaveCount(0);

    // Заголовок списка — то самое «любое место»: своей прокрутки у него нет.
    await openSheet(page);
    const before = await shadeBox(page);
    const title = page.getByText('На связи', { exact: true });
    await dragBox(page, (await title.boundingBox())!, Math.round(before.height * 0.2));
    await expect(shadeRegion(page), 'короткий рывок закрыл шторку').toHaveCount(1);
    await expect
        .poll(async () => (await shadeBox(page)).top, { message: 'шторка не вернулась на место после рывка' })
        .toBe(before.top);

    await dragBox(page, (await title.boundingBox())!, Math.round(before.height * 0.6));
    await expect(shadeRegion(page), 'потяг вниз не закрыл шторку').toHaveCount(0);
});

/**
 * Прокрутка главнее потяга: список и всё, что мотается само, обязаны мотаться, а не превращать
 * движение пальца в закрытие. Колесом же шторка не двигается вовсе — прежде накрученное
 * переставляло её на соседнюю ступень, но ступеней больше нет, а закрывать список случайной
 * прокруткой мыши над ним — худшее, что можно сделать с содержимым, которое человек читает.
 */
test('над своей прокруткой шторка не тянется, а колесо её не трогает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    // Список длиннее шторки: иначе мотать нечего и правило не на чем проверить.
    await growSheetList(page);
    const before = await shadeBox(page);

    const list = page.locator(SHEET_LIST);
    const box = (await list.boundingBox())!;
    await dragAt(page, box.x + box.width / 2, box.y + 40, Math.round(before.height * 0.6));
    await expect(shadeRegion(page), 'потяг по списку закрыл шторку вместо прокрутки').toHaveCount(1);

    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.wheel(0, 400);
    await expect
        .poll(() => list.evaluate((node) => Math.round(node.scrollTop)), {
            message: 'колесо над списком не смотало его',
        })
        .toBeGreaterThan(0);
    expect((await shadeBox(page)).top, 'колесо сдвинуло шторку').toBe(before.top);
});

/** Сила полоски у верхней кромки: 0 — её нет вовсе, 1 — стоит в полную. */
const fadeStrength = (page: Page, inside: 'shade' | 'content'): Promise<number> =>
    (inside === 'shade' ? shadeRegion(page) : page.locator('main'))
        .locator('[class*="fade"]')
        .first()
        .evaluate((node) => Number(getComputedStyle(node).opacity));

/**
 * Полоска у верхней кромки, под которую уходит прокручиваемое. Без неё содержимое обрывается
 * по кромке ровной линией: реплика срезана пополам, и срез читается краем разметки, а не
 * продолжением списка.
 *
 * Полоска одна на всех (`ui/TopFade`) — и в блоке контента, и в шторке, — поэтому проверяется
 * её правило, а не сам градиент: под уехавшим содержимым она в полную силу, домотали до верха
 * — её нет, а мотать нечего — нет и подавно.
 */
test('содержимое уходит под полоску, а домотанное до верха её убирает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    // Раскладка «больше сцены»: в сжатый блок вся лента не помещается, и ей есть куда уходить.
    // В просторной семь демо-реплик влезают целиком, и полоске там взяться неоткуда — это
    // не поломка, а то же самое правило.
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();

    // Лента открывается низом, на последней реплике: старое уже ушло под кромку.
    await expect
        .poll(() => fadeStrength(page, 'content'), { message: 'под уехавшей лентой полоски нет' })
        .toBeGreaterThan(0.9);

    const feed = page.locator('[class*="dateChip"]').locator('xpath=..');
    await feed.evaluate((node) => {
        node.scrollTop = 0;
    });
    await expect
        .poll(() => fadeStrength(page, 'content'), { message: 'в начале ленты полоска осталась висеть' })
        .toBeLessThan(0.05);

    // В шторке та же полоска и то же правило. Трём кораблям в ней тесно не бывает: мотать
    // нечего, и полоске взяться неоткуда.
    await openSheet(page);
    expect(await fadeStrength(page, 'shade'), 'полоска встала над списком, который весь на виду').toBe(0);
});

/**
 * Шторка приезжает поверх разговора, а не встаёт на его место. Прежде список подменял собой
 * содержимое, и разговор при этом собирался заново: набранное в поле, место прокрутки ленты
 * и выделение уезжали вместе с ним.
 *
 * То же обещание и у формы своего корабля: она выезжает поверх разговора внутри того же блока
 * контента, и разговор под ней остаётся собранным.
 *
 * Проверяется поэтому не «текст на месте» (его можно было бы и сохранить снаружи), а что поле
 * — тот же самый узел: всё остальное живёт в нём и уцелеет вместе с ним.
 */
test('шторка и форма корабля приезжают поверх разговора, не разбирая его', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    const input = page.getByPlaceholder('Сообщение');
    await input.fill('недописанное');
    // Метка прямо на узле: заново созданное такое же поле её не унаследует.
    await input.evaluate((node) => node.setAttribute('data-probe', 'тот же самый'));

    await openSheet(page);
    // Кнопка в шапке на время списка меняется на облачко разговора: она же и возвращает назад.
    await expect(
        page.getByRole('button', { name: 'Корабли на связи' }),
        'кнопка списка осталась кнопкой списка'
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Вернуться к разговору' }).click();
    await expect(input, 'разговор пересобрался под шторкой: поле стало другим узлом').toHaveAttribute(
        'data-probe',
        'тот же самый'
    );

    // Форма корабля — тем же движением и с тем же обещанием.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.getByRole('button', { name: 'Готово' }), 'форма корабля не выехала').toBeVisible();
    // Пока форма открыта, в шапке на месте списка стоит выход с рейда: это второе, что делают
    // с собственным кораблём.
    await expect(page.getByRole('button', { name: 'Уйти с рейда' }), 'в шапке не появился выход с рейда').toBeVisible();
    await expect(page.getByRole('button', { name: 'Корабли на связи' }), 'кнопка списка осталась').toHaveCount(0);

    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(input, 'разговор пересобрался под формой: поле стало другим узлом').toHaveAttribute(
        'data-probe',
        'тот же самый'
    );
    await expect(input, 'набранное в поле пропало').toHaveValue('недописанное');
});

/**
 * Орион — единственный узнаваемый узор на небе, и стоит он в кадре на своём месте: правее
 * середины, выше половины неба, подальше от месяца. Место это держится двумя числами разом —
 * долей, на которой созвездие стоит в самой картинке (её задаёт подготовка ассета), и сдвигом
 * полосы в стилях, — поэтому проверяется оно на экране, а не в любом из двух по отдельности.
 *
 * Второе условие важнее первого: Орион обязан быть в кадре ровно один. Плитки неба одинаковы
 * и лежат в ряд, и стоит плитке стать уже кадра — созвездие задвоится, а задвоенный узор
 * читается сразу, в отличие от любого другого куска звёздного неба. Это проверяется во всех
 * четырёх кадрах.
 *
 * А вот по вертикали — только в развёрнутых. Снимок неба стоит от горизонта одним масштабом
 * на окно (см. --sky-reach), и свёрнутому кадру достаётся его нижняя полоса — засветка
 * у воды, выше которой начинаются звёзды. Орион там оказывается над верхней кромкой кадра,
 * и это не поломка, а та самая неподвижность неба: разворот не пересчитывает снимок,
 * а открывает то, что было отмерено, — созвездие выходит из-за кромки на своё место.
 */
// Где Орион стоит в картинке — доли её ширины и высоты. Числа держит подготовка ассета,
// см. SKY_ORION_PLACE в tools/scene-assets/prepare-backgrounds.py.
const ORION_IN_TILE = { x: 0.4333, y: 0.3966 };

test('Орион стоит в кадре на своём месте и ровно один', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    const orions = () =>
        page.evaluate((orion: { x: number; y: number }) => {
            const sky = document.querySelector('[class*="sky_"]')!.getBoundingClientRect();
            return (
                [...document.querySelectorAll('[class*="skyTile"]')]
                    .map((tile) => tile.getBoundingClientRect())
                    .map((tile) => ({
                        x: ((tile.left + orion.x * tile.width - sky.left) / sky.width) * 100,
                        y: ((tile.top + orion.y * tile.height - sky.top) / sky.height) * 100,
                    }))
                    // Только те, что попали в кадр: остальные плитки закрывают его по краям.
                    .filter((spot) => spot.x > 0 && spot.x < 100)
            );
        }, ORION_IN_TILE);

    // Кадры разной пропорции: широкий и низкий (там плитка меряется по ширине кадра) и узкий
    // и высокий (там — по пределу роста неба, иначе картинка не накрыла бы небо сверху).
    const measure = async (frame: { width: number; height: number }, full: boolean) => {
        const size = `${frame.width}×${frame.height}${full ? ', во весь экран' : ''}`;
        await page.setViewportSize(frame);
        await page.getByRole('button', { name: full ? 'Развернуть сцену' : 'Свернуть сцену' }).click();
        await expect(page.getByRole('button', { name: full ? 'Свернуть сцену' : 'Развернуть сцену' })).toBeVisible();
        // Ждём весь ответ целиком, а не одно число из него: высота сцены едет полсекунды,
        // и замер посреди перехода поймал бы небо не той высоты.
        await expect
            .poll(
                async () => {
                    const spots = await orions();
                    if (spots.length !== 1) {
                        return `Орионов в кадре ${spots.length}`;
                    }
                    const x = Math.round(spots[0].x);
                    const y = Math.round(spots[0].y);
                    if (x < 70 || x > 83) {
                        return `уехал по горизонтали: ${x}%`;
                    }
                    // В свёрнутом кадре созвездие стоит выше видимой полосы неба — там и должно.
                    if (full && (y < 15 || y > 50)) {
                        return `уехал по вертикали: ${y}%`;
                    }
                    if (!full && y > 0) {
                        return `в свёрнутом кадре опустился в кадр: ${y}%`;
                    }
                    return 'на месте';
                },
                { message: `${size}: Орион` }
            )
            .toBe('на месте');
    };

    await [
        { frame: { width: 1200, height: 900 }, full: true },
        { frame: { width: 1200, height: 900 }, full: false },
        { frame: { width: 390, height: 844 }, full: true },
        { frame: { width: 390, height: 844 }, full: false },
    ].reduce(async (before, step) => {
        await before;
        return measure(step.frame, step.full);
    }, Promise.resolve());
});

/**
 * Небо и вода собраны одинаково: полоса из трёх плиток, у воды соседние ещё и зеркальны.
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

// Те же числа, что и в стилях сцены: @sky-drop, @sky-image-drop и @moon-above-share.
// Достать их оттуда нечем — проверки стилей не собирают, — поэтому они здесь повторены.
const SKY_DROP = 30;
const SKY_IMAGE_DROP = 0.1;
const MOON_ABOVE_SHARE = 0.42;

/**
 * Всё, что стоит на небе, — мерками от горизонта, px. Мерка одна на всех, потому что опора
 * одна: небо привязано к воде и, сжимаясь, обрезается сверху, — и звёзды, и месяц, и облака
 * держатся линии воды, а не верхней кромки кадра.
 */
const skyFrame = (page: Page) =>
    page.evaluate(() => {
        const box = (selector: string): DOMRect => document.querySelector(selector)!.getBoundingClientRect();
        const scene = box('[class*="scene_"]');
        const horizon = box('[class*="sea_"]').top;
        const tile = box('[class*="skyTile"]');
        const moon = box('[class*="moon_"]');
        return {
            sceneHeight: Math.round(scene.height),
            /** Высота неба в кадре — от верхней кромки до линии воды. */
            skyHeight: Math.round(horizon - scene.top),
            /** Насколько низ снимка неба ушёл ниже горизонта: снимок прижат к нему и опущен. */
            photoBelow: Math.round(tile.bottom - horizon),
            photoHeight: Math.round(tile.height),
            moonTop: Math.round(moon.top - scene.top),
            moonAbove: Math.round(horizon - moon.bottom),
            cloudFar: Math.round(horizon - box('[class*="cloudFar"]').bottom),
            cloudNear: Math.round(horizon - box('[class*="cloudNear"]').bottom),
        };
    });

/** Кадр заданного размера, свёрнутый или развёрнутый, — и замер неба в нём. */
const skyIn = async (page: Page, frame: { width: number; height: number }, full: boolean) => {
    await page.setViewportSize(frame);
    const switcher = page.getByRole('button', { name: full ? 'Развернуть сцену' : 'Свернуть сцену' });
    if (await switcher.isVisible()) {
        await switcher.click();
    }
    await expect(page.getByRole('button', { name: full ? 'Свернуть сцену' : 'Развернуть сцену' })).toBeVisible();
    // Горизонт едет @expand-seconds, и всё, что от него отмерено, едет вместе с ним: замер
    // посреди перехода поймал бы небо не на своём месте.
    await page.waitForTimeout(700);
    return skyFrame(page);
};

/** Четыре раскладки разом: десктоп и телефон, свёрнутая сцена и развёрнутая. */
const skyFrames = async (page: Page) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await openChannel(page, DEMO, ALBATROS);
    // Цепочкой, а не циклом: окно одно, раскладки примеряются по очереди.
    const desk = await skyIn(page, { width: 1200, height: 900 }, false);
    const deskFull = await skyIn(page, { width: 1200, height: 900 }, true);
    const phone = await skyIn(page, { width: 390, height: 844 }, false);
    const phoneFull = await skyIn(page, { width: 390, height: 844 }, true);
    return { desk, deskFull, phone, phoneFull };
};

/**
 * Небо опущено к воде — и месяц вместе с ним: он стоит на этом же небе, и уехать от него
 * не должен. Телефон не в счёт по сдвигу: неба в свёрнутом кадре полоса в 120px, и тридцать
 * пикселей съели бы четверть её. Сдвиг там нулевой в обеих раскладках — разворот его
 * не добавляет, иначе звёзды переезжали бы на глазах.
 *
 * А вот месяц отмерен одинаково везде — долей неба от линии воды, все четыре раскладки
 * по одному правилу. Своего отсчёта у телефона больше нет: он был от строки состояния,
 * и месяц там стоял на месте, пока разворот открывал под ним небо. Теперь месяц едет вместе
 * с горизонтом: тесный кадр срезает его верхней кромкой заодно со звёздами, развёрнутый —
 * показывает целиком.
 *
 * Проверяется отношение, а не место снимка в кадре: низ его лежит ниже горизонта на свою
 * десятую долю (запас, из-за которого у самой воды остаётся дымка) плюс общий сдвиг. Само
 * место в кадре ни о чём не говорит — высота снимка считается по двум разным правилам,
 * см. --sky-tile.
 */
test('небо опущено к воде, а месяц во всех раскладках стоит на своей доле неба', async ({ page }) => {
    const frames = await skyFrames(page);

    const expectDropped = (frame: Awaited<ReturnType<typeof skyFrame>>, drop: number, label: string): void => {
        const expected = frame.photoHeight * SKY_IMAGE_DROP + drop;
        // Пиксель допуска: и высота снимка, и его кромка меряются с дробями.
        expect(Math.abs(frame.photoBelow - expected), `${label}: небо стоит не на своей высоте`).toBeLessThanOrEqual(1);
    };

    expectDropped(frames.desk, SKY_DROP, 'десктоп');
    expectDropped(frames.deskFull, SKY_DROP, 'десктоп во весь экран');
    expectDropped(frames.phone, 0, 'телефон, свёрнутая сцена');
    expectDropped(frames.phoneFull, 0, 'телефон во весь экран');

    // Высота месяца над водой — доля неба, а не пиксели и не доля кадра: в каждом виде своя
    // высота неба, и месяц стоит на той же её части. Мерка одна на все четыре раскладки —
    // отдельного телефонного отсчёта тут нет и быть не должно.
    for (const [label, frame] of [
        ['десктоп', frames.desk],
        ['десктоп во весь экран', frames.deskFull],
        ['телефон, свёрнутая сцена', frames.phone],
        ['телефон во весь экран', frames.phoneFull],
    ] as const) {
        const expected = frame.skyHeight * MOON_ABOVE_SHARE;
        expect(Math.abs(frame.moonAbove - expected), `${label}: месяц стоит не на своей доле неба`).toBeLessThanOrEqual(
            1
        );
    }

    // Следствие того же правила, и ради него оно и заведено: разворот открывает небо — значит,
    // месяц поднимается над водой выше. Прежде на телефоне было наоборот: месяц был прибит
    // к строке состояния и на развороте оставался на месте, пока небо под ним росло.
    for (const [label, compact, full] of [
        ['десктоп', frames.desk, frames.deskFull],
        ['телефон', frames.phone, frames.phoneFull],
    ] as const) {
        expect(
            full.moonAbove,
            `${label}: в развёрнутом кадре месяц не поднялся над водой выше, чем в свёрнутом`
        ).toBeGreaterThan(compact.moonAbove);
        expect(full.moonTop, `${label}: разворот не опустил месяц ниже верхней кромки кадра`).toBeGreaterThan(
            compact.moonTop
        );
    }
});

/**
 * Разворот на весь экран открывает небо, а не переставляет его: снимок стоит относительно
 * горизонта на том же месте и того же размера, что и в свёрнутом кадре. Мерок тут две, и обе
 * нужны — место (низ снимка относительно линии воды) и размер (высота плитки). Съедет любая —
 * и звёзды поедут поверх воды: рисунок созвездий в сцене единственный узнаваемый, и глаз ловит
 * его движение раньше всего остального.
 *
 * Ловятся этим две разные поломки. Размер стерёг ещё прежний замер: высота плитки считается
 * от --sky-reach, от того, до чего небо в этом окне может дорасти, а не от нынешней его высоты
 * (см. --sky-tile). Место — новое: у развёрнутого телефонного кадра стояла своя тридцатка
 * сдвига, и небо на развороте съезжало вниз сверх того, что и так уходит вместе с горизонтом.
 */
test('разворот не двигает и не масштабирует небо', async ({ page }) => {
    const frames = await skyFrames(page);

    for (const [label, compact, full] of [
        ['десктоп', frames.desk, frames.deskFull],
        ['телефон', frames.phone, frames.phoneFull],
    ] as const) {
        expect(full.photoBelow, `${label}: на развороте небо переехало относительно воды`).toBe(compact.photoBelow);
        expect(full.photoHeight, `${label}: на развороте небо сменило размер`).toBe(compact.photoHeight);
        // Само небо при этом открывается: горизонт уходит вниз, и звёзд в кадре становится больше.
        expect(full.skyHeight, `${label}: разворот не открыл неба`).toBeGreaterThan(compact.skyHeight);
    }
});

/**
 * Облака стоят на своей высоте над горизонтом и за опущенным небом не идут: облако — это
 * не рисунок звёзд, а воздух над водой. Дальнее и вовсе лежит на самой линии воды и заходит
 * за неё; опустись оно вместе с небом — ушло бы в море.
 *
 * Высота у обоих одна на все четыре раскладки. Своя телефонная тут была — ближнее облако
 * прижимали к воде под тесноту свёрнутого кадра, — и от неё пошли обе поломки: на телефоне
 * во весь экран облако стояло ниже, чем везде, а между двумя телефонными раскладками
 * переезжало. Мерка от горизонта на то и мерка, что тесный кадр просто срезает всё лишнее
 * верхней кромкой.
 */
test('облака держатся горизонта: одна высота на все четыре кадра', async ({ page }) => {
    const frames = await skyFrames(page);
    const all = [frames.desk, frames.deskFull, frames.phone, frames.phoneFull];

    expect(new Set(all.map((frame) => frame.cloudFar)).size, 'дальнее облако разъехалось по раскладкам').toBe(1);
    expect(new Set(all.map((frame) => frame.cloudNear)).size, 'ближнее облако разъехалось по раскладкам').toBe(1);
    expect(frames.desk.cloudFar, 'дальнее облако сошло с линии воды').toBeLessThan(0);
    expect(frames.desk.cloudNear, 'ближнее облако ушло под воду').toBeGreaterThan(0);
});

/** Размеры шапки: буквы, поля полосы и круг кнопки — всё, что меняется на укрупнённом виде. */
const headerSize = (page: Page) =>
    page.evaluate(() => {
        const letters = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
        return {
            title: letters('[class*="chatTitle"]'),
            status: letters('[class*="chatStatus"]'),
            padding: getComputedStyle(document.querySelector('[class*="headerBar"]')!).padding,
            button: Math.round(
                document.querySelector('[class*="headerActions"] button')!.getBoundingClientRect().width
            ),
        };
    });

/**
 * Шапка растёт вместе с кадром — но только там, где кадр и правда становится больше. На телефоне
 * разворот отдаёт сцене тот же телефонный экран, укрупнять шапку не за чем, а название канала
 * на этой ширине и без того обрезано многоточием: от прибавки букв и полей от него оставалось
 * полслова. На десктопе кадр вырастает по-настоящему, и прежние размеры читались бы мелочью
 * в углу, — там шапка укрупняется по-прежнему.
 */
test('шапка растёт с кадром только на десктопе, а на телефоне остаётся как в свёрнутом виде', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    const phone = await headerSize(page);

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();
    // Разворот едет @expand-seconds, и кнопки в шапке успевают сменить размер на ходу.
    await page.waitForTimeout(700);
    expect(await headerSize(page), 'на телефоне шапка поменялась от разворота').toEqual(phone);

    // Окно расширяется, не выходя из полноэкранного режима: сцена остаётся развёрнутой.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(700);
    const deskFull = await headerSize(page);
    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await expect(page.getByRole('button', { name: 'Развернуть сцену' })).toBeVisible();
    await page.waitForTimeout(700);
    const desk = await headerSize(page);

    expect(desk, 'на десктопе свёрнутая шапка не такая же, как на телефоне').toEqual(phone);
    expect(deskFull.title, 'на десктопе название в полный экран не выросло').toBeGreaterThan(desk.title);
    expect(deskFull.status, 'на десктопе подзаголовок в полный экран не вырос').toBeGreaterThan(desk.status);
    expect(deskFull.button, 'на десктопе кнопка в полный экран не выросла').toBeGreaterThan(desk.button);
    expect(deskFull.padding, 'на десктопе поля шапки в полный экран не выросли').not.toBe(desk.padding);
});

/**
 * Телефон: обе раскладки на одном экране. Мерки у сжатого одни и те же — @compact-height
 * с потолком в долю окна, — и десктопной прибавки блоку контента тут нет: колонка узкая,
 * реплики идут во всю ширину, и трём сообщениям с полем ввода хватает общей мерки.
 *
 * Заезд блока на кадр (@content-overlap) в обеих раскладках свой же: нижняя полоска моря
 * уходит под блок, иначе у моря своя граница, у блока своя, и обе приходятся на одну линию.
 */
test('на телефоне обе раскладки считаются от общей мерки сжатого', async ({ page }) => {
    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await openChannel(page, DEMO, ALBATROS);

    // Раскладка «больше контента»: сжат кадр, и блоку достаётся весь остаток окна.
    const compact = Math.min(COMPACT_HEIGHT, Math.round(phone.height * 0.4));
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр встал не в свою сжатую мерку' })
        .toBe(compact);
    const roomy = await contentBox(page);
    expect(roomy.width, 'блок контента не занял ширину телефонного экрана').toBe(phone.width);
    expect(roomy.top, 'блок контента не заехал на кадр').toBe(compact - CONTENT_OVERLAP);

    // Раскладка «больше сцены»: сжат блок, и мерка у него та же общая, без десктопной прибавки.
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'блок контента ужался не до общей мерки' })
        .toBe(Math.min(COMPACT_HEIGHT, Math.round(phone.height * 0.6)));
    const tight = await contentBox(page);
    expect(tight.width, 'на телефоне блок контента поехал в ширину').toBe(roomy.width);
    // Кадр едет переходом, а рост блоку меняется разом: ждём, пока кадр доедет до остатка окна.
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр занял не тот остаток окна' })
        .toBe(phone.height - tight.height + CONTENT_OVERLAP);
});

/**
 * Обещание сжатого блока контента: из него читается разговор, а не то, что он где-то есть.
 * Три последние реплики целиком и поле ввода под ними — на это и рассчитана мерка сжатого,
 * и проверяется здесь ровно она: не «лента чему-то равна», а сколько пузырей влезло целиком
 * между верхом блока и полем ввода.
 *
 * Считаем на телефоне: колонка там уже, реплики переносятся чаще, и строки выходят выше,
 * чем на широком окне, — то есть это худший из двух случаев, да ещё и с меньшей меркой.
 *
 * Реплики для счёта пишем свои, короткие: в демо-канале лежат абзацы на пять строк, и мерка
 * сжатого под них не рассчитана — три таких не влезут ни в какую разумную высоту. Обещание
 * же про обычный разговор, а обычная реплика в одну строку.
 */
test('в сжатом блоке контента видно три последние реплики и поле ввода', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'блок контента ужался не до своей мерки' })
        .toBe(Math.min(COMPACT_HEIGHT, Math.round(844 * 0.6)));

    await send(page, 'Есть право руля');
    await send(page, 'Ход двенадцать');
    await send(page, 'Вижу огни');
    await expect(bubbles(page).last(), 'последняя реплика не дошла до ленты').toContainText('Вижу огни');
    await page.waitForTimeout(400); // лента доезжает до низа плавно

    const composer = (await page.locator('[class*="composer"]').first().boundingBox())!;
    const content = await contentBox(page);
    const whole = await bubbles(page).evaluateAll(
        (nodes, area) =>
            nodes.filter((node) => {
                const box = node.getBoundingClientRect();
                return box.top >= area.top && box.bottom <= area.bottom;
            }).length,
        { top: content.top, bottom: composer.y }
    );
    expect(whole, 'из сжатого блока видно меньше трёх реплик целиком').toBeGreaterThanOrEqual(3);
    await expect(page.getByPlaceholder('Сообщение'), 'поле ввода не влезло в сжатый блок').toBeInViewport();
});

/**
 * Короткое окно — телефон, положенный на бок: 390px высоты на кадр и блок вдвоём. Отдельной
 * раскладки под него больше нет и не нужно: те же две работают на любой высоте, просто сжатому
 * достаётся доля окна, а не пиксели, — на то у обеих мерок и стоят потолки в `dvh`.
 *
 * Проверяется ровно это: в обеих раскладках сжатому досталась доля, кадр не провалился ниже
 * своей нижней мерки, а разговор с полем ввода остался на экране.
 */
test('в коротком окне обе раскладки делят его долями, а не пикселями', async ({ page }) => {
    const lying = { width: 844, height: 390 };
    await page.setViewportSize(lying);
    await openChannel(page, DEMO, ALBATROS);

    // «Больше контента»: кадру достаётся 40% окна, а не 300px, которых тут нет.
    await expect
        .poll(async () => (await sceneBox(page)).height, { message: 'кадр взял не долю короткого окна' })
        .toBe(Math.round(lying.height * 0.4));
    await expect(page.getByPlaceholder('Сообщение'), 'в коротком окне пропало поле ввода').toBeInViewport();

    // «Больше сцены»: блоку достаётся 60% окна, и кадру остаётся ровно остаток.
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'блок контента взял не долю короткого окна' })
        .toBe(Math.round(lying.height * 0.6));
    expect((await sceneBox(page)).height, 'кадр провалился ниже своей нижней мерки').toBeGreaterThanOrEqual(100);
    await expect(page.getByPlaceholder('Сообщение'), 'в сжатом блоке пропало поле ввода').toBeInViewport();
});
