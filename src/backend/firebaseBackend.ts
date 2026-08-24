import {
    Firestore,
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    limitToLast,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import { Functions, FunctionsError, httpsCallable } from 'firebase/functions';

import { isValidSlug } from '@/utils/slug';
import { paths } from '@shared/config/model';
import { CHANNEL_ERROR_CODES, ChannelErrorCode } from '@shared/errors';
import {
    JoinChannelRequest,
    KickMemberRequest,
    LeaveChannelRequest,
    MemberDraft,
    MemberResponse,
    UpdateMemberRequest,
} from '@shared/types/calls';
import {
    Channel,
    MAX_MESSAGE_LENGTH,
    Member,
    MemberRef,
    Message,
    MessageRef,
    ShipKind,
    ShipNotice,
    ShipPlacement,
    memberRef,
} from '@shared/types/channel';
import { limitMessage, overLimit } from '@shared/utils/limit';

import { ChannelBackend, ChannelError, ChannelSnapshot } from '@/backend/types';

/**
 * Настоящий бэкенд (issue #66). Канал, участники и лента читаются из Firestore одним
 * источником данных; распоряжение рейдом (join, updateMember, leave, kick) идёт вызовом
 * функций — решение там зависит от того, что в этот миг на рейде (свободно ли место,
 * занят ли позывной, кто старший), а такое не выразить одним правилом (см.
 * functions/src/raid.ts). Раньше, пока рейд не переехал, участников и ленту здесь подменял
 * внутренний createLocalBackend() — с переездом этой подмены больше нет.
 *
 * `db` и `functions` приходят доводами, а не берутся из config/firebase.ts: тогда проверки
 * подсовывают сюда подключение к эмулятору, а приложение — настоящее, и подменять для этого
 * ничего внутри файла не приходится.
 *
 * Про ошибки. Свои отказы (адрес не той формы, канала нет, слишком длинный текст) бросаются
 * ChannelError с тем же кодом и текстом, что и у локального бэкенда, — читатели уже умеют
 * их разбирать. Отказ вызова функции несёт точный код в details.code (см. httpsCodeFor
 * и callable в functions/src/index.ts) — тот же код и тот же текст извлекаются в свою же
 * ChannelError, см. toChannelError. Всё остальное чужое (правило не пустило, оборвалась сеть)
 * заворачивается в ChannelError с кодом unknown, а не пробрасывается как есть: весь остальной
 * код (см. components/**) ловит именно ChannelError и показывает .message, а на что-то другое
 * отвечает одной и той же общей фразой — отдать чужую форму ошибки значило бы каждый раз
 * попадать в этот безымянный запасной путь. Разбор по кодам (offline, permission-denied
 * и так далее) — это #67, здесь достаточно одного кода на всё, что не наше.
 */

/**
 * Как канал хранится в Firestore. Ключ документа — сам channelId, отдельным полем его
 * в документе нет. owner ставит сервер, когда на рейд встаёт первый корабль (см.
 * functions/src/raid.ts) — до этого момента у канала владельца нет вовсе.
 */
interface ChannelDoc {
    slug: string;
    title: string;
    createdAt: number;
    owner?: { memberId: string };
    serverAt: Timestamp;
}

/** channels/{channelId}/members/{memberId} — см. functions/src/raid.ts, тот же MemberDoc. */
interface MemberDoc {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    place: ShipPlacement;
    joinedAt: number;
    /** Чей это корабль. Сегодня равно ключу документа, и всё же полем: ссылка — объект. */
    user: { userId: string };
}

/**
 * channels/{channelId}/messages/{messageId}. Одна форма на два вида записи: у реплики
 * участника есть text и, может быть, thread; у системной строчки о рейде вместо них —
 * kind: 'system' и notice (её пишет сервер, см. functions/src/raid.ts, writeNotice).
 */
interface MessageDoc {
    author: MemberRef;
    sentAt: number;
    serverAt: Timestamp;
    kind?: 'system';
    text?: string;
    thread?: MessageRef;
    notice?: ShipNotice;
}

/**
 * Сколько последних сообщений читаем при открытии канала. Это не настоящая страничная
 * лента — догрузка вверх при прокрутке (loadOlderMessages, «упёрся в край — попроси ещё») —
 * это #68, а просто хвост разговора: без предела getChannel читал бы годовую переписку
 * одним запросом.
 */
const MESSAGE_PAGE = 200;

/** Документ → сущность контракта. serverAt наружу не отдаётся — это внутренняя метка. */
const toChannel = (channelId: string, data: ChannelDoc): Channel => ({
    channelId,
    slug: data.slug,
    title: data.title,
    createdAt: data.createdAt,
    owner: data.owner,
});

/** user.userId наружу не идёт: он всегда равен memberId (см. docs/FIREBASE.md, «Формы документов»). */
const toMember = (memberId: string, data: MemberDoc): Member => ({
    memberId,
    name: data.name,
    hullNumber: data.hullNumber,
    shipKind: data.shipKind,
    color: data.color,
    place: data.place,
    joinedAt: data.joinedAt,
});

/**
 * Системную запись отличает kind === 'system' — тогда наружу идёт ShipNoticeMessage
 * с разобранным notice, а не текстом: у самой записи текста и нет, рейд пишет notice,
 * а фразу из него складывает лента (см. components/chat/ShipNoticeLine). serverAt здесь
 * тоже не показывается никому — та же внутренняя метка, что и у канала.
 */
const toMessage = (messageId: string, data: MessageDoc): Message => {
    if (data.kind === 'system') {
        return {
            messageId,
            author: data.author,
            sentAt: data.sentAt,
            kind: 'system',
            notice: data.notice!,
        };
    }
    return {
        messageId,
        author: data.author,
        sentAt: data.sentAt,
        text: data.text ?? '',
        thread: data.thread,
    };
};

const isChannelErrorCode = (value: string): value is ChannelErrorCode =>
    (CHANNEL_ERROR_CODES as readonly string[]).includes(value);

/**
 * Не наша ошибка — в ChannelError с кодом из details.code, если он там есть и знаком,
 * иначе с unknown; своя — возвращается как есть (см. комментарий над файлом).
 */
const toChannelError = (failure: unknown): ChannelError => {
    if (failure instanceof ChannelError) {
        return failure;
    }
    if (failure instanceof FunctionsError) {
        const code = (failure.details as { code?: unknown } | null | undefined)?.code;
        if (typeof code === 'string' && isChannelErrorCode(code)) {
            return new ChannelError(code, failure.message);
        }
    }
    return new ChannelError('unknown', 'Сервер не ответил. Попробуйте ещё раз');
};

/**
 * Черновик корабля к отправке. Необязательные поля добавляются, только когда они есть,
 * и по той же причине, что и у `leave` ниже: сериализатор вызова превращает `undefined`
 * в `null` (см. `encode` в @firebase/functions), поле уезжает на сервер ключом со значением
 * `null`, а серверный разбор считает «не указано» отсутствием ключа и на `null` отвечает
 * отказом (`asMemberDraft` в functions/src/parse.ts). Случай этот не редкий и не выдуманный:
 * форма присылает `berth: undefined` всякий раз, когда человек не выбрал место сам, — то есть
 * при самой обычной постановке в строй.
 */
const draftToCall = ({ name, hullNumber, shipKind, color, berth, facing }: MemberDraft): MemberDraft => ({
    name,
    hullNumber,
    shipKind,
    color,
    ...(berth !== undefined ? { berth } : {}),
    ...(facing !== undefined ? { facing } : {}),
});

/** Свой eventId на каждое событие — тем же способом, что и у локального бэкенда. */
const randomEventId = (): string => `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createFirebaseBackend({ db, functions }: { db: Firestore; functions: Functions }): ChannelBackend {
    const channelRef = (channelId: string) => doc(db, paths.channel({ channelId }));
    const slugRef = (slug: string) => doc(db, paths.slug({ slug }));
    const memberDocRef = (channelId: string, memberId: string) => doc(db, paths.member({ channelId, memberId }));
    const membersQuery = (channelId: string) =>
        query(collection(db, paths.members({ channelId })), orderBy('joinedAt'));
    // limitToLast с order by sentAt по возрастанию — это последние MESSAGE_PAGE документов,
    // но в естественном порядке чтения (старые сверху): то же самое нужно и getChannel,
    // и подписке ниже.
    const feedQuery = (channelId: string) =>
        query(collection(db, paths.messages({ channelId })), orderBy('sentAt'), limitToLast(MESSAGE_PAGE));

    const joinChannelCall = httpsCallable<JoinChannelRequest, MemberResponse>(functions, 'joinChannel');
    const updateMemberCall = httpsCallable<UpdateMemberRequest, MemberResponse>(functions, 'updateMember');
    const leaveChannelCall = httpsCallable<LeaveChannelRequest, Record<string, never>>(functions, 'leaveChannel');
    const kickMemberCall = httpsCallable<KickMemberRequest, Record<string, never>>(functions, 'kickMember');

    /** Канал + участники + хвост ленты. Этим отвечают оба метода чтения. */
    const readChannel = async (channelId: string): Promise<ChannelSnapshot | null> => {
        const channelSnap = await getDoc(channelRef(channelId));
        if (!channelSnap.exists()) {
            return null;
        }
        const [membersSnap, feedSnap] = await Promise.all([
            getDocs(membersQuery(channelId)),
            getDocs(feedQuery(channelId)),
        ]);
        return {
            channel: toChannel(channelId, channelSnap.data() as ChannelDoc),
            members: membersSnap.docs.map((item) => toMember(item.id, item.data() as MemberDoc)),
            messages: feedSnap.docs.map((item) => toMessage(item.id, item.data() as MessageDoc)),
        };
    };

    return {
        getChannel: async ({ channelId }) => {
            try {
                return await readChannel(channelId);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        getChannelBySlug: async ({ slug }) => {
            try {
                const reserved = await getDoc(slugRef(slug));
                if (!reserved.exists()) {
                    return null;
                }
                const { channelId } = reserved.data() as { channelId: string };
                return await readChannel(channelId);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        createChannel: async ({ channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            // channelId назначаем сами и до записи, один раз: повтор с тем же id попадёт
            // в тот же документ, а не заведёт второй (см. docs/FIREBASE.md, «Повтор без
            // двойников»). doc() без родителя внутри существующей коллекции просто выбирает
            // случайный id, ничего не записывая, — это чисто клиентская операция.
            const channelId = doc(collection(db, paths.channels())).id;
            // Только что созданный канал — без owner: старшего назначает сервер, когда
            // на рейд встаёт первый корабль, а до тех пор у канала владельца нет вовсе.
            const created: Channel = { channelId, slug, title: title.trim(), createdAt: Date.now() };

            try {
                await runTransaction(db, async (transaction) => {
                    const reserved = await transaction.get(slugRef(slug));
                    if (reserved.exists()) {
                        throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                    }
                    // Бронь пройдёт правило, только если канал существует после этой же
                    // записи (`existsAfter` в firestore.rules) — поэтому оба документа пишутся
                    // здесь, в одной транзакции, а не по очереди двумя разными вызовами.
                    transaction.set(channelRef(channelId), {
                        slug: created.slug,
                        title: created.title,
                        createdAt: created.createdAt,
                        serverAt: serverTimestamp(),
                    });
                    transaction.set(slugRef(slug), { channelId, createdAt: Date.now() });
                });
            } catch (failure) {
                throw toChannelError(failure);
            }

            return { channel: created };
        },

        updateChannel: async ({ channelId, channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            const trimmedTitle = title.trim();

            let before: ChannelDoc;
            try {
                // Все чтения — до всех записей, это требование Firestore к транзакциям.
                before = await runTransaction(db, async (transaction) => {
                    const channelSnap = await transaction.get(channelRef(channelId));
                    const newSlugSnap = await transaction.get(slugRef(slug));

                    if (!channelSnap.exists()) {
                        throw new ChannelError('channel-not-found', 'Канал не найден');
                    }
                    const current = channelSnap.data() as ChannelDoc;
                    // Бронь занята другим каналом — отказ; своя же бронь (переименование
                    // с тем же адресом) помехой не считается.
                    if (newSlugSnap.exists() && (newSlugSnap.data() as { channelId: string }).channelId !== channelId) {
                        throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                    }

                    if (current.slug !== slug) {
                        // Новая бронь и снятие старой — в той же транзакции: освободившийся
                        // адрес честно свободен, а не повисает ничьим до следующей записи.
                        transaction.set(slugRef(slug), { channelId, createdAt: Date.now() });
                        transaction.delete(slugRef(current.slug));
                    }
                    transaction.update(channelRef(channelId), {
                        slug,
                        title: trimmedTitle,
                        serverAt: serverTimestamp(),
                    });

                    return current;
                });
            } catch (failure) {
                throw toChannelError(failure);
            }

            // owner и createdAt транзакция не трогала — берём их из документа как он был
            // до правки, а slug и title подменяем на то, что только что записали: читать
            // канал заново ради этого незачем, в транзакции и так есть всё, что нужно ответить.
            return { channel: toChannel(channelId, { ...before, slug, title: trimmedTitle }) };
        },

        join: async ({ channelId, member }) => {
            try {
                const result = await joinChannelCall({ channelId, member: draftToCall(member) });
                return result.data;
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        /**
         * memberId в адресе запроса — тот, кем распоряжаются (здесь — кто переоснащается
         * сам). На провод он не идёт ни здесь, ни в leave, ни в kick ниже: сервер берёт
         * распорядившегося из входа (auth.uid), а не из тела запроса — поверить телу здесь
         * значило бы разрешить любому вписать туда чужой memberId и говорить от чужого
         * корабля.
         */
        updateMember: async ({ channelId, member }) => {
            try {
                const result = await updateMemberCall({ channelId, member: draftToCall(member) });
                return result.data;
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        // Тот же довод, что и в комментарии над updateMember: memberId адреса — это тот,
        // кто уходит, и он же вошедший, потому на провод не отправляется.
        leave: async ({ channelId, course, nextOwnerId }) => {
            try {
                // course и nextOwnerId необязательные, и отсутствие — не то же самое, что
                // undefined: сериализатор вызова превращает undefined в null, а серверный
                // разбор (parseLeaveChannelRequest) ждёт от «не указано» отсутствия поля
                // вовсе, а не null. Поэтому добавляем поля, только когда они действительно
                // заданы.
                await leaveChannelCall({
                    channelId,
                    ...(course !== undefined ? { course } : {}),
                    ...(nextOwnerId !== undefined ? { nextOwnerId } : {}),
                });
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        /**
         * Кого высаживают — memberId в теле (`member`): это цель действия, содержимое
         * запроса, а не его адрес, поэтому едет по проводу как есть. А вот кто высаживает —
         * снова из входа, не из memberId адреса (см. комментарий над updateMember). Ссылка
         * несёт только memberId: KickMemberRequest не знает про look, слать его — значило
         * бы выдумывать поле, которого нет в контракте вызова.
         */
        kick: async ({ channelId, member }) => {
            try {
                await kickMemberCall({ channelId, member: { memberId: member.memberId } });
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        sendMessage: async ({ channelId, memberId, message: draft }) => {
            // Длину проверяет бэкенд, а не только форма: интерфейсов может стать больше
            // одного, и правило должно жить там, где данные, а не там, где поле ввода.
            if (overLimit(draft.text, MAX_MESSAGE_LENGTH)) {
                throw new ChannelError('message-too-long', limitMessage(draft.text, MAX_MESSAGE_LENGTH));
            }
            try {
                // Снимок автора берём из документа участника, а не из того, что помнит
                // вкладка о себе, — вкладка могла устареть, а этот документ и есть момент
                // истины прямо сейчас.
                const memberSnap = await getDoc(memberDocRef(channelId, memberId));
                if (!memberSnap.exists()) {
                    throw new ChannelError('member-not-found', 'Корабль не найден');
                }
                const author = memberRef(toMember(memberId, memberSnap.data() as MemberDoc));

                // Идентификатор назначает отправитель, до записи и один раз: повтор с тем же
                // id попадёт в тот же документ, а не заведёт второй (см. docs/FIREBASE.md,
                // «Повтор без двойников»).
                const messageId = doc(collection(db, paths.messages({ channelId }))).id;
                const sentAt = Date.now();

                // Ровно те поля, что разрешает правило (firestore.rules, match
                // /messages/{messageId}): author, sentAt, serverAt, text и, если есть,
                // thread — ничего сверх. thread добавляется полем, только когда есть:
                // Firestore не пишет undefined как значение поля, оно там попросту
                // не проходит валидацию записи.
                await setDoc(doc(db, paths.message({ channelId, messageId })), {
                    author,
                    sentAt,
                    serverAt: serverTimestamp(),
                    text: draft.text,
                    ...(draft.thread ? { thread: draft.thread } : {}),
                });

                // До этой строчки промис не резолвится: пока сервер не подтвердил запись,
                // мы её ждём. Что показать в это время и что делать без сети — статус
                // доставки, это #69, здесь его ещё нет.
                return { message: { messageId, author, sentAt, text: draft.text, thread: draft.thread } };
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        subscribe: ({ channelId, onEvent }) => {
            // Первый снимок onSnapshot приходит целиком и это не события, а состояние —
            // то же самое, что уже отдал getChannel. Пропускаем его отдельным флагом
            // на каждую из трёх подписок: иначе каждое открытие канала заново рождало бы
            // событие на канал, на каждого уже стоящего в строю и на каждую строчку ленты
            // (см. docs/FIREBASE.md, «Подписка: первый снимок — это состояние, а не события»).
            let firstChannel = true;
            const unsubscribeChannel = onSnapshot(
                channelRef(channelId),
                (snap) => {
                    if (firstChannel) {
                        firstChannel = false;
                        return;
                    }
                    // Документ пропал — событие не рождаем: удалить канал сегодня нечем,
                    // но на будущее (или на ручную правку в консоли) ответ тот же, что
                    // и всюду на пустой базе, — молчание, а не ошибка.
                    if (!snap.exists()) {
                        return;
                    }
                    onEvent({
                        eventId: randomEventId(),
                        channelId,
                        at: Date.now(),
                        type: 'channel-updated',
                        channel: toChannel(channelId, snap.data() as ChannelDoc),
                    });
                },
                () => {
                    // Подписка оборвалась (правило не пустило, сети нет) — молчим, а не
                    // роняем вкладку. Разбор по кодам (offline, permission-denied и так
                    // далее) — это #67.
                }
            );

            let firstMembers = true;
            const unsubscribeMembers = onSnapshot(
                membersQuery(channelId),
                (snap) => {
                    if (firstMembers) {
                        firstMembers = false;
                        return;
                    }
                    for (const change of snap.docChanges()) {
                        const member = toMember(change.doc.id, change.doc.data() as MemberDoc);
                        if (change.type === 'added') {
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'member-joined',
                                member,
                            });
                        } else if (change.type === 'modified') {
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'member-updated',
                                member,
                            });
                        } else {
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'member-left',
                                member: memberRef(member),
                            });
                        }
                    }
                },
                () => {
                    // См. комментарий у подписки на канал выше — тот же класс отказов,
                    // то же молчание.
                }
            );

            let firstFeed = true;
            const unsubscribeFeed = onSnapshot(
                feedQuery(channelId),
                (snap) => {
                    if (firstFeed) {
                        firstFeed = false;
                        return;
                    }
                    for (const change of snap.docChanges()) {
                        if (change.type === 'added') {
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'message-added',
                                message: toMessage(change.doc.id, change.doc.data() as MessageDoc),
                            });
                        }
                        // modified молчит: текст сообщения не меняется — это запрещает
                        // правило, — а serverAt приходит вторым снимком, когда сервер
                        // проставляет настоящее время взамен временной пустоты; это modified
                        // у уже показанного сообщения, а не новая строчка в ленте.
                        //
                        // removed молчит тоже: при limitToLast самое старое сообщение
                        // выпадает из окна, когда приходит новое, — это край окна подписки,
                        // а не удаление, и события «сообщение пропало» в контракте нет вовсе.
                    }
                },
                () => {
                    // См. комментарий у подписки на канал выше.
                }
            );

            return () => {
                unsubscribeChannel();
                unsubscribeMembers();
                unsubscribeFeed();
            };
        },
    };
}
