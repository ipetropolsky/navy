import { HttpsError } from 'firebase-functions/v2/https';

import { berthAt } from '../../shared/placement';
import {
    JoinChannelRequest,
    KickMemberRequest,
    LeaveChannelRequest,
    MemberDraft,
    PreviewChannelRequest,
    UpdateMemberRequest,
} from '../../shared/types/calls';
import {
    Berth,
    CORRIDORS,
    Corridor,
    HULL_NUMBER_LENGTH,
    NAME_MAX_LENGTH,
    SHIP_KINDS,
    SLOT_COUNT,
    ShipKind,
    Side,
    isValidHullNumber,
} from '../../shared/types/channel';

/**
 * Разбор входа вызываемых функций рейда. Отдельным файлом от raid.ts: там — правила рейда,
 * здесь — форма запроса, и это разные заботы. Негодный вход отвечает HttpsError('invalid-argument'),
 * а не ChannelError: это отказ транспорта («такого запроса не бывает»), а не отказ правила
 * («запрос понятен, но так нельзя») — и у клиента для них разные ветки (см. index.ts).
 */

/** Бросает invalid-argument с понятным текстом. Возвращает never — годится и как выражение. */
const invalid = (message: string): never => {
    throw new HttpsError('invalid-argument', message);
};

const asRecord = (value: unknown, field: string): Record<string, unknown> => {
    if (typeof value !== 'object' || value === null) {
        return invalid(`Поле ${field} должно быть объектом`);
    }
    return value as Record<string, unknown>;
};

const asString = (value: unknown, field: string): string =>
    typeof value === 'string' ? value : invalid(`Поле ${field} должно быть строкой`);

/** channelId, memberId и прочие идентификаторы — непустые строки, без разбора содержимого. */
const asId = (value: unknown, field: string): string => {
    const id = asString(value, field);
    return id.length > 0 ? id : invalid(`Поле ${field} не может быть пустым`);
};

const asName = (value: unknown): string => {
    const name = asString(value, 'member.name');
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return invalid('Позывной не может быть пустым');
    }
    if (trimmed.length > NAME_MAX_LENGTH) {
        return invalid(`Позывной длиннее ${NAME_MAX_LENGTH} символов`);
    }
    return name;
};

/**
 * Бортовой номер — той же проверкой, что и форма (isValidHullNumber из shared/types/channel):
 * своей копии регулярка не заводит, чтобы предел не разошёлся с тем, что видит человек в поле.
 */
const asHullNumber = (value: unknown): string => {
    const hullNumber = asString(value, 'member.hullNumber');
    return isValidHullNumber(hullNumber) ? hullNumber : invalid(`Бортовой номер — ровно ${HULL_NUMBER_LENGTH} цифры`);
};

// «#8ecae6» — семь символов; предел взят у firestore.rules (lookSane) — тем же числом эта же
// строка ограничена и на входе в базу, так что более длинный цвет всё равно отсеет запись.
const COLOR_MAX_LENGTH = 16;

const asColor = (value: unknown): string => {
    const color = asString(value, 'member.color');
    return color.length > 0 && color.length <= COLOR_MAX_LENGTH
        ? color
        : invalid('Цвет — непустая строка разумной длины');
};

const asShipKind = (value: unknown): ShipKind =>
    typeof value === 'string' && SHIP_KINDS.includes(value as ShipKind)
        ? (value as ShipKind)
        : invalid('Неизвестный тип корабля');

const asSide = (value: unknown): Side =>
    value === 'left' || value === 'right' ? value : invalid('Борт — left или right');

const asCorridor = (value: unknown): Corridor =>
    typeof value === 'string' && CORRIDORS.includes(value as Corridor)
        ? (value as Corridor)
        : invalid('Неизвестный коридор');

/**
 * Место — по слоту и коридору, не больше: `left` (доля экрана) сцена всегда высчитывает сама
 * через berthAt, и присланное клиентом число мы не берём — так к брони не долетит перекошенный
 * left, который какой-нибудь неисправный клиент мог бы прислать вместе с честными slot/corridor.
 */
const asBerth = (value: unknown): Berth => {
    const body = asRecord(value, 'member.berth');
    const slot = body.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
        return invalid('Место на рейде указано неверно');
    }
    return berthAt(slot, asCorridor(body.corridor));
};

/**
 * Сколько манёвра осталось у корабля впереди, с. Верхний предел тут не про безопасность записи,
 * а про то, что бывает: самый долгий манёвр на рейде — уход за дальнюю кромку, пауза и заход
 * с другой, — и минуты на него хватает с большим запасом. Всё, что длиннее, — не манёвр,
 * а корабль, который у пришедшего посреди хода так и остался бы идущим навсегда.
 */
const MANOEUVRE_MAX_SECONDS = 120;

const asManoeuvre = (value: unknown): { seconds: number } => {
    const body = asRecord(value, 'member.manoeuvre');
    const seconds = body.seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || seconds > MANOEUVRE_MAX_SECONDS) {
        return invalid('Длительность манёвра указана неверно');
    }
    return { seconds };
};

const asMemberDraft = (value: unknown): MemberDraft => {
    const body = asRecord(value, 'member');
    const draft: MemberDraft = {
        name: asName(body.name),
        hullNumber: asHullNumber(body.hullNumber),
        shipKind: asShipKind(body.shipKind),
        color: asColor(body.color),
    };
    if (body.berth !== undefined) {
        draft.berth = asBerth(body.berth);
    }
    if (body.facing !== undefined) {
        draft.facing = asSide(body.facing);
    }
    if (body.manoeuvre !== undefined) {
        draft.manoeuvre = asManoeuvre(body.manoeuvre);
    }
    return draft;
};

export const parseJoinChannelRequest = (data: unknown): JoinChannelRequest => {
    const body = asRecord(data, 'request');
    const request: JoinChannelRequest = {
        channelId: asId(body.channelId, 'channelId'),
        member: asMemberDraft(body.member),
    };
    if (body.code !== undefined) {
        request.code = asString(body.code, 'code');
    }
    return request;
};

export const parseUpdateMemberRequest = (data: unknown): UpdateMemberRequest => {
    const body = asRecord(data, 'request');
    return { channelId: asId(body.channelId, 'channelId'), member: asMemberDraft(body.member) };
};

export const parseLeaveChannelRequest = (data: unknown): LeaveChannelRequest => {
    const body = asRecord(data, 'request');
    const request: LeaveChannelRequest = { channelId: asId(body.channelId, 'channelId') };
    if (body.course !== undefined) {
        request.course = asString(body.course, 'course');
    }
    if (body.nextOwnerId !== undefined) {
        request.nextOwnerId = asString(body.nextOwnerId, 'nextOwnerId');
    }
    return request;
};

export const parseKickMemberRequest = (data: unknown): KickMemberRequest => {
    const body = asRecord(data, 'request');
    const member = asRecord(body.member, 'member');
    return {
        channelId: asId(body.channelId, 'channelId'),
        member: { memberId: asId(member.memberId, 'member.memberId') },
    };
};

export const parsePreviewChannelRequest = (data: unknown): PreviewChannelRequest => {
    const body = asRecord(data, 'request');
    const request: PreviewChannelRequest = { channelId: asId(body.channelId, 'channelId') };
    if (body.code !== undefined) {
        request.code = asString(body.code, 'code');
    }
    return request;
};
