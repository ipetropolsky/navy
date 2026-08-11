/**
 * Куда встаёт корабль, когда участник входит в канал.
 *
 * Место выбирает бэкенд — один раз, при входе, — и хранит его вместе с участником.
 * Поэтому сцена у всех одинаковая: чей-то корабль стоит на одном и том же месте и смотрит
 * в одну и ту же сторону во всех вкладках, а не разъезжается у каждого по-своему.
 *
 * Мест на рейде десять — это «слоты», различаются они дальностью от наблюдателя. Слот
 * занимает один корабль, и выбирается место случайно: строй не должен выглядеть построенным.
 * Свободная случайность, впрочем, быстро собирает корабли в кучу, поэтому её ограничивают
 * три правила: коридоры разводят соседей по ширине кадра, размер корабля задаёт, в какой
 * части рейда он скорее встанет, а из оставшегося берётся самое свободное — как место
 * в автобусе, где сперва садятся подальше от всех.
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
    SHIP_KINDS,
    SHIP_SPECS,
    SLOT_COUNT,
    ShipKind,
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

/**
 * Сколько слотов от «своей» дальности рассматриваем как равноценные. Не правило, а склонность:
 * из этого набора слот берётся случайно, поэтому крупный корабль встаёт где-то в дальней
 * половине рейда, а не строго на последнем слоте, и строй не выстраивается по росту.
 */
const SLOT_CHOICE = 4;

/**
 * Из скольких самых свободных мест выбираем в итоге. Рейд занимается как автобус: сначала
 * места подальше от всех, и только когда таких не осталось — те, что ближе к соседям.
 * Не одно самое дальнее, а несколько лучших: иначе расстановка стала бы алгоритмом,
 * который на одних и тех же кораблях каждый раз выдаёт одну и ту же картинку.
 */
const SPOT_CHOICE = 3;

/** Наибольшее расстояние между центрами коридоров, % ширины сцены: от левого до правого. */
const CORRIDOR_SPAN = CORRIDOR_CENTERS.right - CORRIDOR_CENTERS.left;

/**
 * Куда тянет корабль этого размера: самый длинный — к дальнему краю рейда, самый мелкий —
 * к переднему плану. Так сцена уравновешивается сама: крупные не загораживают собой весь кадр,
 * а катера не теряются у горизонта точками.
 */
const preferredSlot = (kind: ShipKind): number => {
    const lengths = SHIP_KINDS.map((item) => SHIP_SPECS[item].length);
    const shortest = Math.min(...lengths);
    const longest = Math.max(...lengths);
    const size = (SHIP_SPECS[kind].length - shortest) / (longest - shortest);
    return Math.round((1 - size) * (SLOT_COUNT - 1));
};

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

/**
 * Насколько место далеко от чужого корабля. Обе разницы приведены к долям своего размаха
 * и сложены: 0 — тот же слот и тот же коридор, 2 — противоположный угол рейда. Дальность
 * и ширина считаются наравне, потому что в кадре они и выглядят наравне: сосед через
 * два слота разнесён с тобой примерно так же, как сосед в другом коридоре.
 */
const distanceTo = (slot: number, corridor: Corridor, other: ShipPlacement): number =>
    Math.abs(slot - other.slot) / (SLOT_COUNT - 1) +
    Math.abs(CORRIDOR_CENTERS[corridor] - CORRIDOR_CENTERS[other.corridor]) / CORRIDOR_SPAN;

/** Насколько место свободно: расстояние до ближайшего соседа. Пустой рейд — свободно всё. */
const loneliness = (slot: number, corridor: Corridor, taken: ShipPlacement[]): number =>
    taken.length === 0 ? Infinity : Math.min(...taken.map((other) => distanceTo(slot, corridor, other)));

/** Точка внутри коридора. Место любое: строй не должен выглядеть расчерченным по линейке. */
const leftInside = (corridor: Corridor): number => CORRIDOR_CENTERS[corridor] + (Math.random() - 0.5) * CORRIDOR_WIDTH;

/**
 * С какой стороны корабль заходит на рейд.
 *
 * На дальних слотах выбора нет: с той стороны остров, и корабль прошёл бы прямо по нему.
 * А там, где выбор есть, он не честная монетка, а противовес: чем больше кораблей уже пришло
 * с одной стороны, тем вероятнее следующий придёт с другой. Иначе рейд заполнялся бы
 * в основном справа — дальние слоты вынужденно правые, а крупные корабли тянутся именно туда.
 *
 * Перевес считается по квадратам, а не напрямую: перекос надо не смягчать, а выправлять.
 * Дальние слоты все правые, и крупные корабли тянутся именно туда, так что вольную половину
 * рейда приходится уводить влево заметно сильнее, чем «чуть чаще». Единица в каждой скобке —
 * обычное сглаживание: на пустом рейде выходит ровно половина, и правая сторона не запрещена
 * никогда.
 */
