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
    /**
     * Встать на рейд. `code` — код доступа закрытого канала, нужен только когда его спросили
     * (см. `needsCode` в App.tsx); открытому каналу и первому входу на закрытый он не нужен —
     * пробрасываем его как есть, дальше решает backend.join (см. src/backend/types.ts).
     */
    join: (draft: MemberDraft, code?: string) => Promise<void>;
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

/** Вычеркнуть участника из снимка — обратная сторона `withMember` выше. */
const withoutMember = (snapshot: ChannelSnapshot, memberId: string): ChannelSnapshot => ({
    ...snapshot,
    members: snapshot.members.filter((member) => member.memberId !== memberId),
});

/**
 * Слить снимок, довыгруженный после входа (см. join() и эффект подписки ниже), с тем, что уже
 * показано, — не заменить им. Подписка переподписывается раньше, чем уходит этот запрос,
 * и участника или реплику, пришедшие между переподпиской и ответом на неё, current уже
 * получил — слепая замена стёрла бы их снимком, снятым до этого прихода.
 *
 * channel — от fetched, и это важнее, чем кажется. Довходовая подписка на документ канала живой
 * не была: не участнику его не открыть тем же isMember(channelId), она получила отказ и замерла
 * (см. firebaseBackend.ts, комментарий у подписки на канал). Всё, что сменилось на канале
 * с открытия и до входа, до current, стало быть, не дошло, — а кое-что не дошло бы и вовсе
 * никогда. Заведший рейд сам себе старший, но узнаёт об этом только отсюда: owner проставляет
 * сервер (functions/src/raid.ts), в превью, снятом до входа, его нет по определению, а свежая,
 * уже участницкая подписка свой первый снимок проглатывает молча. Без этого создатель канала
 * не видел бы ни вымпела «Старший на рейде», ни кнопок высадки — до первой перезагрузки вкладки.
 *
 * members — от fetched: до входа участников не показывают вовсе (см. readChannelForUser
 * в firebaseBackend.ts), и current к этой минуте знает только самого себя — его join() дописал
 * явно, ещё до этого запроса, — да разве что тех, о ком успела сказать уже переподписанная,
 * не превью, подписка. Весь остальной, уже стоящий на рейде, флот знает только что пришедший
 * fetched — берём его как есть. Кого, наоборот, знает current, а fetched не застал (встал
 * в строй уже после самого чтения, отдельным живым событием), дописываем следом: тот снимок
 * его ещё не видел, а подписке об этом уже сказали. Ушедшего в этом же зазоре снимком отдельно
 * не ловим: следующий `member-left`, если он всё же случится, поправит рейд сам — тем же
 * добром на честном слове, каким живёт вся эта довыгрузка (см. комментарий у неё, «Отказ
 * здесь не должен ронять ничего»).
 *
 * messages — из current и fetched сразу: снимок несёт всё, что было до него, current — то,
 * что прибыло позже (в превью лента всегда пуста, см. previewOf, так что общих id между
 * ними почти не бывает). Пересеклись по id — берёт current: та же реплика могла успеть
 * сменить статус доставки (см. `message-updated` ниже), и снимок в этом споре старше. Порядок
 * снимка не трогаем — он и так по времени, — а всё, чего в нём нет, дописываем следом: раз
 * current узнал об этом не из снимка, значит после него.
 */
