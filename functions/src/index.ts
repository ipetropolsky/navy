import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions';
import { CallableRequest, FunctionsErrorCode, HttpsError, onCall } from 'firebase-functions/v2/https';

import { ChannelError, ChannelErrorCode } from '../../shared/errors';
import {
    parseJoinChannelRequest,
    parseKickMemberRequest,
    parseLeaveChannelRequest,
    parseUpdateMemberRequest,
} from './parse';
import * as raid from './raid';

/**
 * Вызываемые функции рейда: вход, переоснащение, уход, высадка. Сама работа — в raid.ts
 * (правила, транзакции) и parse.ts (форма запроса); здесь только обвязка, общая для всех
 * четырёх: проверить, что пришли вошедшим, разобрать тело и перевести ChannelError в HttpsError,
 * которую поймёт клиентский SDK.
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
        case 'not-senior':
            return 'permission-denied';
        case 'course-too-long':
        case 'message-too-long':
            return 'invalid-argument';
        default:
            return 'internal';
    }
};

/**
 * Общая обвязка всех четырёх функций: без входа на рейд не пускаем совсем (см.
 * docs/FIREBASE.md, «Без сети вход не проходит вовсе» — то же самое верно и без личности),
 * тело разбирает parse.ts, а отказ правила (ChannelError) переводится в HttpsError с тем же
 * кодом в деталях. Что не ChannelError — не наше дело, пусть падает как есть.
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
            if (error instanceof ChannelError) {
                throw new HttpsError(httpsCodeFor(error.code), error.message, { code: error.code });
            }
            throw error;
        }
    });

export const joinChannel = callable(parseJoinChannelRequest, (userId, request) =>
    raid.joinChannel({ db, channelId: request.channelId, userId, member: request.member })
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
