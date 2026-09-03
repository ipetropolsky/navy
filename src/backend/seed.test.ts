import { describe, expect, it, vi } from 'vitest';

import { Message, MessageRef } from '@shared/types/channel';

import { createDemoChannel } from '@/backend/seed';

/**
 * Демо-канал — витрина: его открывают до того, как в приложении появится хоть один свой
 * разговор, и по нему судят, что тут вообще есть. Поэтому проверяется не устройство демо,
 * а то, что в нём видно: ответы на сообщения, свои строчки канала, разные корабли.
 *
 * Расстановка кораблей каждый запуск своя (`demoBerths`), так что про места здесь ничего
 * не утверждается — за них отвечает `placement.test.ts`. Здесь только содержимое ленты.
 */

/** На что отвечает сообщение. Строчки канала ответов не носят, поэтому у них всегда пусто. */
const answers = (message: Message): MessageRef | undefined => (message.kind === 'system' ? undefined : message.thread);

describe('createDemoChannel', () => {
    it('показывает ответы на сообщения', () => {
        const replies = createDemoChannel().messages.filter(answers);
        expect(replies.length).toBeGreaterThan(0);
    });

    it('каждый ответ ссылается на существующее сообщение', () => {
        const { messages } = createDemoChannel();
        const ids = new Set(messages.map((message) => message.messageId));
        messages.forEach((message) => {
            const thread = answers(message);
            if (thread) {
                expect(ids.has(thread.messageId), `ответ ${message.messageId} висит в пустоте`).toBe(true);
            }
        });
    });

    it('ответы приходят позже того, на что отвечают', () => {
        const { messages } = createDemoChannel();
        const byId = new Map(messages.map((message) => [message.messageId, message]));
        messages.forEach((message) => {
            const thread = answers(message);
            const answered = thread && byId.get(thread.messageId);
            if (answered) {
                expect(message.sentAt, `${message.messageId} отвечает раньше вопроса`).toBeGreaterThan(answered.sentAt);
            }
        });
    });

    /**
     * Демо не должно оказаться в будущем, в какой бы час его ни открыли, — а вечер в нём
     * поздний, и почти весь день он ещё впереди.
     *
     * Это не про красоту дат. Пока переписка датирована будущим, всё, что в канале напишут
     * после, оказывается «раньше» уже написанного: счётчик непрочитанного считает от метки
     * последнего виденного сообщения и потому молчит вовсе, а лента, выстроенная по времени,
     * ставит новую реплику в середину разговора. Ровно так оно и было — поймано браузерной
     * проверкой «убранная панель считает пришедшие реплики», которая падала весь день и
     * проходила только поздним вечером.
     *
     * Проверяются все двадцать четыре часа, а не один: беда была именно в том, что днём
     * всё иначе, чем ночью.
     */
    it('вся переписка лежит в прошлом, в какой бы час её ни открыли', () => {
        vi.useFakeTimers();
        try {
            for (let hour = 0; hour < 24; hour += 1) {
                vi.setSystemTime(new Date(2026, 7, 28, hour, 30, 0, 0));
                const demo = createDemoChannel();
                const now = Date.now();
                expect(
                    demo.messages.filter((message) => message.sentAt > now).map((message) => message.messageId),
                    `в ${hour} часов эти сообщения оказались в будущем`
                ).toEqual([]);
                expect(demo.channel.createdAt, `в ${hour} часов канал заведён в будущем`).toBeLessThanOrEqual(now);
                expect(
                    demo.members.filter((member) => member.joinedAt > now).map((member) => member.memberId),
                    `в ${hour} часов эти корабли встали в строй в будущем`
                ).toEqual([]);
            }
        } finally {
            vi.useRealTimers();
        }
    });
});
