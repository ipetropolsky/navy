import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { ChannelError, ChannelEvent, ChannelSnapshot, MemberDraft, MessageDraft, backend } from '@/backend';
import { Member, ShipSetup } from '@shared/types/channel';

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
    /**
     * Отправить заново то, что не ушло, — тем же messageId (см. `Message.delivery`,
     * `ChannelBackend.retryMessage`). Молча ничего не делает вне рейда: без своего места
     * там нет и своего неотправленного, которое можно было бы повторить.
     */
    retryMessage: (messageId: string) => Promise<void>;
    /** Выбросить неотправленное — человек передумал (см. `ChannelBackend.discardMessage`). */
    discardMessage: (messageId: string) => Promise<void>;
    /** Есть ли выше messages ещё лента — то же самое, что `ChannelSnapshot.hasMoreMessages`. */
    hasMoreMessages: boolean;
    /** Страница уже в пути: второй запрос до её прихода не нужен, а кнопку показать нечем. */
    loadingOlder: boolean;
    /** Догрузить ленту выше уже показанного — на один экран (см. `backend.loadOlderMessages`). */
    loadOlder: () => Promise<void>;
}

/**
 * Поставить участника в снимок канала: тот же memberId — заменить, новый — дописать.
 *
 * Не просто «дописать в конец», потому что один и тот же участник приходит сюда дважды.
 * Первый раз — своим же входом (`join` ниже кладёт в снимок ответ сервера сразу, не дожидаясь
 * подписки), второй — событием `member-joined`, когда подписка донесёт ту же запись обратно.
 * Дописывай мы вслепую — на рейде стояло бы два своих корабля на одной точке.
 */
const withMember = (snapshot: ChannelSnapshot, member: Member): ChannelSnapshot => ({
    ...snapshot,
    members: snapshot.members.some((item) => item.memberId === member.memberId)
        ? snapshot.members.map((item) => (item.memberId === member.memberId ? member : item))
        : [...snapshot.members, member],
});

