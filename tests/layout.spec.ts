import { Page, expect, test } from '@playwright/test';

import { EDGE_MARGIN } from '@/backend/placement';
import {
    COLUMN_WIDTH,
    COMPACT_HEIGHT,
    CONTENT_DESKTOP_HEIGHT,
    FADE_HEIGHT,
    MOBILE_MAX_WIDTH,
    SCENE_MIN_WIDTH,
    SHEET_INSET,
    SHEET_TOP_GAP,
    SHEET_WIDTH,
    SIDE_GRIP,
    SIDE_MIN_WIDTH,
    SIDE_MIN_WINDOW,
    SIDE_SHARE,
} from '@/config/layout';
import { MAX_MESSAGE_LENGTH, SLOT_COUNT, slotDepth, slotShare } from '@/types/channel';

import {
    ALBATROS,
    DEMO,
    VYMPEL,
    bubbles,
    clickShip,
    join,
    openChannel,
    openNewChannel,
    openSheet,
    openShipCard,
    readState,
    send,
    shipNames,
    ships,
    shipsButton,
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
    // Растёт круг переходом, поэтому ждём — и ждём не «стало больше точки», а «перестало
    // расти»: мерка, снятая на полпути, показывает промежуточный размер, и кратность
    // с ней не сходится. Двух одинаковых замеров подряд для этого довольно.
    let previous = -1;
    await expect
        .poll(async () => {
            const width = (await light.boundingBox())!.width;
            const grown = width > dot.width * 2 && width === previous;
            previous = width;
            return grown;
        }, `место ${key} под указателем не подсветилось`)
        .toBe(true);
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
 * линии он уступает воду соседу, — а имя остаётся на точке, которую собой закрывает. Разойтись
 * они могут заметно: у ближней линии корабль шириной в полкадра, и отступ от кромки уводит его
 * на пятую часть кадра. Поэтому здесь сверяется не совпадение осей и не допуск в долях кадра,
 * а то, что имя осталось при своём корабле — ближе к нему, чем к любому другому. Точное же
 * совпадение подписи с точкой стоянки проверяется в scene.spec, где эту точку видно.
 *
 * Написаны они позывным: цветом участника и той же меркой, что подпись под репликой в ленте.
 * Цвет проверяем не по значению — какой кому достался, решает бэкенд, — а по тому, что он
 * у каждого свой и не общий текстовый.
 */
/** Насколько подпись может уехать от своей отметки, качаясь на волне, px: см. WAVE_NEAR. */
const NAME_SWING = 2.5;

const expectNamesStandOnBerths = async (page: Page): Promise<void> => {
    // Подчёркивание в конце обязательно: подпись ездит по своей дорожке (shipNameLane),
    // и без него в набор попадала бы ещё и она.
    const marks = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[class*="shipName_"]')].map((mark) => {
            const box = mark.getBoundingClientRect();
            const paint = getComputedStyle(mark.firstElementChild ?? mark);
            const lane = mark.closest<HTMLElement>('[class*="shipNameLane"]')!;
            return {
                middle: box.top + box.height / 2,
                berth: lane.getBoundingClientRect().bottom,
                // Ось имени — его собственная середина: сама надпись отходит от коридора
                // разбегом перспективы, ровно как точка внутри своей дорожки.
                axis: box.left + box.width / 2,
                place: lane.dataset.berthName!,
                size: paint.fontSize,
                color: paint.color,
            };
        })
    );
    // Оси корпусов — середины самих корпусов, и у каждого написано, на каком он месте.
    // По ключу места, а не по порядку в кадре: у самой ближней линии корабль шириной
    // в полкадра, и отступ от кромки уводит его дальше, чем стоит сосед, — отсортированные
    // по оси имена и корпуса встали бы тогда в пары наперекрёст.
    const hulls = await page.evaluate(() =>
        Object.fromEntries(
            [...document.querySelectorAll<HTMLElement>('[data-berth-ship]')].map((hull) => {
                const box = hull.getBoundingClientRect();
                return [hull.dataset.berthShip!, box.left + box.width / 2];
            })
        )
    );
    expect(marks.length, 'занятые места не подписаны вовсе').toBeGreaterThan(0);
    // Имя стоит при своём корабле: ближе к нему, чем к любому другому. Без допуска в долях
    // кадра — допуск тут не нужен, а нужен именно этот вопрос. Разойтись имя с корпусом может
    // заметно (у ближней линии — на пятую часть кадра), но не настолько, чтобы перебраться
    // к соседу; сама же точность посадки имени на точку стоянки проверяется в scene.spec,
    // где эту точку видно.
    for (const mark of marks) {
        const mine = Math.abs(mark.axis - hulls[mark.place]);
        const others = Object.entries(hulls)
            .filter(([place]) => place !== mark.place)
            .map(([, axis]) => Math.abs(mark.axis - axis));
        expect(Math.min(mine, ...others), `подпись на ${mark.place} перебралась к чужому кораблю`).toBe(mine);
    }
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
                buttonWidth: button.querySelector('[class*="portraitBox"]')!.getBoundingClientRect().width,
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
        const hull = document.querySelector('[class*="shipRock"] img')!.getBoundingClientRect();
        return (Math.min(hull.left - scene.left, scene.right - hull.right) / scene.width) * 100;
    });

test('корабль не встаёт бортом на обрез кадра, и поле у него одно на всех экранах', async ({ page }) => {
    await openNewChannel(page, 'polya');
    // Самый крупный корабль справочника стоит в списке первым: проекты идут по убыванию длины.
    await page.locator('[role="button"]:has([class*="portraitShip"])').first().click();
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

/**
 * Ширина кнопки в шапке: на укрупнённой раскладке круг больше. Берётся первая попавшаяся —
 * они там все одного роста и растут разом (это отдельно проверено ниже), а подпись у той,
 * что переключает раскладку, меняется вместе с самой раскладкой.
 */
const buttonWidth = async (page: Page): Promise<number> => {
    const box = await page.locator('[class*="headerActions"] button').first().boundingBox();
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
    // Кадр забрал ровно остаток окна: блок с ним встык, ни заезда, ни зазора.
    expect((await sceneBox(page)).height, 'кадр занял не тот остаток окна').toBe(window.height - tight.height);
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
        .toBe(phone.height - Math.min(COMPACT_HEIGHT, Math.round(phone.height * 0.6)));

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

/**
 * Потянуть от точки вниз на `by` пикселей и отпустить.
 *
 * Перед отпусканием палец замирает: шторка считает не только пройденный путь, но и скорость
 * в последний миг (см. `@/utils/magnet`), и брошенная на ходу она улетит дальше, чем её увели.
 * Проверкам про путь эта прибавка мешает — курсор в Playwright ходит рывками и с непредсказуемой
 * скоростью, — поэтому по умолчанию движение здесь заканчивается остановкой. Кому нужен
 * как раз рывок, тот берёт `flingAt` ниже.
 */
const dragAt = async (page: Page, x: number, y: number, by: number): Promise<void> => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Шагами, а не прыжком: перетаскивание считается по pointermove, и одного события
    // хватило бы шторке, но не браузеру — он на прыжок курсора отвечает не всегда.
    await page.mouse.move(x, y + by, { steps: 12 });
    // Дольше, чем окно замера скорости: отпущенная после остановки шторка идёт только туда,
    // куда её довели.
    await page.waitForTimeout(200);
    await page.mouse.up();
};

/** Потянуть за середину блока: за ручку, за заголовок — за что дали. */
const dragBox = (page: Page, box: { x: number; y: number; width: number; height: number }, by: number) =>
    dragAt(page, box.x + box.width / 2, box.y + box.height / 2, by);

/**
 * Короткий рывок вниз: палец уходит недалеко, но быстро, и отпускается на ходу.
 *
 * Одним движением, без шагов: так `pointermove` приходит один и с настоящей разницей во времени
 * от нажатия — то есть с настоящей скоростью, а не с той, что накопилась бы за дюжину шагов
 * по паре пикселей.
 */
const flingAt = async (page: Page, x: number, y: number, by: number): Promise<void> => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + Math.round(by / 2));
    await page.mouse.move(x, y + by);
    await page.mouse.up();
};

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
    // Список кончается там же, где и шторка: пустого поля под ним нет. Кончается он полосой
    // кнопок — координаты рейда и выход, — и вниз она доходит до самой кромки шторки: своё
    // поле она унесла внутрь, к кнопкам (см. ui/Actions).
    const band = (await page.locator('[class*="shade_"] [class*="actions_"]').boundingBox())!;
    expect(short.top + short.height - (band.y + band.height), 'под списком осталось пустое поле').toBeLessThan(8);
    const rows = page.locator('[class*="row_"], [class*="rowActive"]');
    const lastRow = (await rows.last().boundingBox())!;
    expect(band.y - (lastRow.y + lastRow.height), 'между списком и полосой кнопок провал').toBeLessThan(60);

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
        .poll(async () => (await shadeBox(page)).width, {
            message: 'на телефоне шторка не в ширину окна за вычетом полоски по краям',
        })
        .toBe(phone.width - SHEET_INSET);
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
    await shipsButton(page).click();
    await expect(shadeRegion(page), 'кнопка шапки не закрыла шторку').toHaveCount(0);
});

