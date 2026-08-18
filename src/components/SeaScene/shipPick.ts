import { SHIP_TAP_MIN } from '@/config/layout';
import { HullCenter } from '@/types/channel';

/**
 * Кому достаётся нажатие по воде.
 *
 * Две техники разом, и каждая отвечает за своё.
 *
 * **Область у каждого корабля своя** — его силуэт, расширенный до наименьшей нажимаемой мерки.
 * В крупный целятся как в кнопку; мелкому на дальней линии своей ширины не хватает, и область
 * ему раздувают вокруг середины корпуса. Мимо всех областей — ничей: пустая вода на то и пустая.
 *
 * **Расстояние решает только спор.** Области соседей по коридору накладываются: ближний корабль
 * стоит перед дальним и закрывает его собой. Попавшее в обоих нажатие достаётся тому, до чьей
 * середины корпуса ближе, — и до дальнего, торчащего из-за ближнего, дотянуться становится чем.
 * Дальше этого расстояние не решает ничего: за пределами всех областей ближайший корабль
 * такой же посторонний, как и любой другой.
 *
 * Считается всё в координатах окна — тех, что приходят в событии указателя.
 */

/** Прямоугольник в координатах окна: ровно то, что отдаёт `getBoundingClientRect`. */
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Корабль, с которым есть что делать: коробка силуэта и середина корпуса в долях коробки. */
export interface ShipTarget {
    memberId: string;
    box: Box;
    hull: HullCenter;
}

/**
 * Середина корпуса в координатах окна.
 *
 * `y` отсчитывается от нижней кромки вверх — от воды под килем, а не от верха коробки: верх
 * у коробки задаёт мачта, и мерка от него означала бы у каждого силуэта своё.
 */
export const hullSpot = ({ box, hull }: ShipTarget): { x: number; y: number } => ({
    x: box.left + (box.right - box.left) * hull.x,
    y: box.bottom - (box.bottom - box.top) * hull.y,
});

/**
 * Область нажатия: коробка силуэта, растянутая до `min` вокруг середины корпуса.
 *
 * Растягивается она наружу и только там, где не дотягивает: у крупного корабля область
 * так и остаётся его силуэтом. Растягиваем вокруг середины корпуса, а не вокруг середины
 * коробки, — иначе прибавка у мачтового силуэта уходила бы вверх, в небо над ним.
 */
export const tapArea = (ship: ShipTarget, min = SHIP_TAP_MIN): Box => {
    const spot = hullSpot(ship);
    const half = min / 2;
    return {
        left: Math.min(ship.box.left, spot.x - half),
        right: Math.max(ship.box.right, spot.x + half),
        top: Math.min(ship.box.top, spot.y - half),
        bottom: Math.max(ship.box.bottom, spot.y + half),
    };
};

/**
 * Корабль, которому достаётся нажатие в этой точке, или `null`, если нажатие мимо всех.
 *
 * Порядок в списке ни на что не влияет: спор решается расстоянием, а не тем, кто раньше
 * попался. Совпади расстояния до точки — останется первый, но совпадение это невозможно
 * на практике: две середины корпуса в одной точке означали бы два корабля в одном месте.
 */
export const shipAt = (ships: ShipTarget[], x: number, y: number, min = SHIP_TAP_MIN): string | null => {
    let nearest: string | null = null;
    let shortest = Infinity;
    for (const ship of ships) {
        const area = tapArea(ship, min);
        const inside = x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
        const spot = hullSpot(ship);
        // Квадрат расстояния: корень тут не нужен вовсе — сравнение он не меняет.
        const gap = (spot.x - x) ** 2 + (spot.y - y) ** 2;
        if (inside && gap < shortest) {
            shortest = gap;
            nearest = ship.memberId;
        }
    }
    return nearest;
};
