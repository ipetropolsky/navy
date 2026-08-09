import { useCallback, useEffect, useRef, useState } from 'react';

import { ChannelEvent, ChannelSnapshot, MemberDraft, MessageDraft, backend } from '@/backend';
import { forgetMemberId, readMemberId, rememberMemberId } from '@/backend/identity';
import { MorseFeed } from '@/types/channel';

/**
 * Всё общение фронтенда с бэкендом собрано здесь. Наружу отдаются состояние канала
 * и действия; компоненты не знают ни про localStorage, ни про подписку, ни про то,
 * что рядом открыта ещё одна вкладка.
 *
 * Состояние обновляется от событий, а не перечитыванием канала целиком: событие приходит
 * и на своё действие, и на чужое, поэтому ветка «я сам это сделал» не нужна — применяем
 * одинаково, откуда бы оно ни пришло.
 */

/** Сколько печать держится на экране без новых символов. */
const TYPING_IDLE_MS = 2600;

interface TypingState {
    memberId: string;
    feed: MorseFeed;
}

export interface ChannelController {
    /** Пока не загрузились, показывать нечего: канал может быть, а может и не быть. */
    loading: boolean;
    channel: ChannelSnapshot | null;
    /** Кто эта вкладка. null — канал открыт, но корабль ещё не встал в строй. */
    myId: string | null;
    typing: TypingState | null;
    join: (draft: MemberDraft) => Promise<void>;
    updateMe: (draft: MemberDraft) => Promise<void>;
    leave: () => Promise<void>;
    sendMessage: (draft: Omit<MessageDraft, 'memberId'>) => Promise<void>;
    reportTyping: (chars: string) => void;
}

export function useChannel(slug: string | null, memberIdFromUrl: string | null): ChannelController {
    const [loading, setLoading] = useState(true);
    const [channel, setChannel] = useState<ChannelSnapshot | null>(null);
    const [myId, setMyId] = useState<string | null>(null);
    const [typing, setTyping] = useState<TypingState | null>(null);
    const typingTimerRef = useRef<number | undefined>(undefined);

    // Открыли канал: разбираем адрес из ссылки, спрашиваем состояние и решаем, кто мы в нём.
    // Ответ может прийти, когда вкладка уже ушла на другой канал, — тогда его надо выбросить,
    // отсюда флаг.
    useEffect(() => {
        let alive = true;
        if (!slug) {
            setChannel(null);
            setMyId(null);
            setLoading(false);
        } else {
            setLoading(true);
            void backend
                .getChannelBySlug(slug)
                .then((snapshot) => {
                    if (!alive) {
                        return;
                    }
                    setChannel(snapshot);
                    if (!snapshot) {
                        setMyId(null);
                        return;
                    }
                    // Адрес важнее сохранённого: так соседняя вкладка говорит за другой корабль.
                    // Личность привязана к channelId, а не к slug: адрес канала может смениться.
                    const candidate = memberIdFromUrl ?? readMemberId(snapshot.id);
                    const aboard = snapshot.members.some((member) => member.id === candidate);
                    // Корабль мог выйти из другой вкладки, пока эта была закрыта.
                    setMyId(aboard ? candidate : null);
                })
                .finally(() => {
                    if (alive) {
                        setLoading(false);
                    }
                });
        }
        return () => {
            alive = false;
        };
    }, [slug, memberIdFromUrl]);

    // Дальше всё адресуется основным идентификатором канала, а не адресом из ссылки.
    const channelId = channel?.id ?? null;

    // Подписка живёт, пока открыт канал. Незнакомые события молча пропускаем —
    // так добавление новых типов не потребует правок здесь.
    useEffect(() => {
        if (!channelId) {
            return undefined;
        }
        return backend.subscribe(channelId, (event: ChannelEvent) => {
            if (event.type === 'typing') {
                setTyping({ memberId: event.memberId, feed: { seq: event.at, text: event.chars } });
                window.clearTimeout(typingTimerRef.current);
                typingTimerRef.current = window.setTimeout(() => setTyping(null), TYPING_IDLE_MS);
                return;
            }
            setChannel((current) => {
                if (current?.id !== event.channelId) {
                    return current;
                }
                switch (event.type) {
                    case 'channel-updated':
                        return { ...current, slug: event.slug, title: event.title };
                    case 'member-joined':
                        return { ...current, members: [...current.members, event.member] };
                    case 'member-updated':
                        return {
                            ...current,
                            members: current.members.map((member) =>
                                member.id === event.member.id ? event.member : member
                            ),
                        };
                    case 'member-left':
                        return { ...current, members: current.members.filter((m) => m.id !== event.memberId) };
                    case 'message-added':
                        // Повтор возможен, если событие придёт дважды: по id и отсекаем.
                        return current.messages.some((message) => message.id === event.message.id)
                            ? current
                            : { ...current, messages: [...current.messages, event.message] };
                    default:
                        return current;
                }
            });
        });
    }, [channelId]);

    // Корабль вышел (например, из другой вкладки) — эта вкладка возвращается к постановке в строй.
    useEffect(() => {
        if (channel && myId && !channel.members.some((member) => member.id === myId)) {
            forgetMemberId(channel.id);
            setMyId(null);
        }
    }, [channel, myId]);

    useEffect(() => () => window.clearTimeout(typingTimerRef.current), []);

    const join = useCallback(
        async (draft: MemberDraft) => {
            if (!channelId) {
                return;
            }
            const member = await backend.join(channelId, draft);
            rememberMemberId(channelId, member.id);
            setMyId(member.id);
        },
        [channelId]
    );

    const updateMe = useCallback(
        async (draft: MemberDraft) => {
            if (channelId && myId) {
                await backend.updateMember(channelId, myId, draft);
            }
        },
        [channelId, myId]
    );

    const leave = useCallback(async () => {
        if (channelId && myId) {
            await backend.leave(channelId, myId);
            forgetMemberId(channelId);
            setMyId(null);
        }
    }, [channelId, myId]);

    const sendMessage = useCallback(
        async (draft: Omit<MessageDraft, 'memberId'>) => {
            if (channelId && myId) {
                await backend.sendMessage(channelId, { ...draft, memberId: myId });
            }
        },
        [channelId, myId]
    );

    const reportTyping = useCallback(
        (chars: string) => {
            if (channelId && myId) {
                void backend.setTyping(channelId, myId, chars);
            }
        },
        [channelId, myId]
    );

    return { loading, channel, myId, typing, join, updateMe, leave, sendMessage, reportTyping };
}