/**
 * Выходов из шторки три: крестик в верхнем углу, нажатие мимо и потяг вниз. Тянут за любое
 * место, у которого нет своей прокрутки и которое не текстовое поле, — попадать пальцем
 * в полоску шириной в палец занятие для тех, кому некуда спешить.
 *
 * Потяг закрывает не всякий: увёл больше трети высоты — закрылась, меньше — вернулась.
 * Недоведённое движение бывает и промахом, и шторка на своём положении держится.
 *
 * А вот короткий, но резкий рывок закрывает и с четверти пути: шторка считает не только
 * пройденное, но и скорость в последний миг — усилие проносит её мимо точек, за которые она
 * иначе зацепилась бы (см. `@/utils/magnet`). Так её и закрывают одним движением, не отводя
 * палец до самого низа экрана.
 */
test('шторку закрывают крестиком, нажатием мимо, потягом вниз и коротким рывком', async ({ page }) => {
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
    await expect(shadeRegion(page), 'недоведённый потяг закрыл шторку').toHaveCount(1);
    await expect
        .poll(async () => (await shadeBox(page)).top, { message: 'шторка не вернулась на место после потяга' })
        .toBe(before.top);

    await dragBox(page, (await title.boundingBox())!, Math.round(before.height * 0.6));
    await expect(shadeRegion(page), 'потяг вниз не закрыл шторку').toHaveCount(0);

    // Тот же путь, что и в первый раз, но пройденный рывком и отпущенный на ходу.
    await openSheet(page);
    const box = (await title.boundingBox())!;
    await flingAt(page, box.x + box.width / 2, box.y + box.height / 2, Math.round(before.height * 0.2));
    await expect(shadeRegion(page), 'короткий рывок не закрыл шторку').toHaveCount(0);
});

/**
 * Вверх шторке некуда: выше она и так стоит вплотную к своему пределу, и потяг вверх обязан
 * не делать ровно ничего — ни на потяге, ни на отпускании.
 *
 * Проверка покадровая и переживает отпускание нарочно. Выезд шторки прежде был отдельной
 * анимацией по ключевым кадрам, а на время потяга её снимали вместе с переходом; отпущенная
 * шторка получала анимацию обратно, и браузер заводил её заново — то есть шторка падала вниз
 * и выезжала снова. Занимало это те же полсекунды, что и обычный выезд, и одиночный замер
 * «после отпускания» мог прийтись и на начало падения, и на его конец.
 */
test('потяг вверх не двигает шторку', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const before = await shadeBox(page);
    const box = (await page.getByText('На связи', { exact: true }).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - Math.round(before.height * 0.5), { steps: 12 });

    // Замер заводим до отпускания и ждём уже после: он идёт в браузере сам по себе,
    // а отпускание тем временем приходит снаружи.
    const watching = page.evaluate(
        () =>
            new Promise<number[]>((resolve) => {
                const shade = document.querySelector('[class*="shade_"]')!;
                const tops: number[] = [];
                const deadline = performance.now() + 600;
                const tick = () => {
                    tops.push(shade.getBoundingClientRect().top);
                    if (performance.now() < deadline) {
                        requestAnimationFrame(tick);
                    } else {
                        resolve(tops);
                    }
                };
                tick();
            })
    );
    await page.mouse.up();
    const tops = await watching;

    await expect(shadeRegion(page), 'потяг вверх закрыл шторку').toHaveCount(1);
    expect(Math.max(...tops) - Math.min(...tops), 'шторка дёрнулась на потяге вверх').toBeLessThanOrEqual(1);
    expect(Math.round(Math.max(...tops)), 'шторка встала не на прежнее место').toBe(before.top);
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

/** Отступы дорожки полосы прокрутки у первого прокручиваемого блока внутри `selector`, px. */
const trackInset = (page: Page, selector: string): Promise<{ top: number; bottom: number }> =>
    page
        .locator(selector)
        .first()
        .evaluate((node) => {
            const track = getComputedStyle(node, '::-webkit-scrollbar-track');
            return { top: parseFloat(track.marginTop), bottom: parseFloat(track.marginBottom) };
        });

/**
 * Полоса прокрутки не заезжает под скруглённый угол панели: сверху её поджимает ровно то же
 * число, что и рост полоски (FADE_HEIGHT), — под полоской ей делать нечего, а угол она резала
 * бы наискось.
 *
 * Правило это ничьё в отдельности: оно живёт в блоке с полоской (`ui/TopFade`) и достаётся
 * любому прокручиваемому внутри — ленте, списку кораблей в шторке, форме корабля. Раньше оно
 * стояло у ленты, и форма его не получала: её полоса начиналась от самой кромки.
 *
 * Снизу у каждого своё: полоса доходит дотуда же, докуда доходит текст, а поля у ленты, списка
 * и формы разные. Это число блок объявляет о себе сам — `--scrollbar-bottom`.
 */
test('полосу прокрутки поджимает сверху у любого содержимого панели, а снизу — по полям хозяина', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    const feed = await trackInset(page, 'main [class*="list_"]');
    expect(feed.top, 'полоса ленты полезла под скруглённый угол').toBeCloseTo(FADE_HEIGHT, 0);
    expect(feed.bottom, 'полоса ленты не отбита снизу').toBeGreaterThan(0);

    await openSheet(page);
    const crew = await trackInset(page, '[class*="shade_"] [class*="list_"]');
    expect(crew.top, 'полоса списка кораблей полезла под скруглённый угол').toBeCloseTo(FADE_HEIGHT, 0);

    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    const form = await trackInset(page, 'main form[class*="card"]');
    expect(form.top, 'полоса формы полезла под скруглённый угол').toBeCloseTo(FADE_HEIGHT, 0);
    // Поля у формы шире, чем у ленты: полоса кончается там же, где кончается текст.
    expect(form.bottom, 'полоса формы кончается не по её полям').toBeGreaterThan(feed.bottom);
});

/** Размеры кнопки шапки по её подписи: круг и значок в нём, px. */
const headerButton = (page: Page, name: string): Promise<{ size: number; icon: number }> =>
    page
        .getByRole('banner')
        .getByRole('button', { name })
        .evaluate((node) => {
            const icon = node.querySelector('svg')?.getBoundingClientRect();
            return { size: Math.round(node.getBoundingClientRect().width), icon: Math.round(icon?.width ?? 0) };
        });

