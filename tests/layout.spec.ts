import { Page, expect, test } from '@playwright/test';

import { EDGE_MARGIN } from '@/backend/placement';
import {
    CHAT_GRIP,
    CHAT_OVERLAP,
    CHAT_SHARE,
    COLUMN_WIDTH,
    FADE_HEIGHT,
    MOBILE_MAX_WIDTH,
    SCENE_MIN_HEIGHT,
    SCENE_MIN_SHARE,
    SCENE_MIN_WIDTH,
    SHEET_INSET,
    SHEET_TOP_GAP,
    SHEET_WIDTH,
    SIDE_MIN_WIDTH,
} from '@/config/layout';
import { MAX_MESSAGE_LENGTH, SLOT_COUNT, slotDepth, slotShare } from '@/types/channel';
import { FLING_MS } from '@/utils/magnet';

import {
    ALBATROS,
    DEMO,
    VYMPEL,
    bubbles,
    clickShip,
    join,
    openChannel,
    openJoinForm,
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
 * Две раскладки, и выбирает между ними форма окна, а не человек: окно шире своей высоты —
 * разговор стоит справа и меряется шириной; окно выше своей ширины — разговор лежит под кадром
 * и меряется высотой. Кнопок переключения нет: повернул телефон — раскладка сменилась сама.
 *
 * Кадру достаётся всё остальное, и ещё полоска сверх того: он заезжает под разговор
 * на @chat-overlap, и щели между двумя плашками на стыке не бывает ни в покое, ни на ходу.
 */

/** Лежачее окно: разговор встаёт сбоку. */
const LYING = { width: 1200, height: 900 };

/** Стоячее окно: разговор ложится под кадром. */
const STANDING = { width: 420, height: 900 };

/**
 * Какого размера разговор в окне такой формы, пока его не трогали, px. Перевод доли в пиксели
 * тот же самый, что и в hooks/useLayout: сбоку доля от всей ширины, под кадром — от того,
 * что осталось под шапкой.
 */
const chatSize = (view: { width: number; height: number }): number =>
    view.width > view.height
        ? Math.round(view.width * CHAT_SHARE)
        : Math.round((view.height - SHEET_TOP_GAP) * CHAT_SHARE);

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
        await openJoinForm(page);
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
        // Ожидающим expect: новая ширина окна доходит до вёрстки не тем же кадром, в котором
        // о ней сказали, и разовый замер застаёт кнопки ещё в одной строке.
        await expect
            .poll(async () => (await actionsBar(page)).rows, {
                message: 'подписи не влезли в строку, а кнопки остались в ней',
            })
            .toBe(2);
        const stack = await actionsBar(page);
        for (const button of stack.buttons) {
            expect(button.width, 'кнопка на своей строке не заняла всю ширину').toBeCloseTo(stack.width, 0);
        }
    });

    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        await openJoinForm(page);
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

    test('кадр забирает всё, что не занял разговор, и держит свою пропорцию', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // В лежачем окне разговор стоит сбоку, а кадр берёт остаток — с нахлёстом на разговор,
        // чтобы между ними не открывалась щель ни в покое, ни на ходу. Прежде здесь стоял
        // потолок в ширину колонки: кадр держали узким, а по бокам оставляли фон. Колонка
        // осталась мерой для самого разговора, а кадру теперь достаётся всё остальное окно.
        expect(view.scene.width, 'кадр взял не остаток окна').toBe(1200 - chatSize(LYING) + CHAT_OVERLAP);
        expect(view.scene.height, 'кадр не во весь рост окна').toBe(900);
        // Кадр на десктопе разделён раз и навсегда: 40% неба, 60% воды. Прежде здесь стояло
        // обратное — небу отдавали больше половины, — но тогда вода держалась своей пиксельной
        // нормы, и пропорция кадра выходила разной в свёрнутом и развёрнутом виде.
        expect(view.horizon / view.scene.height, 'небо на десктопе взяло не свою долю').toBeCloseTo(SKY_SHARE, 2);
    });

    // Масштаб в списке один на всех, и линейка — единственное, что переводит его в метры.
    // Ошибись тут на шаг — и катер молча станет корветом.
    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        await openJoinForm(page);
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
        // Разметку рейда — линии, по которым тут и видно, съехал он или нет, — показывает
        // открытая форма корабля, и открыть её надо до замеров: перемена окна её не трогает.
        await openJoinForm(page);
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
        await openJoinForm(page);
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
        await openJoinForm(page);
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
        await openJoinForm(page);
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
        await openJoinForm(page);
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
const islandBelowHorizon = (page: Page): Promise<{ px: number; share: number }> =>
    page.evaluate((waterline) => {
        const island = document.querySelector('img[class*="island"]')!.getBoundingClientRect();
        const sky = document.querySelector('[class*="sky"]')!.getBoundingClientRect();
        const sea = document.querySelector('[class*="sea_"]')!.getBoundingClientRect();
        const px = island.top + waterline * island.height - sky.bottom;
        // Доля воды, а не пиксели: глубина берега задана долей (@island-line-share), и в высоком
        // кадре те же проценты дают больше пикселей. Пиксели остаются для сравнения двух окон
        // одной высоты — там доля и пиксели значат одно и то же.
        return { px, share: (px / sea.height) * 100 };
    }, ISLAND_WATERLINE);

/**
 * Берег острова стоит на своей дальности и никуда с неё не сходит. Отступ ему задан от горизонта
 * долей воды, а сдвиг картинки — долей её собственной высоты, и высота эта идёт за шириной сцены.
 * Пока доля верна, одно гасит другое; наврали в доле — и остаток растёт вместе с экраном.
 * Так и было: 19px под горизонтом на десктопе против 22px на телефоне при одном заданном числе.
 *
 * Сравнивается это внутри своей раскладки, а не поперёк. Воды в кадре у стоячего и лежачего
 * окна разное количество — под кадром разговор отнимает высоту, сбоку не отнимает, — так что
 * в пикселях берег и правда стоит у них на разной глубине. От ширины же экрана он не зависит
 * ни там, ни там: это и есть та ошибка, ради которой всё затевалось, и ловится она сравнением
 * широкого кадра с узким при одной высоте окна и одной раскладке.
 */
test('берег острова стоит на горизонте, а не отъезжает от него вместе с шириной экрана', async ({ page }) => {
    await openChannel(page, DEMO);

    // Замер после перемены окна — только когда кадр устоялся: и горизонт, и высота воды едут
    // переходом (@expand-seconds), а берег стоит по одному, меряется по другому, и на ходу
    // они не сходятся.
    const afterResize = async (width: number, height: number) => {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(600);
        return islandBelowHorizon(page);
    };

    // Лежачие окна одной высоты: разговор в обоих стоит сбоку, кадр в обоих во весь рост окна,
    // и разной у них только ширина — ровно то, от чего берег зависеть не должен.
    const wide = await afterResize(1200, 900);
    expect(wide.px, 'берег вылез на небо').toBeGreaterThan(0);
    expect(wide.share, 'берег уехал от горизонта на середину рейда').toBeLessThan(15);
    expect((await afterResize(1000, 900)).px, 'в узком кадре берег отошёл от горизонта').toBeCloseTo(wide.px, 0);

    // Стоячие окна одной высоты: разговор в обоих под кадром, кадру достаётся одна и та же
    // высота, и снова разная только ширина.
    const phone = await afterResize(MOBILE_MAX_WIDTH - 90, 844);
    expect(phone.px, 'на телефоне берег вылез на небо').toBeGreaterThan(0);
    expect(phone.share, 'на телефоне берег уехал от горизонта на середину рейда').toBeLessThan(15);
    expect((await afterResize(330, 844)).px, 'в узком телефонном кадре берег отошёл от горизонта').toBeCloseTo(
        phone.px,
        0
    );
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
    // Ожидающим expect: новая ширина окна доходит до вёрстки не тем же кадром, а высота сцены
    // и вовсе едет переходом — разовый замер застаёт кадр посреди дороги.
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await expect
        .poll(() => edgeGap(page), { message: 'на телефоне поле вышло другой доли кадра' })
        .toBeCloseTo(desktop, 0);
    const phone = await edgeGap(page);

    await page.setViewportSize({ width: 330, height: 700 });
    await expect
        .poll(() => edgeGap(page), { message: 'в узком кадре поле вышло другой доли кадра' })
        .toBeCloseTo(phone, 0);
});

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

/** Коробка блока в координатах окна — со всеми четырьмя кромками сразу. */
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

/**
 * Раскладку выбирает форма окна, и никто больше. Проверяются обе разом, на одном и том же окне
 * высотой 900: сперва лежачем, потом стоячем, — то есть ровно то движение, каким планшет
 * поворачивают в руке.
 *
 * Мерок тут четыре, и все четыре об одном — кто кому оставляет место: разговор встаёт в свою
 * долю, кадр забирает остаток, стык у них внахлёст на @chat-overlap, и кромка окна с той
 * стороны, где разговор, ему и достаётся.
 */
test('раскладку выбирает форма окна: лежачее — сбоку, стоячее — под кадром', async ({ page }) => {
    await page.setViewportSize(LYING);
    await openChannel(page, DEMO, ALBATROS);

    const beside = await contentBox(page);
    expect(beside.width, 'сбоку разговор встал не в свою долю ширины').toBe(chatSize(LYING));
    expect(beside.height, 'сбоку разговор не во всю высоту окна').toBe(LYING.height);
    expect(beside.left + beside.width, 'сбоку разговор не прижат к правой кромке окна').toBe(LYING.width);
    // Кадр — всё остальное и ещё полоска сверх: он заезжает под разговор, а не встаёт с ним встык.
    const asideFrame = await boxOf(page, 'header');
    expect(asideFrame.height, 'сбоку кадр не во всю высоту окна').toBe(LYING.height);
    expect(asideFrame.right - beside.left, 'кадр не заехал под разговор').toBe(CHAT_OVERLAP);

    // Тот же экран, повёрнутый: разговор сам переехал вниз.
    await page.setViewportSize(STANDING);
    await page.waitForTimeout(700);

    const under = await contentBox(page);
    expect(under.height, 'под кадром разговор встал не в свою долю места под шапкой').toBe(chatSize(STANDING));
    // Ширина отмерена от окна, а не от приложения: вся колонка целиком, от края до края.
    expect(under.width, 'под кадром разговор взял не ширину колонки').toBe(Math.min(STANDING.width, COLUMN_WIDTH));
    // И до нижней кромки окна тоже: поля вокруг него нет ни с боков, ни снизу.
    expect(under.top + under.height, 'разговор не дошёл до нижней кромки окна').toBe(STANDING.height);
    const overFrame = await boxOf(page, 'header');
    expect(overFrame.width, 'под кадром кадр не во всю ширину окна').toBe(STANDING.width);
    expect(overFrame.top + overFrame.height - under.top, 'кадр не заехал под разговор').toBe(CHAT_OVERLAP);

    // Скруглены и обведены только верхние углы: разговор не плашка на воде, а начало нижней
    // половины экрана.
    const corners = await page.locator('main').evaluate((node) => {
        const style = getComputedStyle(node);
        return {
            top: [style.borderTopLeftRadius, style.borderTopRightRadius],
            bottom: [style.borderBottomLeftRadius, style.borderBottomRightRadius],
            borders: [style.borderTopWidth, style.borderBottomWidth, style.borderLeftWidth, style.borderRightWidth],
        };
    });
    expect(corners.top, 'верхние углы разговора не скруглены').toEqual(['16px', '16px']);
    expect(corners.bottom, 'нижние углы разговора скруглены, а не доходят до кромки').toEqual(['0px', '0px']);
    expect(corners.borders, 'рамка стоит не только сверху').toEqual(['1px', '0px', '0px', '0px']);
});

/**
 * Кнопка в шапке убирает разговор с экрана совсем — и возвращает его туда, где оставили.
 * Раскладок это касается обеих: сбоку кадр забирает ширину, под кадром — высоту, а вернувшийся
 * разговор в обеих встаёт ровно в тот размер, в каком его убрали.
 *
 * Ушедший разговор остаётся в разметке нулевого размера — иначе с ним пропали бы и место
 * прокрутки ленты, и набранное в поле, — но недоступен вовсе: это и проверяется `inert`.
 */
