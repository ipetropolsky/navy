import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { ISLAND_FREE_SLOT, ISLAND_SIDE, ShipKind, ShipPlacement, otherSide, slotDepth } from '@/types/channel';

/**
 * Ход корабля по сцене: сколько ему идти, куда и как долго.
 *
 * Расстояния здесь считаются в длинах корпуса, а не в пикселях и не в долях экрана.
 * Так удобно по двум причинам. Во-первых, CSS-свойство translate в процентах отсчитывается
 * от собственной ширины элемента, то есть «120%» — это ровно 1.2 длины корабля, и переводить
 * ничего не нужно. Во-вторых, в этих единицах скорость получается честной: дальний корабль
 * в кадре мельче, и та же скорость в пикселях означала бы для него куда больший ход.
 */

/**
 * Крейсерская скорость, длин корпуса в секунду. Для катера длиной 30 м это 15 м/с,
 * то есть около 29 узлов — обычный ход сторожевого или торпедного катера.
 *
 * Для сравнения, как было: 130vw за 5.5 с на широком экране — это 5.3 длины корпуса
 * в секунду средней скорости и 6.4 длины в пике из-за кривой разгона. Для корабля
 * в 50 м это 95 узлов средней и 605 в пике: так не ходит и не тормозит ничто.
 */
const CRUISE_LENGTHS_PER_SECOND = 0.5;

/**
 * Во сколько раз кривая хода быстрее в пике, чем в среднем по прогону. У ease-out
 * (0, 0, 0.58, 1) и обратной ей ease-in это 1.72 — замерено численно по кривой Безье.
 * Отсюда считается длительность: скорость задана крейсерская, а она у этих кривых
 * приходится ровно на пик — на вход в кадр и на уход из него.
 */
const EASE_PEAK_RATIO = 1.72;

/** Задним ходом корабль идёт медленнее переднего: винт и обводы работают не в свою сторону. */
const ASTERN_SPEED_RATIO = 0.7;

/**
 * Потолок длительности. Мелкий далёкий катер, которому идти через весь кадр, по-честному
 * шёл бы полминуты — столько ждать нельзя, поэтому такие редкие прогоны идут быстрее
 * положенного. Обычные ходы в потолок не упираются.
 */
const MAX_SAIL_SECONDS = 14;

/** Запас за кромкой кадра, % ширины сцены: корабль должен уйти целиком, с оглядкой на max-width. */
const EDGE_MARGIN = 10;

/** Ширина корабля в кадре, % ширины сцены: от дальности и от размера силуэта. */
export const shipWidthPercent = (slot: number, kind: ShipKind): number =>
    (20 + slotDepth(slot) * 30) * SHIP_SPRITES[kind].scale;

/** Сколько своих длин кораблю идти от стоянки до края кадра. */
export const lengthsToEdge = (leftPercent: number, widthPercent: number, side: 'left' | 'right'): number => {
    const span = side === 'left' ? leftPercent : 100 - leftPercent;
    return (span + widthPercent / 2 + EDGE_MARGIN) / widthPercent;
};

/** Сколько секунд идти столько-то длин корпуса. Задним ходом — дольше. */
export const sailSeconds = (lengths: number, astern: boolean): number => {
    const speed = (CRUISE_LENGTHS_PER_SECOND / EASE_PEAK_RATIO) * (astern ? ASTERN_SPEED_RATIO : 1);
    return Math.min(lengths / speed, MAX_SAIL_SECONDS);
};

/**
 * Проходит ли корабль сквозь остров, идя в эту сторону. Остров занимает левую часть кадра
 * и на дальних слотах стоит выше корабля по кадру — корабль нарисовался бы прямо на нём.
 * Ближе ISLAND_FREE_SLOT он проходит перед берегом, и это как раз нормально.
 */
export const crossesIsland = (slot: number, side: 'left' | 'right'): boolean =>
    side === ISLAND_SIDE && slot < ISLAND_FREE_SLOT;

/**
 * За сколько слотов чужой корабль ещё считается стоящим на дороге. Ровно за один:
 * на своей дальности корабль всегда один — два в одном слоте расстановка не поставит, —
 * поэтому речь только о соседней. Соседний слот отличается по глубине на девятую часть
 * всей перспективы: корабли там почти одного размера и почти на одной линии, и проход
 * сквозь такого соседа читается как столкновение. Через слот разница уже видна, и корабль
 * проходит перед соседом или за ним — это в кадре происходит постоянно и вопросов не вызывает.
 */
const NEIGHBOUR_REACH = 1;

/** Стоит ли на пути чужой корабль — на соседней дальности и с той стороны, куда идём. */
const shipInTheWay = (place: ShipPlacement, others: ShipPlacement[], side: 'left' | 'right'): boolean =>
    others.some(
        (other) =>
            Math.abs(other.slot - place.slot) <= NEIGHBOUR_REACH &&
            (side === 'left' ? other.left < place.left : other.left > place.left)
    );

/**
 * В какую сторону корабль уходит из кадра и задним ли ходом. Обычно — вперёд, куда смотрит
 * нос: разворачиваться посреди рейда незачем. Но если впереди остров или корабль на соседней
 * дальности, уходит задним ходом, кормой вперёд — медленнее, зато не по суше и не в чужой борт.
 *
 * Заперт с обеих сторон — пойдёт мимо соседа, но не на берег: с соседом разойтись можно,
 * с островом нет.
 */
export const leaveCourse = (
    place: ShipPlacement,
    others: ShipPlacement[]
): { side: 'left' | 'right'; astern: boolean } => {
    const back = otherSide(place.facing);
    const isClear = (side: 'left' | 'right'): boolean =>
        !crossesIsland(place.slot, side) && !shipInTheWay(place, others, side);
    const goBack = !isClear(place.facing) && (isClear(back) || crossesIsland(place.slot, place.facing));
    return { side: goBack ? back : place.facing, astern: goBack };
};
