import { Member, Message, ShipKind } from '@/types/channel';

/**
 * Контракт бэкенда. Фронтенд знает только его и ничего — про то, где лежат данные:
 * сегодня это localStorage в соседней вкладке, завтра Firebase. Поэтому все методы
 * асинхронные, даже когда реализация может ответить мгновенно: синхронный ответ
 * приучил бы UI к порядку, которого у настоящего сервера не будет.
 *
 * Всё общение адресное: канал называется channelId, участник — memberId, сообщение —
 * его собственным id, а ответ ссылается на threadId — id сообщения, к которому он привязан.
 *
 * У канала два имени, и путать их нельзя. channelId — основной идентификатор: неизменный,
 * машинный, по нему адресуются все действия и события. Slug — читаемый адрес для ссылки
 * (`?channel=eskadra-polnoch`), его можно переназначить, и внутри системы на него никто
 * не ссылается. Отсюда и отдельный метод разбора адреса: getChannelBySlug.
 */

/** Канал связи со всем, что в нём есть, на один момент времени. */
export interface ChannelSnapshot {
    id: string;
    /** Читаемый адрес канала для ссылки. Меняется, в отличие от id. */
    slug: string;
    title: string;
    createdAt: number;
    members: Member[];
    messages: Message[];
}

/** Что участник о себе сообщает: и когда встаёт в строй, и когда переоснащает корабль. */
export interface MemberDraft {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
}

/** Что у канала можно задать и потом поменять: адрес и человеческое название. */
export interface ChannelDraft {
    /** Латинские буквы и дефис; в ссылке стоит именно он. */
    slug: string;
    title: string;
}

export interface MessageDraft {
    memberId: string;
    text: string;
    /** id сообщения, на которое отвечаем. */
    threadId?: string;
}

/**
 * Общий конверт события. Поля здесь у всех одинаковые, различает события только `type`,
 * поэтому добавить новый вид — например системное уведомление о шторме — можно, ничего
 * не ломая: транспорт и подписка про конкретные типы не знают, а UI разбирает знакомые
 * и молча пропускает незнакомые.
 */
interface ChannelEventBase {
    /** Свой у каждого события: по нему отбрасываем повторную доставку. */
    id: string;
    channelId: string;
    at: number;
}

export type ChannelEvent = ChannelEventBase &
    (
        | { type: 'channel-created'; channel: ChannelSnapshot }
        | { type: 'channel-updated'; slug: string; title: string }
        | { type: 'member-joined'; member: Member }
        | { type: 'member-updated'; member: Member }
        | { type: 'member-left'; memberId: string }
        | { type: 'message-added'; message: Message }
        /**
         * Единственное событие, которое никуда не сохраняется: печать живёт ровно столько,
         * сколько идёт. `chars` — добавленные символы или '\b' при удалении, из них лампа
         * набирает Морзе.
         */
        | { type: 'typing'; memberId: string; chars: string }
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
    | 'member-not-found';

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

export interface ChannelBackend {
    getChannel(channelId: string): Promise<ChannelSnapshot | null>;
    /** Разбор адреса из ссылки: по slug находим канал и дальше работаем с его id. */
    getChannelBySlug(slug: string): Promise<ChannelSnapshot | null>;

    createChannel(draft: ChannelDraft): Promise<ChannelSnapshot>;
    updateChannel(channelId: string, draft: ChannelDraft): Promise<ChannelSnapshot>;

    join(channelId: string, draft: MemberDraft): Promise<Member>;
    updateMember(channelId: string, memberId: string, draft: MemberDraft): Promise<Member>;
    /**
     * Переставить корабль на другое место: в другой коридор своего слота, а когда слот
     * обойдён весь — на другой слот. Куда именно, решает бэкенд: место корабля общее
     * для всех вкладок, и придумывать его на клиенте нельзя.
     */
    moveShip(channelId: string, memberId: string): Promise<Member>;
    leave(channelId: string, memberId: string): Promise<void>;

    sendMessage(channelId: string, draft: MessageDraft): Promise<Message>;
    setTyping(channelId: string, memberId: string, chars: string): Promise<void>;

    /**
     * Подписка на всё, что происходит в канале. Возвращает функцию отписки.
     * События приходят и от чужих вкладок, и от собственных действий этой вкладки —
     * UI не должен угадывать, кто сделал изменение, чтобы применить его.
     */
    subscribe(channelId: string, listener: (event: ChannelEvent) => void): Unsubscribe;
}

/** Сколько кораблей помещается в сцену. */
export const MAX_MEMBERS = 5;
