import { describe, expect, test } from 'vitest';

import { COLLECTIONS, berthId, parseBerthId, paths } from '@/config/model';

/**
 * Модель приложения: пути к коллекциям и ключ брони места.
 *
 * Проверять тут стоит две вещи, и обе — про то, что расходится молча. Первая: путь вложенной
 * коллекции собирается из пути своего родителя, а не переписан рядом руками, — иначе
 * переименование канала в модели поправит одну строчку из трёх. Вторая: ключ брони собирается
 * и разбирается одной и той же парой функций; разъедься они, и бронь перестала бы находиться
 * по своему же месту, а на рейде появились бы два корабля на одной точке.
 */

describe('пути к коллекциям', () => {
    test('вложенное растёт из родителя', () => {
        const channelId = 'ch-1';
        expect(paths.channel({ channelId })).toBe(`${COLLECTIONS.channels}/ch-1`);
        expect(paths.members({ channelId })).toBe(`${paths.channel({ channelId })}/${COLLECTIONS.members}`);
        expect(paths.member({ channelId, memberId: 'm-1' })).toBe(`${paths.members({ channelId })}/m-1`);
        expect(paths.messages({ channelId })).toBe(`${paths.channel({ channelId })}/${COLLECTIONS.messages}`);
        expect(paths.message({ channelId, messageId: 'msg-1' })).toBe(`${paths.messages({ channelId })}/msg-1`);
        expect(paths.berths({ channelId })).toBe(`${paths.channel({ channelId })}/${COLLECTIONS.berths}`);
    });

    test('участие адресуется личностью с обеих сторон', () => {
        // Одна и та же пара (личность, канал) лежит двумя записями: корабль в канале
        // и запись в реестре участий. Обе адресуются теми же двумя идентификаторами.
        const userId = 'u-1';
        const channelId = 'ch-1';
        expect(paths.member({ channelId, memberId: userId })).toBe('channels/ch-1/members/u-1');
        expect(paths.userChannel({ userId, channelId })).toBe('users/u-1/channels/ch-1');
    });

    test('у документа и его коллекции общее начало', () => {
        expect(paths.user({ userId: 'u-1' }).startsWith(`${paths.users()}/`)).toBe(true);
        expect(paths.slug({ slug: 'nord-ost' }).startsWith(`${paths.slugs()}/`)).toBe(true);
    });
});

describe('ключ брони места', () => {
    test('собирается и разбирается одним и тем же', () => {
        const berth = { slot: 7, corridor: 'right' as const };
        expect(berthId(berth)).toBe('7-right');
        expect(parseBerthId(berthId(berth))).toEqual(berth);
        expect(parseBerthId(berthId({ slot: 0, corridor: 'left' }))).toEqual({ slot: 0, corridor: 'left' });
    });

    test('путь брони — это коллекция броней и ключ места', () => {
        expect(paths.berth({ channelId: 'ch-1', slot: 3, corridor: 'center' })).toBe('channels/ch-1/berths/3-center');
    });

    test('чужая строка под нашим ключом не разбирается', () => {
        // Разбирать нечего — значит, не разбираем: место, придуманное из ничего, увело бы
        // корабль в точку, которой на рейде нет.
        expect(parseBerthId('')).toBe(null);
        expect(parseBerthId('right')).toBe(null);
        expect(parseBerthId('7')).toBe(null);
        expect(parseBerthId('-right')).toBe(null);
        expect(parseBerthId('7-берег')).toBe(null);
        expect(parseBerthId('семь-right')).toBe(null);
        expect(parseBerthId('7.5-right')).toBe(null);
    });
});
