import { describe, expect, test } from 'vitest';

import { manoeuvreEndsAt, manoeuvreWaitMs } from '@/utils/manoeuvreGuard';

describe('очередь манёвров', () => {
    test('манёвр заканчивается через свою длительность после старта', () => {
        expect(manoeuvreEndsAt(1000, 5)).toBe(6000);
        expect(manoeuvreEndsAt(1000, 0)).toBe(1000);
    });

    test('ждать нужно ровно до готового момента', () => {
        expect(manoeuvreWaitMs(6000, 1000)).toBe(5000);
        expect(manoeuvreWaitMs(6000, 5999)).toBe(1);
    });

    test('прошедший момент не просит ждать себя во второй раз', () => {
        expect(manoeuvreWaitMs(6000, 6000)).toBe(0);
        expect(manoeuvreWaitMs(6000, 9000)).toBe(0);
        // 0 — умолчание («манёвра не было») ведёт себя так же: ждать нечего.
        expect(manoeuvreWaitMs(0, 1000)).toBe(0);
    });
});
