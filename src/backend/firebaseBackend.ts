import {
    Firestore,
    Timestamp,
    collection,
    doc,
    getCountFromServer,
    getDoc,
    getDocs,
    limit as limitDocs,
    limitToLast,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    startAfter,
    updateDoc,
    waitForPendingWrites,
    where,
} from 'firebase/firestore';
import { Functions, FunctionsError, httpsCallable } from 'firebase/functions';

import { MESSAGE_PAGE, READ_TIMEOUT, WRITE_TIMEOUT } from '@/config/network';
import { isOnline, watchOnlineStatus } from '@/utils/connection';
import { isValidSlug } from '@/utils/slug';
import { paths } from '@shared/config/model';
import { CHANNEL_ERROR_CODES, ChannelErrorCode } from '@shared/errors';
import {
    JoinChannelRequest,
    KickMemberRequest,
    LeaveChannelRequest,
    MemberDraft,
    MemberResponse,
    PreviewChannelRequest,
    PreviewChannelResponse,
    UpdateMemberRequest,
} from '@shared/types/calls';
import {
    Channel,
    ChatMessage,
    MAX_MESSAGE_LENGTH,
    Member,
    MemberRef,
    Message,
    MessageDelivery,
    MessageRef,
    ShipKind,
    ShipNotice,
    ShipPlacement,
    memberRef,
} from '@shared/types/channel';
import { limitMessage, overLimit } from '@shared/utils/limit';

import { discardOutboxMessage, mergeOutbox, putOutboxMessage, readOutbox, removeOutboxMessage } from '@/backend/outbox';
import {
    ChannelBackend,
    ChannelError,
    ChannelEvent,
    ChannelSnapshot,
    Connection,
    ConnectionStatus,
} from '@/backend/types';

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
 * ChannelError, см. toChannelError. Всё остальное чужое — отказ самого Firestore, обрыв вызова
 * функции без details.code — разбирается по его code: offline, timeout, unavailable,
 * permission-denied, а что не опознано — под unknown. Весь остальной код (см. components/**)
 * ловит именно ChannelError и показывает .message, не заглядывая в чужую форму ошибки.
 */

/**
 * Как канал хранится в Firestore. Ключ документа — сам channelId, отдельным полем его
 * в документе нет. owner ставит сервер, когда на рейд встаёт первый корабль (см.
 * functions/src/raid.ts) — до этого момента у канала владельца нет вовсе.
 *
 * closed/code пишет клиент сам, один раз, при создании (см. createChannel ниже) — и оба
 * неизменны после (firestore.rules не пускает их в onlyChanges у update). code наружу,
 * в Channel, не превращается никогда: participant ли, посторонний ли — то, что можно
 * прочитать этот документ целиком, не значит, что код должен куда-то из него уйти
 * (см. Channel.closed в shared/types/channel.ts).
 */
interface ChannelDoc {
    slug: string;
    title: string;
    createdAt: number;
    owner?: { memberId: string };
    serverAt: Timestamp;
    closed?: boolean;
    code?: string;
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
    /**
     * Докуда участник дочитал разговор. Пишет только он сам, прямо в этот документ,
     * поверх функции рейда (см. `markSeen`, `firestore.rules`, functions/src/raid.ts —
     * там merge: true именно из-за этого поля).
     */
    lastSeen?: { messageId: string; at: number };
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

/** Документ → сущность контракта. serverAt наружу не отдаётся — это внутренняя метка. */
const toChannel = (channelId: string, data: ChannelDoc): Channel => ({
    channelId,
    slug: data.slug,
    title: data.title,
    createdAt: data.createdAt,
    owner: data.owner,
    closed: data.closed,
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
    lastSeen: data.lastSeen,
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
 * SDK сам приписывает к сообщению вызванной функции HTTP-статус отказа — `" [403]"`,
 * `" [404]"` и так далее (см. _errorForResponse в @firebase/functions/dist/index.cjs.js:
 * `${description} [${httpStatus}]` собирается безусловно, для любого отказа). Это дело
 * транспорта, а не слова для человека, и наружу им идти незачем. Сообщения ChannelError
 * с сервера такого хвоста не несут никогда (см. functions/src/raid.ts, preview.ts) —
 * срез снимает только то, что дописал сам клиент.
 */
const stripStatusSuffix = (message: string): string => message.replace(/ \[\d+\]$/, '');

/**
 * Код отказа, голым — без префикса 'functions/', которым FunctionsError отличает свой код
 * от кода самого Firestore (см. комментарий у toChannelError ниже). Не Error вовсе или Error
 * без code — пустая строка, а не исключение: решать, что значит пустой код, дальше уже дело
 * вызвавшего (toChannelError отвечает на него общим unknown, subscribe в этом же файле —
 * обрывом связи).
 */
const errorStatus = (failure: unknown): string =>
    failure instanceof Error && 'code' in failure ? String(failure.code).replace(/^functions\//, '') : '';

/**
 * Не наша ошибка — в ChannelError с кодом из details.code, если он там есть и знаком (свой
 * код нашей функции точнее любого разбора по статусу), иначе — по статус-коду самого отказа;
 * своя — возвращается как есть (см. комментарий над файлом).
 *
 * У FirestoreError code голый ('unavailable'), у FunctionsError — с префиксом
 * ('functions/unavailable'): вызов функции идёт через отдельный клиент со своими кодами,
 * и оба конца по отдельности не заботятся о чужом префиксе. instanceof здесь не поможет
 * различить один отказ от другого — у FirestoreError приватный конструктор, что заодно
 * исключает и юнит-проверку через него, — поэтому код читаем по форме объекта, тем же
 * способом, что и в auth.ts (toSignInError).
 */
export const toChannelError = (failure: unknown): ChannelError => {
    if (failure instanceof ChannelError) {
        return failure;
    }
    if (failure instanceof FunctionsError) {
        const code = (failure.details as { code?: unknown } | null | undefined)?.code;
        if (typeof code === 'string' && isChannelErrorCode(code)) {
            return new ChannelError(code, stripStatusSuffix(failure.message));
        }
    }
    switch (errorStatus(failure)) {
        case 'unavailable':
            return new ChannelError('unavailable', 'Сервер сейчас недоступен. Попробуйте ещё раз');
        case 'deadline-exceeded':
            return new ChannelError('timeout', 'Сервер долго не отвечает. Попробуйте ещё раз');
        // unauthenticated у вызова функции значит одно и только одно — не вошёл (см. callable
        // в functions/src/index.ts, она бросает этот код только за это), и ответ на это
        // не извинение, а кнопка входа. permission-denied — не про личность, а про то, что
        // само правило не пустило (не старший, не участник), и здесь ему всё ещё нечем
        // ответить точнее общего текста.
        case 'unauthenticated':
            return new ChannelError('sign-in-required', 'Нужно войти, чтобы продолжить');
        case 'permission-denied':
            return new ChannelError('permission-denied', 'Доступ к каналу изменился. Попробуйте ещё раз');
        default:
            return new ChannelError('unknown', 'Сервер не ответил. Попробуйте ещё раз');
    }
};

/**
 * Ждать ответ не дольше срока — а если офлайн, не ждать вовсе: сети нет, и ответа не будет,
 * пока она не появится. Таймаут не отменяет сам запрос: очередь записи у Firestore живёт
 * своей жизнью и может доставить отправленное позже (см. WRITE_TIMEOUT в config/network.ts) —
 * он решает только, когда сказать человеку, что дело плохо, а не что делать с запросом.
 */
export const withTimeout = <T>(run: () => Promise<T>, ms: number): Promise<T> => {
    if (!isOnline()) {
        return Promise.reject(new ChannelError('offline', 'Нет связи. Попробуйте, когда она появится'));
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new ChannelError('timeout', 'Сервер долго не отвечает. Попробуйте ещё раз')),
            ms
        );
    });
    // race, а не ручной reject: run() бросает свою причину как есть, не проходя через unknown, —
    // и обрыву сети не приходится притворяться Error, чтобы устроить линтер.
    return Promise.race([run(), timeout]).finally(() => clearTimeout(timer));
};

/**
 * То же самое, чем withTimeout встречает запись, — но без офлайн-огражки: отправка сообщения
 * (см. sendMessage, retryMessage ниже) должна дойти до setDoc(), даже когда сети нет вовсе, —
 * тогда в дело вступает свой локальный кеш Firestore, сообщение сохраняется на диск и ждёт
 * связи там же (см. docs/FIREBASE.md, «Онлайн: из чего складывается задержка»). setDoc()
 * в офлайне не бросает и не резолвится сам, а просто ждёт связи, — решение «пора считать
 * неудачей» здесь наше, а не его.
 *
 * Не уложились в срок — отказ не бросается, а возвращается значением: в отличие от прочих
 * записей, у сообщения есть куда его показать (см. MessageDelivery), и заворачивать это
 * в исключение незачем. Настоящий отказ (run() бросил раньше срока сам — например,
 * ChannelError('member-not-found')) распространяется как есть, не превращаясь в задержку.
 */
export const attemptWrite = async (
    run: () => Promise<void>,
    ms: number
): Promise<{ code: ChannelErrorCode; message: string } | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            timedOut = true;
            resolve();
        }, ms);
    });
    await Promise.race([run(), timeout]).finally(() => clearTimeout(timer));
    if (!timedOut) {
        return null;
    }
    return isOnline()
        ? { code: 'timeout', message: 'Сервер долго не отвечает. Попробуйте ещё раз' }
        : { code: 'offline', message: 'Нет связи. Попробуйте, когда она появится' };
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

