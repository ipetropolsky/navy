import { describe, expect, it } from 'vitest';

import { unreadAfter } from '@/hooks/unread';

import { Message } from '@/types/channel';

/**
 * Счёт непрочитанного. Проверяем само правило: что попадает в счётчик, а что нет, и от какого
 * места он считается.
 */

/** Чужая реплика. */
const said = (messageId: string, memberId = 'other'): Message => ({
    messageId,
    author: { memberId },
    sentAt: 0,
    text: 'Есть',
});

/** Служебная запись о корабле — та самая, что складывается в ленту сама. */
const notice = (messageId: string): Message => ({
    messageId,
    author: { memberId: 'other' },
    sentAt: 0,
    kind: 'system',
    notice: { event: 'joined', before: { shipKind: 'pr12412', name: 'Стриж', hullNumber: '111' } },
});

describe('unreadAfter', () => {
    it('в пустой ленте считать нечего', () => {
        expect(unreadAfter([], null, 'me')).toBe(0);
    });

    it('считает чужие реплики после отметки', () => {
        const feed = [said('1'), said('2'), said('3')];
        expect(unreadAfter(feed, '1', 'me')).toBe(2);
    });

    it('отметка на последней записи означает, что нового нет', () => {
        const feed = [said('1'), said('2')];
        expect(unreadAfter(feed, '2', 'me')).toBe(0);
    });

    it('своё в счёт не идёт', () => {
        // Из другой вкладки человек мог написать и сам — считать это непрочитанным нельзя.
        const feed = [said('1'), said('2', 'me'), said('3')];
        expect(unreadAfter(feed, '1', 'me')).toBe(1);
    });

    it('служебные записи в счёт не идут', () => {
        // Про рейд рассказывает сам рейд: он на экране и с убранным разговором.
        const feed = [said('1'), notice('2'), notice('3'), said('4')];
        expect(unreadAfter(feed, '1', 'me')).toBe(1);
    });

    it('без отметки считает всю ленту', () => {
        // Канал открывали пустым: отмечать было нечего, и всё пришедшее — новость.
        expect(unreadAfter([said('1'), said('2')], null, 'me')).toBe(2);
    });

    it('отметку, которой в ленте нет, считает за начало ленты', () => {
        expect(unreadAfter([said('1'), said('2')], 'ушедшая', 'me')).toBe(2);
    });
});