/**
 * Над развёрнутым кадром шапка просторнее, и кнопки в ней крупнее — все разом. Размер приходит
 * к ним от самой шапки (`--icon-button-size`, `--icon-button-icon`), а не просится у каждой
 * кнопки отдельным свойством: прежде просился, и кнопка выхода с рейда, добавленная позже,
 * его не получила — стояла в ряду крупных мелочью.
 *
 * Проверяется поэтому не число, а равенство: сколько бы ни было кнопок в шапке и какая бы
 * из них ни появилась завтра, они одного роста и вырастают вместе.
 */
test('кнопки в шапке одного роста и над развёрнутым кадром растут разом', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN_WIDTH, height: 900 });
    await openChannel(page, DEMO, ALBATROS);

    const small = await headerButton(page, 'Развернуть сцену');

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await page.waitForTimeout(600);

    const big = await headerButton(page, 'Свернуть сцену');
    expect(big.size, 'над развёрнутым кадром кнопки не выросли').toBeGreaterThan(small.size);
    expect(big.icon, 'значок в выросшей кнопке остался прежним').toBeGreaterThan(small.icon);

    // И выход с рейда — та самая кнопка, что отставала. Она встаёт в шапку, когда открыта
    // форма своего корабля, и добавлена позже остальных: свойства на укрупнение ей тогда
    // не досталось.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    expect(await headerButton(page, 'Уйти с рейда'), 'кнопка выхода отстала от остальных').toEqual(big);
});

/**
 * Список кораблей открывают названием канала: значок стоит в конце названия, и нажимается
 * всё вместе. Отдельной кнопки в шапке для этого больше нет — список это и есть «кто в этом
 * канале», и спрашивают о нём, тыча в его название.
 *
 * Заодно проверяется отклик на наведение: подсвечивается вся кнопка разом — и название,
 * и значок, — потому что нажимается она целиком. Подсветка именно подсветка, а не другой
 * цвет: акцентным название читалось бы ссылкой куда-то наружу, хотя открывает свою же
 * шторку (см. .chatTitleButton в стилях).
 */
test('список кораблей открывается названием канала со значком на конце', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const title = shipsButton(page);

    const parts = await title.evaluate((node) => {
        const name = node.querySelector('span')!;
        const icon = node.querySelector('svg')!.getBoundingClientRect();
        return {
            nameRight: name.getBoundingClientRect().right,
            iconLeft: icon.left,
            iconRight: icon.right,
            right: node.getBoundingClientRect().right,
            color: getComputedStyle(name).color,
            iconOpacity: Number(getComputedStyle(node.querySelector('svg')!.parentElement!).opacity),
        };
    });
    expect(parts.iconLeft, 'значок стоит не в конце названия').toBeGreaterThanOrEqual(parts.nameRight);
    expect(parts.iconRight, 'значок вылез за пределы кнопки').toBeLessThanOrEqual(parts.right + 1);
    expect(parts.iconOpacity, 'значок и без наведения в полный голос').toBeLessThan(1);

    // Наведение оживляет обе половины кнопки: название белеет, значок доходит до полного голоса.
    await title.hover();
    // Подсветка приезжает переходом в 0.12s — читать её сразу значит поймать середину пути.
    await page.waitForTimeout(300);
    const hovered = await title.evaluate((node) => ({
        color: getComputedStyle(node.querySelector('span')!).color,
        iconOpacity: Number(getComputedStyle(node.querySelector('svg')!.parentElement!).opacity),
    }));
    expect(hovered.color, 'название не подсветилось под указателем').not.toBe(parts.color);
    expect(hovered.color, 'название подсветилось не белым, а другим цветом').toBe('rgb(255, 255, 255)');
    expect(hovered.iconOpacity, 'значок не подсветился под указателем').toBe(1);

    // Нажатие в самое начало кнопки — по названию, мимо значка: открывает список и оно.
    await title.click({ position: { x: 4, y: 10 } });
    await expect(
        page.getByRole('region', { name: MEMBERS_SHADE }),
        'список не открылся нажатием на название'
    ).toBeVisible();
});

/**
 * Внизу списка — то, что делают с рейдом целиком: зовут остальных и уходят сами. Подпись
 * у координат на узком списке короче: «Координаты рейда» со значком отнимают там половину
 * полосы у соседней кнопки, а рейд и так один — тот, чей список открыт.
 *
 * Меряется при этом сам список, а не окно (@container в стилях): он живёт в шторке, а шторка
 * бывает уже окна — например в боковой раскладке.
 */
test('внизу списка кораблей — координаты рейда и выход, а на узком списке подпись короче', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const shade = page.getByRole('region', { name: MEMBERS_SHADE });
    await expect(shade.getByRole('button', { name: 'Координаты рейда' }), 'нет координат рейда').toBeVisible();
    await expect(shade.getByRole('button', { name: 'Уйти с рейда' }), 'нет выхода с рейда').toBeVisible();

    await page.setViewportSize({ width: 375, height: 800 });
    await expect(
        shade.getByRole('button', { name: 'Координаты' }),
        'на узком списке подпись не укоротилась'
    ).toBeVisible();
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
    // Кнопка названия та же самая и с открытым списком — тем же нажатием список и убирают.
    await shipsButton(page).click();
    await expect(input, 'разговор пересобрался под шторкой: поле стало другим узлом').toHaveAttribute(
        'data-probe',
        'тот же самый'
    );

    // Форма корабля — тем же движением и с тем же обещанием.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.getByRole('button', { name: 'Готово' }), 'форма корабля не выехала').toBeVisible();
    // Пока форма открыта, в шапке стоит выход с рейда: это второе, что делают с собственным
    // кораблём. Ищется он в самой шапке: та же подпись стоит и на кнопке внизу списка.
    await expect(
        page.getByRole('banner').getByRole('button', { name: 'Уйти с рейда' }),
        'в шапке не появился выход с рейда'
    ).toBeVisible();
    // А названием канала из формы возвращаются к списку — из него форму и открыли.
    await expect(shipsButton(page), 'из формы нечем вернуться к списку').toBeVisible();

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
            // Название в канале — само слово внутри кнопки: у кнопки вокруг него свой кегль
            // не задан, буквы живут в ней (см. .chatTitleName). Второй селектор — для мест,
            // где канала нет и название стоит простой строчкой.
            title: letters('[class*="chatTitleName"], [class*="chatTitle_"]'),
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
 * полслова. На широком окне кадр вырастает по-настоящему, и прежние размеры читались бы мелочью
 * в углу, — там шапка укрупняется. Прибавка набирается вместе с шириной окна по шкале --wide,
 * а не включается порогом; здесь проверяются оба её конца, непрерывность — отдельно ниже.
 */
test('шапка растёт с кадром на широком окне, а на телефоне остаётся как в свёрнутом виде', async ({ page }) => {
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
 * Блок стоит встык с кадром в обеих раскладках: кадру достаётся его мерка, блоку — остаток
 * окна, и ни заезда, ни зазора между ними нет.
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
    expect(roomy.top, 'блок контента встал не встык с кадром').toBe(compact);

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
        .toBe(phone.height - tight.height);
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

/**
 * Ступеньки на границе телефона нет. Прежде на 480px стоял порог, и один пиксель ширины разом
 * переставлял всё, что под телефон подгонялось: небо, месяц, коридоры рейда, укладку стрелки
 * курса, размеры шапки и кнопок. Теперь у каждого такого числа два настроенных конца и шкала
 * между ними (`--wide` в index.less), и проверяется ровно это.
 *
 * Меряются мерки сцены, а не картинка: именно они переставлялись порогом, а всё остальное
 * в кадре считается от них.
 *
 * Три условия сразу. На 479 и 480 — одно и то же (телефонный конец шкалы стоит на 480px,
 * и до него включительно ничего не меняется). На 481 — почти то же: шаг в один пиксель даёт
 * шаг в сотые доли, а не в десятки. И посередине отрезка каждое число стоит строго между
 * своими концами — то есть шкала и правда едет, а не переключается где-то в другом месте.
 */
const RAMP = ['--sky-drop', '--berth-arrow-eye', '--berth-arrow-lean', '--berth-arrow-times', '--moon-disc-max'];

const rampValues = (page: Page) =>
    page.evaluate((names) => {
        const style = getComputedStyle(document.querySelector('[class*="scenePainted"]')!);
        return names.map((name) => Number.parseFloat(style.getPropertyValue(name)));
    }, RAMP);

test('на границе телефона ничего не прыгает: ширина ведёт мерки сцены плавно', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 1, height: 844 });
    await openChannel(page, DEMO, ALBATROS);

    const at = async (width: number) => {
        await page.setViewportSize({ width, height: 844 });
        // Ширину браузер применяет не тем же кадром, что и замер.
        await page.waitForTimeout(150);
        return rampValues(page);
    };

    const before = await at(MOBILE_MAX_WIDTH - 1);
    const edge = await at(MOBILE_MAX_WIDTH);
    const after = await at(MOBILE_MAX_WIDTH + 1);
    const middle = await at((MOBILE_MAX_WIDTH + COLUMN_WIDTH) / 2);
    const wide = await at(COLUMN_WIDTH + 140);

    expect(edge, 'на 479 и 480 мерки сцены разошлись').toEqual(before);
    RAMP.forEach((name, index) => {
        expect(Math.abs(after[index] - edge[index]), `${name} прыгнул на пикселе после порога`).toBeLessThan(0.5);

        // Посередине — строго между концами, с какой бы стороны конец ни был больше.
        const [low, high] = [edge[index], wide[index]].sort((a, b) => a - b);
        expect(middle[index], `${name} не поехал по шкале`).toBeGreaterThan(low);
        expect(middle[index], `${name} не поехал по шкале`).toBeLessThan(high);
    });
});

