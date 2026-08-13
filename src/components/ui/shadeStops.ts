import { SHADE_DESK_PEEK_HEIGHT, SHADE_PEEK_HEIGHT, SHADE_TOP_GAP } from '@/config/layout';

/** Все ступени шторки снизу вверх. По какой лестнице она ходит на самом деле — см. shadeStops. */
export const SHADE_STOPS = ['peek', 'half', 'full'] as const;

export type ShadeStop = (typeof SHADE_STOPS)[number];

/**
 * Геометрия шторки: во что превращается ступень и куда попадает брошенная.
 *
 * Вынесено из самого компонента, потому что это единственное, что в шторке можно посчитать,
 * а не посмотреть. Всё остальное там — указатели, переходы и высота в inline-стиле, и проверять
 * это дешевле браузером; а вот «дотянул до трети — вернулась в щёлку» проверяется числом.
 *
 * Лестниц две, и это не оформление, а разная работа. На телефоне шторка занимает весь экран
 * и промежуточная ступень нужна: с неё видно и сцену, и переписку. На десктопе между сложенной
 * шторкой и раскрытой лежит полоса, ради которой не стоит лишнее движение, — там ступени две,
 * зато сложенная выше: с неё уже можно переписываться, не открывая шторку вовсе.
 */

/** Ступени, по которым шторка ходит в этой раскладке. Порядок — снизу вверх. */
export const shadeStops = (mobile: boolean): readonly ShadeStop[] =>
    mobile ? SHADE_STOPS : SHADE_STOPS.filter((stop) => stop !== 'half');

/** Высота ступени в кадре высотой frame, px. */
export const stopHeight = (stop: ShadeStop, frame: number, mobile: boolean): number => {
    if (stop === 'peek') {
        // На совсем низком окне щёлка выше самого кадра: тогда она и есть весь кадр.
        return Math.min(mobile ? SHADE_PEEK_HEIGHT : SHADE_DESK_PEEK_HEIGHT, frame);
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
export const nearestStop = (height: number, frame: number, mobile: boolean): ShadeStop =>
    shadeStops(mobile).reduce((best, stop) =>
        Math.abs(stopHeight(stop, frame, mobile) - height) < Math.abs(stopHeight(best, frame, mobile) - height)
            ? stop
            : best
    );

/** Следующая ступень вверх, а с верхней — обратно вниз. */
export const nextStop = (stop: ShadeStop, mobile: boolean): ShadeStop => {
    const stops = shadeStops(mobile);
    // Ступень, которой в этой лестнице нет, считается нижней: на десктопе так себя ведёт
    // половина, оставшаяся с телефонной раскладки после того, как окно растянули.
    return stops[(stops.indexOf(stop) + 1) % stops.length];
};
