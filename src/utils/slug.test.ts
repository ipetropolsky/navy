import { describe, expect, test } from 'vitest';

import { SLUG_MAX_LENGTH, isValidSlug, slugify, slugifyInput } from '@/utils/slug';

/**
 * Адрес канала. Правило целиком счётное — строка на входе, строка на выходе, — и проверять
 * его в браузере незачем: там видно только то, что в поле что-то появилось, а не то,
 * что появилось именно годное.
 *
 * Годность тут не украшение: по адресу канал открывают из ссылки, и адрес, который
 * `slugify` предложил, а `isValidSlug` не принял, означал бы форму, которая сама себе
 * подсовывает ошибку.
 */

describe('адрес канала', () => {
    test('русское название превращается в латиницу', () => {
        // В ссылке кириллица стала бы процентами, поэтому название транслитерируется:
        // «Эскадра «Полночь»» → eskadra-polnoch. Кавычки и пробелы — это разделители слов,
        // и все они сходятся в один дефис.
        expect(slugify('Эскадра «Полночь»')).toBe('eskadra-polnoch');
        expect(slugify('Щука, Ёж и Юла')).toBe('schuka-ezh-i-yula');
        // Мягкий и твёрдый знаки пропадают вовсе: в латинице их нечем записать.
        expect(slugify('Сельдь подъездная')).toBe('seld-podezdnaya');
    });

    test('цифры остаются, лишние знаки схлопываются в один дефис', () => {
        expect(slugify('Рейд 17')).toBe('reyd-17');
        expect(slugify('Норд --- Ост!!!')).toBe('nord-ost');
        // По краям дефисов не остаётся: адрес начинается и кончается буквой или цифрой.
        expect(slugify('   ...Норд...   ')).toBe('nord');
    });

    test('длинное название обрезается по пределу и не кончается дефисом', () => {
        // Обрезка может прийтись ровно на разделитель слов — и тогда дефис на конце снимается
        // отдельно, уже после ножа: адрес с дефисом на конце негоден.
        const long = slugify('Эскадра Северного Флота Особого Назначения Номер Семнадцать');
        expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
        expect(long.endsWith('-')).toBe(false);
        expect(isValidSlug(long)).toBe(true);

        const cut = slugify(`${'a'.repeat(SLUG_MAX_LENGTH)} хвост`);
        expect(cut).toBe('a'.repeat(SLUG_MAX_LENGTH));
    });

    test('что бы ни дали, выходит либо годный адрес, либо пустота', () => {
        // Пустота — честный ответ: предлагать нечего, пусть вводят руками. Всё остальное
        // обязано проходить проверку, иначе форма подсунула бы человеку негодный адрес.
        const titles = [
            '',
            '...',
            '«»',
            'Ъ',
            '   ',
            '17',
            'Эскадра «Полночь»',
            'Norð Ost',
            'Эскадра Северного Флота Особого Назначения Номер Семнадцать',
            '-Норд-',
        ];
        for (const title of titles) {
            const slug = slugify(title);
            expect(slug === '' || isValidSlug(slug), `«${title}» → «${slug}»`).toBe(true);
        }
    });

    test('годность адреса: строчная латиница, цифры и дефис между словами', () => {
        expect(isValidSlug('eskadra-polnoch')).toBe(true);
        expect(isValidSlug('17')).toBe(true);
        expect(isValidSlug('')).toBe(false);
        expect(isValidSlug('Nord')).toBe(false);
        expect(isValidSlug('норд')).toBe(false);
        expect(isValidSlug('nord ost')).toBe(false);
        expect(isValidSlug('nord--ost')).toBe(false);
        expect(isValidSlug('-nord')).toBe(false);
        expect(isValidSlug('nord-')).toBe(false);
        expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH))).toBe(true);
        expect(isValidSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false);
    });

    test('при наборе руками дефис на конце остаётся', () => {
        // Отличие от `slugify` ровно одно, и оно про набор: снимай дефис на конце сразу,
        // и поставить его было бы нельзя — он исчезал бы до следующей буквы.
        expect(slugifyInput('nord-')).toBe('nord-');
        expect(slugifyInput('Норд ')).toBe('nord-');
        // А в начале — снимается: адрес с него начинаться не может ни при каком наборе.
        expect(slugifyInput('-nord')).toBe('nord');
        expect(slugifyInput('Норд')).toBe('nord');
        expect(slugifyInput('a'.repeat(SLUG_MAX_LENGTH + 5))).toHaveLength(SLUG_MAX_LENGTH);
    });
});
