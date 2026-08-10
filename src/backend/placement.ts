/**
 * Куда встаёт корабль, когда участник входит в канал.
 *
 * Место выбирает бэкенд — один раз, при входе, — и хранит его вместе с участником.
 * Поэтому сцена у всех одинаковая: чей-то корабль стоит на одном и том же месте и смотрит
 * в одну и ту же сторону во всех вкладках, а не разъезжается у каждого по-своему.
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
 */

import {
    CORRIDORS,
    Corridor,
    ISLAND_FREE_SLOT,
    ISLAND_SIDE,
    SLOT_COUNT,
    ShipPlacement,
    Side,
    otherSide,
} from '@/types/channel';

/** Центры коридоров, % ширины сцены. */
const CORRIDOR_CENTERS: Record<Corridor, number> = { left: 20, center: 50, right: 80 };

/** Ширина коридора, % ширины сцены: шестая часть кадра. */
const CORRIDOR_WIDTH = 100 / 6;

/** Ближе этого числа слотов друг к другу два корабля в одном коридоре не встают. */
const MIN_SLOT_GAP = 3;

/**
 * Левый коридор упирается в остров: тот занимает левую часть кадра, а его берег стоит
 * примерно на дальности слота 0.7. Корабль на дальних слотах там либо оказывается прямо
 * на суше (замер: на слоте 0 под его ватерлинией земля), либо, будучи мелким и далёким,
 * рисуется поверх более близкого острова и читается выброшенным на берег.
 *
 * Поэтому левый коридор закрыт для дальних слотов. Начиная с ISLAND_FREE_SLOT корабль
 * заметно ближе острова и крупнее — перекрытие читается как «прошёл перед берегом»,
 * а это как раз то, что нужно. Сам порог живёт в types/channel.ts: про остров знает
 * не только расстановка, но и сцена, когда решает, в какую сторону кораблю уходить.
 */
const ISLAND_CORRIDOR: Corridor = 'left';

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const shuffled = <T>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

const allSlots = (): number[] => [...new Array<number>(SLOT_COUNT)].map((_, index) => index);

/**
 * Коридоры, свободные для этого слота, в случайном порядке: занятые соседями по дальности
 * и остров — мимо.
 */
const freeCorridors = (slot: number, taken: ShipPlacement[]): Corridor[] => {
    const blocked = new Set(
        taken
            .filter((placement) => Math.abs(placement.slot - slot) < MIN_SLOT_GAP)
            .map((placement) => placement.corridor)
    );
    if (slot < ISLAND_FREE_SLOT) {
        blocked.add(ISLAND_CORRIDOR);
    }
    return shuffled(CORRIDORS).filter((corridor) => !blocked.has(corridor));
};

/** Точка внутри коридора. Место любое: строй не должен выглядеть расчерченным по линейке. */
const leftInside = (corridor: Corridor): number => CORRIDOR_CENTERS[corridor] + (Math.random() - 0.5) * CORRIDOR_WIDTH;

/** Полное место на выбранном слоте: коридор, точка в нём, сторона захода и куда смотрит нос. */
const placeAt = (slot: number, corridor: Corridor): ShipPlacement => {
    // Заходить сквозь остров нельзя — на дальних слотах корабль прошёл бы прямо по нему.
    // Туда идут только с чистой стороны; ближе к переднему плану сторона любая.
    const enterFrom = slot < ISLAND_FREE_SLOT ? otherSide(ISLAND_SIDE) : pick<Side>(['left', 'right']);
    return {
        slot,
        corridor,
        left: leftInside(corridor),
        // Пришёл справа — значит идёт влево, носом вперёд.
        facing: enterFrom === 'right' ? 'left' : 'right',
        enterFrom,
        tried: [corridor],
    };
};

/**
 * Ставит новый корабль среди уже занятых мест. Слоты перебираем в случайном порядке
 * и берём первый, где остался хоть один разрешённый коридор. Если свободных мест нет —
 * возвращаем null; при пяти участниках на десять слотов это невозможно, но проверка
 * дешевле, чем разбирательство, если однажды станет возможно.
 */
export const placeShip = (taken: ShipPlacement[]): ShipPlacement | null => {
    const freeSlots = shuffled(allSlots().filter((slot) => !taken.some((placement) => placement.slot === slot)));
    const slot = freeSlots.find((candidate) => freeCorridors(candidate, taken).length > 0);
    return slot === undefined ? null : placeAt(slot, freeCorridors(slot, taken)[0]);
};

/**
 * Куда переставить корабль, которого попросили сдвинуться. Сначала перебираются коридоры
 * своего слота: корабль переходит в тот, где ещё не стоял, и это короткий ход поперёк кадра.
 * Когда слот обойдён весь, корабль снимается и перезаходит на другой свободный слот —
 * на свой он не возвращается, иначе перестановка ходила бы по кругу.
 *
 * Возвращает null, если двигаться некуда: и коридоры кончились, и свободных слотов нет.
 */
export const moveShip = (place: ShipPlacement, others: ShipPlacement[]): ShipPlacement | null => {
    const untried = freeCorridors(place.slot, others).filter((corridor) => !place.tried.includes(corridor));
    if (untried.length > 0) {
        const corridor = untried[0];
        return { ...place, corridor, left: leftInside(corridor), tried: [...place.tried, corridor] };
    }

    const freeSlots = shuffled(
        allSlots().filter((slot) => slot !== place.slot && !others.some((placement) => placement.slot === slot))
    );
    const slot = freeSlots.find((candidate) => freeCorridors(candidate, others).length > 0);
    return slot === undefined ? null : placeAt(slot, freeCorridors(slot, others)[0]);
};
