import { SHADE_PEEK_HEIGHT, SHADE_TOP_GAP } from '@/config/layout';

/** Ступени шторки снизу вверх. Порядок тут важен: по нему она ходит от нажатия на ручку. */
export const SHADE_STOPS = ['peek', 'half', 'full'] as const;

export type ShadeStop = (typeof SHADE_STOPS)[number];

/**
 * Геометрия шторки: во что превращается ступень и куда попадает брошенная.
 *
 * Вынесено из самого компонента, потому что это единственное, что в шторке можно посчитать,
 * а не посмотреть. Всё остальное там — указатели, переходы и высота в inline-стиле, и проверять
 * это дешевле браузером; а вот «дотянул до трети — вернулась в щёлку» проверяется числом.
 */

/** Высота ступени в кадре высотой frame, px. */
export const stopHeight = (stop: ShadeStop, frame: number): number => {
    if (stop === 'peek') {
        // На совсем низком окне щёлка выше самого кадра: тогда она и есть весь кадр.
        return Math.min(SHADE_PEEK_HEIGHT, frame);
    }
    if (stop === 'half') {
        return Math.round(frame / 2);
    }
    return Math.max(frame - SHADE_TOP_GAP, 0);
};

/**
 * Ступень, к которой ближе всего оказалась брошенная шторка.
 *
 * Отсюда сразу оба движения, обещанных шторкой: коротким рывком уходишь на соседнюю ступень,
 * длинным дотягиваешь до верха за раз. Программировать их по отдельности не нужно — достаточно
 * не переключать ступени по одной, а смотреть, где палец отпустили.
 */
export const nearestStop = (height: number, frame: number): ShadeStop =>
    SHADE_STOPS.reduce((best, stop) =>
        Math.abs(stopHeight(stop, frame) - height) < Math.abs(stopHeight(best, frame) - height) ? stop : best
    );

/** Следующая ступень вверх, а с верхней — обратно в щёлку. */
export const nextStop = (stop: ShadeStop): ShadeStop =>
    SHADE_STOPS[(SHADE_STOPS.indexOf(stop) + 1) % SHADE_STOPS.length];