const enterSide = (slot: number, taken: ShipPlacement[]): Side => {
    if (slot < ISLAND_FREE_SLOT) {
        return otherSide(ISLAND_SIDE);
    }
    const fromLeft = (taken.filter((placement) => placement.enterFrom === 'left').length + 1) ** 2;
    const fromRight = (taken.filter((placement) => placement.enterFrom === 'right').length + 1) ** 2;
    return Math.random() < fromRight / (fromLeft + fromRight) ? 'left' : 'right';
};

/** Полное место на выбранном слоте: коридор, точка в нём, сторона захода и куда смотрит нос. */
const placeAt = (slot: number, corridor: Corridor, taken: ShipPlacement[]): ShipPlacement => {
    const enterFrom = enterSide(slot, taken);
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

/** Свободное место на рейде: дальность и коридор. Точку внутри коридора выберет placeAt. */
interface Spot {
    slot: number;
    corridor: Corridor;
}

/**
 * Куда этот корабль может встать. Сначала отбираем слоты по дальности — ближайшие к «своей»
 * части рейда, — а потом раскладываем их по свободным коридорам: получается набор мест,
 * из которого и выбираем.
 */
const freeSpots = (kind: ShipKind, taken: ShipPlacement[], exclude?: number): Spot[] => {
    const wanted = preferredSlot(kind);
    return allSlots()
        .filter(
            (slot) =>
                slot !== exclude &&
                !taken.some((placement) => placement.slot === slot) &&
                freeCorridors(slot, taken).length > 0
        )
        .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted))
        .slice(0, SLOT_CHOICE)
        .flatMap((slot) => freeCorridors(slot, taken).map((corridor) => ({ slot, corridor })));
};

/**
 * Место для корабля — как место в автобусе: сперва подальше от всех, и только когда таких
 * не осталось, поближе к соседям. Считается это одинаково для обоих случаев: свободные места
 * сортируются по расстоянию до ближайшего соседа, и выбор идёт из нескольких самых свободных.
 *
 * Случайность нужна: без неё расстановка превратилась бы в алгоритм, который на одном
 * и том же составе каждый раз рисует одну и ту же картинку.
 */
const pickSpot = (kind: ShipKind, taken: ShipPlacement[], exclude?: number): Spot | null => {
    const spots = freeSpots(kind, taken, exclude);
    if (spots.length === 0) {
        return null;
    }
    // Перемешиваем до сортировки: сортировка устойчива, поэтому одинаково свободные места
    // сохранят случайный порядок. Без этого на пустом рейде, где свободно всё, в набор
    // попадали бы три коридора одного и того же слота — и первый корабль всегда вставал бы
    // на одно и то же место.
    const roomiest = shuffled(spots)
        .sort((a, b) => loneliness(b.slot, b.corridor, taken) - loneliness(a.slot, a.corridor, taken))
        .slice(0, SPOT_CHOICE);
    return pick(roomiest);
};

/**
 * Ставит новый корабль среди уже занятых мест. Если свободных мест нет — возвращаем null;
 * при пяти участниках на десять слотов это невозможно, но проверка дешевле, чем
 * разбирательство, если однажды станет возможно.
 */
export const placeShip = (kind: ShipKind, taken: ShipPlacement[]): ShipPlacement | null => {
    const spot = pickSpot(kind, taken);
    return spot && placeAt(spot.slot, spot.corridor, taken);
};

/**
 * Куда переставить корабль, которого попросили сдвинуться. Сначала перебираются коридоры
 * своего слота: корабль переходит в тот, где ещё не стоял, и это короткий ход поперёк кадра.
 * Когда слот обойдён весь, корабль снимается и перезаходит на другой свободный слот —
 * на свой он не возвращается, иначе перестановка ходила бы по кругу.
 *
 * Возвращает null, если двигаться некуда: и коридоры кончились, и свободных слотов нет.
 */
export const moveShip = (kind: ShipKind, place: ShipPlacement, others: ShipPlacement[]): ShipPlacement | null => {
    const untried = freeCorridors(place.slot, others).filter((corridor) => !place.tried.includes(corridor));
    if (untried.length > 0) {
        const corridor = untried[0];
        return { ...place, corridor, left: leftInside(corridor), tried: [...place.tried, corridor] };
    }

    // На свой слот не возвращаемся, иначе перестановка ходила бы по кругу; в остальном
    // место выбирается так же, как при входе.
    const spot = pickSpot(kind, others, place.slot);
    return spot && placeAt(spot.slot, spot.corridor, others);
};
