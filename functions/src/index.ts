import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions';
import { CallableRequest, FunctionsErrorCode, HttpsError, onCall } from 'firebase-functions/v2/https';

import { ChannelError, ChannelErrorCode } from '../../shared/errors';
import { PreviewChannelResponse } from '../../shared/types/calls';
import {
    parseJoinChannelRequest,
    parseKickMemberRequest,
    parseLeaveChannelRequest,
    parsePreviewChannelRequest,
    parseUpdateMemberRequest,
} from './parse';
import * as preview from './preview';
import * as raid from './raid';

/**
 * Вызываемые функции рейда: вход, переоснащение, уход, высадка. Сама работа — в raid.ts
 * (правила, транзакции) и parse.ts (форма запроса); здесь только обвязка, общая для всех
 * четырёх: проверить, что пришли вошедшим, разобрать тело и перевести ChannelError в HttpsError,
 * которую поймёт клиентский SDK.
 *
 * Пятая функция, previewChannel, в этот список не укладывается: её как раз и зовут без входа —
 * это и есть ответ тому, кто не вошёл (см. preview.ts), — и обвязка у неё поэтому своя,
 * без общей проверки request.auth.
 */

initializeApp();

// Один инстанс на десяток вызовов разом — щит от случайного всплеска, не тонкая настройка:
// у рейда на весь канал десяток мест, и минуту-другую подождать лишней функции не смертельно.
// Регион — тот же, что и у самой базы (firestore.location в firebase.json): вызов, живущий
// в одном регионе с Firestore, а не гоняющий транзакцию через океан.
setGlobalOptions({ maxInstances: 10, region: 'europe-central2' });

const db = getFirestore();

/**
 * Код HttpsError по коду ChannelError — единственное место, где они сопоставляются. Сам код
 * ChannelError при этом никуда не девается: он едет вторым аргументом (`details`), и клиент,
 * которому нужна не общая категория, а точная причина, читает его оттуда.
 */
const httpsCodeFor = (code: ChannelErrorCode): FunctionsErrorCode => {
    switch (code) {
        case 'channel-not-found':
        case 'member-not-found':
            return 'not-found';
        case 'channel-full':
            return 'resource-exhausted';
        case 'name-taken':
        case 'hull-taken':
            return 'already-exists';
        // channel-closed рядом не потому, что это то же самое, что not-senior, а потому что
        // и здесь дверь открывает не личность, а знание: код доступа не совпал — заперто
        // для всех одинаково, кто угадает код, тому дверь откроется ровно так же.
        case 'not-senior':
        case 'channel-closed':
            return 'permission-denied';
        case 'course-too-long':
        case 'message-too-long':
            return 'invalid-argument';
        default:
            return 'internal';
    }
};

/**
 * Отказ правила (ChannelError) — в HttpsError с тем же кодом в деталях. Что не ChannelError —
 * не наше дело, пусть падает как есть. Возвращает `never`, а не void: и `callable()`,
 * и previewChannel ниже пишут `return toHttpsError(error)` в catch — сама функция никогда
 * не возвращает значения, но так компилятору по-прежнему видно, что до конца тела дело
 * не доходит ни при одном исходе.
 */
const toHttpsError = (error: unknown): never => {
    if (error instanceof ChannelError) {
        throw new HttpsError(httpsCodeFor(error.code), error.message, { code: error.code });
    }
    throw error;
};

/**
 * Общая обвязка всех четырёх функций: без входа на рейд не пускаем совсем (см.
 * docs/FIREBASE.md, «Без сети вход не проходит вовсе» — то же самое верно и без личности),
 * тело разбирает parse.ts, а отказ правила переводится в HttpsError той же toHttpsError,
 * какой пользуется и previewChannel ниже.
 */
const callable = <Request, Response>(
    parse: (data: unknown) => Request,
    run: (userId: string, request: Request) => Promise<Response>
) =>
    onCall(async (request: CallableRequest<unknown>): Promise<Response> => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Нужно войти, чтобы распоряжаться на рейде');
        }
        const parsed = parse(request.data);
        try {
            return await run(request.auth.uid, parsed);
        } catch (error) {
            return toHttpsError(error);
        }
    });

export const joinChannel = callable(parseJoinChannelRequest, (userId, request) =>
    raid.joinChannel({ db, channelId: request.channelId, userId, member: request.member, code: request.code })
);

export const updateMember = callable(parseUpdateMemberRequest, (userId, request) =>
    raid.updateMember({ db, channelId: request.channelId, userId, member: request.member })
);

export const leaveChannel = callable(parseLeaveChannelRequest, (userId, request) =>
    raid.leaveChannel({
        db,
        channelId: request.channelId,
        userId,
        course: request.course,
        nextOwnerId: request.nextOwnerId,
    })
);

export const kickMember = callable(parseKickMemberRequest, (userId, request) =>
    raid.kickMember({ db, channelId: request.channelId, userId, member: request.member })
);

/**
 * Вход в канал для того, кто на него ещё не встал: без входа в аккаунт проверять здесь нечего
 * (см. комментарий над файлом), и звать эту функцию может кто угодно — сама она отдаёт только
 * название канала и его закрытость, ничего из того, что видно исключительно участнику
 * (см. preview.ts). Код доступа, если он пришёл, сверяется той же функцией — неверный код
 * или несуществующий канал доходят до клиента как обычный HttpsError, той же toHttpsError,
 * что и у остальных четырёх функций.
 */
export const previewChannel = onCall(async (request: CallableRequest<unknown>): Promise<PreviewChannelResponse> => {
    const { channelId, code } = parsePreviewChannelRequest(request.data);
    try {
        return await preview.previewChannel(db, channelId, code);
    } catch (error) {
        return toHttpsError(error);
    }
});