/**
 * Длинная форма мотается сама, а кнопки внизу остаются на виду. Прокрутки у неё однажды
 * не стало вовсе — блок контента снаружи обрезан наглухо, а своего скроллера форме не завели, —
 * и десяток силуэтов в столбик просто уходил под обрез без права вернуться. Прилипшим кнопкам
 * при этом было не к чему прилипать: `position: sticky` считается от того, что прокручивает.
 *
 * Проверяется и то, и другое: форме есть что мотать, домотать до конца выходит, а полоса кнопок
 * всё это время стоит ровно на нижней кромке формы — не выше, иначе под ней светилась бы
 * полоска фона в её нижнее поле.
 */
test('длинная форма мотается сама, а кнопки держатся нижней кромки', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.getByPlaceholder('Гром'), 'форма корабля не открылась').toBeVisible();

    const card = page.locator('form[class*="card"]');
    const measure = () =>
        card.evaluate((node) => ({
            scrollable: node.scrollHeight - node.clientHeight,
            top: Math.round(node.scrollTop),
            cardBottom: Math.round(node.getBoundingClientRect().bottom),
            actionsBottom: Math.round(node.querySelector('[class*="actions"]')!.getBoundingClientRect().bottom),
        }));

    // Кромка меряется с допуском в пиксель: и форма, и полоса кнопок встают на дробные
    // координаты, и на домотанной до конца прокрутке они округляются в разные стороны.
    // Ловим мы тут не пиксель, а полоску фона в нижнее поле формы — она была бы в десяток.
    const onEdge = (measured: { actionsBottom: number; cardBottom: number }): number =>
        Math.abs(measured.actionsBottom - measured.cardBottom);

    const before = await measure();
    expect(before.scrollable, 'форме нечего мотать — прокрутки у неё нет').toBeGreaterThan(0);
    expect(onEdge(before), 'кнопки встали не на кромку формы').toBeLessThanOrEqual(1);

    await card.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
    });
    const after = await measure();
    expect(after.top, 'форма не домоталась до конца').toBe(before.scrollable);
    expect(onEdge(after), 'кнопки уехали с кромки вместе с формой').toBeLessThanOrEqual(1);
});

/**
 * Переключение раскладок не отрывает блок контента от нижней кромки окна. Своя высота у него
 * тут была, и вставала она в конечное значение первым же кадром, пока кадр над ней только
 * трогался с места: блок подскакивал вверх на разницу высот (замер: 244px при окне 844)
 * и потом полперехода сползал обратно. Теперь рост ему никто не задаёт — он берёт остаток
 * от кадра и потому едет вместе с ним.
 *
 * Меряется низ на каждом кадре перехода: он обязан стоять на кромке окна всё время, в обе
 * стороны. Высота при этом обязана меняться — иначе проверка прошла бы и на неподвижном блоке.
 */
const bottomsWhileSwitching = (page: Page, button: string) =>
    page.evaluate(async (label) => {
        const main = document.querySelector('main')!;
        const taken: { bottom: number; height: number }[] = [];
        const probe = (): void => {
            const box = main.getBoundingClientRect();
            taken.push({ bottom: Math.round(box.bottom), height: Math.round(box.height) });
        };
        document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                probe();
                if (taken.length < 26) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    }, button);

test('блок контента не отрывается от нижней кромки, пока раскладка переключается', async ({ page }) => {
    const window = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(window);
    await openChannel(page, DEMO, ALBATROS);

    const check = (frames: { bottom: number; height: number }[], button: string): void => {
        const bottoms = [...new Set(frames.map((frame) => frame.bottom))];
        expect(bottoms, `«${button}»: блок отрывался от нижней кромки`).toEqual([window.height]);

        const heights = frames.map((frame) => frame.height);
        expect(Math.max(...heights) - Math.min(...heights), `«${button}»: блок не менял высоту`).toBeGreaterThan(100);
    };

    check(await bottomsWhileSwitching(page, 'Развернуть сцену'), 'Развернуть сцену');
    check(await bottomsWhileSwitching(page, 'Свернуть сцену'), 'Свернуть сцену');
});

/**
 * Форма выезжает снизу целиком, а не встаёт на место первым же кадром.
 *
 * Съедала выезд автопрокрутка: блок контента был `overflow: hidden` — это прокрутка, просто
 * без полосы, — а форма первым кадром висит ниже блока на всю свою высоту, и поле позывного
 * в ней встаёт под фокус. Браузер честно доматывал блок до этого поля и тем самым возвращал
 * форму на место: движения оставалось ровно столько, сколько прокрутке не хватило (замер:
 * 273 из 319px в развёрнутой раскладке — то есть 46px вместо 319).
 *
 * Меряется покадрово одно и то же: блок не промотан ни на пиксель, а верх формы идёт от
 * нижней кромки блока к его верхней. Раскладка развёрнутая — в ней блок ниже всего, и там
 * разница между «выехала» и «встала на место» самая заметная.
 */
test('форма выезжает снизу целиком, а не встаёт на место сразу', async ({ page }) => {
    await page.setViewportSize({ width: COLUMN_WIDTH + 440, height: 900 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();
    await openSheet(page);

    const frames = await page.evaluate(async () => {
        const main = document.querySelector('main')!;
        const taken: { scrolled: number; offset: number }[] = [];
        const probe = (): void => {
            const box = main.getBoundingClientRect();
            const form = main.querySelector(':scope > div[class*="form"]');
            taken.push({
                scrolled: Math.round(main.scrollTop),
                offset: form ? Math.round(form.getBoundingClientRect().top - box.top) : -1,
            });
        };
        document.querySelector<HTMLButtonElement>('button[aria-label="Настроить корабль"]')!.click();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                probe();
                if (taken.length < 26) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    });

    const scrolled = [...new Set(frames.map((frame) => frame.scrolled))];
    expect(scrolled, 'блок контента промотал сам себя под сфокусированное поле').toEqual([0]);

    const offsets = frames.map((frame) => frame.offset);
    const height = await page.locator('main').evaluate((node) => Math.round(node.getBoundingClientRect().height));
    expect(Math.max(...offsets), 'форма не начала выезд из-за нижней кромки блока').toBeGreaterThan(height - 8);
    expect(Math.min(...offsets), 'форма не доехала до верхней кромки блока').toBeLessThan(2);
});

/** Ширина окна, на которой боковая раскладка заведомо работает. */
const WIDE = SIDE_MIN_WINDOW + 200;

/** Ширина окна, на которой её заведомо нет. */
const NARROW = SIDE_MIN_WINDOW - 100;

/**
 * Какой панель открывается в окне WIDE, px. Ширина хранится долей окна, а меряется в браузере
 * пикселями — перевод один и тот же и здесь, и в hooks/useLayout.
 */
const SIDE_AT_WIDE = Math.round(WIDE * SIDE_SHARE);

/** Коробка блока в координатах окна. */
const boxOf = (page: Page, selector: string) =>
    page.locator(selector).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
    });

