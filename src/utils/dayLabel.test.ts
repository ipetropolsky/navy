import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { dayBoundaries, daySeparatorLabel, isSameLocalDay } from '@/utils/dayLabel';

/**
 * Граница дня — чистый счёт по меткам времени, без единой строчки разметки. Гонять её через
 * браузер незачем: ответ на «сменился ли календарный день» и на «что написать на чипе»
 * не зависит ни от кадра, ни от свёрстанной ленты (принцип GH-12).
 */

describe('isSameLocalDay', () => {
    beforeEach(() => {
        // Граница дня — это граница местной полуночи, а не UTC: закрепляем пояс окружения
        // явно, чтобы прогон не зависел от того, где физически стоит машина с тестами.
        vi.stubEnv('TZ', 'UTC');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    test('минута до полуночи и минута после — разные дни', () => {
        const beforeMidnight = Date.UTC(2026, 8, 4, 23, 50);
        const afterMidnight = Date.UTC(2026, 8, 5, 0, 10);
        expect(isSameLocalDay(beforeMidnight, afterMidnight)).toBe(false);
    });

    test('утро и вечер одного дня — один день', () => {
        const morning = Date.UTC(2026, 8, 5, 6, 0);
        const evening = Date.UTC(2026, 8, 5, 20, 0);
        expect(isSameLocalDay(morning, evening)).toBe(true);
    });
});

describe('dayBoundaries', () => {
    test('перед первым сообщением разделитель всегда, дальше — по смене дня', () => {
        const day1 = Date.UTC(2026, 8, 4, 10, 0);
        const day1Later = Date.UTC(2026, 8, 4, 18, 0);
        const day2 = Date.UTC(2026, 8, 5, 9, 0);
        const day2Later = Date.UTC(2026, 8, 5, 9, 30);
        expect(dayBoundaries([day1, day1Later, day2, day2Later])).toEqual([true, false, true, false]);
    });

    test('единственное сообщение канала — разделитель перед ним тоже есть', () => {
        expect(dayBoundaries([Date.now()])).toEqual([true]);
    });

    test('пустая лента — пустой список границ', () => {
        expect(dayBoundaries([])).toEqual([]);
    });
});

describe('daySeparatorLabel', () => {
    const now = Date.UTC(2026, 8, 5, 12, 0);

    test('сегодняшнее сообщение', () => {
        expect(daySeparatorLabel(Date.UTC(2026, 8, 5, 0, 5), now)).toBe('Сегодня');
    });

    test('вчерашнее сообщение', () => {
        expect(daySeparatorLabel(Date.UTC(2026, 8, 4, 23, 55), now)).toBe('Вчера');
    });

    test('позавчера — дата с месяцем, без года в текущем году', () => {
        expect(daySeparatorLabel(Date.UTC(2026, 8, 1, 12, 0), now)).toBe('1 сентября');
    });

    test('за прошлый год — дата с годом, чтобы не читалась как свежая', () => {
        expect(daySeparatorLabel(Date.UTC(2025, 8, 5, 12, 0), now)).toBe('5 сентября 2025 г.');
    });
});
