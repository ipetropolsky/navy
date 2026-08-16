import { describe, expect, it } from 'vitest';

import { HAIL_SIGNAL, MORSE_UNIT, charToSegments, morseDuration } from '@/hooks/morse';

/**
 * Морзянка лампы: сколько держать огонь и сколько молчать. Счёт этот чистый, и проверять его
 * в браузере незачем — там видно только, что лампа мигает, а не что точка втрое короче тире.
 *
 * Числа тут не сверяются с самими собой: длительности записаны единицами (точка, тире, пауза),
 * как их и читают в своде сигналов, а MORSE_UNIT — то единственное число, от которого всё
 * остальное считается.
 */
describe('charToSegments', () => {
    const dot = MORSE_UNIT;
    const dash = MORSE_UNIT * 3;

    it('точка — короткая вспышка и пауза длиной в тире', () => {
        // Е — одна точка: короче знака в морзянке нет.
        expect(charToSegments('Е')).toEqual([{ on: dot, off: dash }]);
    });

    it('буква из нескольких знаков разделена паузами в точку, а после буквы пауза в тире', () => {
        // К — «−·−»: тире, точка, тире. Пауза после последнего знака длиннее — это конец буквы.
        expect(charToSegments('К')).toEqual([
            { on: dash, off: dot },
            { on: dot, off: dot },
            { on: dash, off: dash },
        ]);
    });

    it('строчную букву читает как прописную', () => {
        expect(charToSegments('к')).toEqual(charToSegments('К'));
    });

    it('пробел — молчание в семь точек', () => {
        expect(charToSegments(' ')).toEqual([{ on: 0, off: MORSE_UNIT * 7 }]);
    });

    it('незнакомый знак мигает спокойно, а не пропадает', () => {
        // Ни в кириллице, ни в латинице, ни в цифрах: передать его нечем, но и промолчать
        // о нём нельзя — иначе набранное в поле расходилось бы с тем, что видно на рейде.
        expect(charToSegments('§')).toEqual([
            { on: MORSE_UNIT * 2, off: MORSE_UNIT * 2 },
            { on: MORSE_UNIT * 2, off: MORSE_UNIT * 3 },
        ]);
    });
});

describe('morseDuration', () => {
    it('складывает и вспышки, и паузы между ними', () => {
        // К: (3+1) + (1+1) + (3+3) = 12 точек.
        expect(morseDuration('К')).toBe(MORSE_UNIT * 12);
    });

    it('считает слово по буквам', () => {
        expect(morseDuration('ЕЕ')).toBe(morseDuration('Е') * 2);
    });
});

describe('HAIL_SIGNAL', () => {
    it('это K трижды — одну букву не успеть поймать взглядом', () => {
        expect(HAIL_SIGNAL).toBe('KKK');
    });

    it('и длится он около четырёх секунд', () => {
        expect(morseDuration(HAIL_SIGNAL)).toBe(MORSE_UNIT * 36);
    });
});
