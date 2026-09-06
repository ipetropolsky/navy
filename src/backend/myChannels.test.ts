import { describe, expect, test } from 'vitest';

import { Channel } from '@shared/types/channel';

import { joinMyChannels, pickMyChannels, sortMyChannels } from '@/backend/myChannels';

/**
 * Счётная часть списка своих каналов — та, которая одна на оба бэкенда. Проверяется здесь,
 * а не браузерным прогоном: порядок строчек и правило «канал без названия не показываем»
 * — это разбор данных, и стоить он должен секунды, а не минуты (см. AGENTS.md о цене проверок).
 */

const channel = (channelId: string, over: Partial<Channel> = {}): Channel => ({
    channelId,
    slug: channelId,
    title: channelId,
    createdAt: 0,
    ...over,
});

describe('sortMyChannels', () => {
    test('последний рейд — сверху', () => {
        const sorted = sortMyChannels([
            { channelId: 'ch-1', slug: 'one', title: 'Один', joinedAt: 100 },
            { channelId: 'ch-2', slug: 'two', title: 'Два', joinedAt: 300 },
            { channelId: 'ch-3', slug: 'three', title: 'Три', joinedAt: 200 },
        ]);
        expect(sorted.map((item) => item.channelId)).toEqual(['ch-2', 'ch-3', 'ch-1']);
    });

    test('вошли в один миг — разбирает названием, а не порядком хранилища', () => {
        const same = [
            { channelId: 'ch-b', slug: 'b', title: 'Бриз', joinedAt: 100 },
            { channelId: 'ch-a', slug: 'a', title: 'Аврора', joinedAt: 100 },
        ];
        expect(sortMyChannels(same).map((item) => item.title)).toEqual(['Аврора', 'Бриз']);
        expect(sortMyChannels([...same].reverse()).map((item) => item.title)).toEqual(['Аврора', 'Бриз']);
    });

    test('исходный список не трогает: сортировка на месте испортила бы состояние бэкенда', () => {
        const given = [
            { channelId: 'ch-1', slug: 'one', title: 'Один', joinedAt: 100 },
            { channelId: 'ch-2', slug: 'two', title: 'Два', joinedAt: 300 },
        ];
        sortMyChannels(given);
        expect(given.map((item) => item.channelId)).toEqual(['ch-1', 'ch-2']);
    });
});

describe('pickMyChannels', () => {
    const stored = [
        { channel: channel('ch-mine', { slug: 'mine', title: 'Мой' }), members: [{ memberId: 'u-1', joinedAt: 10 }] },
        {
            channel: channel('ch-other', { slug: 'other', title: 'Чужой' }),
            members: [{ memberId: 'u-2', joinedAt: 20 }],
        },
        { channel: channel('ch-empty', { slug: 'empty', title: 'Пустой' }), members: [] },
        {
            channel: channel('ch-both', { slug: 'both', title: 'Общий' }),
            members: [
                { memberId: 'u-2', joinedAt: 5 },
                { memberId: 'u-1', joinedAt: 30 },
            ],
        },
    ];

    test('свои — те, где стоит корабль этой личности', () => {
        expect(pickMyChannels(stored, 'u-1')).toEqual([
            { channelId: 'ch-both', slug: 'both', title: 'Общий', joinedAt: 30 },
            { channelId: 'ch-mine', slug: 'mine', title: 'Мой', joinedAt: 10 },
        ]);
    });

    test('заведённый и брошенный канал в список не идёт: участия в нём нет', () => {
        expect(pickMyChannels(stored, 'u-1').map((item) => item.channelId)).not.toContain('ch-empty');
    });

    test('время входа берётся у своего корабля, а не у первого встречного', () => {
        expect(pickMyChannels(stored, 'u-2').map((item) => item.joinedAt)).toEqual([20, 5]);
    });

    test('ни одного своего канала — пустой список, а не отказ', () => {
        expect(pickMyChannels(stored, 'u-нездешний')).toEqual([]);
    });
});

describe('joinMyChannels', () => {
    const entries = [
        { channelId: 'ch-1', joinedAt: 10 },
        { channelId: 'ch-2', joinedAt: 20 },
    ];

    test('название и адрес — из самого канала, время входа — из реестра', () => {
        const found = new Map([
            ['ch-1', { slug: 'one', title: 'Один' }],
            ['ch-2', { slug: 'two', title: 'Два' }],
        ]);
        expect(joinMyChannels(entries, found)).toEqual([
            { channelId: 'ch-2', slug: 'two', title: 'Два', joinedAt: 20 },
            { channelId: 'ch-1', slug: 'one', title: 'Один', joinedAt: 10 },
        ]);
    });

    test('канал не прочитался — строчка выпадает, остальные остаются', () => {
        const found = new Map([['ch-1', { slug: 'one', title: 'Один' }]]);
        expect(joinMyChannels(entries, found)).toEqual([
            { channelId: 'ch-1', slug: 'one', title: 'Один', joinedAt: 10 },
        ]);
    });

    test('не прочиталось ничего — пустой список, а не список без названий', () => {
        expect(joinMyChannels(entries, new Map())).toEqual([]);
    });
});
