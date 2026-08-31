import { Berth, Member, ShipKind, Side } from './channel';

/**
 * Формы вызовов сервера — то, что уходит по проводу в функции. Общий каталог, а не `src/`,
 * потому что решение по этим формам принимает не только клиент: `functions` разбирает их же,
 * и разъехаться черновику и разбору нельзя.
 */

/** Что участник о себе сообщает: и когда встаёт в строй, и когда переоснащает корабль. */
export interface MemberDraft {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    /**
     * Выбранное место на рейде. Пожелание, а не приказ: пока человек заполнял форму, туда мог
     * встать кто-то другой, и тогда бэкенд поставит корабль на ближайшее свободное — целился
     * человек в точку на рейде, а не «куда-нибудь». Не указано — место выбирается целиком
     * бэкендом; у стоящего в строю корабля оно при этом не меняется.
     */
    berth?: Berth;
    /**
     * Курс: куда смотрит нос, когда корабль встал на рейд. В отличие от места это не пожелание,
     * а приказ — курс ничем не занят и отобрать его не у кого. Не указан — курс достаётся
     * от стороны захода, как было до того, как его начали выбирать.
     */
    facing?: Side;
}

export interface JoinChannelRequest {
    channelId: string;
    member: MemberDraft;
    /**
     * Код доступа закрытого канала. Нужен, только если у канала стоит `closed` и входящий —
     * не первый: тот, кто заводит канал, код только что сам придумал, и спрашивать его заново
     * незачем (см. joinChannel в functions/src/raid.ts).
     */
    code?: string;
}

export interface UpdateMemberRequest {
    channelId: string;
    member: MemberDraft;
}

export interface LeaveChannelRequest {
    channelId: string;
    course?: string;
    nextOwnerId?: string;
}

export interface KickMemberRequest {
    channelId: string;
    member: { memberId: string };
}

export interface MemberResponse {
    member: Member;
}

export interface PreviewChannelRequest {
    channelId: string;
    /**
     * Код доступа — для проверки на экране «Закрытая частота» ещё до входа (см.
     * checkAccessCode в src/backend/types.ts). Сам вход всё равно сверяет код заново:
     * этот вызов только подсказывает, не запирая ничего по-настоящему.
     */
    code?: string;
}

/**
 * Вход, а не список участников: посторонний и чужой вошедший видят только название канала
 * и закрыт ли он (см. общий комментарий вверху firestore.rules) — участников, ленту и брони
 * мест previewChannel им не отдаёт вовсе.
 */
export interface PreviewChannelResponse {
    title: string;
    closed: boolean;
}