/** Открыть канал в развёрнутой раскладке на широком окне и убрать разговор в боковую панель. */
const openSide = async (page: Page): Promise<void> => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();
    await page.getByRole('button', { name: 'Разговор сбоку' }).click();
    // Переезд идёт двумя половинами; ждём обе с запасом.
    await page.waitForTimeout(600);
};

/**
 * Боковая раскладка: разговор справа во всю высоту окна, кадру — весь остаток ширины.
 *
 * Мерок тут три, и все три легко разъезжаются по мелочи: и .contentSide, и .headerSide спорят
 * за вес с .content и .header — селектор у обоих в один класс, медиа-запрос веса не прибавляет.
 * Стоило правилу оказаться выше того, что оно правит, — и блок разъезжался во всю ширину окна,
 * отжимая кадр в ноль.
 */
test('на широком окне разговор встаёт сбоку во всю высоту, кадру достаётся остальное', async ({ page }) => {
    await openSide(page);

    const content = await boxOf(page, 'main');
    const frame = await boxOf(page, 'header');
    expect(content.width, 'блок не встал в ширину боковой панели').toBe(SIDE_AT_WIDE);
    expect(content.right, 'блок не прижат к правой кромке окна').toBe(WIDE);
    expect(content.height, 'блок не во всю высоту окна').toBe(900);
    expect(frame.width, 'кадру достался не весь остаток ширины').toBe(WIDE - SIDE_AT_WIDE);
    expect(frame.height, 'кадр не во всю высоту окна').toBe(900);
});

/**
 * Шторка в боковой раскладке вылезает на сцене, а не в панели и не поверх окна: и список
 * кораблей, и карточка — про рейд, и место им там, где рейд и виден. Ширина у неё при этом
 * та же, что и в нижней раскладке, — панель у неё только отнимает место слева от себя,
 * а мерки остаются общими.
 *
 * Форма корабля, наоборот, остаётся внутри панели: она про свой корабль, и открывают её
 * из разговора.
 */
test('шторка встаёт на сцену рядом с панелью, а форма остаётся внутри неё', async ({ page }) => {
    await openSide(page);
    await openSheet(page);

    // Сцена — всё, что не заняла панель; шторка меряется от неё по общим правилам: полоска
    // по краям и предел по колонке. Ширину сцены спрашиваем у самого кадра, а не считаем
    // вычитанием: доля панели в пикселях бывает дробной, и разойтись на пиксель тут проще,
    // чем сойтись.
    const scene = (await boxOf(page, 'header')).width;
    const shade = await boxOf(page, 'section[aria-label="Корабли на связи"]');
    expect(shade.width, 'шторка не той ширины, что в нижней раскладке').toBe(
        Math.min(scene - SHEET_INSET, SHEET_WIDTH)
    );
    expect(Math.abs(shade.left - (scene - shade.right)), 'шторка не посередине сцены').toBeLessThanOrEqual(1);
    expect(shade.right, 'шторка залезла на панель с разговором').toBeLessThanOrEqual(scene);

    const backdrop = await boxOf(page, 'button[aria-label="Закрыть шторку"]');
    expect(backdrop.width, 'затемнение погасило не сцену').toBe(scene);
    expect(backdrop.left, 'затемнение легло не от левой кромки окна').toBe(0);

    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(500);
    // Форма стоит внутри блока и меряется по нему же: у боковой панели слева рамка,
    // и на неё форма честно уже своей полосы.
    const content = await boxOf(page, 'main');
    const form = await boxOf(page, 'main > div[class*="form"]');
    expect(form.width, 'форма шире панели').toBeLessThanOrEqual(content.width);
    expect(form.width, 'форма не заняла панель целиком').toBeGreaterThan(content.width - 4);
    expect(form.left, 'форма вылезла на кадр').toBeGreaterThanOrEqual(content.left);
});

/**
 * Переезд идёт двумя половинами по очереди: сперва блок уходит за ту кромку, у которой стоял,
 * и только оказавшись за ней меняет место, потом приезжает из-за новой кромки. Одно движение
 * из угла в угол было бы полётом коробки через всю сцену.
 *
 * Меряем покадрово: пока блок в колонке, он едет вниз и никуда вбок; сменив место, он обязан
 * начаться за правой кромкой окна и дойти до своей полосы. Ни одного кадра между половинами,
 * на котором блок уже на новом месте и уже без сдвига, быть не должно — это и был бы скачок.
 */
test('разговор переезжает двумя половинами, а не прыгает через сцену', async ({ page }) => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    await openChannel(page, DEMO, ALBATROS);
    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();

    const frames = await page.evaluate(async () => {
        const main = document.querySelector('main')!;
        const taken: { left: number; top: number; width: number }[] = [];
        document.querySelector<HTMLButtonElement>('button[aria-label="Разговор сбоку"]')!.click();
        const started = performance.now();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                const rect = main.getBoundingClientRect();
                taken.push({
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                    width: Math.round(rect.width),
                });
                if (performance.now() - started < 600) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    });

    const under = frames.filter((frame) => frame.width !== SIDE_AT_WIDE);
    const beside = frames.filter((frame) => frame.width === SIDE_AT_WIDE);
    expect(under.length, 'блок не побыл под кадром').toBeGreaterThan(2);
    expect(beside.length, 'блок так и не встал сбоку').toBeGreaterThan(2);

    // Уход: только вниз и до конца — за нижнюю кромку окна.
    expect(new Set(under.map((frame) => frame.left)).size, 'уходящий блок поехал вбок').toBe(1);
    expect(Math.max(...under.map((frame) => frame.top)), 'блок сменил место, не уйдя за кромку').toBeGreaterThan(800);

    // Приезд: на новом месте блок начинается из-за правой кромки окна, а не на своей полосе.
    //
    // Меряем с запасом, а не «ровно за кромкой»: кадры снимает requestAnimationFrame, и под
    // нагрузкой первый снятый кадр приходится уже на начавшееся движение — то на пиксель
    // внутрь окна, то на десяток. Скачок от этого не спрячется: он выглядит как готовая полоса
    // с первого же кадра, то есть промах на всю ширину панели, а не на её край.
    expect(
        beside[0].left - (WIDE - SIDE_AT_WIDE),
        'блок появился сбоку уже на своём месте — переезда не видно'
    ).toBeGreaterThan(SIDE_AT_WIDE / 2);

    // Доезжает он до своей полосы — но проверяем это после переезда, а не последним снятым
    // кадром: под нагрузкой окно съёмки кончается раньше, чем движение.
    await page.waitForTimeout(500);
    expect((await boxOf(page, 'main')).left, 'блок не доехал до своей полосы').toBe(WIDE - SIDE_AT_WIDE);
});

/**
 * Разворот с выбранной панелью ведёт два движения разом: кадр расхлопывается ровно так же,
 * как расхлопнулся бы с разговором внизу, а разговор в это время уезжает за нижнюю кромку
 * и приезжает в панель — тем же переездом, что и по кнопке.
 *
 * Прежде боковая раскладка вставала первым же кадром, до всякого движения, и разворот читался
 * задом наперёд: сперва собиралась сжатая раскладка с узкой панелью сбоку, и уже она
 * раздвигалась во всю ширину окна.
 *
 * Меряем покадрово, потому что и разница тут покадровая: в конце обе раскладки одинаковы,
 * и весь спор — о том, что показано между.
 */
