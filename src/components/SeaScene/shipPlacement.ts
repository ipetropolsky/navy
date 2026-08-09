/**
 * Куда встаёт корабль, когда участник входит в канал.
 *
 * Мест на рейде десять — это «слоты», различаются они дальностью от наблюдателя. Слот
 * занимает один корабль, и выбирается слот случайно: строй не должен выглядеть построенным.
 * Свободная случайность, впрочем, быстро собирает корабли в кучу, поэтому её ограничивает
 * простое правило коридоров.
 *
 * Коридор — вертикальная полоса, в которую попадает центр корабля. Кадр поделён на три:
 * центры на 20%, 50% и 80% ширины, ширина коридора — шестая часть кадра. То есть на экране
 * в 600px левый коридор даёт центру корабля попасть куда-то между 70 и 170 пикселями.
 * Два корабля в одном коридоре должны стоять хотя бы через два слота друг от друга —
 * тогда они разнесены по дальности достаточно, чтобы не наложиться силуэтами.
 *
 * Расстановка своя у каждой вкладки и живёт в памяти: свой корабль у каждого наблюдателя
 * на первой линии, поэтому одинаковой картины у разных вкладок всё равно быть не может.
 */

export interface ShipPlacement {
    /** Номер слота: 0 — у горизонта, дальше к наблюдателю. */
    slot: number;
    /** Номер коридора: 0 — левый, 2 — правый. */
    corridor: number;
    /** Центр корабля, % ширины сцены. */
    left: number;
    /** Куда смотрит нос. Определяется стороной входа: корабль идёт носом вперёд. */
    facing: 'left' | 'right';
    /** С какой стороны заплыл: 'right' — из-за правого края кадра. */
    enterFrom: 'left' | 'right';
}

export const OTHER_SLOT_COUNT = 10;

/** Центры коридоров, % ширины сцены. */
const CORRIDOR_CENTERS = [20, 50, 80];

/** Ширина коридора, % ширины сцены: шестая часть кадра. */
const CORRIDOR_WIDTH = 100 / 6;

/** Ближе этого числа слотов друг к другу два корабля в одном коридоре не встают. */
const MIN_SLOT_GAP = 3;

/** Слот наблюдателя: первая линия, ближе всех. Его корабль всегда здесь. */
export const VIEWER_SLOT = OTHER_SLOT_COUNT;

/** Коридор наблюдателя — центральный: его корабль главный в кадре. */
export const VIEWER_CORRIDOR = 1;

/**
 * Глубина слота: 0 — у горизонта, 1 — первая линия. От неё зависит и размер корабля,
 * и его высота в кадре, и размах качки. Дальний край не доводим до нуля — корабль
 * у самого горизонта выродился бы в точку.
 */
export const slotDepth = (slot: number): number =>
    slot >= VIEWER_SLOT ? 1 : 0.1 + (slot / (OTHER_SLOT_COUNT - 1)) * 0.65;

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const shuffled = <T>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

/**
 * Ставит новый корабль среди уже занятых мест. Слоты перебираем в случайном порядке
 * и берём первый, где остался хоть один разрешённый коридор. Если свободных мест нет —
 * возвращаем null; при пяти участниках на десять слотов это невозможно, но проверка
 * дешевле, чем разбирательство, если однажды станет возможно.
 */
export const placeShip = (taken: ShipPlacement[]): ShipPlacement | null => {
    const allSlots = [...new Array<number>(OTHER_SLOT_COUNT)].map((_, index) => index);
    const freeSlots = shuffled(allSlots.filter((slot) => !taken.some((placement) => placement.slot === slot)));

    /** Коридоры, свободные для этого слота: занятые соседями по дальности — мимо. */
    const corridorsFor = (slot: number): number[] => {
        const blocked = new Set(
            taken
                .filter((placement) => Math.abs(placement.slot - slot) < MIN_SLOT_GAP)
                .map((placement) => placement.corridor)
        );
        return shuffled(CORRIDOR_CENTERS.map((_, index) => index)).filter((corridor) => !blocked.has(corridor));
    };

    const slot = freeSlots.find((candidate) => corridorsFor(candidate).length > 0);
    if (slot !== undefined) {
        const corridor = corridorsFor(slot)[0];
        const enterFrom = pick<'left' | 'right'>(['left', 'right']);
        return {
            slot,
            corridor,
            // Внутри коридора место любое: строй не должен выглядеть расчерченным по линейке.
            left: CORRIDOR_CENTERS[corridor] + (Math.random() - 0.5) * CORRIDOR_WIDTH,
            // Пришёл справа — значит идёт влево, носом вперёд.
            facing: enterFrom === 'right' ? 'left' : 'right',
            enterFrom,
        };
    }
    return null;
};

/** Место наблюдателя: слот и коридор у него закреплены, случайна только сторона входа. */
export const placeViewer = (): ShipPlacement => {
    const enterFrom = pick<'left' | 'right'>(['left', 'right']);
    return {
        slot: VIEWER_SLOT,
        corridor: VIEWER_CORRIDOR,
        left: CORRIDOR_CENTERS[VIEWER_CORRIDOR],
        facing: enterFrom === 'right' ? 'left' : 'right',
        enterFrom,
    };
};