export function useChannel(
    slug: string | null,
    memberIdFromUrl: string | null,
    userId: string | null,
    rememberLook: (ship: ShipSetup) => void
): ChannelController {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    // Дёргает первый эффект заново тем же адресом — свой повод меняет зависимость эффекта,
    // не трогая ни slug, ни адресную строку.
    const [retryCount, setRetryCount] = useState(0);
    const [channel, setChannel] = useState<ChannelSnapshot | null>(null);
    const [myId, setMyId] = useState<string | null>(null);
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
                .getChannelBySlug({ slug, userId })
                .then((snapshot) => {
                    if (!alive) {
                        return;
                    }
                    setChannel(snapshot);
                    if (!snapshot) {
                        setMyId(null);
                        return;
                    }
                    // Не вошёл — значит, никто: memberIdFromUrl здесь не спасение, а лазейка.
                    // Без входа, подобрав чужой memberId в адресной строке, можно было бы
                    // назваться стоящим на рейде кораблём, хотя вход так и не пройден, —
                    // App.tsx решает, что показать, по `me`, а не по `signedIn` напрямую,
                    // и назначь мы candidate до входа, лента и форма ответа встали бы поверх
                    // приглашения войти, а не вместо него.
                    if (!userId) {
                        setMyId(null);
                        return;
                    }
                    // Адрес важнее вошедшего: так соседняя вкладка говорит за другой корабль,
                    // даже когда обе открыты тем же человеком.
                    //
                    // Второй кандидат — вошедший, и это не частный случай, а правило:
                    // memberId === userId на обоих бэкендах (см. join в functions/src/raid.ts
                    // и в localBackend.ts), участие адресуется личностью напрямую, и своё
                    // участие в канале видно прямо в списке участников, без отдельного запроса
                    // к серверному реестру `users/{userId}/channels` — тот существует ради
                    // обратного (по личности найти её каналы), а не ради этого.
                    const candidate = memberIdFromUrl ?? userId;
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
                        return withMember(current, event.member);
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
                        // Тот же messageId уже показан — не обязательно повтор одного и того же
                        // события: так приходит и отправленное заново тем же id, но с другим
                        // статусом доставки (см. retryMessage, backend/localBackend.ts —
                        // «автоподхват при восстановлении связи»). Заменяем запись по id вместо
                        // прежней, а не отбрасываем и не заводим вторую.
                        return {
                            ...current,
                            messages: current.messages.some((message) => message.messageId === event.message.messageId)
                                ? current.messages.map((message) =>
                                      message.messageId === event.message.messageId ? event.message : message
                                  )
                                : [...current.messages, event.message],
                        };
                    case 'message-updated':
                        // Статус доставки сменился (сервер подтвердил или, наоборот, не дождались,
                        // см. Message.delivery) — запись та же самая, по messageId. Не нашлась —
                        // тихий нет-оп, тем же способом, что и member-updated выше: событие
                        // не про то, что сейчас показано (например, страница ленты догружена
                        // не до него).
                        return {
                            ...current,
                            messages: current.messages.map((message) =>
                                message.messageId === event.message.messageId ? event.message : message
                            ),
                        };
                    case 'message-removed':
                        // Неотправленное выбросили (см. discardMessage) — на сервере его и не
                        // было, показывать больше нечего.
                        return {
                            ...current,
                            messages: current.messages.filter(
                                (message) => message.messageId !== event.message.messageId
                            ),
                        };
                    default:
                        return current;
                }
            });
        };

        return backend.subscribe({
            channelId,
            userId,
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
    }, [channelId, userId, receive]);

    // Корабль вышел (например, из другой вкладки) — эта вкладка возвращается к постановке в строй.
    useEffect(() => {
        if (channel && myId && !channel.members.some((member) => member.memberId === myId)) {
            setMyId(null);
        }
    }, [channel, myId]);

    /**
     * Записать во флот корабль, которым встали в строй или переоснастились. Берём от бэкенда,
     * а не из заявки: цвет мог быть переназначен, если выбранный оказался занят, а во флоте
     * должен остаться тот, с которым корабль в итоге вышел.
     */
    const keepLook = useCallback(
        (member: Member) => {
            if (!channelId) {
                return;
            }
            rememberLook({
                name: member.name,
                hullNumber: member.hullNumber,
                shipKind: member.shipKind,
                color: member.color,
                channelId,
            });
        },
        [rememberLook, channelId]
    );

    const join = useCallback(
        async (draft: MemberDraft) => {
            if (!channelId) {
                return;
            }
            const { member } = await backend.join({ channelId, member: draft });
            keepLook(member);
            // Свой корабль ставим в снимок сами, а не ждём, пока подписка пришлёт его обратно.
            // Догадки тут нет: `member` — это ответ сервера, ровно та же запись, что придёт
            // событием `member-joined` (и `withMember` её там не задвоит).
            //
            // Ждать нельзя. У местного бэкенда событие уходит до возврата из `join`, и обе
            // правки состояния попадают в один проход React; у Firebase ответ приходит вызовом
            // функции, а событие — отдельной задачей от подписки Firestore, уже после. В этом
            // зазоре эффект «корабль вышел» (ниже) видел бы myId, которого нет среди участников,
            // и молча сбрасывал бы его в null. Вход при этом проходил: корабль на рейде,
            // на сервере запись, — а вкладка так и стояла с открытой формой постановки в строй,
            // и своим корабль для неё уже не становился никогда. Замерено против эмулятора:
            // joinChannel отвечал 200 с участником, корабль появлялся в кадре, а `shipMine`
            // не появлялся вовсе (см. tests-firebase/e2e.spec.ts).
            setChannel((current) => (current?.channel.channelId === channelId ? withMember(current, member) : current));
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

    const retryMessage = useCallback(
        async (messageId: string) => {
            if (channelId && myId) {
                await backend.retryMessage({ channelId, memberId: myId, message: { messageId } });
            }
        },
        [channelId, myId]
    );

    const discardMessage = useCallback(
        async (messageId: string) => {
            if (channelId) {
                await backend.discardMessage({ channelId, message: { messageId } });
            }
        },
        [channelId]
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
        join,
        updateMe,
        leave,
        kick,
        sendMessage,
        retryMessage,
        discardMessage,
        hasMoreMessages: channel?.hasMoreMessages ?? false,
        loadingOlder,
        loadOlder,
    };
}