/** Ящик: положить или переписать запись с обычным статусом «в пути». */
const putPending = (base: ChatMessage, userId: string, channelId: string): ChatMessage => {
    const delivery: MessageDelivery = { status: 'pending' };
    const tagged: ChatMessage = { ...base, delivery };
    putOutboxMessage(userId, channelId, tagged);
    return tagged;
};

export function createFirebaseBackend({
    db,
    functions,
    // Тот же WRITE_TIMEOUT, что и у остальных записей, — своим значением, а не константой
    // напрямую, ровно по той же причине, что у db/functions выше: проверке нужен короткий
    // срок, чтобы не ждать взаправду десять секунд ради одного «не дождались — failed»
    // (см. firestore/backend.test.ts, «статус отправки»), а приложению — настоящий.
    writeTimeout = WRITE_TIMEOUT,
}: {
    db: Firestore;
    functions: Functions;
    writeTimeout?: number;
}): ChannelBackend {
    const channelRef = (channelId: string) => doc(db, paths.channel({ channelId }));
    const slugRef = (slug: string) => doc(db, paths.slug({ slug }));
    const memberDocRef = (channelId: string, memberId: string) => doc(db, paths.member({ channelId, memberId }));
    const messageDocRef = (channelId: string, messageId: string) => doc(db, paths.message({ channelId, messageId }));
    const membersQuery = (channelId: string) =>
        query(collection(db, paths.members({ channelId })), orderBy('joinedAt'));
    // limitToLast с order by sentAt по возрастанию — это последние MESSAGE_PAGE документов,
    // но в естественном порядке чтения (старые сверху): то же самое нужно и одноразовому
    // чтению ниже, и подписке. Число берётся из общих мерок разговора с сервером
    // (config/network.ts), а не заводится своё рядом: страница у ленты одна.
    const feedQuery = (channelId: string) =>
        query(collection(db, paths.messages({ channelId })), orderBy('sentAt'), limitToLast(MESSAGE_PAGE));

    // Тот же запрос, но на один документ шире — только для readChannel. Лишний документ
    // и есть ответ на «а выше есть что-нибудь ещё»: пришло MESSAGE_PAGE + 1 — значит есть,
    // и самый старый из пришедших в ответ не идёт, отбрасывается (см. readChannel). Отдельный
    // запрос «сколько всего сообщений» стоил бы дороже: это ещё одно чтение коллекции,
    // а здесь та же цена, что и у самой страницы. Подписке лишний документ не нужен —
    // у неё hasMoreMessages не пересчитывается, это дело только чтения страницы.
    const feedReadQuery = (channelId: string) =>
        query(collection(db, paths.messages({ channelId })), orderBy('sentAt'), limitToLast(MESSAGE_PAGE + 1));

    const joinChannelCall = httpsCallable<JoinChannelRequest, MemberResponse>(functions, 'joinChannel');
    const updateMemberCall = httpsCallable<UpdateMemberRequest, MemberResponse>(functions, 'updateMember');
    const leaveChannelCall = httpsCallable<LeaveChannelRequest, Record<string, never>>(functions, 'leaveChannel');
    const kickMemberCall = httpsCallable<KickMemberRequest, Record<string, never>>(functions, 'kickMember');
    const previewChannelCall = httpsCallable<PreviewChannelRequest, PreviewChannelResponse>(
        functions,
        'previewChannel'
    );

    /**
     * Состояние связи — одно на весь бэкенд, а не на каждую подписку: три подписки одного
     * канала (subscribe ниже) делят одно соединение, и обрыв одной значит обрыв у всех разом.
     * Источников два. `navigator.onLine` — быстрый и грубый: знает про сам браузер, но не про
     * то, отвечает ли сервер. Отказ или успех onSnapshot — медленный, зато точный: заметен,
     * только когда открыт канал, и требует различить один отказ от разъединения, — но снимает
     * ложные «на связи», которые остались бы, отвечай мы только за браузер. Ни то ни другое
     * не смотрит в snapshot.metadata.fromCache: подсказка ненадёжна (см. docs/FIREBASE.md,
     * «Состояние связи»), и «снимок дошёл» здесь значит только это, а не откуда он дошёл.
     */
    let browserOffline = false;
    let snapshotOffline = false;
    let connection: Connection = { status: 'online', since: Date.now() };
    const connectionListeners = new Set<(connection: Connection) => void>();

    /**
     * Кому передать message-updated/message-removed, которые не пришли снимком Firestore,
     * а решены самим бэкендом: не дождались подтверждения (sendMessage, retryMessage) —
     * запись не менялась ни на одном документе, и настоящему onSnapshot взять событие
     * неоткуда; выбросили из ящика (discardMessage) — тем более, там и подавно нет записи,
     * которую можно было бы удалить (см. firestore.rules, allow update, delete: if false).
     * Регистрируют себя подписки на ленту конкретного канала (subscribe ниже) — свой Set
     * на каждый channelId, а не один общий, ровно затем, чтобы разослать только тем, кто
     * его и открыл.
     */
    const feedListeners = new Map<string, Set<(event: ChannelEvent) => void>>();
    const broadcastFeedEvent = (channelId: string, event: ChannelEvent): void => {
        feedListeners.get(channelId)?.forEach((listener) => listener(event));
    };

    const applyConnection = (): void => {
        const status: ConnectionStatus = browserOffline || snapshotOffline ? 'offline' : 'online';
        if (status === connection.status) {
            return;
        }
        connection = { status, since: Date.now() };
        connectionListeners.forEach((listener) => listener(connection));
    };
    watchOnlineStatus(({ status }) => {
        browserOffline = status === 'offline';
        applyConnection();
    });
    const reportSnapshotAlive = (): void => {
        snapshotOffline = false;
        applyConnection();
    };
    const reportSnapshotFailure = (): void => {
        snapshotOffline = true;
        applyConnection();
    };

    /**
     * Развязка попытки записи (см. attemptWrite). Сервер подтвердил (outcome === null) —
     * запись уходит из ящика и возвращается без delivery вовсе, это и есть обычное,
     * всегдашнее состояние; не подтвердил — остаётся в ящике под тем же messageId,
     * помеченная отказом.
     *
     * message-updated транслируется синтетикой всегда, а не только когда своя подписка
     * этого не увидит сама: настоящий 'modified' у Firestore (см. subscribe ниже) приходит
     * сам по себе, когда сервер и правда подтверждает запись, но полагаться на точное
     * совпадение по времени с тем, что здесь решает setDoc()/waitForPendingWrites(), —
     * рискованно. Повторный, тот же самый по данным message-updated не вредит: приёмник
     * (useChannel.ts) заменяет запись по id, и применить одно и то же дважды — не отличается
     * от одного раза.
     */
    const settleDelivery = (
        base: ChatMessage,
        outcome: { code: ChannelErrorCode; message: string } | null,
        userId: string,
        channelId: string
    ): ChatMessage => {
        let settled: ChatMessage;
        if (!outcome) {
            removeOutboxMessage(userId, channelId, base.messageId);
            settled = {
                messageId: base.messageId,
                author: base.author,
                sentAt: base.sentAt,
                text: base.text,
                thread: base.thread,
            };
        } else {
            const delivery: MessageDelivery = { status: 'failed', error: outcome };
            settled = { ...base, delivery };
            putOutboxMessage(userId, channelId, settled);
        }
        broadcastFeedEvent(channelId, {
            eventId: randomEventId(),
            channelId,
            at: Date.now(),
            type: 'message-updated',
            message: settled,
        });
        return settled;
    };

    /** Канал + участники + хвост ленты. Этим отвечают оба метода чтения. */
    const readChannel = async (channelId: string): Promise<ChannelSnapshot | null> => {
        const channelSnap = await getDoc(channelRef(channelId));
        if (!channelSnap.exists()) {
            return null;
        }
        const [membersSnap, feedSnap] = await Promise.all([
            getDocs(membersQuery(channelId)),
            getDocs(feedReadQuery(channelId)),
        ]);
        // Пришёл лишний документ сверх страницы — значит, выше есть что догружать; сам он
        // в ответ не идёт (docs отсортированы по возрастанию sentAt, лишний — самый старый,
        // он первый).
        const hasMoreMessages = feedSnap.docs.length > MESSAGE_PAGE;
        const pageDocs = hasMoreMessages ? feedSnap.docs.slice(1) : feedSnap.docs;
        return {
            channel: toChannel(channelId, channelSnap.data() as ChannelDoc),
            members: membersSnap.docs.map((item) => toMember(item.id, item.data() as MemberDoc)),
            messages: pageDocs.map((item) => toMessage(item.id, item.data() as MessageDoc)),
            hasMoreMessages,
        };
    };

    /**
     * То же самое для того, кому нельзя видеть рейд как есть — посторонний или чужой вошедший,
     * не стоящий на этом рейде: документ канала правила отдают только участнику (firestore.rules,
     * allow get: if isMember(channelId)), участников и ленту — тоже. Читать здесь поэтому
     * нечего — весь ответ идёт от previewChannel (functions/src/index.ts, preview.ts), которая
     * сама уже читает Admin SDK, минуя правила, и отдаёт ровно вход: название канала и закрыт
     * ли он, ни участников, ни ленты. channel-not-found — тот же самый «нет канала», что и
     * пустой снимок getDoc в readChannel, а не отказ: наружу оба пути отвечают одинаковым null.
     */
    const readChannelPreview = async (channelId: string): Promise<ChannelSnapshot | null> => {
        try {
            const { data } = await previewChannelCall({ channelId });
            return {
                channel: { channelId, slug: '', title: data.title, createdAt: 0, closed: data.closed },
                members: [],
                messages: [],
                hasMoreMessages: false,
            };
        } catch (failure) {
            if (toChannelError(failure).code === 'channel-not-found') {
                return null;
            }
            throw failure;
        }
    };

    /**
     * Полный снимок — тому, кому положено, вход вместо него — всем прочим, а узнать заранее,
     * кому что, неоткуда: решает правило (isMember(channelId), см. firestore.rules) на сервере,
     * а не эта функция, и участник ли userId на самом деле, здесь видно только по итогу самой
     * попытки. null — заведомый посторонний, пробовать полный незачем: signedIn() внутри
     * isMember() всё равно его не пропустит. Любой другой userId — и вошедший, но чужой на этом
     * рейде, и не переданный вовсе (см. userId в types.ts, ChannelBackend.getChannel) — идёт
     * за полным снимком, а permission-denied, если рейд всё-таки оказался чужим, откатывается
     * на вход вместо того, чтобы всплыть отказом: ровно то же самое видит и посторонний
     * без входа.
     */
    const readChannelForUser = async (
        channelId: string,
        userId: string | null | undefined
    ): Promise<ChannelSnapshot | null> => {
        if (userId === null) {
            return readChannelPreview(channelId);
        }
        try {
            return await readChannel(channelId);
        } catch (failure) {
            if (errorStatus(failure) !== 'permission-denied') {
                throw failure;
            }
            return readChannelPreview(channelId);
        }
    };

    return {
        getChannel: async ({ channelId, userId }) => {
            try {
                const snapshot = await withTimeout(() => readChannelForUser(channelId, userId), READ_TIMEOUT);
                return snapshot && mergeOutbox(snapshot, userId ?? undefined, channelId);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        getChannelBySlug: async ({ slug, userId }) => {
            try {
                return await withTimeout(async () => {
                    const reserved = await getDoc(slugRef(slug));
                    if (!reserved.exists()) {
                        return null;
                    }
                    const { channelId } = reserved.data() as { channelId: string };
                    const snapshot = await readChannelForUser(channelId, userId);
                    return snapshot && mergeOutbox(snapshot, userId ?? undefined, channelId);
                }, READ_TIMEOUT);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        createChannel: async ({ channel: { slug, title, closed, code } }) => {
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
            // closed попадает в Channel, только когда канал и правда закрыт — отсутствие
            // поля и есть открытый канал (см. Channel.closed в shared/types/channel.ts);
            // code наружу, в Channel, не идёт вовсе — даже переменной, которую можно было бы
            // забыть отфильтровать, здесь нет.
            const created: Channel = {
                channelId,
                slug,
                title: title.trim(),
                createdAt: Date.now(),
                ...(closed ? { closed: true } : {}),
            };

            try {
                await withTimeout(
                    () =>
                        runTransaction(db, async (transaction) => {
                            const reserved = await transaction.get(slugRef(slug));
                            if (reserved.exists()) {
                                throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                            }
                            // Бронь пройдёт правило, только если канал существует после этой же
                            // записи (`existsAfter` в firestore.rules) — поэтому оба документа
                            // пишутся здесь, в одной транзакции, а не по очереди двумя вызовами.
                            transaction.set(channelRef(channelId), {
                                slug: created.slug,
                                title: created.title,
                                createdAt: created.createdAt,
                                serverAt: serverTimestamp(),
                                // closed и code — строго парой или не пишутся вовсе (closedSane
                                // в firestore.rules): открытый канал в базе выглядит точно так же,
                                // как и до появления закрытых, — без этих двух полей вовсе.
                                ...(closed ? { closed: true, code: (code ?? '').trim() } : {}),
                            });
                            transaction.set(slugRef(slug), { channelId, createdAt: Date.now() });
                        }),
                    WRITE_TIMEOUT
                );
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
                before = await withTimeout(
                    () =>
                        runTransaction(db, async (transaction) => {
                            const channelSnap = await transaction.get(channelRef(channelId));
                            const newSlugSnap = await transaction.get(slugRef(slug));

                            if (!channelSnap.exists()) {
                                throw new ChannelError('channel-not-found', 'Канал не найден');
                            }
                            const current = channelSnap.data() as ChannelDoc;
                            // Бронь занята другим каналом — отказ; своя же бронь (переименование
                            // с тем же адресом) помехой не считается.
                            if (
                                newSlugSnap.exists() &&
                                (newSlugSnap.data() as { channelId: string }).channelId !== channelId
                            ) {
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
                        }),
                    WRITE_TIMEOUT
                );
            } catch (failure) {
                throw toChannelError(failure);
            }

            // owner и createdAt транзакция не трогала — берём их из документа как он был
            // до правки, а slug и title подменяем на то, что только что записали: читать
            // канал заново ради этого незачем, в транзакции и так есть всё, что нужно ответить.
            return { channel: toChannel(channelId, { ...before, slug, title: trimmedTitle }) };
        },

        /**
         * Подсказка, не запирающая проверка (см. checkAccessCode в types.ts) — поэтому зовёт
         * ту же previewChannel, что и вход для не-участника, только с кодом в запросе:
         * previewChannel и без кода ничего не решает, а с кодом ровно сверяет его и бросает
         * channel-closed, если код не совпал. Ответ самой функции здесь не нужен, важен только
         * сам факт, что она не бросила.
         */
        checkAccessCode: async ({ channelId, code }) => {
            try {
                await withTimeout(() => previewChannelCall({ channelId, code: code.trim() }), READ_TIMEOUT);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        join: async ({ channelId, member, code }) => {
            try {
                // code — как и course/nextOwnerId в leave ниже: отсутствие поля, а не undefined,
                // потому что сериализатор вызова превращает undefined в null, а серверный разбор
                // (parseJoinChannelRequest) ждёт отсутствия поля вовсе, а не null.
                const result = await withTimeout(
                    () =>
                        joinChannelCall({
                            channelId,
                            member: draftToCall(member),
                            ...(code !== undefined ? { code: code.trim() } : {}),
                        }),
                    WRITE_TIMEOUT
                );
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
                const result = await withTimeout(
                    () => updateMemberCall({ channelId, member: draftToCall(member) }),
                    WRITE_TIMEOUT
                );
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
                await withTimeout(
                    () =>
                        leaveChannelCall({
                            channelId,
                            ...(course !== undefined ? { course } : {}),
                            ...(nextOwnerId !== undefined ? { nextOwnerId } : {}),
                        }),
                    WRITE_TIMEOUT
                );
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
                await withTimeout(
                    () => kickMemberCall({ channelId, member: { memberId: member.memberId } }),
                    WRITE_TIMEOUT
                );
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        /**
         * Идентификатор назначает отправитель, до записи и один раз (draft.messageId,
         * если задан заранее, — иначе новый здесь): повтор с тем же id попадёт в тот же
         * документ, а не заведёт второй (см. docs/FIREBASE.md, «Повтор без двойников»).
         *
         * Промис резолвится не только на «сервер подтвердил» — offline-сеть и правда
         * не даёт ответа месяцами, и ждать его незачем: не дождались за writeTimeout
         * (см. attemptWrite) — сообщение остаётся в ящике неотправленного, помеченное
         * отказом, и возвращается именно таким, а не бросает исключение. Дальше решает
         * человек: значок (!) в ленте и retryMessage по нажатию.
         */
        sendMessage: async ({ channelId, memberId, message: draft }) => {
            // Длину проверяет бэкенд, а не только форма: интерфейсов может стать больше
            // одного, и правило должно жить там, где данные, а не там, где поле ввода.
            if (overLimit(draft.text, MAX_MESSAGE_LENGTH)) {
                throw new ChannelError('message-too-long', limitMessage(draft.text, MAX_MESSAGE_LENGTH));
            }
            const messageId = draft.messageId ?? doc(collection(db, paths.messages({ channelId }))).id;
            const sentAt = Date.now();
            // Присваивается внутри attemptWrite — до этого момента ждать нечего, класть
            // в ящик и возвращать как результат нечего, пока участник не прочитан.
            let base: ChatMessage | undefined;
            try {
                const outcome = await attemptWrite(async () => {
                    // Снимок автора берём из документа участника, а не из того, что помнит
                    // вкладка о себе, — вкладка могла устареть, а этот документ и есть момент
                    // истины прямо сейчас.
                    const memberSnap = await getDoc(memberDocRef(channelId, memberId));
                    if (!memberSnap.exists()) {
                        throw new ChannelError('member-not-found', 'Корабль не найден');
                    }
                    const author = memberRef(toMember(memberId, memberSnap.data() as MemberDoc));
                    // В ящик — до setDoc(), а не после: перезагрузка вкладки между этой
                    // строкой и подтверждением сервера не должна терять набранное
                    // (см. backend/outbox.ts). Видимой строчкой в чужой ленте это ещё
                    // не становится — это сделает 'added' у самой подписки (см. subscribe),
                    // когда до неё дойдёт очередь; здесь только память на случай перезагрузки.
                    base = putPending(
                        { messageId, author, sentAt, text: draft.text, thread: draft.thread },
                        memberId,
                        channelId
                    );

                    // Ровно те поля, что разрешает правило (firestore.rules, match
                    // /messages/{messageId}): author, sentAt, serverAt, text и, если есть,
                    // thread — ничего сверх. thread добавляется полем, только когда есть:
                    // Firestore не пишет undefined как значение поля, оно там попросту
                    // не проходит валидацию записи.
                    await setDoc(messageDocRef(channelId, messageId), {
                        author,
                        sentAt,
                        serverAt: serverTimestamp(),
                        text: draft.text,
                        ...(draft.thread ? { thread: draft.thread } : {}),
                    });
                }, writeTimeout);

                if (!base) {
                    // Не успели даже прочитать участника — писать в ящик было ещё нечего.
                    // Взаправду срок короче одного чтения не бывает; в проверках, где
                    // writeTimeout можно поставить сколь угодно малым, — бывает, и здесь это
                    // обычный отказ, а не запись со статусом доставки.
                    throw new ChannelError(
                        outcome?.code ?? 'timeout',
                        outcome?.message ?? 'Сервер долго не отвечает. Попробуйте ещё раз'
                    );
                }
                return { message: settleDelivery(base, outcome, memberId, channelId) };
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        retryMessage: async ({ channelId, memberId, message }) => {
            const pending = readOutbox(memberId, channelId).find((item) => item.messageId === message.messageId);
            if (!pending) {
                // По обычному пути такого не бывает: показанное как «не вышло» само взялось
                // либо из этого же ящика (getChannel/mergeOutbox), либо из события той же
                // подписки, источник у которого — тот же ящик. Отдельного пути дочитки
                // не заводим.
                throw new ChannelError('unknown', 'Сообщение уже не в ящике неотправленного');
            }
            try {
                const base = putPending(pending, memberId, channelId);
                broadcastFeedEvent(channelId, {
                    eventId: randomEventId(),
                    channelId,
                    at: Date.now(),
                    type: 'message-updated',
                    message: base,
                });

                const outcome = await attemptWrite(async () => {
                    // Сперва — дождаться, а не написать заново: тот самый вызов, скорее
                    // всего, всё ещё в очереди Firestore и сам пытается доставиться
                    // (см. attemptWrite), и второй setDoc() с тем же id рискует по пути
                    // стать для правила уже не созданием, а изменением, если первая попытка
                    // дойдёт позже, чем мы решили, что не дождались (firestore.rules,
                    // allow update, delete: if false).
                    await waitForPendingWrites(db);

                    // Но пустая очередь — это ещё не «дошло». Пустой она бывает и тогда,
                    // когда первая попытка отвалилась насовсем: отказ по правилам, скажем,
                    // выбрасывает запись из очереди, и ждать её после этого можно вечно —
                    // ждать уже нечего. Поверить одному лишь «очередь пуста» значило бы
                    // объявить доставленным то, чего на сервере нет вовсе, — сообщение
                    // ушло бы из ящика неотправленного и пропало молча, с видом
                    // отправленного. Поэтому спрашиваем сам документ; нет его — вот теперь
                    // и пишем заново, и это по-прежнему создание, а не изменение: документа
                    // нет, спорить правилу не с чем.
                    const written = await getDoc(messageDocRef(channelId, message.messageId));
                    if (!written.exists()) {
                        await setDoc(messageDocRef(channelId, message.messageId), {
                            author: base.author,
                            sentAt: base.sentAt,
                            serverAt: serverTimestamp(),
                            text: base.text,
                            ...(base.thread ? { thread: base.thread } : {}),
                        });
                    }
                }, writeTimeout);

                // waitForPendingWrites ждёт разом всю очередь этого клиента, а не одну эту
                // запись: не дождались — не значит, что не дождались именно её, если рядом
                // зависла другая отправка. Настоящее 'modified' у подписки (см. subscribe)
                // могло тем временем само убрать её из ящика — перечитываем перед тем, как
                // поверить исходу attemptWrite.
                const stillPending = readOutbox(memberId, channelId).some(
                    (item) => item.messageId === message.messageId
                );
                if (!stillPending) {
                    return {
                        message: {
                            messageId: base.messageId,
                            author: base.author,
                            sentAt: base.sentAt,
                            text: base.text,
                            thread: base.thread,
                        },
                    };
                }
                return { message: settleDelivery(base, outcome, memberId, channelId) };
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        // Не Promise.reject/async с одним лишь синхронным телом: работы здесь ровно на два
        // синхронных шага (убрать из ящика, разослать своим подписчикам), и оборачивать их
        // в лишний await незачем — форма всё равно Promise<void>, как и у остального контракта.
        discardMessage: ({ channelId, message }) => {
            discardOutboxMessage(channelId, message.messageId);
            broadcastFeedEvent(channelId, {
                eventId: randomEventId(),
                channelId,
                at: Date.now(),
                type: 'message-removed',
                message: { messageId: message.messageId },
            });
            return Promise.resolve();
        },

        loadOlderMessages: async ({ channelId, before, limit }) => {
            try {
                return await withTimeout(async () => {
                    // Курсор — по снимку документа (startAfter(snapshot)), а не по числу sentAt:
                    // двум сообщениям случается совпасть по времени до миллисекунды, и числовой
                    // startAfter потерял бы одно из них или прочитал его дважды на соседних
                    // страницах. Снимок при этом приходится читать здесь: по контракту границу
                    // называют ссылкой (before: { messageId }), а startAfter принимает документ —
                    // одно лишнее чтение на страницу, и оно того стоит.
                    const beforeSnap = await getDoc(doc(db, paths.message({ channelId, messageId: before.messageId })));
                    if (!beforeSnap.exists()) {
                        // Сообщений сегодня не удаляют, и на практике это не случается; но если
                        // граница пропала, строить от неё курсор нечем — отдаём пустой ответ,
                        // а не гадаем, что было выше.
                        return { messages: [], hasMore: false };
                    }
                    const pageSize = limit ?? MESSAGE_PAGE;
                    // desc — читаем от before назад, к началу разговора; лишний документ сверх
                    // pageSize — тот же приём, что и в readChannel: пришёл — значит, выше есть
                    // что читать ещё.
                    const olderSnap = await getDocs(
                        query(
                            collection(db, paths.messages({ channelId })),
                            orderBy('sentAt', 'desc'),
                            startAfter(beforeSnap),
                            limitDocs(pageSize + 1)
                        )
                    );
                    const hasMore = olderSnap.docs.length > pageSize;
                    const pageDocs = hasMore ? olderSnap.docs.slice(0, pageSize) : olderSnap.docs;
                    // Запрос шёл в обратную сторону (desc, от before к началу) — переворачиваем
                    // в естественный порядок чтения, старые сверху, тот же, в каком лежит
                    // messages в ChannelSnapshot.
                    const messages = pageDocs.reverse().map((item) => toMessage(item.id, item.data() as MessageDoc));
                    return { messages, hasMore };
                }, READ_TIMEOUT);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        /**
         * Пишет прямо в документ участника, а не вызовом функции: правило внутри
         * `firestore.rules` само проверяет, что правит владелец и только поле lastSeen —
         * распоряжаться здесь особо нечем, и звать ради этого рейд незачем (см. #70).
         */
        markSeen: async ({ channelId, memberId, message }) => {
            try {
                await withTimeout(
                    () =>
                        updateDoc(memberDocRef(channelId, memberId), {
                            // at — sentAt самого сообщения, а не Date.now() этой вкладки:
                            // по этой черте countUnread сравнивает sentAt, и часы у обеих
                            // сторон сравнения должны быть одни (см. Member.lastSeen).
                            lastSeen: { messageId: message.messageId, at: message.sentAt },
                        }),
                    WRITE_TIMEOUT
                );
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        /**
         * Счёт, а не чтение документов: getCountFromServer отвечает числом, не унося
         * с сервера сами сообщения, — оплате подлежит один агрегирующий запрос вне
         * зависимости от того, сколько их набралось (см. комментарий у ChannelBackend.countUnread).
         */
        countUnread: async ({ channelId, after }) => {
            try {
                return await withTimeout(async () => {
                    const snap = await getCountFromServer(
                        query(collection(db, paths.messages({ channelId })), where('sentAt', '>', after))
                    );
                    return { count: snap.data().count };
                }, READ_TIMEOUT);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        subscribe: ({ channelId, userId, onEvent }) => {
            // Посторонний без входа не имеет доступа ни к одному документу канала — ни сам
            // канал, ни участники, ни лента не проходят isMember(channelId) (firestore.rules),
            // а signedIn() внутри isMember() такого userId вообще не пропустит: три подписки,
            // которые тут же оборвутся отказом, заводить незачем — сразу отдаём пустую отписку.
            //
            // Любой другой userId — и вошедший, но чужой на этом рейде, и не переданный вовсе
            // (см. userId в types.ts, ChannelBackend.subscribe) — заводит все три подписки как
            // обычно: не участник получит тот же отказ правила на каждой из них, но он у него
            // замрёт молча (см. комментарий у подписки на канал ниже), а не оборвёт связь.
            // Эхо своего неотправленного ниже в этом случае не распознать — ключа нет, но
            // и посылать вошедшему, ещё не участнику, есть нечего: форма отправки ему не
            // открыта (App.tsx).
            if (userId === null) {
                return () => {};
            }

            // Первый снимок onSnapshot приходит целиком и это не события, а состояние —
            // то же самое, что уже отдал getChannel. Пропускаем его отдельным флагом
            // на каждую из трёх подписок: иначе каждое открытие канала заново рождало бы
            // событие на канал, на каждого уже стоящего в строю и на каждую строчку ленты
            // (см. docs/FIREBASE.md, «Подписка: первый снимок — это состояние, а не события»).
            let firstChannel = true;
            const unsubscribeChannel = onSnapshot(
                channelRef(channelId),
                (snap) => {
                    // Снимок дошёл — подписка жива, и неважно, что в ней: даже проглоченный
                    // первый снимок это уже доказывает.
                    reportSnapshotAlive();
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
                (failure) => {
                    // Не встал на этот рейд — документ канала тоже не открыть (firestore.rules,
                    // allow get: if isMember(channelId)), и это не обрыв связи: ровно то же
                    // самое видел бы и посторонний без входа (см. readChannelPreview выше).
                    // Подписка на отказе всё равно замирает сама — Firestore не переспрашивает
                    // правило заново, а join() в useChannel.ts отвечает на вступление свежей
                    // подпиской, а не эта, на своё же будущее членство. Прочие отказы (сети
                    // нет) — тот же класс, что и у подписок на участников и на ленту ниже,
                    // тот же выход в состояние связи.
                    if (errorStatus(failure) !== 'permission-denied') {
                        reportSnapshotFailure();
                    }
                }
            );

            // Участники и лента — тот же самый isMember(channelId), что и у канала выше:
            // не участник получит тот же permission-denied на каждой из них, и каждая
            // замирает молча тем же способом (см. комментарий у подписки на канал выше).
            let firstMembers = true;
            const unsubscribeMembers = onSnapshot(
                membersQuery(channelId),
                (snap) => {
                    reportSnapshotAlive();
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
                (failure) => {
                    // Не встал на этот рейд — участников не открыть (firestore.rules,
                    // isMember(channelId)), и это не обрыв связи: тот же самый список видел бы
                    // и посторонний без входа (см. readChannelPreview выше). Подписка на отказе
                    // всё равно замирает сама — Firestore не переспрашивает правило заново,
                    // и ждать её точно так же незачем: join() в useChannel.ts отвечает
                    // на вступление свежей подпиской, а не эта, на своё же будущее членство.
                    // Прочие отказы (сети нет) — тот же класс, что и у подписки на канал выше,
                    // тот же выход в состояние связи.
                    if (errorStatus(failure) !== 'permission-denied') {
                        reportSnapshotFailure();
                    }
                }
            );

            // Кому в этой подписке ещё не пришло подтверждение — только эти id интересны
            // в modified ниже: событие message-updated значит «сменился статус доставки
            // у того, чего мы ждали», и на документе, которого эта вкладка не отправляла,
            // такого смысла нет.
            //
            // Начинаем не с пустого, и это главное: своё отправленное переживает
            // перезагрузку вкладки в двух местах сразу — в ящике неотправленного и в очереди
            // самого Firestore (кеш на диске, см. config/firebase.ts, persistentLocalCache).
            // Очередь после перезагрузки досылает запись сама, и подтверждение ей приходит
            // обычным modified — а первый снимок ниже проглатывается целиком, и завести
            // такой id в pendingIds там уже негде. Не подобрать его из ящика — значок «в пути»
            // над пережившим перезагрузку сообщением так и остался бы гореть навсегда.
            const pendingIds = new Set<string>(
                userId ? readOutbox(userId, channelId).map((item) => item.messageId) : []
            );

            // Слушатели синтетики этого канала (см. feedListeners выше) — регистрируем
            // и здесь же снимаем в отписке, тем же Set, что раздаёт broadcastFeedEvent.
            let feedListenerSet = feedListeners.get(channelId);
            if (!feedListenerSet) {
                feedListenerSet = new Set();
                feedListeners.set(channelId, feedListenerSet);
            }
            feedListenerSet.add(onEvent);

            // Без includeMetadataChanges, хотя дальше и читается metadata.hasPendingWrites,
            // — и это замерено, а не додумано. Подтверждение своей записи метаданными
            // не ограничивается: вместе с hasPendingWrites сервер проставляет и serverAt
            // (до подтверждения его нет вовсе, см. serverTimestamp() в sendMessage), а это
            // уже обычная перемена данных, и modified с ней доходит до подписки и без опции.
            // Опция добавила бы к этому лишь ещё один снимок на переход кеш → сервер,
            // у которого docChanges() пуст, — работы никакой, а повод решить, будто без неё
            // hasPendingWrites не виден, есть.
            let firstFeed = true;
            const unsubscribeFeed = onSnapshot(
                feedQuery(channelId),
                (snap) => {
                    reportSnapshotAlive();
                    if (firstFeed) {
                        firstFeed = false;
                        return;
                    }
                    for (const change of snap.docChanges()) {
                        const messageId = change.doc.id;
                        if (change.type === 'added') {
                            const hasPendingWrites = change.doc.metadata.hasPendingWrites;
                            const message = toMessage(messageId, change.doc.data() as MessageDoc);
                            if (hasPendingWrites) {
                                pendingIds.add(messageId);
                            }
                            const delivery: MessageDelivery = { status: 'pending' };
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'message-added',
                                message: hasPendingWrites ? { ...message, delivery } : message,
                            });
                        } else if (
                            change.type === 'modified' &&
                            pendingIds.has(messageId) &&
                            !change.doc.metadata.hasPendingWrites
                        ) {
                            // Настоящее подтверждение сервера у уже показанного «в пути»
                            // сообщения — единственное, что modified у отслеживаемого id
                            // здесь может значить: текст не меняется никогда (правило
                            // запрещает), а serverAt и hasPendingWrites приходят этим же
                            // снимком, когда сервер принимает запись.
                            pendingIds.delete(messageId);
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'message-updated',
                                message: toMessage(messageId, change.doc.data() as MessageDoc),
                            });
                        }
                        // Остальное молчит. modified у неотслеживаемого id — это не про
                        // доставку: свою запись эта вкладка ждёт по ящику и по pendingIds,
                        // а чужая приходит уже подтверждённой, одним лишь added, и второй
                        // раз о ней рассказывать нечего. removed — это край окна limitToLast,
                        // самое старое сообщение выпадает, когда приходит новое, а не
                        // удаление — правило его и не разрешает; «сообщение пропало» в ленте
                        // приходит только синтетикой из discardMessage (см. broadcastFeedEvent
                        // выше).
                    }
                },
                (failure) => {
                    // См. комментарий у подписки на участников выше — тот же класс отказов,
                    // тот же выход в состояние связи, кроме отказа «не участник».
                    if (errorStatus(failure) !== 'permission-denied') {
                        reportSnapshotFailure();
                    }
                }
            );

            return () => {
                unsubscribeChannel();
                unsubscribeMembers();
                unsubscribeFeed();
                feedListenerSet.delete(onEvent);
                if (feedListenerSet.size === 0) {
                    feedListeners.delete(channelId);
                }
            };
        },

        watchConnection: ({ onChange }) => {
            onChange(connection);
            connectionListeners.add(onChange);
            return () => {
                connectionListeners.delete(onChange);
            };
        },
    };
}
