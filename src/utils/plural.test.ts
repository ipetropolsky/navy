import { describe, expect, test } from 'vitest';

import { plural } from '@/utils/plural';

/**
 * Формы слова по числу. Правило чисто счётное, и вся его суть — в исключениях: второй десяток
 * ведёт себя не как единицы, а дробное — не как его целая часть. Проверять такое в браузере
 * значило бы искать в кадре строчку, которую можно просто посчитать.
 */

const KNOTS: [string, string, string] = ['узел', 'узла', 'узлов'];

describe('формы слов', () => {
    test('единица, малые числа и всё остальное', () => {
        expect(plural(1, KNOTS)).toBe('узел');
        expect(plural(2, KNOTS)).toBe('узла');
        expect(plural(4, KNOTS)).toBe('узла');
        expect(plural(5, KNOTS)).toBe('узлов');
        expect(plural(0, KNOTS)).toBe('узлов');
    });

    test('второй десяток — исключение, а следующие десятки идут по последней цифре', () => {
        // Одиннадцать, двенадцать и далее до двадцати берут последнюю форму, хотя цифра
        // на конце говорила бы о другой: «11 узлов», а не «11 узел».
        expect(plural(11, KNOTS)).toBe('узлов');
        expect(plural(12, KNOTS)).toBe('узлов');
        expect(plural(14, KNOTS)).toBe('узлов');
        expect(plural(21, KNOTS)).toBe('узел');
        expect(plural(22, KNOTS)).toBe('узла');
        expect(plural(25, KNOTS)).toBe('узлов');
        expect(plural(101, KNOTS)).toBe('узел');
        expect(plural(111, KNOTS)).toBe('узлов');
    });

    test('дробное всегда берёт вторую форму', () => {
        // По-русски дробь согласуется с долей, а не с целой частью: «16,5 узла», хотя
        // само шестнадцать взяло бы последнюю форму.
        expect(plural(16.5, KNOTS)).toBe('узла');
        expect(plural(1.5, KNOTS)).toBe('узла');
        expect(plural(0.5, KNOTS)).toBe('узла');
        expect(plural(21.3, KNOTS)).toBe('узла');
    });

    test('знак числа на форму не влияет', () => {
        // Отрицательных узлов не бывает, но правило не должно зависеть от того, каким числом
        // его спросили: минус — это про направление, а не про форму слова.
        expect(plural(-1, KNOTS)).toBe('узел');
        expect(plural(-3, KNOTS)).toBe('узла');
        expect(plural(-11, KNOTS)).toBe('узлов');
    });
});