test('разворот с выбранной панелью расхлопывает кадр, а не собирает узкую раскладку', async ({ page }) => {
    await openSide(page);
    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await page.waitForTimeout(600);

    const frames = await page.evaluate(async () => {
        const main = document.querySelector('main')!;
        // Приложение — то, что вокруг блока: по его ширине и видно расхлопывание.
        const app = main.parentElement!;
        const taken: { left: number; width: number; app: number }[] = [];
        document.querySelector<HTMLButtonElement>('button[aria-label="Развернуть сцену"]')!.click();
        const started = performance.now();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                const rect = main.getBoundingClientRect();
                taken.push({
                    left: Math.round(rect.left),
                    width: Math.round(rect.width),
                    app: Math.round(app.getBoundingClientRect().width),
                });
                if (performance.now() - started < 700) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    });

    const under = frames.filter((frame) => frame.width !== SIDE_AT_WIDE);
    const beside = frames.filter((frame) => frame.width === SIDE_AT_WIDE);
    expect(under.length, 'разговор встал в панель, не побыв под кадром').toBeGreaterThan(2);
    expect(beside.length, 'разговор так и не доехал до панели').toBeGreaterThan(2);

    // Кадр расхлопывается, пока разговор ещё внизу и в своей колонке: это и есть то самое
    // движение из раскладки с чатом внизу.
    expect(
        under.every((frame) => frame.width === COLUMN_WIDTH),
        'разговор под кадром стоит не в свою ширину'
    ).toBe(true);
    expect(
        Math.max(...under.map((frame) => frame.app)) - Math.min(...under.map((frame) => frame.app)),
        'кадр не раздавался, пока разговор был внизу'
    ).toBeGreaterThan(100);

    // А панель приезжает в кадр, который уже почти раздался. Меряем с запасом: разворот идёт
    // дольше переезда, и к его середине кадру остаётся последняя доля пути.
    expect(beside[0].app, 'панель собралась вместе с кадром, а не приехала в него').toBeGreaterThan(WIDE - 60);
    // И приезжает она переездом: из-за правой кромки окна, а не готовой полосой на своём месте.
    expect(beside[0].left - (WIDE - SIDE_AT_WIDE), 'разговор появился в панели уже на месте').toBeGreaterThan(
        SIDE_AT_WIDE / 2
    );

    await page.waitForTimeout(600);
    const content = await boxOf(page, 'main');
    expect(content.width, 'разговор не встал в панель').toBe(SIDE_AT_WIDE);
    expect(content.left, 'панель не прижата к правой кромке окна').toBe(WIDE - SIDE_AT_WIDE);
});

/**
 * Место под панель бронируется первым же кадром разворота — и потому кадр идёт к своему
 * размеру по прямой, не заглядывая по дороге туда, где ему стоять не придётся.
 *
 * Прежде разворот в боковую раскладку кончался отскоком: кадр раздавался во всю ширину окна,
 * и в тот миг, когда панель занимала своё место, отскакивал назад на её ширину — на треть
 * окна одним кадром. Ловится это только покадрово: и до, и после отскока раскладка одна и та же.
 *
 * Меряем обе мерки кадра. Ширина: она в этом развороте не растёт, а убывает — колонка шире
 * того, что остаётся рядом с панелью, — и всякий кадр шире исходной колонки и есть тот самый
 * перелёт. Высота: она идёт вверх и обязана дойти до окна одним движением, а не в два приёма
 * с остановкой на «окно минус разговор».
 */
test('разворот с выбранной панелью бронирует ей место, а не отдаёт его кадру', async ({ page }) => {
    await openSide(page);
    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await page.waitForTimeout(600);

    const frames = await page.evaluate(async () => {
        const header = document.querySelector('header')!;
        const taken: { width: number; height: number }[] = [];
        document.querySelector<HTMLButtonElement>('button[aria-label="Развернуть сцену"]')!.click();
        const started = performance.now();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                const rect = header.getBoundingClientRect();
                taken.push({ width: rect.width, height: rect.height });
                if (performance.now() - started < 800) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    });

    const widths = frames.map((frame) => frame.width);
    const heights = frames.map((frame) => frame.height);
    expect(widths[0], 'замер начался не со свёрнутой колонки').toBe(COLUMN_WIDTH);
    expect(widths[widths.length - 1], 'кадру достался не остаток окна').toBe(WIDE - SIDE_AT_WIDE);
    expect(heights[heights.length - 1], 'кадр не дорос до окна').toBe(900);

    // Допуск в полпикселя — на дробную ширину и округление разметки, а не на движение:
    // перелёт, который ловит проверка, был во всю ширину панели.
    const SLACK = 0.5;
    expect(Math.max(...widths), 'кадр по дороге раздавался шире, чем ему положено').toBeLessThan(COLUMN_WIDTH + SLACK);
    expect(
        widths.every((width, i) => i === 0 || width <= widths[i - 1] + SLACK),
        'ширина кадра шла с возвратом'
    ).toBe(true);
    expect(
        heights.every((height, i) => i === 0 || height >= heights[i - 1] - SLACK),
        'высота кадра шла с возвратом'
    ).toBe(true);
});

/**
 * Узкое окно: боковой раскладки нет вовсе. Кнопки переезда нет — нажимать её было бы враньём,
 * правила на этой ширине не применяются, — а разговор, застигнутый сужением окна сбоку,
 * оказывается там же, где и был бы всегда: под кадром и во всю ширину колонки.
 */
test('на узком окне боковой раскладки нет, а разговор возвращается под кадр', async ({ page }) => {
    await openSide(page);
    await page.setViewportSize({ width: NARROW, height: 900 });
    await page.waitForTimeout(300);

    await expect(page.getByRole('button', { name: /^Разговор/ })).toHaveCount(0);
    const content = await boxOf(page, 'main');
    expect(content.width, 'блок остался в ширину панели').toBe(Math.min(NARROW, COLUMN_WIDTH));
    expect(content.height, 'блок остался во всю высоту окна').toBeLessThan(900);
});

/**
 * Сворачивание кадра возвращает разговор вниз, откуда бы его ни сворачивали. Держится это
 * вычислением, а не сбросом на каждом пути: раскладку переключают и кнопкой, и свайпом,
 * и забытый сброс оставил бы сжатый кадр рядом с панелью во всю высоту окна.
 *
 * Сам выбор при этом цел: развернули заново — разговор вернулся туда, где его оставили.
 * Стирало бы его сворачивание, и «убрать разговор в панель» пришлось бы просить заново
 * после каждого взгляда на карту.
 */
test('свёрнутая раскладка возвращает разговор под кадр, но выбор помнит', async ({ page }) => {
    await openSide(page);
    await page.getByRole('button', { name: 'Свернуть сцену' }).click();
    await page.waitForTimeout(600);

    const content = await boxOf(page, 'main');
    expect(content.width, 'свёрнутая раскладка оставила разговор в панели').toBe(COLUMN_WIDTH);
    expect(content.height, 'разговор не занял всё, что осталось от сжатого кадра').toBeGreaterThan(400);

    await page.getByRole('button', { name: 'Развернуть сцену' }).click();
    await page.waitForTimeout(600);
    expect((await boxOf(page, 'main')).width, 'разговор не вернулся в панель').toBe(SIDE_AT_WIDE);
});

/** Ширина боковой панели по её левой кромке: справа она всегда упирается в кромку окна. */
const sideWidth = async (page: Page): Promise<number> => (await boxOf(page, 'main')).width;

