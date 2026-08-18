import { describe, expect, it } from 'vitest';

import { charDelay, receptionParts } from '@/hooks/reception';

/**
 * Резка текста под лампу. Проверяем то, ради чего она и заведена: лампа не молчит между
 * границами, а начало и конец сообщения уходят целыми кусками — их и пытаются прочитать.
 */

/** Сколько знаков в каждой части. */
const sizes = (text: string): number[] => receptionParts(text).map((part) => part.text.length);

describe('receptionParts', () => {
    it('пустому тексту частей не заводит', () => {
        expect(receptionParts('')).toEqual([]);
    });

    it('короткое сообщение уходит одной частью целиком', () => {
        // Резать тут нечего: лампа и так передаст его от первой буквы до последней.
        expect(receptionParts('Есть')).toEqual([{ at: 0, text: 'Есть' }]);
    });

    it('начало и конец передаются целиком', () => {
        const text = 'Идём курсом норд-ост, ветер зюйд-вест, видимость хорошая, на связи';
        const parts = receptionParts(text);
        // Первую часть никто не перебивает — печать только началась; последнюю переставлять
        // уже не с чего. Именно они и передаются честно.
        expect(parts[0].at).toBe(0);
        expect(text.startsWith(parts[0].text)).toBe(true);
        expect(text.endsWith(parts[parts.length - 1].text)).toBe(true);
    });

    it('части идут подряд и покрывают текст без пропусков', () => {
        const text = 'Вижу вас, встаю на якорь у острова';
        const parts = receptionParts(text);
        expect(parts.map((part) => part.text).join('')).toBe(text);
        expect(parts.map((part) => part.at)).toEqual(
            parts.map((_, index) => parts.slice(0, index).reduce((sum, prev) => sum + prev.text.length, 0))
        );
    });

    it('короче пяти знаков часть не бывает: иначе лампа замолкала бы между границами', () => {
        // Худший случай — текст, у которого хвост не делится нацело: он достаётся предыдущей
        // части, а своей границы не заводит.
        for (let length = 1; length <= 200; length += 1) {
            const parts = sizes('а'.repeat(length));
            expect(Math.min(...parts), `длина ${length}`).toBeGreaterThanOrEqual(Math.min(5, length));
        }
    });

    it('длинное сообщение режет мельче, а не крупнее', () => {
        // Последнюю часть лампа договаривает уже в тишине, после того как текст допечатался.
        // Растяни её вместе с сообщением — и мигание тянулось бы минуту.
        expect(Math.max(...sizes('а'.repeat(500)))).toBe(10);
        expect(receptionParts('а'.repeat(500))).toHaveLength(50);
    });

    it('обычную реплику режет примерно на десять частей', () => {
        expect(receptionParts('а'.repeat(80))).toHaveLength(10);
    });
});

describe('charDelay', () => {
    it('печатает быстро и неровно', () => {
        const delays = 'а'.repeat(200).split('').map(charDelay);
        expect(Math.min(...delays)).toBeGreaterThanOrEqual(34);
        expect(Math.max(...delays)).toBeLessThanOrEqual(60);
        // Ровный отсчёт читается бегущей строкой, а не человеком за клавиатурой.
        expect(new Set(delays).size, 'печать идёт с ровным шагом').toBeGreaterThan(1);
    });

    it('после пробела держит паузу длиннее', () => {
        expect(charDelay(' ')).toBeGreaterThan(charDelay('а') + 60);
    });
});