const mergeCatchUp = (current: ChannelSnapshot, fetched: ChannelSnapshot): ChannelSnapshot => {
    const members = [
        ...fetched.members,
        ...current.members.filter((member) => !fetched.members.some((item) => item.memberId === member.memberId)),
    ];
    const freshById = new Map(current.messages.map((message) => [message.messageId, message]));
    const messages = [
        ...fetched.messages.map((message) => freshById.get(message.messageId) ?? message),
        ...current.messages.filter((message) => !fetched.messages.some((item) => item.messageId === message.messageId)),
    ];
    return { ...current, channel: fetched.channel, members, messages, hasMoreMessages: fetched.hasMoreMessages };
};

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
    /**
     * Чей полный снимок довыгрузить, как только подписка ниже переподпишется не превью, —
     * см. комментарий у join() и у самой довыгрузки в эффекте подписки. null — довыгружать
     * никого не надо: обычная загрузка канала полный снимок либо уже получила, либо не имеет
     * права получить.
     */
    const catchUpAsRef = useRef<string | null>(null);
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
            // Кем спрашивать канал — кандидат, а не сам userId впрямую.
            //
            // Не вошёл вовсе — значит, никто: memberIdFromUrl тут не спасение, а лазейка. Без
            // входа, подобрав чужой memberId в адресной строке, можно было бы назваться стоящим
            // на рейде кораблём, хотя вход так и не пройден, — и не только для мигания myId
            // (App.tsx решает, что показать, по `me`, а не по `signedIn` напрямую): спроси
            // бэкенд этим же кандидатом до входа, урезание снял бы не сам кандидат, а то, что
            // спрашивающий вообще назвался кем-то, а не никем (см. needsPreview в
            // localBackend.ts — userId === null там единственный случай, отличимый от простого
            // «не тот участник»).
            //
            // Вошедший — другое дело: адрес важнее него самого, так соседняя вкладка говорит
            // за другой корабль, даже когда обе открыты тем же человеком (см. memberId ===
            // userId на обоих бэкендах — join в functions/src/raid.ts и в localBackend.ts,
            // участие адресуется личностью напрямую). Кандидат здесь — не только чей myId,
            // но и от чьего лица читать канал целиком: подошёл ли он рейду на самом деле,
            // решает не эта строка, а настоящая проверка на другом конце — isMember(channelId)
            // в firestore.rules (сверяет request.auth, а не то, что написано в вызове) и
            // needsPreview в localBackend.ts (сверяет список участников). Назвался чужим
            // кораблём вошедший нездешний — снимок всё равно останется урезанным.
            const candidate = userId ? (memberIdFromUrl ?? userId) : null;
            void backend
                .getChannelBySlug({ slug, userId: candidate })
                .then((snapshot) => {
                    if (!alive) {
                        return;
                    }
                    setChannel(snapshot);
                    if (!snapshot || !candidate) {
                        setMyId(null);
                        return;
                    }
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

        const unsubscribe = backend.subscribe({
            channelId,
            // myId, а не userId впрямую — той же причиной, что и кандидат в эффекте загрузки
            // выше: подписка живёт дольше одной загрузки, а от чьего лица она открыта, должно
            // совпадать с тем, чей снимок канал уже показывает, — иначе, встав в строй чужим
            // адресом (memberIdFromUrl), тут снова слушали бы урезанно, хотя сам канал уже
            // открыт полным. Не на рейде (myId нет) — подписываемся вошедшим как есть, как
            // и раньше: подойдёт он каналу или нет, здесь по-прежнему решает не эта строка.
            userId: myId ?? userId,
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

        // Довыгрузка полного снимка после входа (см. join() ниже, catchUpAsRef) — именно
        // здесь, а не в самом join(): к этой строке прежняя, урезанная подписка уже снята,
        // а эта, только что заведённая, — уже встала. Уйди запрос из join() напрямую, он лёг
        // бы в зазор до переподписки, а в этом зазоре чужие события слушать было бы некому —
        // урезанная подписка их не пропускает вовсе (см. localBackend.ts, subscribe,
        // «участников и ленту гасит»), а эта ещё не завелась.
        //
        // Отказ здесь не должен ронять ничего — сам вход уже состоялся (его подтверждают
        // withMember и myId в join()), и терять его из-за того, что не удалось перечитать
        // канал, нельзя. Не вышло — не страшно: рейд остаётся таким, каким его сейчас
        // показывает снимок, а следующее событие подписки при случае донесёт то же самое.
        if (catchUpAsRef.current !== null && catchUpAsRef.current === myId) {
            catchUpAsRef.current = null;
            void backend
                .getChannel({ channelId, userId: myId })
                .then((snapshot) => {
                    if (!snapshot) {
                        return;
                    }
                    setChannel((current) =>
                        current?.channel.channelId === channelId ? mergeCatchUp(current, snapshot) : current
                    );
                })
                .catch(() => {});
        }

        return unsubscribe;
        // myId в зависимостях — не только ради своего эха (event.message.author.memberId
        // !== myIdRef.current выше и так читает ссылку, не само состояние) и не только ради
        // довыгрузки выше: встал в строй или вышел — подписка пересобирается заново, а не
        // тянет прежнюю. Пока вошедший ещё не участник, правило пускает его к той же
        // обрезанной подписке, что и гостя без входа (members/лента отказывают
        // permission-denied и гаснут молча, не роняя связь — см. firebaseBackend.ts,
        // комментарий у подписки на участников); свежая же подписка, заведённая после join(),
        // уже подписана как участник и донесёт дальнейшие чужие события — но не тот кусок
        // истории, что случился до неё: свой первый снимок подписка проглатывает молча
        // (см. коммент у applyEvent выше), тем и занята довыгрузка выше.
    }, [channelId, userId, myId, receive]);

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
        async (draft: MemberDraft, code?: string) => {
            if (!channelId) {
                return;
            }
            const { member } = await backend.join({ channelId, member: draft, code });
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
            // Полный снимок довыгрузит эффект подписки ниже, а не мы здесь: вошедший, ещё не
            // участник, до этой минуты видел превью без участников вовсе (members: [],
            // messages: [] — см. readChannelForUser в firebaseBackend.ts), и withMember
            // выше просто дописал в этот же пустой снимок свежепринятого участника. Попроси
            // мы снимок прямо тут — запрос ушёл бы до того, как эффект успеет переподписаться
            // на уже-не-превью, и лёг бы в тот самый зазор, ради которого эта довыгрузка вообще
            // затевалась (см. комментарий там же). Метим только, чей снимок нужен, — эффект
            // разберётся, когда его просить.
            catchUpAsRef.current = member.memberId;
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
                // Свой корабль вычёркиваем из снимка сами — ровно по той же причине, по какой
                // join() выше сам же его туда и ставит: ждать, пока уход вернётся подпиской,
                // нельзя. У Firebase его оттуда и не дождёшься вовсе. Уход снимает с нас
                // участие, а на участие смотрит правило (firestore.rules, isMember) — подписка
                // на участников отвечает на это не событием `removed`, а отказом
                // permission-denied, после которого замирает совсем (см. firebaseBackend.ts).
                // Ушедший так и остался бы в снимке навсегда: в кадре — стоящим на прежнем
                // месте кораблём, потому что уход из кадра сцена замечает сравнением списков
                // (SeaScene.tsx), а сравнивать было бы нечего. И это не только про красоту:
                // при следующем входе тем же человеком тот же корабль наконец сдвигался бы
                // с места — но уже как переезд на новую точку строя, некстати и не туда (#79).
                setChannel((current) =>
                    current?.channel.channelId === channelId ? withoutMember(current, myId) : current
                );
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
