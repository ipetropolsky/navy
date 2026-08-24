import { describe, expect, test } from 'vitest';

import { limitMessage, overLimit } from './limit';

/**
 * Предел длины. Правило короткое, но живёт оно в четырёх полях сразу — сообщение, позывной,
 * название канала, новый курс, — и разъехаться ему нельзя: поле краснеет по одной мерке,
 * а отказ считает по другой, и человек читает про 100 символов, глядя на непокрасневшее поле.
 */

describe('overLimit', () => {
    test('ровно по пределу — ещё не перебор', () => {
        expect(overLimit('я'.repeat(100), 100)).toBe(false);
        expect(overLimit('я'.repeat(101), 100)).toBe(true);
    });

    test('пустое поле не перебирает никогда', () => {
        expect(overLimit('', 0)).toBe(false);
        expect(overLimit('   ', 1)).toBe(false);
    });

    test('крайние пробелы не считаются: уйдёт всё равно обрезанное', () => {
        expect(overLimit(`  ${'я'.repeat(100)}  `, 100)).toBe(false);
    });
});

describe('limitMessage', () => {
    test('говорит и предел, и то, сколько набрано', () => {
        expect(limitMessage('я'.repeat(505), 500)).toBe('Максимум 500 символов, у вас 505');
    });

    test('считает то же самое, что и сама проверка', () => {
        expect(limitMessage(`  ${'я'.repeat(101)} `, 100)).toBe('Максимум 100 символов, у вас 101');
    });
});
