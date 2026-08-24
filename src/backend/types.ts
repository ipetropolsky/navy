import { Berth, Channel, Member, MemberRef, Message, MessageRef, ShipKind, Side } from '@shared/types/channel';

/**
 * Контракт бэкенда. Фронтенд знает только его и ничего — про то, где лежат данные:
 * сегодня это localStorage в соседней вкладке, завтра Firebase. Поэтому все методы
 * асинхронные, даже когда реализация может ответить мгновенно: синхронный ответ
 * приучил бы UI к порядку, которого у настоящего сервера не будет.
 *
 * Форма контракта подчинена правилам из docs/API-PRINCIPLES.md. Коротко: всё, что может
 * стать объектом, кладётся объектом; ссылка называется по сущности и несёт её канонический
 * идентификатор (`author: { memberId }`, а не `memberId`); методы принимают один именованный
 * объект; ответ — тоже объект, а не голая сущность. Всё это ради одного: чтобы завтрашнее
 * поле дописывалось рядом, а не ломало читателей.
 *
 * У канала два имени, и путать их нельзя. `channelId` — основной идентификатор: неизменный,
 * машинный, по нему адресуются все действия и события. `slug` — читаемый адрес для ссылки
 * (`?channel=eskadra-polnoch`), его можно переназначить, и внутри системы на него никто
 * не ссылается. Отсюда и отдельный метод разбора адреса: getChannelBySlug.
 */

/** Канал целиком: сам канал и его коллекции, каждая своим ключом. */
export interface ChannelSnapshot {
    channel: Channel;
    members: Member[];
    messages: Message[];
}

/** Что участник о себе сообщает: и когда встаёт в строй, и когда переоснащает корабль. */
export interface MemberDraft {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    /**
     * Выбранное место на рейде. Пожелание, а не приказ: пока человек заполнял форму, туда мог
     * встать кто-то другой, и тогда бэкенд поставит корабль на случайное свободное. Не указано —
     * место выбирается целиком бэкендом; у стоящего в строю корабля оно при этом не меняется.
     */
    berth?: Berth;
    /**
     * Курс: куда смотрит нос, когда корабль встал на рейд. В отличие от места это не пожелание,
     * а приказ — курс ничем не занят и отобрать его не у кого. Не указан — курс достаётся
     * от стороны захода, как было до того, как его начали выбирать.
     */
    facing?: Side;
}

/** Что у канала можно задать и потом поменять: адрес и человеческое название. */
export interface ChannelDraft {
    /** Латинские буквы, цифры и дефис; в ссылке стоит именно он. */
    slug: string;
    title: string;
}

/**
 * Тело сообщения — и только оно. Отправитель сюда не входит: он адресует запрос,
 * а не является частью текста, и передаётся отдельным полем метода.
 */
export interface MessageDraft {
    text: string;
    /** Ответ: сообщение, к которому он привязан. */
    thread?: MessageRef;
}

/**
 * Общий конверт события. Поля здесь у всех одинаковые, различает события только `type`,
 * поэтому добавить новый вид — например системное уведомление о шторме — можно, ничего
 * не ломая: транспорт и подписка про конкретные типы не знают, а UI разбирает знакомые
 * и молча пропускает незнакомые.
 *
 * По проводу идёт только то, что канал у себя оставляет. Печати среди событий нет и не будет:
 * сообщение доставляется целиком, а по буквам его набирает уже получатель, у себя (см.
 * `hooks/useReception`). Дело не в экономии — событие на каждую букву значит запись документа
 * на каждую букву, и в тот день, когда за подпиской окажется Firebase, за печать одной реплики
 * придётся заплатить полусотней записей.
 */
interface ChannelEventBase {
    /** Свой у каждого события: по нему отбрасываем повторную доставку. */
    eventId: string;
    channelId: string;
    at: number;
}

export type ChannelEvent = ChannelEventBase &
    (
        | { type: 'channel-created'; channel: Channel }
        | { type: 'channel-updated'; channel: Channel }
        | { type: 'member-joined'; member: Member }
        | { type: 'member-updated'; member: Member }
        | { type: 'member-left'; member: MemberRef }
        | { type: 'message-added'; message: Message }
    );

