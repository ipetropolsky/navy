import { describe, expect, it } from 'vitest';

import { SHADE_PEEK_HEIGHT, SHADE_TOP_GAP } from '@/config/layout';

import { nearestStop, nextStop, stopHeight } from '@/components/ui/shadeStops';

/** Обычное окно телефона: щёлка, половина и верх на нём хорошо разнесены. */
const FRAME = 800;

describe('stopHeight', () => {
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

describe('nearestStop', () => {
    it('стоящую на ступени не сдвигает', () => {
        expect(nearestStop(stopHeight('peek', FRAME), FRAME)).toBe('peek');
        expect(nearestStop(stopHeight('half', FRAME), FRAME)).toBe('half');
        expect(nearestStop(stopHeight('full', FRAME), FRAME)).toBe('full');
    });

    it('короткий рывок из щёлки возвращает в щёлку, а до половины не дотягивает', () => {
        // Четверть пути от щёлки до половины: ближе к тому, откуда тянули.
        const short = stopHeight('peek', FRAME) + (stopHeight('half', FRAME) - stopHeight('peek', FRAME)) / 4;
        expect(nearestStop(short, FRAME)).toBe('peek');
    });

    it('рывок за середину промежутка переставляет на соседнюю ступень', () => {
        const past = stopHeight('peek', FRAME) + (stopHeight('half', FRAME) - stopHeight('peek', FRAME)) * 0.6;
        expect(nearestStop(past, FRAME)).toBe('half');
    });

    it('длинное движение из щёлки доводит до верха за раз', () => {
        const far = stopHeight('full', FRAME) - 20;
        expect(nearestStop(far, FRAME)).toBe('full');
    });

    it('за пределами кадра ступени всё равно крайние, а не пустота', () => {
        expect(nearestStop(-100, FRAME)).toBe('peek');
        expect(nearestStop(FRAME * 2, FRAME)).toBe('full');
    });
});

describe('nextStop', () => {
    it('идёт вверх по одной и с верхней возвращается в щёлку', () => {
        expect(nextStop('peek')).toBe('half');
        expect(nextStop('half')).toBe('full');
        expect(nextStop('full')).toBe('peek');
    });
});
