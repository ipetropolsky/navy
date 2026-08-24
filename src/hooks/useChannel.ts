import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { ChannelError, ChannelEvent, ChannelSnapshot, MemberDraft, MessageDraft, backend } from '@/backend';
import {
    Look,
    forgetMemberId,
    readLastLook,
    readMemberId,
    rememberLastLook,
    rememberMemberId,
} from '@/backend/identity';
import { Member } from '@shared/types/channel';

import useReception, { Reception } from '@/hooks/useReception';

/**
 * Всё общение фронтенда с бэкендом собрано здесь. Наружу отдаются состояние канала
 * и действия; компоненты не знают ни про localStorage, ни про подписку, ни про то,
 * что рядом открыта ещё одна вкладка.
 *
 * Состояние обновляется от событий, а не перечитыванием канала целиком: событие приходит
 * и на своё действие, и на чужое, поэтому ветка «я сам это сделал» не нужна — применяем
 * одинаково, откуда бы оно ни пришло.
 */

export interface ChannelController {
    /** Пока не загрузились, показывать нечего: канал может быть, а может и не быть. */
    loading: boolean;
    /**
     * Открыть канал не вышло — не «канала нет» (это snapshot === null у channel, законный
     * ответ), а сеть или сервер подвели. Текст уже человеческий, годится прямо в Panel.hint.
     * null, если последняя попытка открылась, ещё грузится или канал и не спрашивали (!slug).
     */
    loadError: string | null;
    /** Попробовать открыть канал заново после loadError — тем же адресом, что и был. */
    retryLoad: () => void;
    channel: ChannelSnapshot | null;
    /** Кто эта вкладка. null — канал открыт, но корабль ещё не встал в строй. */
    myId: string | null;
    /** Что печатается прямо сейчас: пришедшая чужая реплика (см. `useReception`). */
    reception: Reception | null;
    /**
     * Чем эта личность выходила в море в последний раз — силуэт и цвет. Ими открывается форма
     * у того, кто в этом канале ещё не стоит: позывной с номером в новом канале свои,
     * а корабль человек чаще берёт тот же. Ни разу не выходила — null.
     */
    lastLook: Look | null;
    join: (draft: MemberDraft) => Promise<void>;
    updateMe: (draft: MemberDraft) => Promise<void>;
    /**
     * Сняться с рейда, сказав новый курс: с ним уход и встаёт строчкой в ленте.
     * `nextOwnerId` — кого старший оставляет за себя, если он не последний на рейде
     * (см. `components/channel/LeaveRaid`).
     */
    leave: (course: string, nextOwnerId?: string) => Promise<void>;
    /** Высадить чужой корабль. Доступно только старшему на рейде — это проверяет бэкенд. */
    kick: (memberId: string) => Promise<void>;
    sendMessage: (draft: MessageDraft) => Promise<void>;
    /** Есть ли выше messages ещё лента — то же самое, что `ChannelSnapshot.hasMoreMessages`. */
    hasMoreMessages: boolean;
    /** Страница уже в пути: второй запрос до её прихода не нужен, а кнопку показать нечем. */
    loadingOlder: boolean;
    /** Догрузить ленту выше уже показанного — на один экран (см. `backend.loadOlderMessages`). */
    loadOlder: () => Promise<void>;
}

