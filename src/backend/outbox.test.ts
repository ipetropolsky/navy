import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ChatMessage } from '@shared/types/channel';

import { discardOutboxMessage, putOutboxMessage, readOutbox, removeOutboxMessage } from '@/backend/outbox';

/**
 * Ящик неотправленного живёт в sessionStorage — здесь он подложный, как и localStorage
 * у localBackend.test.ts: своя карта на ключ-значение вместо настоящего окна браузера.
 *
 * Полнее того минимума (getItem/setItem/removeItem), которым обходятся другие такие
 * подложные хранилища в проекте: discardOutboxMessage перебирает ключи (length/key),
 * и без них тест проверял бы не тот путь, каким пойдёт настоящий браузер.
 */
const shelf = new Map<string, string>();

const fakeSessionStorage = {
    getItem: (key: string): string | null => shelf.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        shelf.set(key, value);
    },
    removeItem: (key: string): void => {
        shelf.delete(key);
    },
    get length(): number {
        return shelf.size;
    },
    key: (index: number): string | null => [...shelf.keys()][index] ?? null,
};

beforeEach(() => {
    shelf.clear();
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: fakeSessionStorage };
});

afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
});

const chatMessage = (messageId: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
    messageId,
    author: { memberId: 'm1' },
    sentAt: 1000,
    text: 'Привет',
    ...over,
});

describe('outbox', () => {
    test('пустой ящик — пустой список, а не отказ', () => {
        expect(readOutbox('local', 'ch1')).toEqual([]);
    });

    test('положенное читается обратно', () => {
        const message = chatMessage('msg-1');
        putOutboxMessage('local', 'ch1', message);

        expect(readOutbox('local', 'ch1')).toEqual([message]);
    });

    test('повторная запись тем же messageId переписывает запись, а не заводит вторую', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1', { text: 'Раз' }));
        putOutboxMessage(
            'local',
            'ch1',
            chatMessage('msg-1', {
                text: 'Раз',
                delivery: { status: 'failed', error: { code: 'offline', message: 'Нет связи' } },
            })
        );

        const stored = readOutbox('local', 'ch1');
        expect(stored).toHaveLength(1);
        expect(stored[0].delivery).toEqual({ status: 'failed', error: { code: 'offline', message: 'Нет связи' } });
    });

    test('remove убирает только названную запись', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));
        putOutboxMessage('local', 'ch1', chatMessage('msg-2'));

        removeOutboxMessage('local', 'ch1', 'msg-1');

        expect(readOutbox('local', 'ch1').map((message) => message.messageId)).toEqual(['msg-2']);
    });

    test('remove единственной записи не оставляет в хранилище пустого мусора', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));
        removeOutboxMessage('local', 'ch1', 'msg-1');

        expect(fakeSessionStorage.getItem('kilvater.outbox.local.ch1')).toBeNull();
    });

    test('remove незнакомого messageId — молчаливый нет-оп', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));

        expect(() => removeOutboxMessage('local', 'ch1', 'net-takogo')).not.toThrow();
        expect(readOutbox('local', 'ch1')).toHaveLength(1);
    });

    test('ключ разделяет и вкладки (userId), и каналы (channelId)', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));
        putOutboxMessage('other-user', 'ch1', chatMessage('msg-2'));
        putOutboxMessage('local', 'ch2', chatMessage('msg-3'));

        expect(readOutbox('local', 'ch1').map((message) => message.messageId)).toEqual(['msg-1']);
        expect(readOutbox('other-user', 'ch1').map((message) => message.messageId)).toEqual(['msg-2']);
        expect(readOutbox('local', 'ch2').map((message) => message.messageId)).toEqual(['msg-3']);
    });

    test('без window — тихая пустота, а не падение (приватный режим, голый Node)', () => {
        delete (globalThis as unknown as { window?: unknown }).window;

        expect(() => putOutboxMessage('local', 'ch1', chatMessage('msg-1'))).not.toThrow();
        expect(readOutbox('local', 'ch1')).toEqual([]);
    });

    test('испорченная запись в хранилище — пустой список, а не падение', () => {
        fakeSessionStorage.setItem('kilvater.outbox.local.ch1', '{не json вовсе');

        expect(readOutbox('local', 'ch1')).toEqual([]);
    });

    test('испорченная запись — не массив, а что-то другое — тоже пустой список', () => {
        fakeSessionStorage.setItem('kilvater.outbox.local.ch1', JSON.stringify({ not: 'an array' }));

        expect(readOutbox('local', 'ch1')).toEqual([]);
    });

    test('discardOutboxMessage находит запись без userId — по каналу и messageId', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));

        discardOutboxMessage('ch1', 'msg-1');

        expect(readOutbox('local', 'ch1')).toEqual([]);
    });

    test('discardOutboxMessage не трогает тот же messageId в другом канале', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));
        putOutboxMessage('local', 'ch2', chatMessage('msg-1'));

        discardOutboxMessage('ch1', 'msg-1');

        expect(readOutbox('local', 'ch1')).toEqual([]);
        expect(readOutbox('local', 'ch2')).toHaveLength(1);
    });

    test('discardOutboxMessage — незнакомые канал или messageId — молчаливый нет-оп', () => {
        putOutboxMessage('local', 'ch1', chatMessage('msg-1'));

        expect(() => discardOutboxMessage('net-takogo-kanala', 'msg-1')).not.toThrow();
        expect(() => discardOutboxMessage('ch1', 'net-takogo-soobshenia')).not.toThrow();
        expect(readOutbox('local', 'ch1')).toHaveLength(1);
    });

    test('discardOutboxMessage без window — тихая пустота, а не падение', () => {
        delete (globalThis as unknown as { window?: unknown }).window;

        expect(() => discardOutboxMessage('ch1', 'msg-1')).not.toThrow();
    });
});