/** Потянуть коридор на `by` пикселей вправо (влево — отрицательное). */
const dragGrip = async (page: Page, by: number): Promise<void> => {
    const grip = await boxOf(page, '[role="separator"]');
    const y = grip.top + grip.height / 2;
    await page.mouse.move(grip.left + grip.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.left + grip.width / 2 + by, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
};

/**
 * Ширину боковой панели меняют потягом за коридор вдоль её кромки. Упоров два, и оба
 * не про панель одну: уже своего минимума она не бывает, а шире — только пока кадру рядом
 * остаётся его собственный минимум. Рейд про ширину, и отдать её всю разговору значит
 * оставить от рейда вертикальную полоску.
 */
test('панель тянут за коридор вдоль кромки, и упирается она в свои пределы', async ({ page }) => {
    await openSide(page);
    expect(await sideWidth(page), 'панель открылась не в свою ширину').toBe(SIDE_AT_WIDE);

    const grip = await boxOf(page, '[role="separator"]');
    expect(grip.width, 'коридор не в свою ширину').toBe(SIDE_GRIP);
    expect(grip.height, 'коридор не во всю высоту панели').toBe(900);
    expect(grip.left, 'коридор встал не у кромки панели').toBeLessThan(WIDE - SIDE_AT_WIDE + SIDE_GRIP);

    // Панель справа: влево — шире. Тянем на столько, чтобы до упоров было далеко: здесь
    // проверяется, что панель идёт за указателем ровно, а упоры проверяются ниже.
    await dragGrip(page, -60);
    expect(await sideWidth(page), 'панель не пошла за указателем').toBe(SIDE_AT_WIDE + 60);

    await dragGrip(page, 900);
    expect(await sideWidth(page), 'панель ужалась ниже своего минимума').toBe(SIDE_MIN_WIDTH);

    await dragGrip(page, -900);
    expect(await sideWidth(page), 'панель отняла у кадра его минимум').toBe(WIDE - SCENE_MIN_WIDTH);
});

/**
 * Окно меняется и без ведома человека — повернули планшет, вытащили ноутбук из док-станции, —
 * и раскладка обязана съехать на допустимое сама. Проверок на этом пути несколько, и все они
 * в одном месте (`hooks/useLayout`): ширина сначала урезается по новому окну, а когда окна
 * не хватает и на минимумы — разговор возвращается под кадр.
 *
 * Урезанное не записывается: это не выбор человека, а то, во что его временно уложило окно.
 * Раздалось окно обратно — панель вернулась к выбранной ширине. Иначе одно случайное сужение
 * стирало бы выбор насовсем.
 */
test('сузившееся окно урезает панель, а совсем тесное возвращает разговор под кадр', async ({ page }) => {
    await openSide(page);
    await dragGrip(page, -300);
    const chosen = await sideWidth(page);
    expect(chosen, 'панель не дотянулась до упора').toBe(WIDE - SCENE_MIN_WIDTH);

    // Окно уже — панель урезана ровно на столько, чтобы кадру остался его минимум.
    await page.setViewportSize({ width: SIDE_MIN_WINDOW + 100, height: 900 });
    await page.waitForTimeout(300);
    expect(await sideWidth(page), 'панель не ужалась вслед за окном').toBe(SIDE_MIN_WINDOW + 100 - SCENE_MIN_WIDTH);

    // Окно тесное — боковой раскладки нет вовсе, и разговор снова под кадром.
    await page.setViewportSize({ width: NARROW, height: 900 });
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: /^Разговор/ })).toHaveCount(0);
    expect((await boxOf(page, 'main')).width, 'разговор остался в панели').toBe(Math.min(NARROW, COLUMN_WIDTH));

    // Окно раздалось обратно — вернулись и панель, и выбранная ширина.
    await page.setViewportSize({ width: WIDE, height: 900 });
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'панель не вернулась к выбранной ширине').toBe(chosen);
});

/**
 * Выбранное вкладка помнит: перезагрузили — раскладка та же, и панель той же ширины.
 * Память именно на вкладку (sessionStorage), а не на браузер: второе окно того же чата
 * человек открывает ради другого взгляда на то же самое, и навязывать ему раскладку первого
 * значит отбирать этот второй взгляд.
 */
test('раскладка и ширина панели переживают перезагрузку', async ({ page }) => {
    await openSide(page);
    await dragGrip(page, -120);
    const chosen = await sideWidth(page);

    await page.reload();
    await page.waitForTimeout(1200);
    expect(await sideWidth(page), 'панель забыла свою ширину').toBe(chosen);
    expect((await boxOf(page, 'main')).height, 'разговор вернулся под кадр').toBe(900);
});

/**
 * С чем приложение открывается, когда вкладке нечего вспомнить.
 *
 * На широком окне — сразу развёрнутым кадром и разговором сбоку: рейд тут главное, и показывать
 * его в четверти экрана, пока рядом пустует стол, незачем. Ширина панели при этом не число,
 * а доля окна: на любом мониторе это одна и та же треть.
 *
 * Хранилище эта проверка не трогает нарочно (обычные проверки открывают канал со сжатой
 * раскладкой, см. `startCollapsed` в helpers) — весь её смысл в том, что вкладка ничего
 * не помнит.
 */
