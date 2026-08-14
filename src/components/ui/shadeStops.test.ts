import { describe, expect, it } from 'vitest';

import { SHADE_PEEK_HEIGHT, SHADE_TOP_GAP } from '@/config/layout';

import { nearestStop, nextStop, shadeStops, stepStop, stopHeight } from '@/components/ui/shadeStops';

/** Обычное окно телефона: щёлка, половина и верх на нём хорошо разнесены. */
const FRAME = 800;

/** Телефонная лестница и десктопная: в проверках ниже это аргумент раскладки. */
const PHONE = true;
const DESK = false;

describe('stopHeight', () => {
    // Раскладки в мерках нет вовсе: она решает, по каким ступеням шторка ходит
    // (см. shadeStops), но не какого они роста. Три реплики с полем ввода на широком
    // окне занимают не меньше места, чем на телефоне.
    it('щёлка — своя высота, половина — половина кадра, верх — кадр без полоски под шапку', () => {
        expect(stopHeight('peek', FRAME)).toBe(SHADE_PEEK_HEIGHT);
        expect(stopHeight('half', FRAME)).toBe(FRAME / 2);
        expect(stopHeight('full', FRAME)).toBe(FRAME - SHADE_TOP_GAP);
    });

    it('ступени идут строго вверх', () => {
        expect(stopHeight('peek', FRAME)).toBeLessThan(stopHeight('half', FRAME));
        expect(stopHeight('half', FRAME)).toBeLessThan(stopHeight('full', FRAME));
    });

    it('на кадре ниже щёлки все ступени сходятся в кадр, а не вылезают за него', () => {
        const tiny = 90;
        expect(stopHeight('peek', tiny)).toBe(tiny);
        expect(stopHeight('full', tiny)).toBeLessThanOrEqual(tiny);
        expect(stopHeight('half', tiny)).toBeLessThanOrEqual(tiny);
    });
});

describe('shadeStops', () => {
    it('на телефоне ступеней три, на десктопе две — без промежуточной', () => {
        expect(shadeStops(PHONE)).toEqual(['peek', 'half', 'full']);
        expect(shadeStops(DESK)).toEqual(['peek', 'full']);
    });
});

describe('nearestStop', () => {
    it('стоящую на ступени не сдвигает', () => {
        expect(nearestStop(stopHeight('peek', FRAME), FRAME, PHONE)).toBe('peek');
        expect(nearestStop(stopHeight('half', FRAME), FRAME, PHONE)).toBe('half');
        expect(nearestStop(stopHeight('full', FRAME), FRAME, PHONE)).toBe('full');
    });

    it('короткий рывок из щёлки возвращает в щёлку, а до половины не дотягивает', () => {
        // Четверть пути от щёлки до половины: ближе к тому, откуда тянули.
        const half = stopHeight('half', FRAME);
        const peek = stopHeight('peek', FRAME);
        expect(nearestStop(peek + (half - peek) / 4, FRAME, PHONE)).toBe('peek');
    });

    it('рывок за середину промежутка переставляет на соседнюю ступень', () => {
        const half = stopHeight('half', FRAME);
        const peek = stopHeight('peek', FRAME);
        expect(nearestStop(peek + (half - peek) * 0.6, FRAME, PHONE)).toBe('half');
    });

    it('длинное движение из щёлки доводит до верха за раз', () => {
        expect(nearestStop(stopHeight('full', FRAME) - 20, FRAME, PHONE)).toBe('full');
    });

    it('на десктопе половина кадра не ступень: брошенная там шторка идёт к ближайшей из двух', () => {
        const peek = stopHeight('peek', FRAME);
        const full = stopHeight('full', FRAME);
        expect(nearestStop(Math.round(FRAME / 2), FRAME, DESK)).not.toBe('half');
        expect(nearestStop(peek + 20, FRAME, DESK)).toBe('peek');
        // Ровно на середине между двумя ступенями — уже верх, а чуть ниже — ещё сложенная.
        expect(nearestStop((peek + full) / 2 + 1, FRAME, DESK)).toBe('full');
        expect(nearestStop((peek + full) / 2 - 1, FRAME, DESK)).toBe('peek');
    });

    it('за пределами кадра ступени всё равно крайние, а не пустота', () => {
        expect(nearestStop(-100, FRAME, PHONE)).toBe('peek');
        expect(nearestStop(FRAME * 2, FRAME, PHONE)).toBe('full');
        expect(nearestStop(-100, FRAME, DESK)).toBe('peek');
        expect(nearestStop(FRAME * 2, FRAME, DESK)).toBe('full');
    });
});

describe('nextStop', () => {
    it('на телефоне идёт вверх по одной и с верхней возвращается в щёлку', () => {
        expect(nextStop('peek', PHONE)).toBe('half');
        expect(nextStop('half', PHONE)).toBe('full');
        expect(nextStop('full', PHONE)).toBe('peek');
    });

    it('на десктопе перекладывает между двумя, а половину считает сложенной', () => {
        expect(nextStop('peek', DESK)).toBe('full');
        expect(nextStop('full', DESK)).toBe('peek');
        // Так бывает, когда телефонное окно растянули: ступень осталась, лестницы под ней нет.
        expect(nextStop('half', DESK)).toBe('peek');
    });
});

describe('stepStop', () => {
    it('ходит по одной ступени в обе стороны и на краю лестницы стоит', () => {
        expect(stepStop('peek', PHONE, 1)).toBe('half');
        expect(stepStop('half', PHONE, 1)).toBe('full');
        expect(stepStop('half', PHONE, -1)).toBe('peek');
        // Край: колесо вверх на верхней ступени и вниз на нижней ничего не переставляет.
        // Этим шаг и отличается от нажатия на ручку, которое с верхней уходит по кругу в щёлку.
        expect(stepStop('full', PHONE, 1)).toBe('full');
        expect(stepStop('peek', PHONE, -1)).toBe('peek');
    });

    it('на десктопе перекладывает между двумя, а половину считает сложенной', () => {
        expect(stepStop('peek', DESK, 1)).toBe('full');
        expect(stepStop('full', DESK, -1)).toBe('peek');
        // Ступень, оставшаяся с телефонной раскладки после того, как окно растянули.
        expect(stepStop('half', DESK, 1)).toBe('full');
        expect(stepStop('half', DESK, -1)).toBe('peek');
    });
});