/* eslint-disable no-await-in-loop -- окно одно, раскладки примеряются по очереди */
test('кнопка убирает разговор с экрана и возвращает его в прежний размер', async ({ page }) => {
    await page.setViewportSize(LYING);
    await openChannel(page, DEMO, ALBATROS);

    for (const [what, view] of [
        ['сбоку', LYING],
        ['под кадром', STANDING],
    ] as const) {
        await page.setViewportSize(view);
        await page.waitForTimeout(700);
        const before = await contentBox(page);
        expect(before.width * before.height, `${what}: разговора нет на экране до всякого нажатия`).toBeGreaterThan(0);

        await page.getByRole('button', { name: 'Убрать разговор' }).click();
        // Уход плавный, и сразу после нажатия кадр ещё в пути. Ждём не срок, а конец движения:
        // кадр перестаёт расти сам, когда дошёл до окна.
        // Обе мерки разом, а не по очереди: в одной раскладке кадр растёт вширь, в другой
        // вниз, и та, что не меняется, сходится с первого же замера — посреди движения второй.
        await expect
            .poll(
                async () => {
                    const { width, height } = await boxOf(page, 'header');
                    return { width, height };
                },
                { message: `${what}: кадр не занял всё окно` }
            )
            .toEqual({ width: view.width, height: view.height });
        await expect(page.locator('main'), `${what}: убранный разговор остался доступным`).toHaveAttribute('inert', '');

        await page.getByRole('button', { name: 'Вернуть разговор' }).click();
        await expect
            .poll(async () => await contentBox(page), { message: `${what}: разговор вернулся не в свой размер` })
            .toEqual(before);
    }
});
/* eslint-enable no-await-in-loop */

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
 * Свайп по кадру убирает разговор и возвращает его — и только в свою сторону. Сторона своя
 * на каждое положение: палец ведёт сам разговор, а тот лежит снизу, так что движение вниз
 * его отталкивает, а движение вверх притягивает обратно.
 *
 * Обратное движение кадр не забирает, и это здесь половина проверки: на движении вниз браузер
 * тянет страницу к обновлению, и жест, забранный во все стороны, забрал бы заодно и его.
 */
test('свайп по кадру убирает разговор в свою сторону, а обратное движение отдаёт системе', async ({ page }) => {
    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await openChannel(page, DEMO, ALBATROS);
    const chat = chatSize(phone);
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'разговор встал не в свою долю' })
        .toBe(chat);

    // Вверх по кадру с разговором — чужое движение: на экране всё то же, отмены нет.
    expect(await swipeScene(page, -120), 'кадр отменил чужое движение пальца').toBe(false);
    await page.waitForTimeout(400);
    expect((await contentBox(page)).height, 'разговор уехал от чужого движения').toBe(chat);

    // Вниз — своё: разговор уходит, и потяг страницы к обновлению на нём запрещён.
    expect(await swipeScene(page, 120), 'кадр не отменил своё движение пальца').toBe(true);
    await expect
        .poll(async () => (await boxOf(page, 'header')).height, { message: 'кадр не занял окно после свайпа вниз' })
        .toBe(phone.height);

    // И обратно: к убранному разговору своё движение — вверх.
    expect(await swipeScene(page, 120), 'кадр без разговора забрал движение вниз').toBe(false);
    expect(await swipeScene(page, -120), 'кадр не отменил своё движение пальца').toBe(true);
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'разговор не вернулся от свайпа вверх' })
        .toBe(chat);

    // Короткое движение — не свайп: так кадр возит палец, который просто ткнули мимо корабля.
    expect(await swipeScene(page, 24), 'короткий свайп убрал разговор').toBe(true);
    await page.waitForTimeout(400);
    expect((await contentBox(page)).height, 'разговор ушёл от короткого движения').toBe(chat);
});

/**
 * Уход и возврат разговора — движение, а не прыжок вверх и обратно. Держится это на двух вещах.
 *
 * Первая: --scene-height объявлена длиной (@property в index.less) и потому переходит
 * во времени. Пока она менялась скачком, коробка шапки ехала своим переходом, а всё, что
 * от этой мерки отмерено, вставало в конечное значение первым же кадром — и море под сценой
 * полперехода не доставало до разговора, отчего в прогалине светился фон чата.
 *
 * Вторая: мерки внутри сцены — горизонт, вода под ним, месяц — переходят каждая сама, теми же
 * секундами и той же кривой, что и высота кадра (см. --chat-move). Разойдись они хоть чем,
 * горизонт поднимался бы на полсотни пикселей раньше кадра, а месяц вместе с ним уходил бы
 * под верхнюю кромку.
 *
 * Проверяем поэтому не одну мерку, а всё, что должно ехать вместе, и в обе стороны: кадр,
 * линию воды, месяц и его диск. Порознь каждая из них выглядела бы правильной — расходились
 * они именно между собой.
 */
