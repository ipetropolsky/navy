import { useRef } from 'react';

import { ChannelSnapshot } from '@/backend';

import { unreadAfter } from '@/hooks/unread';

/**
 * Сколько непрочитанного накопилось, пока разговор был убран с экрана.
 *
 * `watching` — виден ли разговор. Пока виден, отметка идёт за концом ленты и счётчик стоит
 * в нуле: читать человеку показывают, а больше ничего утверждать нельзя. Убрали разговор —
 * отметка встала, и всё, что пришло после неё, считается непрочитанным (см. `unreadAfter`).
 *
 * Отметка — состоянием в ссылке, а не в `useState`: она ни на что не влияет сама по себе,
 * а перерисовка и без неё случается ровно тогда, когда нужно, — на приходе сообщения
 * и на движении панели.
 *
 * Смена канала отметку переставляет в конец ленты: непрочитанным считается то, что пришло
 * при человеке, а не вся переписка, которую он застал. Иначе всякий открытый с убранной
 * панелью канал встречал бы его счётчиком в полсотни чужих реплик.
 */
export function useUnread(channel: ChannelSnapshot | null, myId: string | null, watching: boolean): number {
    const seen = useRef<string | null>(null);
    const known = useRef<string | null>(null);
    const messages = channel?.messages ?? [];
    const last = messages.length ? messages[messages.length - 1].messageId : null;
    const channelId = channel?.channel.channelId ?? null;
    if (known.current !== channelId) {
        known.current = channelId;
        seen.current = last;
    }
    if (watching) {
        seen.current = last;
    }
    return watching ? 0 : unreadAfter(messages, seen.current, myId);
}
