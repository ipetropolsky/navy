import { describe, expect, it } from 'vitest';

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
});
