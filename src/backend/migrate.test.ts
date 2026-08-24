import { describe, expect, it } from 'vitest';

import { Channel, ShipNoticeMessage } from '@shared/types/channel';

import { OLDEST_VERSION, archiveKey, restoreState } from '@/backend/migrate';

/**
 * Приведение хранимого состояния. Проверяем то, ради чего оно и заведено: разговор
 * не пропадает от смены схемы, а от того, чего приведение не осилило, не падает экран.
 *
 * Версия здесь всюду берётся из `OLDEST_VERSION` и от неё же отсчитывается: проверки
 * не должны переписываться на каждом подъёме схемы, а те, что должны, — только те, что
 * про конкретный переход.
 */

const NOW = 15;

const CHANNEL: Channel = {
    channelId: 'ch-1',
    slug: 'eskadra',
    title: 'Эскадра',
    createdAt: 1000,
};

/** Состояние заданной версии с одним каналом. Каналы кладутся как есть, без проверки формы. */
const stored = (version: number, channels: unknown = { 'ch-1': { channel: CHANNEL, members: [], messages: [] } }) =>
    JSON.stringify({ version, channels });

/** Запись о переоснащении в той форме, в какой она лежала до четырнадцатой версии. */
const oldRefit = (changed: string[]) => ({
    messageId: 'msg-1',
    author: { memberId: 'm-1' },
    sentAt: 2000,
    kind: 'system',
    notice: {
        event: 'refit',
        before: { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' },
        after: { shipKind: 'pr205', name: 'Бургомистр', hullNumber: '512' },
        changed,
    },
});

/** Что стало с лентой канала после приведения из тринадцатой формы. */
const messagesAfter = (messages: unknown[]): ShipNoticeMessage[] =>
    (restoreState(stored(13, { 'ch-1': { channel: CHANNEL, members: [], messages } }), NOW).state?.channels['ch-1']
        .messages ?? []) as ShipNoticeMessage[];

describe('restoreState', () => {
    it('состояние нынешней формы отдаёт как есть и хранилище не трогает', () => {
        const { state, was } = restoreState(stored(NOW), NOW);
        expect(state?.channels['ch-1'].channel).toEqual(CHANNEL);
        // Пустой `was` — это и есть «переписывать нечего»: хранилище уже нужной формы.
        expect(was, 'состояние нынешней формы попросилось в архив').toBeNull();
    });

    it('пустого хранилища не бывает «прежним»: откладывать нечего', () => {
        expect(restoreState(null, NOW)).toEqual({ state: null, was: null });
    });

    it('битый JSON не роняет чтение, но и не пропадает', () => {
        const { state, was } = restoreState('{это не json', NOW);
        expect(state, 'из битого JSON что-то восстановилось').toBeNull();
        // Версии у такого нет вовсе, но отложить его всё равно надо: ключ нулевой.
        expect(was).toBe(0);
    });

    it('версию из будущего вниз не приводит', () => {
        const { state, was } = restoreState(stored(NOW + 1), NOW);
        expect(state, 'состояние новой выкладки прочиталось нынешним кодом').toBeNull();
        expect(was).toBe(NOW + 1);
    });

    it('форму старше всех приведений не выдумывает', () => {
        const { state, was } = restoreState(stored(OLDEST_VERSION - 1), NOW);
        expect(state).toBeNull();
        expect(was, 'самая старая форма не попала в архив').toBe(OLDEST_VERSION - 1);
    });

    it('приводит по ступенькам от самой старой формы до нынешней', () => {
        const { state, was } = restoreState(stored(OLDEST_VERSION), NOW);
        expect(state?.version).toBe(NOW);
        expect(state?.channels['ch-1'].channel).toEqual(CHANNEL);
        expect(was, 'приведённое состояние не попросилось переписать хранилище').toBe(OLDEST_VERSION);
    });
});

describe('разбор', () => {
    it('канал без своих полей пропускает, соседний оставляет', () => {
        const { state, was } = restoreState(
            stored(NOW, {
                'ch-1': { channel: CHANNEL, members: [], messages: [] },
                'ch-2': { channel: { title: 'Без адреса' }, members: [], messages: [] },
            }),
            NOW
        );
        expect(Object.keys(state?.channels ?? {}), 'неразобранный канал утащил с собой соседний').toEqual(['ch-1']);
        expect(was, 'пропущенный канал не заставил отложить прежнее').toBe(NOW);
    });

    it('канал без списков достраивает пустыми', () => {
        const { state, was } = restoreState(stored(NOW, { 'ch-1': { channel: CHANNEL } }), NOW);
        expect(state?.channels['ch-1']).toEqual({ channel: CHANNEL, members: [], messages: [] });
        expect(was).toBe(NOW);
    });

    it('участников и сообщения поштучно не проверяет', () => {
        // Незнакомое поле у сообщения ничему не мешает, и выбрасывать из-за него разговор
        // нельзя: сегодняшний код прочитает знакомое, а лишнее просто не заметит.
        const messages = [{ messageId: 'msg-1', author: { memberId: 'm-1' }, sentAt: 1, text: 'Есть', wind: 'зюйд' }];
        const { state, was } = restoreState(stored(NOW, { 'ch-1': { channel: CHANNEL, members: [], messages } }), NOW);
        expect(state?.channels['ch-1'].messages).toEqual(messages);
        expect(was).toBeNull();
    });
});

describe('тринадцатая форма → четырнадцатая', () => {
    it('разбирает запись о трёх переменах на три сообщения, от крупного к мелкому', () => {
        const messages = messagesAfter([oldRefit(['name', 'hullNumber', 'shipKind'])]);
        expect(messages.map((message) => message.notice.changed)).toEqual(['shipKind', 'name', 'hullNumber']);
        // Номера разные — по ним отвечают, и два одинаковых слепили бы два ответа в один.
        expect(messages.map((message) => message.messageId)).toEqual([
            'msg-1-shipKind',
            'msg-1-name',
            'msg-1-hullNumber',
        ]);
        // Всё остальное в записи — прежнее: приведение делит, а не переписывает.
        expect(messages[0].sentAt).toBe(2000);
        expect(messages[0].notice.before).toEqual({ shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' });
    });

    it('одну перемену оставляет одним сообщением', () => {
        const messages = messagesAfter([oldRefit(['name'])]);
        expect(messages).toHaveLength(1);
        expect(messages[0].notice.changed).toBe('name');
        expect(messages[0].messageId).toBe('msg-1-name');
    });

    it('запись без пометок не выбрасывает', () => {
        const messages = messagesAfter([oldRefit([])]);
        expect(messages).toHaveLength(1);
        expect(messages[0].notice.changed).toBeUndefined();
        expect(messages[0].messageId, 'запись без пометок сменила номер').toBe('msg-1');
    });

    it('обычную реплику не трогает', () => {
        const chat = { messageId: 'msg-2', author: { memberId: 'm-1' }, sentAt: 3000, text: 'Есть' };
        expect(messagesAfter([chat])).toEqual([chat]);
    });
});

describe('archiveKey', () => {
    it('раскладывает прежнее по версиям, чтобы копии не затирали друг друга', () => {
        expect(archiveKey('kilvater.state', 13)).toBe('kilvater.state.was.13');
        expect(archiveKey('kilvater.state', 14)).not.toBe(archiveKey('kilvater.state', 13));
    });
});
