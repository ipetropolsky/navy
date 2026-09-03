import { describe, expect, it } from 'vitest';

import { ChatMessage, ShipNoticeMessage } from '@shared/types/channel';

import { flashedTitle, isNotifiable } from '@/hooks/useMessageNotifications';

/**
 * Как и у useUnread.ts — здесь проверяются только чистые разборы. Сам хук завязан на
 * document.title, Notification и таймеры разом, и его место — браузерный прогон
 * (см. дальше tests/channel.spec.ts), не vitest.
 */
describe('flashedTitle', () => {
    it('число и исходный заголовок в скобках спереди', () => {
        expect(flashedTitle('Кильватер', 3)).toBe('(3) Кильватер');
    });
});

const chatMessage = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    messageId: 'm-1',
    author: { memberId: 'someone', look: { name: 'Альбатрос', hullNumber: '317', color: '#8ecae6' } },
    sentAt: 1000,
    text: 'На связи',
    ...over,
});

const noticeMessage = (over: Partial<ShipNoticeMessage> = {}): ShipNoticeMessage => ({
    messageId: 'm-2',
    author: { memberId: 'someone' },
    sentAt: 1000,
    kind: 'system',
    notice: { event: 'joined', before: { shipKind: 'pr1234', name: 'Альбатрос', hullNumber: '317' } },
    ...over,
});

describe('isNotifiable', () => {
    it('чужая реплика — да', () => {
        expect(isNotifiable(chatMessage(), 'me')).toBe(true);
    });

    it('своя реплика — нет', () => {
        expect(isNotifiable(chatMessage({ author: { memberId: 'me' } }), 'me')).toBe(false);
    });

    it('системная строчка — нет, даже не про меня', () => {
        expect(isNotifiable(noticeMessage(), 'me')).toBe(false);
    });
});