test('пустая вкладка открывается на десктопе сбоку и в треть окна, а на телефоне — как была', async ({ page }) => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    await page.goto(`/?channel=${DEMO}&memberId=${ALBATROS}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    await expect(page.getByRole('button', { name: 'Свернуть сцену' })).toBeVisible();
    const content = await boxOf(page, 'main');
    expect(content.width, 'панель открылась не в треть окна').toBe(SIDE_AT_WIDE);
    expect(content.height, 'разговор открылся не во всю высоту окна').toBe(900);

    // Другое окно — та же треть, но других пикселей: в этом и смысл доли.
    const wider = 1800;
    await page.setViewportSize({ width: wider, height: 900 });
    await page.waitForTimeout(300);
    expect(await sideWidth(page), 'панель не потянулась за окном').toBe(Math.round(wider * SIDE_SHARE));

    // Телефон: боковой раскладки там нет, и разворачивать кадр за человека тоже незачем.
    const phone = await page.context().newPage();
    await phone.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await phone.goto(`/?channel=${DEMO}&memberId=${ALBATROS}`, { waitUntil: 'networkidle' });
    await phone.waitForTimeout(1500);
    await expect(phone.getByRole('button', { name: 'Развернуть сцену' })).toBeVisible();
    await phone.close();
});

/**
 * Раскладка — про кадр и блок контента, а не про канал: на главной, где в блоке стоит форма
 * создания канала, кадр такой же настоящий, и разговор там тоже переезжает вбок.
 */
test('разговор переезжает вбок и на главной, где канала ещё нет', async ({ page }) => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const content = await boxOf(page, 'main');
    expect(content.width, 'форма создания канала открылась не в панели').toBe(SIDE_AT_WIDE);

    await page.getByRole('button', { name: 'Разговор под кадром' }).click();
    await page.waitForTimeout(600);
    expect((await boxOf(page, 'main')).width, 'форма не вернулась под кадр').toBe(COLUMN_WIDTH);
});

/**
 * Шторки стоят стопкой: открытая позже лежит выше открытой раньше. В разметке они написаны
 * одна за другой, и порядок этот — тот, в котором о них рассказано, а не тот, в котором
 * их открывали: карточка стоит в App ниже списка, и открытый поверх неё список вылезал под ней.
 *
 * Карточку из списка при этом кладут поверх (`cover`), а не вместо: закрыв её, человек ждёт
 * увидеть список, из которого её открыл. Затемнение карточки накрывает и список — под верхней
 * шторкой ничего не выбирают, чем бы это ни было.
 */
test('карточка ложится поверх списка кораблей и затемняет его', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    const sheet = page.getByRole('region', { name: 'Корабли на связи' });
    await sheet.getByRole('button', { name: 'Корабль «Вымпел»' }).click();
    await expect(page.getByRole('region', { name: 'Корабль' })).toBeVisible();

    // Обе шторки на экране разом, и этажи считаем у обеих сразу: спрашивать их по одной
    // значило бы мерить в разные кадры выезда.
    const floors = await page.evaluate(() => {
        const level = (node: Element) => Number(getComputedStyle(node).zIndex);
        const shades = [...document.querySelectorAll('[class*="shade_"]')];
        const backdrops = [...document.querySelectorAll('[class*="backdrop_"]')];
        const named = (name: string) => shades.find((node) => node.getAttribute('aria-label') === name)!;
        return {
            list: level(named('Корабли на связи')),
            card: level(named('Корабль')),
            // Затемнений тоже два, и верхнее — то, что выше: оно и должно накрывать список.
            top: Math.max(...backdrops.map(level)),
        };
    });

    expect(floors.card, 'карточка легла не поверх списка').toBeGreaterThan(floors.list);
    expect(floors.top, 'затемнение карточки не накрыло список').toBeGreaterThan(floors.list);
    expect(floors.card, 'затемнение карточки накрыло и саму карточку').toBeGreaterThan(floors.top);

    // Закрыли верхнюю — вернулись в нижнюю. Закрываются они по одной, сверху вниз.
    await page.getByRole('region', { name: 'Корабль' }).getByRole('button', { name: 'Закрыть' }).click();
    await expect(page.getByRole('region', { name: 'Корабль' })).toBeHidden();
    await expect(sheet, 'карточка закрылась не в список').toBeVisible();
});

/**
 * А обратно — нет: список, открытый из шапки, карточку под собой закрывает. Он отвечает
 * про весь рейд, и разговор про один корабль на этом кончился. Раньше он в этом случае
 * вылезал под карточкой — и выглядело это поломкой.
 */
test('список кораблей, открытый поверх карточки, закрывает её за собой', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Карточку берём из кадра: из списка она открылась бы поверх него, а нам нужен обратный
    // порядок — сперва карточка, потом список.
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const other = fleet.find((member) => member.memberId !== ALBATROS)!;
    await clickShip(page, page.locator(`[data-berth-ship="${other.place.slot}-${other.place.corridor}"]`));
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toBeVisible();

    await openSheet(page);
    await expect(page.getByRole('region', { name: 'Корабли на связи' }), 'список не открылся').toBeVisible();
    await expect(card, 'список не закрыл карточку под собой').toBeHidden();
});

/**
 * Снекбар отвечает на то, что человек только что нажал, — а нажимает он и из шторки: вымпел
 * старшего в списке кораблей и в карточке отзывается именно уведомлением. Этаж у снекбара
 * был ниже шторки, и ответ на нажатие уходил под неё: нажал — и ничего не случилось.
 */
test('уведомление видно поверх шторки, из которой его вызвали', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await page.getByRole('button', { name: 'Старший на рейде' }).first().click();

    const snackbar = page.getByRole('status');
    await expect(snackbar, 'уведомления нет вовсе').toHaveText('Старший на рейде');

    // Сравниваем этажи, а не спрашиваем браузер, что лежит сверху: снекбар сквозной
    // для указателя (`pointer-events: none`), и в hit-тесте его не видно вовсе.
    const floors = await page.evaluate(() => {
        const floor = (selector: string) => {
            const node = document.querySelector(selector)!;
            const box = node.getBoundingClientRect();
            return { level: Number(getComputedStyle(node).zIndex), box };
        };
        const snack = floor('[role="status"]');
        const shade = floor('[class*="shade_"]');
        const across = Math.min(snack.box.right, shade.box.right) - Math.max(snack.box.left, shade.box.left);
        const down = Math.min(snack.box.bottom, shade.box.bottom) - Math.max(snack.box.top, shade.box.top);
        return { snack: snack.level, shade: shade.level, overlap: across > 0 && down > 0 };
    });

    expect(floors.overlap, 'снекбар и шторка не пересекаются — проверять нечего').toBe(true);
    expect(floors.snack, 'снекбар лежит не выше шторки').toBeGreaterThan(floors.shade);
});

/**
 * Снекбар шириной по своей строчке, а не по половине окна. Прижат он одним краем
 * (`left: 50%`), и без явного `width: max-content` браузер отмерял бы ему ширину по остатку
 * от этого края — то есть ровно половину экрана. На телефоне из-за этого короткое
 * уведомление ломалось надвое на пустом месте: места вокруг вдоволь, а строчка в две.
 */
test('уведомление на телефоне стоит в одну строку, пока помещается в экран', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openChannel(page, DEMO, ALBATROS);

    // Уведомление берём подлиннее: короткое влезало бы и в половину окна, и проверка
    // проходила бы при любой ширине. Отказ по длине — как раз такое: в экран помещается
    // с запасом, в половину экрана — нет.
    await page.getByPlaceholder('Сообщение').fill('а'.repeat(MAX_MESSAGE_LENGTH + 1));
    await page.keyboard.press('Enter');

    const snackbar = page.getByRole('status');
    await expect(snackbar, 'уведомления нет вовсе').toBeVisible();

    // Строк считаем не по высоте, а по строчным коробкам: диапазон по содержимому отдаёт
    // по прямоугольнику на строку, и двойной перенос от одинарного так не отличить иначе.
    const written = await snackbar.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return { lines: range.getClientRects().length, width: node.getBoundingClientRect().width };
    });

    expect(written.lines, 'короткое уведомление сломалось на две строки').toBe(1);
    expect(written.width, 'уведомление растянулось на весь экран').toBeLessThan(360 * 0.92 + 1);
});

/**
 * Портрет в карточке корабля приближается по нажатию.
 *
 * Размер силуэта тут общий со сценой (`shipSizeShare`): катер обязан быть мельче корвета,
 * и в карточке он занимает половину отведённого места. Разглядеть его при этом всё равно
 * хочется — приближение и есть единственное место в приложении, где корабль показан не
 * в масштабе флота, а сам по себе.
 *
 * Меряется тут не только силуэт, но и линейка: она мерит этот самый рисунок, и отстань она
 * от него — десять метров на ней перестанут быть десятью метрами.
 *
 * Берём «Альбатрос»: это самый короткий корабль справочника, и растёт он ровно вдвое —
 * у самого длинного доля и так единица, и проверять на нём нечего.
 */
test('портрет корабля приближается по нажатию и возвращается обратно', async ({ page }) => {
    await openChannel(page, DEMO, VYMPEL);
    await openShipCard(page, 'Альбатрос');

    const box = page.locator('[class*="portraitBox"]');
    const ship = page.locator('[class*="portraitShip"]');
    const scale = page.locator('[class*="scaleBar"]');
    const measure = async () => ({
        place: (await box.boundingBox())?.width ?? 0,
        ship: (await ship.boundingBox())?.width ?? 0,
        height: (await box.boundingBox())?.height ?? 0,
        scale: (await scale.boundingBox())?.width ?? 0,
    });

    const before = await measure();
    expect(before.ship / before.place, 'катер в карточке и так во всю ширину — приближать нечего').toBeLessThan(0.9);

    // Ждём не наугад: приближение идёт переходом, и мерить его надо после того, как он встал.
    await page.getByRole('button', { name: 'Рассмотреть вблизи' }).click();
    await page.waitForTimeout(600);
    const near = await measure();

    expect(near.ship / near.place, 'силуэт не дорос до полной ширины места').toBeCloseTo(1, 1);
    expect(near.height / before.height, 'место под силуэт не выросло вместе с ним').toBeCloseTo(
        near.ship / before.ship,
        1
    );
    expect(near.scale / before.scale, 'линейка отстала от силуэта и начала врать').toBeCloseTo(
        near.ship / before.ship,
        1
    );

    // Повторное нажатие уводит обратно: это положение, а не разовое действие.
    await page.getByRole('button', { name: 'Отойти на шаг' }).click();
    await page.waitForTimeout(600);
    const after = await measure();

    expect(after.ship, 'силуэт не вернулся к своему размеру').toBeCloseTo(before.ship, 0);
    expect(after.scale, 'линейка не вернулась вместе с силуэтом').toBeCloseTo(before.scale, 0);
});