test('уход разговора растекается, а не прыгает', async ({ page }) => {
    await page.setViewportSize(STANDING);
    await openChannel(page, DEMO, ALBATROS);

    // Замер идёт покадрово и изнутри страницы: снаружи каждый заход стоит миллисекунд, и весь
    // переход в четыре десятых секунды успел бы кончиться за три замера.
    const record = (label: string) =>
        page.evaluate(async (name) => {
            const probe = () => {
                const moon = document.querySelector('[class*="moon_"]')!.getBoundingClientRect();
                const frame = document.querySelector('header')!.getBoundingClientRect();
                const chat = document.querySelector('main')!.getBoundingClientRect();
                return {
                    header: frame.height,
                    sea: document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top,
                    moon: moon.top,
                    disc: moon.height,
                    // Насколько кадр заехал под разговор. Меньше нуля — щель между ними.
                    overlap: frame.bottom - chat.top,
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
        // Щели между кадром и разговором нет ни на одном кадре движения: обе коробки идут
        // к своим целям одними секундами и одной кривой, а щель между ними — их разность,
        // и разность двух прямых остаётся прямой. Заезд по дороге бывает больше положенного —
        // это нормально, лишнее оказывается под разговором.
        const gap = Math.min(...frames.map((frame) => frame.overlap));
        expect(gap, 'между кадром и разговором открылась щель').toBeGreaterThanOrEqual(-SLACK);
    };

    const out = await record('Убрать разговор');
    expect(out[out.length - 1].header, 'кадр не дошёл до полного экрана').toBe(STANDING.height);
    check(out, true);

    const back = await record('Вернуть разговор');
    expect(back[back.length - 1].header, 'кадр не отдал разговору его место').toBeLessThan(back[0].header * 0.9);
    check(back, false);
});

/**
 * Какой рост положен кадру в окне такой формы, px. Та же выкладка, что и в стилях: всё окно
 * без разговора, плюс полоска заезда под него, но не ниже наименьшего кадра и не выше окна.
 */
const frameHeight = (view: { width: number; height: number }): number =>
    Math.min(
        view.height,
        Math.max(Math.max(SCENE_MIN_HEIGHT, SCENE_MIN_SHARE * view.height), view.height - chatSize(view) + CHAT_OVERLAP)
    );

/** Окно того же стоячего вида, но ниже: раскладка та же, а все мерки другие. */
const SHRUNK = { width: STANDING.width, height: 700 };

/** Покадровый замер живёт в окне страницы: заводят его одним заходом, читают другим. */
declare global {
    interface Window {
        __film: { frame: number; window: number }[];
    }
}

/**
 * Полсекунды на движение — это про перемены от разговора: убрали его кнопкой, потянули
 * за кромку, вернули из-за кромки после поворота. Само окно к этому отношения не имеет: свои
 * мерки оно меняет разом, и вести к ним кадр полсекунды значит полсекунды держать кадр
 * отмеренным по окну, которого уже нет. Видно это было на повороте отдельным движением поверх
 * переезда разговора — замер: сцена шла 604 → 700 после того, как окно уже стало 700 высотой.
 *
 * Проверяем поэтому не «плавно ли», а «когда»: на каждом кадре, где окно уже новое, кадр обязан
 * стоять в новом росте. Кадров этих десятки — переход, останься он, растянулся бы на все.
 *
 * И тут же обратное: снятие переходов держится ровно на смену окна и не остаётся насовсем —
 * кнопка после этого убирает разговор всё тем же движением, что и до.
 */
test('кадр встаёт в новый рост вместе с окном, а не едет к нему следом', async ({ page }) => {
    await page.setViewportSize(STANDING);
    await openChannel(page, DEMO, ALBATROS);

    // Замер идёт покадрово и изнутри страницы: снаружи каждый заход стоит миллисекунд, и весь
    // переход в полсекунды прошёл бы между двумя замерами незамеченным.
    //
    // Заводится он отдельным заходом и складывает кадры в окно: дожидаться его результата
    // нельзя — окно меняют снаружи, и ждущая проверка не дошла бы до смены окна вовсе.
    await page.evaluate(() => {
        window.__film = [];
        const since = performance.now();
        const tick = (): void => {
            window.__film.push({
                frame: document.querySelector('header')!.getBoundingClientRect().height,
                window: window.innerHeight,
            });
            if (performance.now() - since < 1200) {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    });
    // Несколько кадров до смены окна: по ним видно, что замер идёт и что до перемены кадр
    // стоял в прежнем росте, — иначе проверка прошла бы и на пустом замере.
    await page.waitForTimeout(100);
    await page.setViewportSize(SHRUNK);
    await page.waitForTimeout(900);
    const film = await page.evaluate(() => window.__film);

    const before = film.filter((shot) => shot.window === STANDING.height);
    const after = film.filter((shot) => shot.window === SHRUNK.height);
    expect(before.length, 'замер начался уже после смены окна').toBeGreaterThan(0);
    expect(after.length, 'кадров после смены окна не набралось').toBeGreaterThan(10);

    // Допуск в пиксель — на дробную высоту и округление разметки, а не на движение: отставший
    // кадр расходился с новым окном на сотню с лишним.
    const off = (shot: { frame: number }, want: number): boolean => Math.abs(shot.frame - want) > 1;
    expect(before.filter((shot) => off(shot, frameHeight(STANDING))).length, 'кадр не в своём росте до замера').toBe(0);
    expect(
        after.filter((shot) => off(shot, frameHeight(SHRUNK))).map((shot) => Math.round(shot.frame)),
        'кадр ехал к новому росту вслед за окном'
    ).toEqual([]);

    // Разговор при этом остался прежней долей нового окна: окно урезало кадр, а выбора не
    // тронуло.
    expect((await contentBox(page)).height, 'разговор не пересчитался под новое окно').toBe(chatSize(SHRUNK));

    const moving = await page.evaluate(async () => {
        const taken: number[] = [];
        document.querySelector<HTMLElement>('[aria-label="Убрать разговор"]')!.click();
        await new Promise<void>((resolve) => {
            const tick = (): void => {
                taken.push(Math.round(document.querySelector('header')!.getBoundingClientRect().height));
                if (taken.length < 20) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        return taken;
    });
    expect(new Set(moving).size, 'кадр отдал разговору место прыжком, а не движением').toBeGreaterThan(5);
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

    // В кадре во весь экран рост тот же: это слой воздуха у воды, а не часть рисунка, которую
    // перспектива тянет вместе с кадром.
    await page.getByRole('button', { name: 'Убрать разговор' }).click();
    await expect
        .poll(async () => (await measure()).height, { message: 'дымка выросла вместе с кадром' })
        .toBe(HAZE_HEIGHT);
    expect(Math.abs((await measure()).gap), 'дымка сошла с линии воды').toBeLessThan(1);
});

/**
 * Форма настройки корабля живёт отдельно от разговора.
 *
 * Раньше она лежала внутри блока разговора: убранный разговор схлопывался в ноль и глох для
 * указателя (`inert`), а с ним пропадала и форма. То есть на кадре во весь экран — там, где
 * рейд как раз и виден лучше всего, — нажатие по своему кораблю не делало ровно ничего.
 * Теперь форма стоит соседом разговору и тем же размером: разговор ушёл, форма выехала.
 *
 * Размер в убранном разговоре нулевой, поэтому форма меряется не им, а тем, в какой размер
 * его вернёт кнопка (`back` в hooks/useLayout, `--form-to` в стилях).
 */
const berthSpan = (page: Page): Promise<number> =>
    page.evaluate(() => {
        const marks = [...document.querySelectorAll('[data-berth]')].map((el) => el.getBoundingClientRect());
        const top = Math.min(...marks.map((mark) => mark.top));
        const bottom = Math.max(...marks.map((mark) => mark.bottom));
        return bottom - top;
    });

const PHONE = { width: MOBILE_MAX_WIDTH - 90, height: 844 };

test('с убранным разговором форма своего корабля всё равно выезжает', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    await page.getByRole('button', { name: 'Убрать разговор' }).click();
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'разговор не ушёл с экрана').toBeVisible();

    // Открываем форму на голом кадре: список кораблей достают из шапки, и он от разговора
    // не зависит вовсе.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(600);

    const form = await boxOf(page, '[class*="form_"]');
    expect(form.height, 'форма выехала нулевой высоты — то есть не выехала').toBe(chatSize(PHONE));
    expect(form.top + form.height, 'форма не дошла до нижней кромки окна').toBe(PHONE.height);
    await expect(page.getByRole('button', { name: 'Готово' }), 'в форме не видно кнопки готовности').toBeVisible();

    // И работает она целиком: место на рейде выбирается прямо отсюда.
    const marks = page.locator('[data-berth]');
    expect(await marks.count(), 'на форме не показали свободных мест').toBeGreaterThan(0);
    expect(await berthSpan(page), 'отметки мест сошлись в точку').toBeGreaterThan(0);
    await marks.first().click();

    // Разговор при этом так и остался убранным: форма его не возвращала и не подменяла собой.
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'форма вернула разговор').toBeVisible();
});

/**
 * Под открытой формой разговор не убирают: кнопки на это в шапке нет.
 *
 * Форма занимает ровно то же место, и убранный из-под неё разговор не поменял бы на экране
 * ничего — кроме значка на самой кнопке. Увидеть последствия можно было бы только закрыв
 * форму, то есть неожиданностью.
 */
test('под открытой формой в шапке нет кнопки разговора, а рейд стоит на месте', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const before = await boxOf(page, 'header');
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(600);

    await expect(page.getByRole('button', { name: 'Убрать разговор' }), 'под формой осталась кнопка').toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'под формой осталась кнопка').toHaveCount(0);
    // Место у формы то же, что у разговора, — значит, и кадр над ней прежнего роста.
    expect((await boxOf(page, 'header')).height, 'кадр под открытой формой поменял рост').toBe(before.height);

    // Закрылась форма — кнопка вернулась, и разговор в том же положении, в каком его застали.
    await page.getByRole('button', { name: 'Отмена' }).click();
    await page.waitForTimeout(600);
    await expect(
        page.getByRole('button', { name: 'Убрать разговор' }),
        'кнопка не вернулась с уходом формы'
    ).toBeVisible();
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
 * Ширина шторки. В просторном окне она упирается в свой предел и стоит по центру той полосы,
 * что ей досталась: шторка приезжает на кадр, и по краям должно быть видно, что под ней что-то
 * есть. На телефоне предел ни на что не влияет — там окно и так уже колонки.
 */
test('шторка в просторном окне уже своей полосы и по центру, а на телефоне во всю ширину', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const window = page.viewportSize()!;
    // Полоса под шторку — всё, что не занял разговор: сбоку он отнимает у неё ширину справа.
    const room = window.width - chatSize(window);
    const desk = await shadeBox(page);
    expect(desk.width, 'шторка в просторном окне взяла не свою ширину').toBe(SHEET_WIDTH);
    expect(desk.width, 'шторка не уже своей полосы').toBeLessThan(room);
    expect(Math.round(desk.left + desk.width / 2), 'шторка встала не по центру своей полосы').toBe(room / 2);

    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await expect
        .poll(async () => (await shadeBox(page)).width, {
            message: 'на телефоне шторка не в ширину окна за вычетом полоски по краям',
        })
        .toBe(phone.width - SHEET_INSET);
});

/**
 * Открытая шторка забирает экран себе: затемнение лежит по всему окну, и под ним всё —
 * кадр, разговор и шапка. Пока шторка на экране, разговор идёт только про неё, и нажатие
 * куда угодно мимо означает одно: «убери».
 *
 * Шапка тут отдельно: прежде она стояла выше затемнения, и кнопками из неё шторку открывали
 * и закрывали поверх уже открытой. Теперь она под ним — выходов из шторки и так три.
 */
test('открытая шторка забирает экран себе, и шапка тоже под затемнением', async ({ page }) => {
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
    expect(layers.header, 'шапка осталась поверх затемнения').toBeLessThan(layers.backdrop);

    // Затемнение — во всё окно, а не по кадру: разговор сбоку гаснет вместе со всем остальным.
    const window = page.viewportSize()!;
    const backdrop = await boxOf(page, 'button[aria-label="Закрыть шторку"]');
    expect(backdrop.width, 'затемнение погасило не всё окно').toBe(window.width);
    expect(backdrop.height, 'затемнение погасило не всё окно').toBe(window.height);

    // Кнопки шапки из-под затемнения не достать: нажатие по её месту достаётся затемнению,
    // и шторка от него закрывается, а не открывает вторую.
    const ships = (await shipsButton(page).boundingBox())!;
    await page.mouse.click(Math.round(ships.x + ships.width / 2), Math.round(ships.y + ships.height / 2));
    await expect(shadeRegion(page), 'нажатие по шапке не закрыло шторку').toHaveCount(0);
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
 * Прокрутка главнее потяга ровно до тех пор, пока ей есть куда мотаться: список и всё, что
 * мотается само, обязаны мотаться, а не превращать движение пальца в закрытие. А домотанный
 * до верха список вниз больше не едет — движение по нему осталось бы ничьим, и потяг поэтому
 * достаётся шторке.
 *
 * Колесом же шторка не двигается вовсе — прежде накрученное переставляло её на соседнюю ступень,
 * но ступеней больше нет, а закрывать список случайной прокруткой мыши над ним — худшее, что
 * можно сделать с содержимым, которое человек читает.
 */
test('шторка тянется с домотанной до верха прокрутки, с недомотанной — нет, а колесо её не трогает', async ({
    page,
}) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    // Список длиннее шторки: иначе мотать нечего и правило не на чем проверить.
    await growSheetList(page);
    const before = await shadeBox(page);

    const list = page.locator(SHEET_LIST);
    const box = (await list.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.wheel(0, 400);
    await expect
        .poll(() => list.evaluate((node) => Math.round(node.scrollTop)), {
            message: 'колесо над списком не смотало его',
        })
        .toBeGreaterThan(0);
    expect((await shadeBox(page)).top, 'колесо сдвинуло шторку').toBe(before.top);

    // Смотанный список забирает потяг себе: под пальцем ещё есть что мотать вверх.
    await dragAt(page, box.x + box.width / 2, box.y + 40, Math.round(before.height * 0.6));
    await expect(shadeRegion(page), 'потяг по смотанному списку закрыл шторку вместо прокрутки').toHaveCount(1);

    // Домотали до верха — и тот же потяг достаётся шторке.
    await list.evaluate((node) => node.scrollTo(0, 0));
    await dragAt(page, box.x + box.width / 2, box.y + 40, Math.round(before.height * 0.6));
    await expect(shadeRegion(page), 'потяг по домотанному до верха списку не закрыл шторку').toHaveCount(0);
});

/**
 * То же правило глазами того, ради кого оно и переделано: карточка корабля в коротком окне.
 *
 * Стоит содержимому перерасти окно, как своя прокрутка появляется у всей карточки — то есть
 * у всего, что в шторке видно, от позывного до кнопок внизу. Потяг вниз доставался ей отовсюду,
 * и закрыть шторку выходило только за рисочку ручки или крестиком: на телефоне это и читалось
 * как «шторка не закрывается».
 *
 * Окно тут короткое нарочно — мышью на просторном это не воспроизводится вовсе.
 */
test('карточка корабля в коротком окне закрывается потягом вниз из середины', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    // Узкое и короткое окно: карточке в нём тесно, и она мотается сама. Ширина заметно меньше
    // высоты нарочно — раскладка выбирается по сторонам окна, и почти квадратное ушло бы
    // в горизонтальную, где разговор стоит сбоку и шторке достаётся полоска.
    await page.setViewportSize({ width: 320, height: 380 });
    await openShipCard(page, 'Вымпел');

    const card = page.getByRole('region', { name: 'Корабль' });
    const body = card.locator('[class*="card_"]');
    // Проверка держится на том, что карточка и правда мотается сама: не мотайся она, потяг
    // достался бы шторке и без всякой починки.
    expect(
        await body.evaluate((node) => node.scrollHeight - node.clientHeight),
        'карточка в коротком окне не переросла окно, и проверять нечего'
    ).toBeGreaterThan(0);

    // От середины карточки до нижней кромки окна: дальше курсор не увести, а этого пути
    // с запасом хватает на треть высоты шторки, за которой она и закрывается.
    const box = (await body.boundingBox())!;
    const startY = Math.round(box.y + box.height / 2);
    await dragAt(page, box.x + box.width / 2, startY, page.viewportSize()!.height - 10 - startY);
    await expect(card, 'потяг вниз по карточке её не закрыл').toHaveCount(0);
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
    // Стоячее окно: разговор встаёт под кадром на треть высоты, и вся лента в него не влезает
    // — ей есть куда уходить. В лежачем разговор во весь рост окна, семь демо-реплик
    // помещаются целиком, и полоске там взяться неоткуда — это не поломка, а то же правило.
    await page.setViewportSize(STANDING);

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
    // Форма живёт не внутри блока разговора, а соседом ему (см. `--form-to`), — поэтому
    // и селектор без `main`. Правило от этого не поменялось: полоску даёт TopFade, и достаётся
    // она любому прокручиваемому внутри, где бы тот ни стоял.
    const form = await trackInset(page, 'form[class*="card"]');
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
 * На широком окне шапка просторнее, и кнопки в ней крупнее — все разом. Размер приходит
 * к ним от самой шапки (`--icon-button-size`, `--icon-button-icon`), а не просится у каждой
 * кнопки отдельным свойством: прежде просился, и кнопка выхода с рейда, добавленная позже,
 * его не получила — стояла в ряду крупных мелочью.
 *
 * Проверяется поэтому не число, а равенство: сколько бы ни было кнопок в шапке и какая бы
 * из них ни появилась завтра, они одного роста и вырастают вместе.
 *
 * Ведёт их ширина окна, а не раскладка: раскладку выбирает форма окна, а кадр в обеих
 * во всю ширину, и укрупнять шапку от ухода разговора не за чем.
 */
test('кнопки в шапке одного роста и вместе растут с шириной окна', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);

    const small = await headerButton(page, 'Убрать разговор');

    await page.setViewportSize({ width: COLUMN_WIDTH + 440, height: 900 });
    await page.waitForTimeout(600);

    const big = await headerButton(page, 'Убрать разговор');
    expect(big.size, 'на широком окне кнопки не выросли').toBeGreaterThan(small.size);
    expect(big.icon, 'значок в выросшей кнопке остался прежним').toBeGreaterThan(small.icon);

    // И выход с рейда — та самая кнопка, что отставала. Она встаёт в шапку, когда открыта
    // форма своего корабля, и добавлена позже остальных: свойства на укрупнение ей тогда
    // не досталось.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    expect(await headerButton(page, 'Уйти с рейда'), 'кнопка выхода отстала от остальных').toEqual(big);
});

/**
 * Кадр заезжает под разговор на @chat-overlap, и это правильно: полоска воды уходит под кромку,
 * и стык не читается щелью. Но полоса шапки отмерена от кадра — и заезжала вместе с ним, унося
 * под разговор правую кнопку. В просторном окне из неё пропадало шесть пикселей, в тесном —
 * семь, и чем теснее, тем заметнее: кнопка, у которой обрезан бок, читается съехавшей.
 *
 * Проверяется не отступ, а последствие: кнопка целиком в видимой части кадра, в любом окне
 * боковой раскладки. Числа тут разъезжаются с шириной (кнопка растёт по --wide, разговор
 * упирается в свой минимум), и сверять их поштучно значило бы переписывать проверку на каждую
 * правку оформления.
 */
test('кнопка в шапке не уходит под кромку разговора ни в одном лежачем окне', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // По очереди, а не разом: окно у страницы одно, и следующий размер должен ставиться
    // после того, как проверен предыдущий.
    await [
        { width: 1400, height: 900 },
        { width: 1200, height: 900 },
        { width: 900, height: 700 },
        { width: 800, height: 500 },
        { width: 700, height: 400 },
    ].reduce(async (before, view) => {
        await before;
        await page.setViewportSize(view);
        await expect
            .poll(
                async () => {
                    const button = await page.getByRole('button', { name: 'Убрать разговор' }).boundingBox();
                    const chat = await page.locator('main').boundingBox();
                    if (!button || !chat) {
                        return 'нет кнопки или разговора';
                    }
                    // Зазор до кромки: отрицательный — значит кнопка уже под разговором.
                    return Math.round(chat.x - (button.x + button.width)) >= 0 ? 'на виду' : 'под разговором';
                },
                { message: `${view.width}×${view.height}: кнопка` }
            )
            .toBe('на виду');
    }, Promise.resolve());
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
    // Закрываем крестиком: шапка под затемнением, и кнопкой из неё список уже не убрать.
    await shadeRegion(page).getByRole('button', { name: 'Закрыть' }).click();
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
        const size = `${frame.width}×${frame.height}${full ? ', без разговора' : ''}`;
        await page.setViewportSize(frame);
        await page.getByRole('button', { name: full ? 'Убрать разговор' : 'Вернуть разговор' }).click();
        await expect(page.getByRole('button', { name: full ? 'Вернуть разговор' : 'Убрать разговор' })).toBeVisible();
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
                    // По вертикали — верхняя половина неба в любом из четырёх кадров.
                    // Полоса допуска тут широкая нарочно: снимок стоит от горизонта и в поджатом
                    // кадре не пересчитывается, так что доля видимой полосы, на которой
                    // оказывается созвездие, у поджатого своя — от 14% до 48%. Насколько
                    // именно — сверяется ниже, замером двух кадров друг против друга.
                    if (y < 10 || y > 50) {
                        return `уехал по вертикали: ${y}%`;
                    }
                    return 'на месте';
                },
                { message: `${size}: Орион` }
            )
            .toBe('на месте');
        // Полоса допуска у проверки выше широкая, и сойтись она может ещё на ходу. Для замера,
        // который потом сравнивается с другим кадром, этого мало: ждём конца движения.
        await page.waitForTimeout(700);
        return (await orions())[0].y;
    };

    const spots: Record<string, number> = {};
    await [
        { key: 'лежачее без разговора', frame: { width: 1200, height: 900 }, full: true },
        { key: 'лежачее с разговором', frame: { width: 1200, height: 900 }, full: false },
        { key: 'стоячее без разговора', frame: { width: 390, height: 844 }, full: true },
        { key: 'стоячее с разговором', frame: { width: 390, height: 844 }, full: false },
    ].reduce(async (before, step) => {
        await before;
        spots[step.key] = await measure(step.frame, step.full);
    }, Promise.resolve());

    // В лежачем окне разговор отнимает у кадра ширину, а не высоту: небо там одной высоты
    // с разговором и без него, и созвездию двигаться незачем.
    expect(spots['лежачее с разговором'], 'сбоку разговор сдвинул созвездие').toBeCloseTo(
        spots['лежачее без разговора'],
        0
    );
    // В стоячем — отнимает высоту, и полоса неба становится ниже. Снимок при этом не сжимается
    // вместе с ней: он стоит от горизонта и в той же мере, что и в полном кадре, — а значит
    // созвездие остаётся на прежней высоте над водой. Полоса укоротилась сверху, от неба, так
    // что под созвездием её доля выросла, а над ним — та, которую и меряет `y`, — упала.
    // Сожмись снимок вместе с полосой — доля осталась бы той же, и это была бы та самая
    // поломка, из-за которой небо когда-то дёргалось на каждом движении разговора.
    expect(spots['стоячее с разговором'], 'под кадром небо сжалось вместе с полосой').toBeLessThan(
        spots['стоячее без разговора']
    );
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
    // Без разговора: там кадр во весь экран, плитки крупнее всего, и там же черту было видно
    // невооружённым глазом.
    await page.getByRole('button', { name: 'Убрать разговор' }).click();
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
        await page.getByRole('button', { name: 'Убрать разговор' }).click();
        await expect(page.getByRole('button', { name: 'Вернуть разговор' })).toBeVisible();
        await expectCovered(`${size}, без разговора`);
        await page.getByRole('button', { name: 'Вернуть разговор' }).click();
        await expect(page.getByRole('button', { name: 'Убрать разговор' })).toBeVisible();
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

/** Кадр в окне заданной формы, с разговором или без него, — и замер неба в нём. */
const skyIn = async (page: Page, frame: { width: number; height: number }, full: boolean) => {
    await page.setViewportSize(frame);
    const switcher = page.getByRole('button', { name: full ? 'Убрать разговор' : 'Вернуть разговор' });
    if (await switcher.isVisible()) {
        await switcher.click();
    }
    await expect(page.getByRole('button', { name: full ? 'Вернуть разговор' : 'Убрать разговор' })).toBeVisible();
    // Горизонт едет @expand-seconds, и всё, что от него отмерено, едет вместе с ним: замер
    // посреди перехода поймал бы небо не на своём месте.
    await page.waitForTimeout(700);
    return skyFrame(page);
};

/** Четыре кадра разом: широкое окно и телефонное, с разговором на экране и без него. */
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
 * не должен. Телефон не в счёт по сдвигу: неба в тесном кадре полоса в 120px, и тридцать
 * пикселей съели бы четверть её. Сдвиг там нулевой и с разговором, и без него — уход разговора
 * его не добавляет, иначе звёзды переезжали бы на глазах.
 *
 * А вот месяц отмерен одинаково везде — долей неба от линии воды, все четыре кадра
 * по одному правилу. Своего отсчёта у телефона больше нет: он был от строки состояния,
 * и месяц там стоял на месте, пока под ним открывалось небо. Теперь месяц едет вместе
 * с горизонтом: тесный кадр срезает его верхней кромкой заодно со звёздами, кадр во весь
 * экран — показывает целиком.
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

    expectDropped(frames.desk, SKY_DROP, 'широкое окно');
    expectDropped(frames.deskFull, SKY_DROP, 'широкое окно без разговора');
    expectDropped(frames.phone, 0, 'телефон');
    expectDropped(frames.phoneFull, 0, 'телефон без разговора');

    // Высота месяца над водой — доля неба, а не пиксели и не доля кадра: в каждом виде своя
    // высота неба, и месяц стоит на той же её части. Мерка одна на все четыре кадра —
    // отдельного телефонного отсчёта тут нет и быть не должно.
    for (const [label, frame] of [
        ['широкое окно', frames.desk],
        ['широкое окно без разговора', frames.deskFull],
        ['телефон', frames.phone],
        ['телефон без разговора', frames.phoneFull],
    ] as const) {
        const expected = frame.skyHeight * MOON_ABOVE_SHARE;
        expect(Math.abs(frame.moonAbove - expected), `${label}: месяц стоит не на своей доле неба`).toBeLessThanOrEqual(
            1
        );
    }

    // Следствие того же правила, и ради него оно и заведено: ушедший разговор открывает небо —
    // значит, месяц поднимается над водой выше. Прежде на телефоне было наоборот: месяц был
    // прибит к строке состояния и оставался на месте, пока небо под ним росло.
    //
    // Стоячее окно тут одно: сбоку разговор отнимает у кадра ширину, а не высоту, и небу
    // от его ухода не прибавляется ничего. Это и проверяется следом.
    expect(frames.phoneFull.moonAbove, 'телефон: без разговора месяц не поднялся над водой выше').toBeGreaterThan(
        frames.phone.moonAbove
    );
    expect(frames.phoneFull.moonTop, 'телефон: ушедший разговор не опустил месяц ниже кромки кадра').toBeGreaterThan(
        frames.phone.moonTop
    );
    expect(frames.deskFull.moonAbove, 'сбоку месяц поехал от ухода разговора').toBe(frames.desk.moonAbove);
    expect(frames.deskFull.skyHeight, 'сбоку небо выросло от ухода разговора').toBe(frames.desk.skyHeight);
});

/**
 * Ушедший разговор открывает небо, а не переставляет его: снимок стоит относительно горизонта
 * на том же месте и того же размера, что и в тесном кадре. Мерок тут две, и обе нужны —
 * место (низ снимка относительно линии воды) и размер (высота плитки). Съедет любая — и звёзды
 * поедут поверх воды: рисунок созвездий в сцене единственный узнаваемый, и глаз ловит его
 * движение раньше всего остального.
 *
 * Ловятся этим две разные поломки. Размер стерёг ещё прежний замер: высота плитки считается
 * от --sky-reach, от того, до чего небо в этом окне может дорасти, а не от нынешней его высоты
 * (см. --sky-tile). Место — новое: у телефонного кадра во весь экран стояла своя тридцатка
 * сдвига, и небо съезжало вниз сверх того, что и так уходит вместе с горизонтом.
 */
test('уход разговора не двигает и не масштабирует небо', async ({ page }) => {
    const frames = await skyFrames(page);

    for (const [label, compact, full] of [
        ['широкое окно', frames.desk, frames.deskFull],
        ['телефон', frames.phone, frames.phoneFull],
    ] as const) {
        expect(full.photoBelow, `${label}: небо переехало относительно воды`).toBe(compact.photoBelow);
        expect(full.photoHeight, `${label}: небо сменило размер`).toBe(compact.photoHeight);
    }
    // Само небо при этом открывается — там, где разговор отнимал у кадра высоту.
    expect(frames.phoneFull.skyHeight, 'телефон: ушедший разговор не открыл неба').toBeGreaterThan(
        frames.phone.skyHeight
    );
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
 * Шапка растёт вместе с шириной окна — и только с ней. На телефоне название канала и без того
 * обрезано многоточием: от прибавки букв и полей от него оставалось полслова. На широком окне
 * прежние размеры читались бы мелочью в углу, — там шапка укрупняется. Прибавка набирается
 * вместе с шириной окна по шкале --wide, а не включается порогом; здесь проверяются оба её
 * конца, непрерывность — отдельно ниже.
 *
 * За раскладкой шапка не идёт вовсе: кадр в обеих во всю ширину окна, и уход разговора добавляет
 * ему высоты, а не простора для букв.
 */
test('шапка растёт с шириной окна, а не с уходом разговора', async ({ page }) => {
    await page.setViewportSize({ width: MOBILE_MAX_WIDTH - 90, height: 844 });
    await openChannel(page, DEMO, ALBATROS);
    const phone = await headerSize(page);

    await page.getByRole('button', { name: 'Убрать разговор' }).click();
    await expect(page.getByRole('button', { name: 'Вернуть разговор' })).toBeVisible();
    // Уход едет @expand-seconds, и кнопки в шапке успели бы сменить размер на ходу.
    await page.waitForTimeout(700);
    expect(await headerSize(page), 'на телефоне шапка поменялась от ухода разговора').toEqual(phone);

    // Окно раздаётся вширь — разговор всё так же убран.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(700);
    const deskFull = await headerSize(page);
    await page.getByRole('button', { name: 'Вернуть разговор' }).click();
    await expect(page.getByRole('button', { name: 'Убрать разговор' })).toBeVisible();
    await page.waitForTimeout(700);
    const desk = await headerSize(page);

    expect(desk, 'на широком окне шапка поменялась от возврата разговора').toEqual(deskFull);
    expect(desk.title, 'на широком окне название не выросло').toBeGreaterThan(phone.title);
    expect(desk.status, 'на широком окне подзаголовок не вырос').toBeGreaterThan(phone.status);
    expect(desk.button, 'на широком окне кнопка не выросла').toBeGreaterThan(phone.button);
    expect(desk.padding, 'на широком окне поля шапки не выросли').not.toBe(phone.padding);
});

/**
 * Обещание разговора, открытого в треть: из него читается разговор, а не то, что он где-то есть.
 * Две последние реплики целиком и поле ввода под ними — на это треть и рассчитана, и проверяется
 * здесь ровно она: не «лента чему-то равна», а сколько пузырей влезло целиком между верхом блока
 * и полем ввода.
 *
 * Считаем на телефоне: колонка там уже, реплики переносятся чаще, и строки выходят выше,
 * чем на широком окне, — то есть это худший из двух случаев, да ещё и с меньшей меркой.
 *
 * Реплики для счёта пишем свои, короткие: в демо-канале лежат абзацы на пять строк, и треть
 * под них не рассчитана — две таких не влезут ни в какую разумную высоту. Обещание же про
 * обычный разговор, а обычная реплика в одну строку.
 */
test('в разговоре на треть экрана видно две последние реплики и поле ввода', async ({ page }) => {
    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await openChannel(page, DEMO, ALBATROS);
    await expect
        .poll(async () => (await contentBox(page)).height, { message: 'разговор встал не в свою треть' })
        .toBe(chatSize(phone));

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
    expect(whole, 'из разговора на треть видно меньше двух реплик целиком').toBeGreaterThanOrEqual(2);
    await expect(page.getByPlaceholder('Сообщение'), 'поле ввода не влезло в разговор на треть').toBeInViewport();
});

/**
 * Короткое окно — телефон, положенный на бок: 844 на 390. Окно лежачее, значит разговор
 * встаёт сбоку, — и вот тут его доля ни во что не годится: треть от 844 это 281px, а лента
 * ниже 300 нечитаема. Пределы в такой тесноте сходятся в точку: пол выше потолка (кадру
 * не остаётся и его собственного минимума), и пол сильнее.
 *
 * Проверяется ровно это: разговор встал в свой минимум, кадру досталось всё прочее, а поле
 * ввода на экране.
 */
test('в тесном лежачем окне разговор не бывает уже своего минимума', async ({ page }) => {
    const lying = { width: 844, height: 390 };
    await page.setViewportSize(lying);
    await openChannel(page, DEMO, ALBATROS);

    await expect
        .poll(async () => (await contentBox(page)).width, { message: 'разговор ужался ниже своего минимума' })
        .toBe(SIDE_MIN_WIDTH);
    expect((await contentBox(page)).height, 'разговор не во всю высоту короткого окна').toBe(lying.height);
    // Кадру достаётся остальное — и полоска заезда сверх того.
    expect((await boxOf(page, 'header')).width, 'кадр взял не остаток тесного окна').toBe(
        lying.width - SIDE_MIN_WIDTH + CHAT_OVERLAP
    );
    await expect(page.getByPlaceholder('Сообщение'), 'в коротком окне пропало поле ввода').toBeInViewport();
});

/**
 * Ступеньки на границе телефона нет. Прежде на 480px стоял порог, и один пиксель ширины разом
 * переставлял всё, что под телефон подгонялось: небо, месяц, коридоры рейда, укладку стрелки
 * курса, размеры шапки и кнопок. Теперь у каждого такого числа два настроенных конца и шкала
 * между ними (`--wide` в index.less), и проверяется ровно это.
 *
 * Меряются мерки сцены, а не картинка: именно они переставлялись порогом, а всё остальное
 * в кадре считается от них. Взяты те, что объявлены через `@property` (см. index.less):
 * у них computed-значение — число, а не строчка `calc(...)`, и его можно сравнить.
 *
 * Три условия сразу. На 479 и 480 — одно и то же (телефонный конец шкалы стоит на 480px,
 * и до него включительно ничего не меняется). Дальше числа едут, и на самом пороге едут
 * с тем же шагом, что и следом за ним: пиксель с 480 на 481 меняет ровно столько же, сколько
 * пиксель с 481 на 482, — а порог дал бы на первом из них скачок во весь отрезок. Сравнивается
 * поэтому не сам шаг с каким-то допуском (у разных чисел отрезки разной длины, и у стрелки
 * курса пиксель ширины честно стоит почти пикселя перспективы), а два соседних шага между
 * собой. И посередине отрезка каждое число стоит строго между своими концами — то есть шкала
 * и правда едет, а не переключается где-то в другом месте.
 */
const RAMP = ['--sky-drop', '--berth-arrow-eye', '--berth-arrow-lean', '--berth-arrow-times'];

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
    const next = await at(MOBILE_MAX_WIDTH + 2);
    const middle = await at((MOBILE_MAX_WIDTH + COLUMN_WIDTH) / 2);
    const wide = await at(COLUMN_WIDTH + 140);

    expect(edge, 'на 479 и 480 мерки сцены разошлись').toEqual(before);
    RAMP.forEach((name, index) => {
        const onEdge = after[index] - edge[index];
        const beyond = next[index] - after[index];
        expect(Math.abs(onEdge - beyond), `${name} прыгнул на пикселе после порога`).toBeLessThan(0.05);

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
 * Убранный разговор уезжает за кромку окна целиком и своим размером — как уходит всякая
 * шторка, — а не сминается до нуля.
 *
 * Прежде ехала высота, и разговор на глазах превращался в кашу: лента с полем ввода сжимались
 * в полоску, а вернувшись, раскладывались обратно. Ещё раньше, до общей нижней привязки, блок
 * вдобавок подскакивал вверх на разницу высот (замер: 244px при окне 844) и полперехода
 * сползал обратно.
 *
 * Меряется покадрово и то и другое: высота обязана стоять на месте всё движение, а верх —
 * пройти от своего места до самой кромки окна. Одного без другого мало: неподвижный блок
 * прошёл бы проверку на высоту, а сминающийся — проверку на движение.
 */
const boxWhileSwitching = (page: Page, button: string) =>
    page.evaluate(async (label) => {
        const main = document.querySelector('main')!;
        const taken: { top: number; height: number }[] = [];
        const probe = (): void => {
            const box = main.getBoundingClientRect();
            taken.push({ top: Math.round(box.top), height: Math.round(box.height) });
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

test('разговор уезжает за кромку целиком, а не сминается до нуля', async ({ page }) => {
    const window = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(window);
    await openChannel(page, DEMO, ALBATROS);

    const check = (frames: { top: number; height: number }[], button: string): void => {
        const heights = [...new Set(frames.map((frame) => frame.height))];
        expect(heights, `«${button}»: разговор менял высоту, а не уезжал`).toHaveLength(1);

        const tops = frames.map((frame) => frame.top);
        expect(Math.max(...tops) - Math.min(...tops), `«${button}»: разговор не двинулся`).toBeGreaterThan(100);
        // Ниже кромки окна он не опускается: уехал ровно на себя самого, не дальше.
        expect(Math.max(...tops), `«${button}»: разговор уехал дальше кромки окна`).toBeLessThanOrEqual(window.height);
        expect(Math.min(...tops), `«${button}»: разговор поднялся выше своего места`).toBeGreaterThanOrEqual(
            window.height - heights[0]
        );
    };

    check(await boxWhileSwitching(page, 'Убрать разговор'), 'Убрать разговор');
    check(await boxWhileSwitching(page, 'Вернуть разговор'), 'Вернуть разговор');
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
 * Меряется покадрово одно и то же: ничто себя не промотало, а верх формы идёт от нижней кромки
 * окна к своему месту. Мерка сменилась с блока на окно вместе с самой формой: та переехала
 * из блока разговора наружу, соседом ему, и едет теперь по окну (см. `--form-to`).
 */
test('форма выезжает снизу целиком, а не встаёт на место сразу', async ({ page }) => {
    const window = { width: COLUMN_WIDTH + 440, height: 900 };
    await page.setViewportSize(window);
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    const frames = await page.evaluate(async () => {
        const main = document.querySelector('main')!;
        const app = main.parentElement!;
        const taken: { scrolled: number; top: number }[] = [];
        const probe = (): void => {
            const form = app.querySelector(':scope > div[class*="form_"]');
            taken.push({
                // Прокрутиться могло что угодно из троих: блок разговора, коробка приложения
                // и сама страница. Складываем — ноль тут значит, что не прокрутился никто.
                scrolled: Math.round(main.scrollTop + app.scrollTop + document.documentElement.scrollTop),
                top: form ? Math.round(form.getBoundingClientRect().top) : -1,
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
    expect(scrolled, 'кто-то промотал себя под сфокусированное поле').toEqual([0]);

    const tops = frames.map((frame) => frame.top);
    expect(Math.max(...tops), 'форма не начала выезд из-за нижней кромки окна').toBeGreaterThan(window.height - 8);
    expect(Math.min(...tops), 'форма не доехала до своего места').toBeLessThan(2);
});

/**
 * Разговор сбоку. Отдельной кнопки у этой раскладки нет: её выбирает форма окна, — но всё,
 * что человек с разговором делает руками, живёт именно здесь. Ширину тянут за коридор вдоль
 * кромки, и она же помнится отдельно от высоты под кадром.
 */

/** Лежачее окно, в котором разговору сбоку просторно. */
const WIDE = { width: 1400, height: 900 };

/** Какой разговор в этом окне открывается, px: та же треть, что и везде. */
const SIDE_AT_WIDE = chatSize(WIDE);

/** Стоячее окно той же высоты: тот же экран, повёрнутый в руке. */
const TURNED = { width: 700, height: 900 };

/** Открыть канал на широком окне. Разговор встаёт сбоку сам — спрашивать не о чем. */
const openSide = async (page: Page): Promise<void> => {
    await page.setViewportSize(WIDE);
    await openChannel(page, DEMO, ALBATROS);
};

/**
 * Разговор сбоку: справа во всю высоту окна, кадру — весь остаток ширины и полоска заезда сверх
 * того.
 *
 * Мерок тут три, и все три легко разъезжаются по мелочи: .contentSide спорит за вес с .content —
 * селектор у обоих в один класс, и спор выигрывает записанный последним. Стоило правилу оказаться
 * выше того, что оно правит, — и разговор разъезжался во всю ширину окна, отжимая кадр в ноль.
 */
test('на широком окне разговор встаёт сбоку во всю высоту, кадру достаётся остальное', async ({ page }) => {
    await openSide(page);

    const content = await boxOf(page, 'main');
    const frame = await boxOf(page, 'header');
    expect(content.width, 'разговор встал не в свою долю ширины').toBe(SIDE_AT_WIDE);
    expect(content.right, 'разговор не прижат к правой кромке окна').toBe(WIDE.width);
    expect(content.height, 'разговор не во всю высоту окна').toBe(WIDE.height);
    expect(frame.width, 'кадру достался не остаток ширины вместе с заездом').toBe(
        WIDE.width - SIDE_AT_WIDE + CHAT_OVERLAP
    );
    expect(frame.height, 'кадр не во всю высоту окна').toBe(WIDE.height);
});

/**
 * Сбоку разговор уходит вбок — по своей стороне, а не вниз. Правило то же, что и под кадром:
 * коробка уезжает за кромку окна целиком и своим размером. Меняется только сторона, и стоит
 * она на двух классах в селекторе (`.appSide .contentGone`): одноклассовый спор боковая
 * раскладка проиграла бы — уходящее правило записано ниже.
 */
test('сбоку разговор уезжает за правую кромку, не теряя ширины', async ({ page }) => {
    await openSide(page);

    await page.getByRole('button', { name: 'Убрать разговор' }).click();
    await page.waitForTimeout(700);

    const gone = await boxOf(page, 'main');
    expect(gone.width, 'уехавший разговор потерял ширину').toBe(SIDE_AT_WIDE);
    expect(gone.left, 'разговор уехал не ровно за правую кромку окна').toBe(WIDE.width);
    expect(gone.height, 'уехавший разговор потерял высоту').toBe(WIDE.height);

    // Кадру при этом досталось всё окно: занятого места больше нет.
    expect((await boxOf(page, 'header')).width, 'кадр не забрал освободившуюся ширину').toBe(WIDE.width);

    await page.getByRole('button', { name: 'Вернуть разговор' }).click();
    await page.waitForTimeout(700);
    expect((await boxOf(page, 'main')).left, 'разговор вернулся не на своё место').toBe(WIDE.width - SIDE_AT_WIDE);
});

/**
 * Шторка в боковой раскладке вылезает на сцене, а не в разговоре и не поверх окна: и список
 * кораблей, и карточка — про рейд, и место им там, где рейд и виден. Ширина у неё при этом
 * та же, что и под кадром, — разговор у неё только отнимает место справа, а мерки остаются
 * общими.
 *
 * Форма корабля, наоборот, встаёт на место разговора: она не шторка на сцене, а второй слой
 * той же боковой коробки — ровно там, где только что был разговор, и той же ширины.
 */
test('шторка встаёт на сцену рядом с разговором, а форма — на его место', async ({ page }) => {
    await openSide(page);
    await openSheet(page);

    // Место под шторку — полоса слева от разговора. Считается она от окна, а не от кадра:
    // кадр заезжает под разговор, и лезть туда же шторке незачем.
    const room = WIDE.width - SIDE_AT_WIDE;
    const shade = await boxOf(page, 'section[aria-label="Корабли на связи"]');
    expect(shade.width, 'шторка не той ширины, что под кадром').toBe(Math.min(room - SHEET_INSET, SHEET_WIDTH));
    expect(Math.abs(shade.left - (room - shade.right)), 'шторка не посередине сцены').toBeLessThanOrEqual(1);
    expect(shade.right, 'шторка залезла на разговор').toBeLessThanOrEqual(room);

    // Затемнение при этом по всему окну, а не по полосе под шторкой: место у шторки своё,
    // а гаснет под ней всё — разговор рядом в этот момент тоже ничего не ждёт.
    const backdrop = await boxOf(page, 'button[aria-label="Закрыть шторку"]');
    expect(backdrop.width, 'затемнение погасило не всё окно').toBe(WIDE.width);
    expect(backdrop.left, 'затемнение легло не от левой кромки окна').toBe(0);

    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(500);
    // Форма встаёт ровно в коробку разговора: та же ширина, та же высота, та же правая кромка.
    // Соседом ему, а не содержимым, — но снаружи разницы быть не должно.
    const content = await boxOf(page, 'main');
    const form = await boxOf(page, '[class*="form_"]');
    expect(form.width, 'форма встала не в ширину разговора').toBe(content.width);
    expect(form.right, 'форма не прижата к правой кромке окна').toBe(WIDE.width);
    expect(form.height, 'форма не во всю высоту окна').toBe(WIDE.height);
    expect(form.left, 'форма вылезла на кадр').toBe(content.left);
});

/**
 * Окно повернули — разговор переехал сам. Кнопки на это нет и быть не должно: место разговору
 * ищут там, где его больше, и в стоячем окне это высота.
 *
 * Коридор для потяга переезжает вместе с ним и ложится поперёк: тянут разговор в обеих
 * раскладках, просто сбоку за ширину, а под кадром за высоту.
 */
test('повёрнутое окно само уводит разговор под кадр', async ({ page }) => {
    await openSide(page);

    await page.setViewportSize(TURNED);
    await page.waitForTimeout(700);

    const content = await boxOf(page, 'main');
    expect(content.width, 'разговор остался в боковой ширине').toBe(Math.min(TURNED.width, COLUMN_WIDTH));
    expect(content.height, 'под кадром разговор встал не в свою долю').toBe(chatSize(TURNED));
    expect(content.top + content.height, 'разговор не дошёл до нижней кромки окна').toBe(TURNED.height);
    await expect(
        page.getByRole('separator', { name: 'Высота разговора' }),
        'коридор не переехал вслед за разговором'
    ).toBeVisible();
});

/**
 * Покадровый снимок переезда: меняем форму окна и следим за коробкой разговора и за кадром.
 *
 * Ждём мы тут не «доехало», а «как ехало», поэтому кадры собираем сами, а не смотрим на
 * готовое: промежуточные размеры на то и промежуточные, что в покое их уже нет.
 */
const boxWhileTurning = async (page: Page, to: { width: number; height: number }) => {
    await page.evaluate(() => {
        const main = document.querySelector('main')!;
        const head = document.querySelector('header')!;
        const taken: { left: number; top: number; width: number; height: number; edge: number }[] = [];
        (window as unknown as { turn: typeof taken }).turn = taken;
        const tick = (): void => {
            const box = main.getBoundingClientRect();
            const frame = head.getBoundingClientRect();
            taken.push({
                left: Math.round(box.left),
                top: Math.round(box.top),
                width: Math.round(box.width),
                height: Math.round(box.height),
                // Кромка кадра со стороны разговора: снизу под кадром, справа сбоку.
                edge: Math.round(box.width < box.height ? frame.right : frame.bottom),
            });
            if (taken.length < 40) {
                requestAnimationFrame(tick);
            }
        };
        requestAnimationFrame(tick);
    });
    await page.setViewportSize(to);
    await page.waitForTimeout(900);
    return page.evaluate(
        () =>
            (
                window as unknown as {
                    turn: { left: number; top: number; width: number; height: number; edge: number }[];
                }
            ).turn
    );
};

/**
 * Смена раскладки: разговор приезжает из-за новой кромки уже в своём размере.
 *
 * Прежде он оказывался на новом месте первым же кадром и оттуда поджимался до нужной ширины
 * на глазах — замер на повороте: 390px схлопывались до 333 за те же полсекунды, что и всё
 * остальное движение. Промежуточных размеров не должно быть вовсе: ехать разговору положено
 * смещением, а размер брать готовым.
 *
 * Заодно проверяется главное следствие: кадр отдаёт место ровно под приезжающую коробку,
 * и щели между ними не бывает ни на одном кадре. Первым кадром переезда всё считается так,
 * будто разговора нет вовсе, — потому кромка кадра и трогается вместе с ним, а не стоит
 * на старом месте.
 */
test('повёрнутое окно не поджимает разговор, а привозит его из-за кромки', async ({ page }) => {
    await openSide(page);

    // Первые кадры снимка могут застать ещё старую раскладку: окно уже другой формы, а разметка
    // о ней пока не знает. Переезд начинается там, где кончается старое, — с них и считаем.
    const since = <T>(frames: T[], started: (frame: T) => boolean): T[] => frames.slice(frames.findIndex(started));

    // Сбоку → под кадр. Едет верх, стоит высота.
    const down = since(await boxWhileTurning(page, TURNED), (frame) => frame.height === chatSize(TURNED));
    expect(
        [...new Set(down.map((frame) => frame.height))],
        'разговор поджимался по высоте, вместо того чтобы приехать'
    ).toEqual([chatSize(TURNED)]);
    const tops = down.map((frame) => frame.top);
    expect(Math.max(...tops), 'разговор не начал переезд из-за нижней кромки окна').toBe(TURNED.height);
    expect(Math.min(...tops), 'разговор не доехал до своего места').toBe(TURNED.height - chatSize(TURNED));
    down.forEach((frame) => {
        expect(frame.edge, 'между кадром и приезжающим разговором открылась щель').toBeGreaterThanOrEqual(frame.top);
    });

    // Под кадром → сбоку. Едет левая кромка, стоит ширина.
    const aside = since(await boxWhileTurning(page, WIDE), (frame) => frame.width === SIDE_AT_WIDE);
    expect(
        [...new Set(aside.map((frame) => frame.width))],
        'разговор поджимался по ширине, вместо того чтобы приехать'
    ).toEqual([SIDE_AT_WIDE]);
    const lefts = aside.map((frame) => frame.left);
    expect(Math.max(...lefts), 'разговор не начал переезд из-за правой кромки окна').toBe(WIDE.width);
    expect(Math.min(...lefts), 'разговор не доехал до своего места').toBe(WIDE.width - SIDE_AT_WIDE);
    aside.forEach((frame) => {
        expect(frame.edge, 'между кадром и приезжающей панелью открылась щель').toBeGreaterThanOrEqual(frame.left);
    });
});

/** Ширина бокового разговора: справа он всегда упирается в кромку окна. */
const sideWidth = async (page: Page): Promise<number> => (await boxOf(page, 'main')).width;

/**
 * Подвести коридор на `by` пикселей вправо (влево — отрицательное) и поставить.
 *
 * Палец перед отпусканием стоит дольше отрезка, на котором меряется усилие (`FLING_MS`):
 * коридор именно подводят, а не бросают. Сбоку у разговора тоже есть точки, и брошенный
 * он улетал бы к ближней из них — а здесь проверяется, что кромка идёт за указателем.
 */
const dragGrip = async (page: Page, by: number): Promise<void> => {
    const grip = await boxOf(page, '[role="separator"]');
    const y = grip.top + grip.height / 2;
    await page.mouse.move(grip.left + grip.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.left + grip.width / 2 + by, y, { steps: 8 });
    await page.waitForTimeout(FLING_MS * 3);
    await page.mouse.up();
    await page.waitForTimeout(400);
};

/**
 * Ширину бокового разговора меняют потягом за коридор вдоль его кромки. Упоров два, и оба
 * не про разговор один: уже своего минимума он не бывает, а шире — только пока кадру рядом
 * остаётся его собственный минимум. Рейд про ширину, и отдать её всю разговору значит
 * оставить от рейда вертикальную полоску.
 *
 * Уводить разговор с экрана упоры при этом не мешают: утянутый за нулевую отметку — то есть
 * за саму кромку окна, а не просто в узкую полосу — он уходит целиком. Это не поломка упора,
 * а третий его исход: «стать уже трёхсот» и «уйти вовсе» — разные просьбы, и первая упирается,
 * а вторая исполняется.
 */
test('разговор тянут за коридор вдоль кромки, и упирается он в свои пределы', async ({ page }) => {
    await openSide(page);
    expect(await sideWidth(page), 'разговор открылся не в свою ширину').toBe(SIDE_AT_WIDE);

    const grip = await boxOf(page, '[role="separator"]');
    expect(grip.width, 'коридор не в свою ширину').toBe(CHAT_GRIP);
    expect(grip.height, 'коридор не во всю высоту разговора').toBe(WIDE.height);
    expect(grip.left, 'коридор встал не у кромки разговора').toBeLessThan(WIDE.width - SIDE_AT_WIDE + CHAT_GRIP);

    // Разговор справа: влево — шире. Тянем на столько, чтобы до упоров было далеко: здесь
    // проверяется, что он идёт за указателем ровно, а упоры проверяются ниже.
    await dragGrip(page, -60);
    expect(await sideWidth(page), 'разговор не пошёл за указателем').toBe(SIDE_AT_WIDE + 60);

    // Тянем в узкую полосу, но не за кромку окна: 527 - 300 = 227, и это ниже минимума.
    await dragGrip(page, 300);
    expect(await sideWidth(page), 'разговор ужался ниже своего минимума').toBe(SIDE_MIN_WIDTH);

    await dragGrip(page, -900);
    expect(await sideWidth(page), 'разговор отнял у кадра его минимум').toBe(WIDE.width - SCENE_MIN_WIDTH);

    // А теперь за саму кромку — разговор уходит с экрана, и коридора вместе с ним не остаётся:
    // тянуть больше нечего, возвращают его кнопкой из шапки.
    await dragGrip(page, 900);
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'разговор не ушёл с экрана').toBeVisible();
    await expect(page.locator('[role="separator"]'), 'у убранного разговора остался коридор').toHaveCount(0);
});

/**
 * Окно меняется и без ведома человека — повернули планшет, вытащили ноутбук из док-станции, —
 * и раскладка обязана съехать на допустимое сама. Все эти проверки живут в одном месте
 * (`hooks/useLayout`): ширина урезается по новому окну, а стоячее окно и вовсе уводит разговор
 * под кадр.
 *
 * Урезанное не записывается: это не выбор человека, а то, во что его временно уложило окно.
 * Раздалось окно обратно — разговор вернулся к выбранной ширине. Иначе одно случайное сужение
 * стирало бы выбор насовсем.
 */
test('сузившееся окно урезает разговор, но выбора не переписывает', async ({ page }) => {
    await openSide(page);
    // Две сотни, а не три: от трёхсот кромка встала бы в тридцати пикселях от упора, и точка
    // притянула бы её к себе — проверялось бы уже не окно, а магнит.
    await dragGrip(page, -200);
    const chosen = await sideWidth(page);
    expect(chosen, 'разговор не пошёл за указателем').toBe(SIDE_AT_WIDE + 200);

    // Окно уже — разговор урезан ровно на столько, чтобы кадру остался его минимум.
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'разговор не ужался вслед за окном').toBe(1000 - SCENE_MIN_WIDTH);

    // Окно повернули — разговор под кадром, и ширина ему больше не мерка.
    await page.setViewportSize(TURNED);
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'разговор остался в боковой ширине').toBe(Math.min(TURNED.width, COLUMN_WIDTH));

    // Окно раздалось обратно — вернулась и раскладка, и выбранная ширина.
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'разговор не вернулся к выбранной ширине').toBe(chosen);
});

/**
 * Выбранное вкладка помнит: перезагрузили — разговор той же ширины. Память именно на вкладку
 * (sessionStorage), а не на браузер: второе окно того же чата человек открывает ради другого
 * взгляда на то же самое, и навязывать ему раскладку первого значит отбирать этот второй взгляд.
 *
 * Помнятся высота и ширина раздельно: треть высоты, выбранная на телефоне, не должна становиться
 * третью ширины после поворота — число то же, место совсем другое.
 */
test('ширина сбоку помнится отдельно от высоты под кадром и переживает перезагрузку', async ({ page }) => {
    await openSide(page);
    await dragGrip(page, -120);
    const chosen = await sideWidth(page);
    expect(chosen, 'разговор не пошёл за указателем').toBe(SIDE_AT_WIDE + 120);

    // Поворот: под кадром разговор открывается своей долей, а не натянутой сбоку.
    await page.setViewportSize(TURNED);
    await page.waitForTimeout(400);
    expect((await boxOf(page, 'main')).height, 'под кадром разговор взял натянутую сбоку мерку').toBe(chatSize(TURNED));

    await page.setViewportSize(WIDE);
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'после поворота туда и обратно ширина забылась').toBe(chosen);

    await page.reload();
    await page.waitForTimeout(1500);
    expect(await sideWidth(page), 'разговор забыл свою ширину').toBe(chosen);
    expect((await boxOf(page, 'main')).height, 'разговор ушёл из-под правой кромки').toBe(WIDE.height);
});

/**
 * С чем приложение открывается, когда вкладке нечего вспомнить: треть на обе раскладки.
 * Треть — и не мелочь, в которой ничего не разобрать, и не то, что накрывает собой рейд.
 * От окна она не зависит вовсе: доля на то и доля, и на любом мониторе это одна и та же треть.
 */
test('пустая вкладка открывает разговор в треть окна в обеих раскладках', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto(`/?channel=${DEMO}&memberId=${ALBATROS}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const content = await boxOf(page, 'main');
    expect(content.width, 'разговор открылся не в треть окна').toBe(SIDE_AT_WIDE);
    expect(content.height, 'разговор открылся не во всю высоту окна').toBe(WIDE.height);

    // Другое окно — та же треть, но других пикселей: в этом и смысл доли.
    const wider = { width: 1800, height: 900 };
    await page.setViewportSize(wider);
    await page.waitForTimeout(400);
    expect(await sideWidth(page), 'разговор не потянулся за окном').toBe(chatSize(wider));

    // Телефон: то же самое, только высотой.
    const phone = { width: MOBILE_MAX_WIDTH - 90, height: 844 };
    await page.setViewportSize(phone);
    await page.waitForTimeout(400);
    expect((await boxOf(page, 'main')).height, 'на телефоне разговор открылся не в треть').toBe(chatSize(phone));
});

/**
 * Раскладка — про кадр и разговор, а не про канал: на главной, где вместо разговора стоит форма
 * создания канала, кадр такой же настоящий, и место разговору отмеряется тем же правилом.
 */
test('на главной, где канала ещё нет, раскладка та же', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    expect((await boxOf(page, 'main')).width, 'форма создания канала открылась не в свою треть').toBe(SIDE_AT_WIDE);

    await page.setViewportSize(TURNED);
    await page.waitForTimeout(700);
    expect((await boxOf(page, 'main')).height, 'на главной разговор не переехал под кадр').toBe(chatSize(TURNED));
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
 * А обратно шторки больше не открываются вовсе: пока карточка на экране, шапка под затемнением,
 * и нажатие по названию канала достаётся затемнению — то есть закрывает карточку, а списка
 * не открывает. Открытая шторка забирает экран себе, и второй поверх неё из шапки не позвать.
 *
 * Правило «поздняя закрывает прежние» (`cover` у `Shade`) от этого никуда не делось: оно про
 * стопку, а не про шапку, — просто из интерфейса на него теперь не выйти.
 */
test('из-под открытой карточки список кораблей не позвать: шапка под затемнением', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Карточку берём из кадра: из списка она открылась бы поверх него, а нам нужен обратный
    // порядок — сперва карточка, потом попытка позвать список.
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const other = fleet.find((member) => member.memberId !== ALBATROS)!;
    await clickShip(page, page.locator(`[data-berth-ship="${other.place.slot}-${other.place.corridor}"]`));
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toBeVisible();

    const ships = (await shipsButton(page).boundingBox())!;
    await page.mouse.click(Math.round(ships.x + ships.width / 2), Math.round(ships.y + ships.height / 2));
    await expect(card, 'карточка не закрылась от нажатия по затемнению').toBeHidden();
    await expect(
        page.getByRole('region', { name: 'Корабли на связи' }),
        'список открылся из-под затемнения'
    ).toHaveCount(0);
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

/**
 * Оборванный потяг не оставляет шторку на экране.
 *
 * Движение пальца обрывается чаще, чем кажется: указатель отпустили за краем окна, касание
 * забрал браузер, вкладку увели. Отпускания шторка тогда не видит и остаётся со сдвигом
 * от потяга и снятым на время движения переходом — а уезжает она как раз переходом и снимается
 * с экрана по его концу. Выходило, что крестик гасил затемнение, а шторка висела на экране
 * до перезагрузки и на следующем открытии молча подменяла корабль в себе на другой.
 *
 * Обрыв здесь настоящий: pointerdown и pointermove шторка получает, а pointerup не получает
 * вовсе — ровно как при отпускании мыши за краем окна.
 */
test('шторка уходит с экрана и после оборванного потяга', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toBeVisible();

    // Тянем за верхнюю кромку: своей прокрутки у неё нет, а значит потяг достаётся шторке.
    const top = (await card.boundingBox())!.y;
    await page.evaluate(() => {
        const shade = document.querySelector('[aria-label="Корабль"]')!;
        const box = shade.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + 8);
        const at = (offset: number, type: string) =>
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: 'mouse',
                button: 0,
                buttons: 1,
                clientX: x,
                clientY: y + offset,
            });
        shade.dispatchEvent(at(0, 'pointerdown'));
        for (const step of [10, 40, 80]) {
            window.dispatchEvent(at(step, 'pointermove'));
        }
        // Отпускания нет нарочно: указатель «ушёл» за окно.
    });
    await expect
        .poll(async () => Math.round(((await card.boundingBox())?.y ?? top) - top), {
            message: 'шторка не поехала за пальцем — тянуть было не за что',
        })
        .toBeGreaterThan(0);

    // Крестик нажимаем с клавиатуры: обычное нажатие мышью само послало бы pointerup,
    // которого шторка и ждёт, и оборванное движение чинилось бы им же — а чинить его должно
    // само закрытие.
    await card.getByRole('button', { name: 'Закрыть' }).press('Enter');
    await expect(card, 'шторка осталась на экране после крестика').toBeHidden();

    // И следующее открытие показывает тот корабль, который открыли, а не оставшийся с прошлого.
    // Список под карточкой никуда не делся — открываем из него, второй раз его не зовём.
    await page.getByRole('button', { name: 'Корабль «Резвый»' }).click();
    await expect(card.getByText('Резвый'), 'в шторке остался прежний корабль').toBeVisible();
});

/**
 * И на подстраховку: там, где перехода нет вовсе, шторка всё равно уходит.
 *
 * Снимают её с экрана по концу перехода, а он случается не всегда: движение бывает выключено
 * в системе, отменено расширением или прерван сам переход. Событие тогда не приходит никогда,
 * и шторка, снимаемая по нему, оставалась бы на экране навсегда. Здесь переходы сняты нарочно —
 * ровно тот случай.
 */
test('шторка уходит с экрана и там, где переходов нет', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.addStyleTag({ content: '* { transition: none !important; }' });
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toBeVisible();

    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card, 'шторка осталась на экране без перехода').toBeHidden({ timeout: 2000 });
});

/**
 * Разговор под кадром — нижняя шторка.
 *
 * Тянут его за тот же коридор, что и сбоку, только положенный поперёк, а отпущенный он
 * приезжает к своей точке (`CHAT_POINTS`): ноль, треть, две трети, весь рост. Между точками
 * он стоять волен — человек ставит его туда, где ему видно и рейд, и последние реплики, —
 * и точки только помогают попасть в привычное.
 */

/** Весь ход разговора под кадром в этом окне, px: всё, что осталось под шапкой. */
const chatRoom = (view: { width: number; height: number }): number => view.height - SHEET_TOP_GAP;

/** Высота разговора под кадром, px. */
const chatHeight = async (page: Page): Promise<number> => (await boxOf(page, 'main')).height;

/** Середина коридора: за неё разговор и берут. */
const gripSpot = async (page: Page): Promise<{ x: number; y: number }> => {
    const grip = await boxOf(page, '[role="separator"]');
    return { x: grip.left + grip.width / 2, y: grip.top + grip.height / 2 };
};

/**
 * Подвести кромку разговора на `by` пикселей вверх (вниз — отрицательное) и поставить.
 *
 * Перед отпусканием палец стоит дольше отрезка, на котором меряется усилие (`FLING_MS`), —
 * то есть разговор именно подвели, а не бросили. Скорости к отпусканию не остаётся, и приезд
 * считается от того места, куда его привели.
 */
const leadChat = async (page: Page, by: number): Promise<void> => {
    const { x, y } = await gripSpot(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - by, { steps: 8 });
    await page.waitForTimeout(FLING_MS * 3);
    await page.mouse.up();
    await page.waitForTimeout(600);
};

/**
 * Бросить разговор вниз на `by` пикселей: короткий сильный рывок, палец отпускают на ходу.
 *
 * Шаги идут с паузами нарочно: усилие считается из пути и времени, а мгновенно посланные
 * подряд события отличались бы нулём миллисекунд — скорости не вышло бы вовсе.
 */
const flingChatDown = async (page: Page, by: number): Promise<void> => {
    const { x, y } = await gripSpot(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await [1, 2, 3].reduce(
        (before, step) =>
            before.then(() => page.waitForTimeout(10)).then(() => page.mouse.move(x, y + (by * step) / 3)),
        Promise.resolve()
    );
    await page.mouse.up();
    await page.waitForTimeout(600);
};

/**
 * Коридор под кадром — та же полоска, что и сбоку, только поперёк: вдоль верхней кромки
 * разговора и во всю его ширину, а не во всю ширину окна. Стоит он на самом стыке, половиной
 * на кадр и половиной на разговор.
 */
test('под кадром коридор лежит поперёк, вдоль верхней кромки разговора', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    const grip = await boxOf(page, '[role="separator"]');
    const chat = await boxOf(page, 'main');
    expect(grip.height, 'коридор не в свою толщину').toBe(CHAT_GRIP);
    expect(grip.width, 'коридор не во всю ширину разговора').toBe(chat.width);
    expect(grip.top + CHAT_GRIP / 2, 'коридор встал не на кромку разговора').toBe(chat.top);
    await expect(
        page.getByRole('separator', { name: 'Высота разговора' }),
        'коридор под кадром назвался шириной'
    ).toBeVisible();
});

/**
 * Отпущенный разговор приезжает к ближней точке, а вдали от точек остаётся там, где его
 * оставили. Это и есть «тянется произвольно, магнитится на точки»: точки помогают попасть
 * в привычное, но не отбирают у человека промежуточных положений.
 */
test('разговор под кадром тянут произвольно, а к точкам он притягивается', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);
    const room = chatRoom(PHONE);
    expect(await chatHeight(page), 'разговор открылся не в свою треть').toBe(chatSize(PHONE));

    // Далеко от точек: 260 + 150 = 410, а соседние точки в 260 и 520 — до обеих больше,
    // чем дотягивается притяжение (MAGNET_PULL).
    await leadChat(page, 150);
    expect(await chatHeight(page), 'разговор не остался там, куда его привели').toBe(chatSize(PHONE) + 150);

    // А теперь рядом: 410 + 90 = 500, и до двух третей всего двадцать пикселей.
    await leadChat(page, 90);
    expect(await chatHeight(page), 'разговор не притянулся к двум третям').toBe(Math.round(room * 2 * CHAT_SHARE));

    // Вверх до упора: выше низа шапки разговор не поднимается, и точка там как раз.
    await leadChat(page, 400);
    expect(await chatHeight(page), 'разговор поднялся не во весь рост').toBe(room);
});

/**
 * Короткий сильный рывок вниз убирает разговор целиком, не цепляясь за точки по дороге.
 *
 * Считается приземление не от места, где палец отпустил кромку, а от того, куда разговор
 * долетел бы по инерции (`MAGNET_THROW_MS`): отпущенный на ходу в двух сотнях от нижней кромки,
 * он проскакивает и треть, и ноль — то есть уходит с экрана. Тот же путь, пройденный медленно,
 * оставил бы его на ближней точке.
 */
test('короткий сильный свайп вниз убирает разговор, не цепляясь за точки', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    await flingChatDown(page, 120);
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'разговор не ушёл с экрана').toBeVisible();
    await expect(page.locator('[role="separator"]'), 'у убранного разговора остался коридор').toHaveCount(0);

    // Возвращается он в тот размер, в каком его убрали: рывком выбирают, где разговору быть,
    // а не сколько он занимает.
    await page.getByRole('button', { name: 'Вернуть разговор' }).click();
    await page.waitForTimeout(600);
    expect(await chatHeight(page), 'разговор вернулся не в свой размер').toBe(chatSize(PHONE));
});

/**
 * То же самое медленно: подвели кромку к самой нижней и поставили. Разговор уходит с экрана
 * и так — нулевая точка на то и точка, — но уходит по своей воле, а не по инерции.
 */
test('подведённая к нижней кромке кромка тоже убирает разговор', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    await leadChat(page, -chatSize(PHONE) + 20);
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'разговор не ушёл с экрана').toBeVisible();
});

/** Наименьший рост кадра в этом окне, px: больший из доли окна и трёхсот пикселей. */
const sceneMin = (view: { width: number; height: number }): number =>
    Math.max(SCENE_MIN_HEIGHT, view.height * SCENE_MIN_SHARE);

/** Кадр и разговор разом: их высоты и то, насколько один заехал под другой. */
const stack = async (page: Page): Promise<{ scene: number; chat: number; overlap: number }> => {
    const scene = await boxOf(page, 'header');
    const chat = await boxOf(page, 'main');
    return { scene: scene.height, chat: chat.height, overlap: scene.top + scene.height - chat.top };
};

/**
 * Кадр под разговором: сколько разговор оставил, столько кадр и берёт, плюс полоска заезда.
 * Пока разговору отдана не больше чем половина окна, это простое вычитание; а как разговор
 * поднимается выше, кадр упирается в свой наименьший рост и дальше не сжимается — разговор
 * идёт поверх него. Заезд от этого делается больше положенного, но видно этого нигде: лишнее
 * оказывается под разговором.
 *
 * Мерка кадра тут не круглая, а большая из двух — треть окна и триста пикселей: на высоком
 * окне треть больше трёхсот, на низком — меньше, и кадру достаётся большая. В 300px ещё виден
 * рейд с кораблями и полоса неба над ними, в меньшем не видно уже ничего.
 */
test('кадр берёт остаток окна с заездом, а ниже своей мерки прячется под разговором', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    const stood = await stack(page);
    expect(stood.scene, 'кадр взял не остаток окна').toBeCloseTo(PHONE.height - stood.chat + CHAT_OVERLAP, 0);
    expect(stood.overlap, 'кадр заехал под разговор не на свою полоску').toBeCloseTo(CHAT_OVERLAP, 0);

    // Подняли разговор на полсотни — кадр отдал ровно столько же и не пиксели сверх того.
    await leadChat(page, 50);
    const raised = await stack(page);
    expect(raised.chat, 'разговор не пошёл за указателем').toBeCloseTo(stood.chat + 50, 0);
    expect(raised.scene, 'кадр отдал не то, что взял разговор').toBeCloseTo(stood.scene - 50, 0);
    expect(raised.overlap, 'полоска заезда переменилась').toBeCloseTo(CHAT_OVERLAP, 0);

    // А теперь во весь рост: кадру осталось бы восемь десятков пикселей, и он вместо этого
    // встал на свою мерку, а разговор пошёл поверх.
    await leadChat(page, 500);
    const covered = await stack(page);
    expect(covered.chat, 'разговор поднялся не во весь рост').toBe(chatRoom(PHONE));
    expect(covered.scene, 'кадр сжался ниже своей мерки').toBeCloseTo(sceneMin(PHONE), 0);
    expect(covered.overlap, 'разговор не пошёл поверх кадра').toBeGreaterThan(CHAT_OVERLAP);
});

/**
 * Приезд разговора к точке — движение, а не прыжок: кадр раздаётся под него ровно теми же
 * секундами и той же кривой. Проверяется это покадрово и по стыку: щели между кадром
 * и разговором не бывает ни на одном кадре, и обе коробки идут в одну сторону без возвратов.
 *
 * Порознь каждая из них выглядела бы правильной: разговор приезжает к своей точке, кадр
 * встаёт в свой рост. Разъехаться они могут только между собой — и видно это только на стыке.
 */
test('приезд разговора к точке раздаёт кадр без щели на стыке', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);

    // Подводим кромку почти к двум третям и отпускаем на месте: приезжать разговору недалеко,
    // но приезжать он будет — а вместе с ним и кадр.
    const { x, y } = await gripSpot(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - (Math.round(chatRoom(PHONE) * 2 * CHAT_SHARE) - chatSize(PHONE) - 20), { steps: 8 });
    await page.waitForTimeout(FLING_MS * 3);

    // Замер идёт покадрово и изнутри страницы: снаружи каждый заход стоит миллисекунд, и весь
    // приезд успел бы кончиться за три замера. Съёмку заводим до отпускания и не ждём её здесь:
    // ждать нужно палец, а он поднимется следующей строкой, — иначе приезд кончился бы прежде,
    // чем указателю дали отпустить.
    const recording = page.evaluate(async () => {
        const probe = (): { scene: number; chat: number; seam: number } => {
            const scene = document.querySelector('header')!.getBoundingClientRect();
            const chat = document.querySelector('main')!.getBoundingClientRect();
            return { scene: scene.height, chat: chat.height, seam: scene.bottom - chat.top };
        };
        const taken: ReturnType<typeof probe>[] = [];
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
    });
    await page.mouse.up();
    const frames = await recording;

    // Допуск в полпикселя — на дробную высоту и округление разметки, а не на движение:
    // расхождения, которые ловит проверка, были бы в десятки пикселей.
    const SLACK = 0.5;
    // Сперва — что съёмка вообще застала ход: приедь разговор до первого кадра, все проверки
    // ниже прошли бы на неподвижной картинке и не значили бы ничего.
    expect(
        frames[frames.length - 1].chat - frames[0].chat,
        'съёмка началась после приезда: проверять на ней нечего'
    ).toBeGreaterThan(5);
    expect(
        frames.every((frame) => frame.seam >= CHAT_OVERLAP - SLACK),
        'на стыке кадра и разговора появлялась щель'
    ).toBe(true);
    expect(
        frames.every((frame, i) => i === 0 || frame.chat >= frames[i - 1].chat - SLACK),
        'разговор ехал с возвратом'
    ).toBe(true);
    expect(
        frames.every((frame, i) => i === 0 || frame.scene <= frames[i - 1].scene + SLACK),
        'кадр ехал с возвратом'
    ).toBe(true);
    expect(frames[frames.length - 1].chat, 'разговор не приехал к двум третям').toBeCloseTo(
        Math.round(chatRoom(PHONE) * 2 * CHAT_SHARE),
        0
    );
});

/**
 * Сбоку у разговора те же четыре точки, что и под кадром, только ход у него другой и пределы
 * настоящие: уже трёхсот он не бывает, а кадру обязан оставить шестьсот. Доля, вышедшая за
 * упор, к нему и прижимается — «две трети ширины» на окне в 1200 значит «до упора», — и точек
 * там остаётся три: убрать, треть, упор (см. `chatMagnets` в hooks/useLayout).
 */

/** Ширина разговора сбоку, px. */
const chatWidth = async (page: Page): Promise<number> => (await boxOf(page, 'main')).width;

/**
 * Подвести кромку разговора сбоку на `by` пикселей вширь (уже — отрицательное) и поставить.
 * Разговор стоит справа, поэтому «шире» — это влево; в остальном всё то же, что и под кадром.
 */
const leadSide = async (page: Page, by: number): Promise<void> => {
    const { x, y } = await gripSpot(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - by, y, { steps: 8 });
    await page.waitForTimeout(FLING_MS * 3);
    await page.mouse.up();
    await page.waitForTimeout(600);
};

test('разговор сбоку притягивается к точкам, а между ними стоит где поставили', async ({ page }) => {
    await page.setViewportSize(LYING);
    await openChannel(page, DEMO, ALBATROS);

    const third = Math.round(LYING.width * CHAT_SHARE);
    expect(await chatWidth(page), 'разговор открылся не третью ширины').toBe(third);

    // Подвели почти к трети — приехал на треть: тридцать пикселей это ближе `MAGNET_PULL`.
    await leadSide(page, -30);
    expect(await chatWidth(page), 'разговор не вернулся на треть').toBe(third);

    // Подвели на сотню шире — там до точек далеко в обе стороны, и разговор остался на месте.
    await leadSide(page, 100);
    expect(await chatWidth(page), 'разговор не удержался между точками').toBe(third + 100);

    // Дальше к упору: две трети ширины кадру не оставили бы и шестисот, и точка стоит
    // на самом упоре.
    await leadSide(page, 200);
    expect(await chatWidth(page), 'разговор встал не на упор').toBe(LYING.width - SCENE_MIN_WIDTH);
});

/**
 * Ноль — такая же точка и сбоку: подведённая к правой кромке окна, кромка разговора уводит его
 * с экрана целиком. Пределы ширины про эту точку ничего не говорят — уже 300px не бывает
 * разговор на экране, а тут его нет вовсе.
 *
 * Про усилие проверки здесь нет нарочно: мерка у него общая на обе раскладки (`trackFling`),
 * и проверена она там, где ход длиннее, — под кадром.
 */
test('подведённая к правой кромке кромка убирает разговор сбоку', async ({ page }) => {
    await page.setViewportSize(LYING);
    await openChannel(page, DEMO, ALBATROS);

    // Ведём кромку к самому краю окна: разговору там остаётся ноль, и точка стоит ровно на нём.
    await leadSide(page, -(Math.round(LYING.width * CHAT_SHARE) - 1));
    await expect(page.getByRole('button', { name: 'Вернуть разговор' }), 'разговор не ушёл с экрана').toBeVisible();
    await expect(page.locator('[role="separator"]'), 'у убранного разговора остался коридор').toHaveCount(0);

    // Возвращается он в тот размер, в каком его убрали: кромкой выбирают, быть ли разговору
    // на экране, а не сколько он занимает.
    await page.getByRole('button', { name: 'Вернуть разговор' }).click();
    await page.waitForTimeout(600);
    expect(await chatWidth(page), 'разговор вернулся не в свой размер').toBe(Math.round(LYING.width * CHAT_SHARE));
});

/**
 * Приспущенная форма своего корабля.
 *
 * Место на рейде выбирают в форме, а форма занимает под собой ту же треть экрана, что
 * и разговор, — отметки ближних мест жмутся к самой её кромке, и разглядеть их нечем. Чтобы
 * их разглядеть, форму приспускают потягом: коробка уходит вниз (сбоку — вправо), кадр
 * раздаётся на освободившееся, отметки разъезжаются. Отпущенная у своей кромки, коробка
 * встаёт обратно; утянутая до конца — закрывает форму совсем.
 *
 * Едет при этом вся коробка, а не одна форма: под формой стоит разговор, и уйди она одна,
 * из-под неё показался бы он, а не рейд.
 */

/**
 * Заголовок формы: за него её и берут — это ни поле, ни кнопка.
 *
 * Сбоку берём не сами буквы, а пустое место в конце строки заголовка: там, где коробку
 * отодвигают вбок, движение по буквам достаётся выделению текста — вдоль строки ходят оба,
 * и различить их можно только по тому, с чего движение началось.
 */
const formGrip = async (page: Page, title: string, axis: 'y' | 'x' = 'y'): Promise<{ x: number; y: number }> => {
    const box = (await page.getByRole('heading', { name: title }).boundingBox())!;
    return { x: axis === 'x' ? box.x + box.width - 8 : box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * Приспустить форму на `by` пикселей и поставить. Под кадром её ведут вниз, сбоку — вправо:
 * коробка там стоит у правой кромки, и «приспустить» значит отодвинуть её туда.
 *
 * Перед отпусканием палец стоит дольше отрезка, на котором меряется усилие (`FLING_MS`), —
 * то есть форму именно подвели, а не бросили, и приезжает она туда, куда её привели.
 */
const lowerForm = async (page: Page, title: string, by: number, axis: 'y' | 'x' = 'y'): Promise<void> => {
    const { x, y } = await formGrip(page, title, axis);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(axis === 'x' ? x + by : x, axis === 'x' ? y : y + by, { steps: 12 });
    await page.waitForTimeout(FLING_MS * 3);
    await page.mouse.up();
    await page.waitForTimeout(600);
};

/**
 * Потяг за форму отдаёт кадру ровно то, на сколько форму увели, — и отдаёт это сразу, пока
 * палец ещё ведёт. Проверяется вся дорога целиком: приспустили, кадр раздался, отметки мест
 * разъехались, разговор поехал вместе с формой; подвели обратно к кромке — форма встала
 * на место; утянули до конца — закрылась совсем.
 *
 * Точек у формы две, закрыто и на месте, а между ними она вольна стоять где угодно (`free`):
 * рейд разглядывают на любую нужную глубину, а не на одну заранее выбранную.
 */
test('приспущенная форма отдаёт кадру своё место, а отпущенная у кромки встаёт обратно', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(600);

    const stood = await boxOf(page, '[class*="form_"]');
    const sceneStood = (await boxOf(page, 'header')).height;
    const spanStood = await berthSpan(page);
    expect(stood.top + stood.height, 'форма встала не на нижнюю кромку окна').toBe(PHONE.height);

    // Ведём форму вниз на 120: до обеих её точек оттуда далеко, и она остаётся, где поставили.
    await lowerForm(page, 'Настроить корабль', 120);

    const low = await boxOf(page, '[class*="form_"]');
    expect(low.top - stood.top, 'форма не поехала за пальцем').toBe(120);
    // Кадр раздаётся ровно на то, что форма отдала: щели между ними не бывает.
    expect((await boxOf(page, 'header')).height - sceneStood, 'кадр не забрал освободившееся').toBe(120);
    // Рейд разъезжается вместе с кадром — ради этого потяг и затеян.
    expect(await berthSpan(page), 'отметки мест не разъехались').toBeGreaterThan(spanStood);
    // Разговор едет вместе с формой: коробка внизу экрана у них одна. Уйди форма одна,
    // из-под неё показался бы он, а не рейд.
    expect((await boxOf(page, 'main')).top - stood.top, 'разговор остался стоять под приспущенной формой').toBe(120);

    // Подвели обратно к кромке — форма встала на место: двадцать оставшихся пикселей ближе
    // к точке, чем MAGNET_PULL.
    await lowerForm(page, 'Настроить корабль', -100);
    expect((await boxOf(page, '[class*="form_"]')).top, 'форма не вернулась на место').toBe(stood.top);
    expect((await boxOf(page, 'header')).height, 'кадр не отдал место обратно').toBe(sceneStood);

    // Утянутая до конца — закрывается совсем, и разговор остаётся там же, где стоял.
    const grip = await formGrip(page, 'Настроить корабль');
    await flingAt(page, grip.x, grip.y, 160);
    await expect(page.getByRole('heading', { name: 'Настроить корабль' }), 'форма не закрылась').toHaveCount(0);
    expect((await boxOf(page, 'main')).top, 'разговор не вернулся на своё место').toBe(stood.top);
});

/**
 * Тем же потягом закрывается и форма постановки в строй — обратно в свою единственную кнопку.
 * Кнопки «отмена» у неё поэтому нет вовсе: закрывает её движение, а не ещё одна кнопка рядом
 * с «Встать на рейд».
 *
 * Набранное закрытие переживает: это одна форма в двух видах, и в закрытом её держат на месте,
 * а не разбирают.
 */
test('форму постановки в строй закрывает тот же потяг, а набранное в ней остаётся', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openChannel(page, DEMO);
    await openJoinForm(page);
    await page.getByPlaceholder('Гром').fill('Гроза');

    const grip = await formGrip(page, 'Встать на рейд');
    await flingAt(page, grip.x, grip.y, 160);

    await expect(page.getByRole('button', { name: 'Встать на рейд' }), 'форма не свернулась').toBeVisible();
    await expect(page.getByPlaceholder('Гром'), 'поля остались на экране').toHaveCount(0);

    await openJoinForm(page);
    await expect(page.getByPlaceholder('Гром'), 'набранное потерялось при закрытии').toHaveValue('Гроза');
});

/**
 * Сбоку коробка стоит у правой кромки и меряется шириной — приспускают её там вбок, а не вниз:
 * форма отодвигается вправо, кадр раздаётся вширь. Правило то же самое, ось другая.
 */
test('сбоку форму отодвигают вправо, и кадр раздаётся вширь', async ({ page }) => {
    await openSide(page);
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.waitForTimeout(600);

    const stood = await boxOf(page, '[class*="form_"]');
    const frameStood = (await boxOf(page, 'header')).width;
    expect(stood.right, 'форма встала не у правой кромки окна').toBe(WIDE.width);

    await lowerForm(page, 'Настроить корабль', 120, 'x');

    expect((await boxOf(page, '[class*="form_"]')).left - stood.left, 'форма не отодвинулась вправо').toBe(120);
    expect((await boxOf(page, 'header')).width - frameStood, 'кадр не забрал освободившееся').toBe(120);
    // Разговор под формой отъехал вместе с ней: коробка у них одна и сбоку тоже.
    expect((await boxOf(page, 'main')).left - stood.left, 'разговор остался стоять под формой').toBe(120);

    // А по самим буквам то же движение выделяет текст: вдоль строки ходят оба, и различить их
    // можно только по тому, с чего движение началось. Характеристики корабля для того и
    // написаны, чтобы их читали и сравнивали, — и утащить их с собой человек вправе.
    const moved = await boxOf(page, '[class*="form_"]');
    const spec = page.locator('[class*="kinds_"] [class*="kindSpec"]').first();
    await spec.scrollIntoViewIfNeeded();
    const line = (await spec.boundingBox())!;
    await page.mouse.move(line.x + 2, line.y + line.height / 2);
    await page.mouse.down();
    await page.mouse.move(line.x + line.width - 2, line.y + line.height / 2, { steps: 12 });
    await page.mouse.up();

    const picked = await page.evaluate(() => window.getSelection()?.toString().trim() ?? '');
    expect(picked, 'протяжка по характеристикам ничего не выделила').not.toBe('');
    expect((await boxOf(page, '[class*="form_"]')).left, 'выделение текста уехало формой').toBe(moved.left);
});