export type ChannelEventType = ChannelEvent['type'];

/** Почему действие не вышло. Коды перечислены, чтобы UI мог показать внятный текст. */
export type ChannelErrorCode =
    | 'channel-not-found'
    | 'channel-full'
    | 'slug-taken'
    | 'slug-invalid'
    | 'name-taken'
    | 'hull-taken'
    | 'member-not-found'
    | 'not-senior'
    | 'message-too-long'
    | 'course-too-long'
    // Сеть и вход. Тем же перечислением и той же ошибкой: у приложения один способ отказать,
    // и читателю не приходится гадать, какой из двух он поймал.
    | 'offline'
    | 'sign-in-cancelled'
    | 'sign-in-blocked'
    | 'unknown';

export class ChannelError extends Error {
    constructor(
        readonly code: ChannelErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'ChannelError';
    }
}

export type Unsubscribe = () => void;

/**
 * Адрес канала — во всех методах, кроме создания и разбора ссылки. Скаляром, а не объектом:
 * это адрес запроса, то, что в настоящем API стояло бы в пути, а не его содержимое.
 */
interface ChannelAddress {
    channelId: string;
}

/** Адрес участника внутри канала. По той же причине скаляром. */
interface MemberAddress extends ChannelAddress {
    memberId: string;
}

export interface ChannelBackend {
    getChannel(request: ChannelAddress): Promise<ChannelSnapshot | null>;
    /** Разбор адреса из ссылки: по slug находим канал и дальше работаем с его channelId. */
    getChannelBySlug(request: { slug: string }): Promise<ChannelSnapshot | null>;

    createChannel(request: { channel: ChannelDraft }): Promise<{ channel: Channel }>;
    updateChannel(request: ChannelAddress & { channel: ChannelDraft }): Promise<{ channel: Channel }>;

    join(request: ChannelAddress & { member: MemberDraft }): Promise<{ member: Member }>;
    updateMember(request: MemberAddress & { member: MemberDraft }): Promise<{ member: Member }>;
    /**
     * Сняться с рейда. Вместе с уходом приходит новый курс — куда корабль пошёл: канал
     * не должен терять корабли молча, и в ленте об уходе говорится его же словами.
     *
     * Курс необязателен нарочно: уйти можно и не сказав ничего — так уходили до того, как
     * курс стали спрашивать, и записи тех уходов остаются законными.
     *
     * `nextOwnerId` называет преемника — им может быть только старший, и только когда
     * на рейде остаётся кто-то ещё: спрашивать выбор у рядового или у последнего не для чего,
     * там его либо некому передать, либо решение оставить некому. Пришёл, а на рейде такого
     * уже нет — бэкенд молча передаст старшинство по прежнему правилу, тому, кто дольше всех:
     * во вкладке к этому моменту мог устареть список.
     */
    leave(request: MemberAddress & { course?: string; nextOwnerId?: string }): Promise<void>;
    /**
     * Высадить чужой корабль с рейда. Адресует запрос тот, кто высаживает, — и это должен быть
     * старший на рейде (`channel.owner`), иначе `not-senior`. Кого высаживают, идёт ссылкой
     * в теле: это содержимое запроса, а не его адрес.
     *
     * Отдельным методом, а не флагом у `leave`: уйти самому и быть высаженным — разные события
     * и для правил (одно доступно каждому, другое одному), и для ленты.
     */
    kick(request: MemberAddress & { member: MemberRef }): Promise<void>;

    sendMessage(request: MemberAddress & { message: MessageDraft }): Promise<{ message: Message }>;

    /**
     * Подписка на всё, что происходит в канале. Возвращает функцию отписки.
     * События приходят и от чужих вкладок, и от собственных действий этой вкладки —
     * UI не должен угадывать, кто сделал изменение, чтобы применить его.
     */
    subscribe(request: ChannelAddress & { onEvent: (event: ChannelEvent) => void }): Unsubscribe;
}