export function useChannel(
    slug: string | null,
    memberIdFromUrl: string | null,
    userId: string | null
): ChannelController {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Дёргает первый эффект заново тем же адресом — свой повод меняет зависимость эффекта,
    // не трогая ни slug, ни адресную строку.
    const [retryCount, setRetryCount] = useState(0);
    const [channel, setChannel] = useState<ChannelSnapshot | null>(null);
    const [myId, setMyId] = useState<string | null>(null);
    // Внешность держим состоянием, а не перечитыванием на каждом проходе: хранилище отвечает
    // синхронно, а проходов у приложения много — по одному на всякое движение шторки.
    const [lastLook, setLastLook] = useState<Look | null>(readLastLook);
    const { reception, receive } = useReception();
    /**
     * Кто мы — для подписки. Подписка заведена на канал и переживает постановку в строй,
     * а знать, своё ли пришло сообщение, ей надо на каждом событии. Ссылкой, а не зависимостью:
     * иначе подписка пересобиралась бы всякий раз, как корабль встал или ушёл.
     */
    const myIdRef = useRef(myId);
    myIdRef.current = myId;
    /**
     * Что сейчас показано — для первого эффекта и для loadOlder. Ссылкой по той же причине,
     * что и myId выше: обоим надо знать нынешний снимок, но пересобираться на каждую его
     * перемену им незачем.
     */
    const shownRef = useRef(channel);
    shownRef.current = channel;
    const [loadingOlder, setLoadingOlder] = useState(false);
    // Синхронный дублёр loadingOlder: React обновляет состояние не сразу, а прокрутка внутри
    // одного кадра может позвать loadOlder дважды — вторая заявка должна увидеть первую
    // раньше, чем до неё дойдёт отрисовка.
    const loadingOlderRef = useRef(false);

    // Открыли канал: разбираем адрес из ссылки, спрашиваем состояние и решаем, кто мы в нём.
    // Ответ может прийти, когда вкладка уже ушла на другой канал, — тогда его надо выбросить,
    // отсюда флаг.
    useEffect(() => {
        let alive = true;
        if (!slug) {
            setChannel(null);
            setMyId(null);
            setLoading(false);
            setLoadError(null);
        } else {
            setLoading(true);
            setLoadError(null);
            // Спрашиваем другой канал — прежний снимок убираем сразу, не дожидаясь ответа:
            // в адресе один рейд, и показывать вместо него другой нельзя, а при отказе
            // за оставшимся снимком спрятался бы и сам отказ — «Канал не открылся»
            // показывается, только когда показывать больше нечего. Повтор того же канала
            // (retryLoad) снимок сохраняет: там на экране ровно то, что и должно быть.
            if (shownRef.current && shownRef.current.channel.slug !== slug) {
                setChannel(null);
                setMyId(null);
            }
            void backend
                .getChannelBySlug({ slug })
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
                    //
                    // Третий кандидат — вошедший: на Firebase участие адресуется личностью
                    // (memberId === userId), а sessionStorage свой у каждой вкладки, — без этого
                    // вторая вкладка того же человека не узнавала бы свой корабль и предлагала
                    // встать в строй заново, хотя он уже на рейде. Для локального бэкенда это
                    // ничем не грозит: там userId один на всех ('local', см. backend/auth.ts),
                    // а memberId устроен иначе (randomId('m'), см. backend/localBackend.ts) —
                    // совпасть с настоящим участником такому кандидату нечем.
                    const candidate = memberIdFromUrl ?? readMemberId(snapshot.channel.channelId) ?? userId;
                    const aboard = snapshot.members.some((member) => member.memberId === candidate);
                    // Корабль мог выйти из другой вкладки, пока эта была закрыта.
                    setMyId(aboard ? candidate : null);
                })
                .catch((failure: unknown) => {
                    // Не «канала нет» (тот ответ — snapshot === null, и это ветка .then выше),
                    // а сеть или сервер подвели: channel не трогаем, тут ещё есть что показать
                    // при следующей удачной попытке — прежний снимок вместо пустого экрана.
                    if (alive) {
                        setLoadError(failure instanceof ChannelError ? failure.message : 'Канал не открылся');
                    }
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
    }, [slug, memberIdFromUrl, userId, retryCount]);

    const retryLoad = useCallback(() => setRetryCount((count) => count + 1), []);

    // Дальше всё адресуется основным идентификатором канала, а не адресом из ссылки.
    const channelId = channel?.channel.channelId ?? null;

    // Подписка живёт, пока открыт канал. Незнакомые события молча пропускаем —
    // так добавление новых типов не потребует правок здесь.
    useEffect(() => {
        if (!channelId) {
            return undefined;
        }
        const applyEvent = (event: ChannelEvent): void => {
            setChannel((current) => {
                if (current?.channel.channelId !== event.channelId) {
                    return current;
                }
                switch (event.type) {
                    case 'channel-updated':
                        return { ...current, channel: event.channel };
                    case 'member-joined':
                        return { ...current, members: [...current.members, event.member] };
                    case 'member-updated':
                        return {
                            ...current,
                            members: current.members.map((member) =>
                                member.memberId === event.member.memberId ? event.member : member
                            ),
                        };
                    case 'member-left':
                        return {
                            ...current,
                            members: current.members.filter((item) => item.memberId !== event.member.memberId),
                        };
                    case 'message-added':
                        // Повтор возможен, если событие придёт дважды: по id и отсекаем.
                        return current.messages.some((message) => message.messageId === event.message.messageId)
                            ? current
                            : { ...current, messages: [...current.messages, event.message] };
                    default:
                        return current;
                }
            });
        };

        return backend.subscribe({
            channelId,
            onEvent: (event: ChannelEvent) => {
                // Чужая реплика доехала — разыгрываем её приём: она печатается по буквам,
                // а корабль отправителя мигает лампой (см. `useReception`). Своё не разыгрываем:
                // мы этот текст и набирали, и печатать его нам заново незачем — да и лампа
                // своего корабля отмигала его прямо во время набора.
                //
                // Служебные записи тоже мимо: их не набирал никто, они складываются на месте.
                if (
                    event.type === 'message-added' &&
                    event.message.kind !== 'system' &&
                    event.message.author.memberId !== myIdRef.current
                ) {
                    receive({
                        messageId: event.message.messageId,
                        memberId: event.message.author.memberId,
                        text: event.message.text,
                    });
                }
                // В фоне применяем в том же такте, в котором пришло событие, а не когда
                // до отрисовки дойдёт очередь: доставку самого события браузер не придерживает,
                // а вот отложенную работу — вполне, и новость о вошедшем корабле повисала бы
                // до возвращения на вкладку.
                //
                // На переднем плане — обычной отрисовкой. Там очередь и так доходит ближайшим
                // кадром, а `flushSync` ломает объединение: вход корабля приходит парой событий
                // (member-joined и строчка о постановке в ленту), и дерево рисовалось бы дважды
                // вместо одного раза.
                if (document.visibilityState === 'hidden') {
                    flushSync(() => applyEvent(event));
                } else {
                    applyEvent(event);
                }
            },
        });
    }, [channelId, receive]);

    // Корабль вышел (например, из другой вкладки) — эта вкладка возвращается к постановке в строй.
    useEffect(() => {
        if (channel && myId && !channel.members.some((member) => member.memberId === myId)) {
            forgetMemberId(channel.channel.channelId);
            setMyId(null);
        }
    }, [channel, myId]);

    /**
     * Запомнить, чем человек вышел в море. Берём от бэкенда, а не из заявки: цвет он мог
     * и переназначить, если выбранный оказался занят, а подставлять в следующий канал стоит
     * то, чем корабль в итоге вышел.
     */
    const keepLook = useCallback((member: Member) => {
        const look = { shipKind: member.shipKind, color: member.color };
        rememberLastLook(look);
        setLastLook(look);
    }, []);

    const join = useCallback(
        async (draft: MemberDraft) => {
            if (!channelId) {
                return;
            }
            const { member } = await backend.join({ channelId, member: draft });
            rememberMemberId(channelId, member.memberId);
            keepLook(member);
            setMyId(member.memberId);
        },
        [channelId, keepLook]
    );

    const updateMe = useCallback(
        async (draft: MemberDraft) => {
            if (channelId && myId) {
                const { member } = await backend.updateMember({ channelId, memberId: myId, member: draft });
                keepLook(member);
            }
        },
        [channelId, myId, keepLook]
    );

    const leave = useCallback(
        async (course: string, nextOwnerId?: string) => {
            if (channelId && myId) {
                await backend.leave({ channelId, memberId: myId, course, nextOwnerId });
                forgetMemberId(channelId);
                setMyId(null);
            }
        },
        [channelId, myId]
    );

    const kick = useCallback(
        async (memberId: string) => {
            if (channelId && myId) {
                await backend.kick({ channelId, memberId: myId, member: { memberId } });
            }
        },
        [channelId, myId]
    );

    const sendMessage = useCallback(
        async (draft: MessageDraft) => {
            if (channelId && myId) {
                await backend.sendMessage({ channelId, memberId: myId, message: draft });
            }
        },
        [channelId, myId]
    );

    /**
     * Догрузить страницу выше показанного. Читает канал и признак хвоста через shownRef,
     * а не через channel/channelId из замыкания: тогда колбэк не пересобирается на каждый
     * пришедший снимок, и ссылка на него в MessageList остаётся стабильной.
     */
    const loadOlder = useCallback(async () => {
        const current = shownRef.current;
        const oldest = current?.messages[0];
        if (!current || !current.hasMoreMessages || !oldest || loadingOlderRef.current) {
            return;
        }
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        try {
            const { messages: older, hasMore } = await backend.loadOlderMessages({
                channelId: current.channel.channelId,
                before: { messageId: oldest.messageId },
            });
            setChannel((state) =>
                state?.channel.channelId === current.channel.channelId
                    ? { ...state, messages: [...older, ...state.messages], hasMoreMessages: hasMore }
                    : state
            );
        } catch {
            // Отказ (нет связи, таймаут) отдельно не показываем: hasMoreMessages остаётся
            // правдой, и следующая прокрутка к тому же краю запросит страницу заново —
            // тот же приём, что и у retryLoad, только без отдельной кнопки.
        } finally {
            loadingOlderRef.current = false;
            setLoadingOlder(false);
        }
    }, []);

    return {
        loading,
        loadError,
        retryLoad,
        channel,
        myId,
        reception,
        lastLook,
        join,
        updateMe,
        leave,
        kick,
        sendMessage,
        hasMoreMessages: channel?.hasMoreMessages ?? false,
        loadingOlder,
        loadOlder,
    };
}
