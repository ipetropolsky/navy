import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';

import { paths } from '../../shared/config/model';
import { ChannelError } from '../../shared/errors';
import { moveNotices, refitNotices, shipTitle } from '../../shared/notice';
import { isBerthFree, placeShip } from '../../shared/placement';
import { MemberDraft } from '../../shared/types/calls';
import {
    Corridor,
    MAX_COURSE_LENGTH,
    Manoeuvre,
    Member,
    MemberRef,
    ShipKind,
    ShipNotice,
    ShipPlacement,
    isManoeuvre,
    isSameBerth,
    manoeuvreFrom,
    memberRef,
} from '../../shared/types/channel';
import { limitMessage, overLimit } from '../../shared/utils/limit';

/**
 * Правила рейда — на транзакциях Admin SDK. Ровно те же решения, что и в src/backend/localBackend.ts
 * (кто старший, свободен ли позывной, куда встать при отказе брони), только источник данных другой:
 * там — объект в localStorage под замком вкладки, здесь — документы Firestore под транзакцией.
 * Расходиться в правилах эти два места не должны, а входить в них с разных сторон — это ровно то,
 * ради чего расстановка (`shared/placement.ts`) и правила поверх неё живут в общем каталоге.
 *
 * `db` приходит снаружи, а не заводится здесь: emulator-проверки (raid.test.ts) должны говорить
 * со своим Firestore, а не с тем, что достаётся из initializeApp() в index.ts, — иначе прогон
 * без раздельных приложений столкнул бы боевые и проверочные данные в одном инстансе.
 */

/** channels/{channelId} — здесь читаем то, от чего зависит расстановка и вход: старшего и код. */
interface ChannelDoc {
    owner?: { memberId: string };
    closed?: boolean;
    code?: string;
}

/** channels/{channelId}/members/{memberId} — форма документа участника, см. docs/FIREBASE.md. */
interface MemberDoc {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    place: ShipPlacement;
    joinedAt: number;
    /**
     * Манёвр, который корабль отыгрывает прямо сейчас, — для тех, кто пришёл посреди него
     * (см. `Manoeuvre`). Поля нет у тех, кто встал на рейд до того, как манёвры стали
     * записывать, и у тех, чья вкладка не прислала оценки.
     */
    manoeuvre?: Manoeuvre;
    /** Чей это корабль. Сегодня равно ключу документа, и всё же полем: ссылка — объект. */
    user: { userId: string };
    /**
     * Серверное время последней записи — тем же приёмом, что и у сообщений (см. `NoticeDoc`,
     * `writeNotice`). `manoeuvre.startedAt` ставят эти самые часы Cloud Function, а вычитывает
     * его вкладка своими, ничем с ними не сверенными; расхождение съедает остаток короткого
     * хода при доигровке после перезагрузки (issue #230). По `serverAt` рядом с записью клиент
     * (firebaseBackend.ts) мерит свой сдвиг и поправляет им `Date.now()` перед сравнением.
     */
    serverAt?: FieldValue;
}

/** channels/{channelId}/berths/{berthId} — бронь места, ключ собран из слота и коридора. */
interface BerthDoc {
    slot: number;
    corridor: Corridor;
    memberId: string;
    takenAt: number;
}

/** users/{userId}/channels/{channelId} — реестр участий, обратная сторона членства. */
interface UserChannelDoc {
    memberId: string;
    joinedAt: number;
}

/** channels/{channelId}/messages/{messageId} — сюда пишем только системные записи о рейде. */
interface NoticeDoc {
    author: MemberRef;
    kind: 'system';
    notice: ShipNotice;
    sentAt: number;
    serverAt: FieldValue;
}

const memberFromDoc = (memberId: string, doc: MemberDoc): Member => ({
    memberId,
    name: doc.name,
    hullNumber: doc.hullNumber,
    shipKind: doc.shipKind,
    color: doc.color,
    place: doc.place,
    joinedAt: doc.joinedAt,
    ...(doc.manoeuvre ? { manoeuvre: doc.manoeuvre } : {}),
});

// Поля с `undefined` Firestore не принимает вовсе — поэтому манёвр не проставляется пустым,
// а не пишется совсем. Заодно это и правильно по смыслу: манёвра у корабля либо нет, либо
// он есть целиком.
const memberToDoc = (member: Member): MemberDoc => ({
    name: member.name,
    hullNumber: member.hullNumber,
    shipKind: member.shipKind,
    color: member.color,
    place: member.place,
    joinedAt: member.joinedAt,
    ...(member.manoeuvre ? { manoeuvre: member.manoeuvre } : {}),
    user: { userId: member.memberId },
    serverAt: FieldValue.serverTimestamp(),
});

/** Канал должен существовать — это общее условие всех четырёх операций. */
const readChannel = async (transaction: Transaction, db: Firestore, channelId: string): Promise<ChannelDoc> => {
    const snapshot = await transaction.get(db.doc(paths.channel({ channelId })));
    if (!snapshot.exists) {
        throw new ChannelError('channel-not-found', 'Канал не найден');
    }
    return snapshot.data() as ChannelDoc;
};

/**
 * Все участники разом. Ровно этого требует расстановка (freeBerths смотрит на весь флот
 * целиком, а не по одному кораблю) и проверка занятого позывного — прочитать целиком дешевле,
 * чем городить запрос по полю, да и участников на канал не бывает больше десятка.
 */
const readMembers = async (transaction: Transaction, db: Firestore, channelId: string): Promise<Member[]> => {
    const snapshot = await transaction.get(db.collection(paths.members({ channelId })));
    return snapshot.docs.map((doc) => memberFromDoc(doc.id, doc.data() as MemberDoc));
};

/** Позывной и бортовой номер должны быть свободны: иначе в ленте не различить, кто говорит. */
const checkDraftIsFree = (others: Member[], draft: MemberDraft): void => {
    if (others.some((member) => member.name.toLowerCase() === draft.name.trim().toLowerCase())) {
        throw new ChannelError('name-taken', 'Корабль с таким позывным уже на связи');
    }
    if (others.some((member) => member.hullNumber === draft.hullNumber.trim())) {
        throw new ChannelError('hull-taken', 'Этот бортовой номер уже занят');
    }
};

/**
 * Строчка в ленту от имени самого канала — событие рейда, а не реплика участника. Пишется
 * в той же транзакции, что и само событие (см. docs/FIREBASE.md, «Как методы ложатся
 * на Firestore»): разомкни их, и уход, оборвавшийся посередине, оставит канал без записи
 * об ушедшем. Идентификатор — свой, как и у сообщения участника: назначает его тот, кто пишет.
 */
const writeNotice = (
    transaction: Transaction,
    db: Firestore,
    channelId: string,
    entry: { author: MemberRef; notice: ShipNotice; sentAt: number }
): void => {
    const doc: NoticeDoc = {
        author: entry.author,
        kind: 'system',
        notice: entry.notice,
        sentAt: entry.sentAt,
        serverAt: FieldValue.serverTimestamp(),
    };
    transaction.create(db.collection(paths.messages({ channelId })).doc(), doc);
};

/**
 * Бронь места заняли между тем, как мы её проверили, и тем, как транзакция должна была
 * записать её же, — внутренний сигнал ретраю (retryOnBerthTaken), а не ChannelError: наружу,
 * к клиенту, он просочиться не должен. Человек тут ни при чём: место у него увели за те
 * полсекунды, что шёл запрос, и показывать ему отказ вместо соседнего свободного места
 * не за что.
 */
class BerthTaken extends Error {}

/** Сколько раз пересчитывать место заново, прежде чем сдаться и ответить отказом. */
const MAX_BERTH_ATTEMPTS = 3;

/**
 * Повторяет операцию, если бронь места увели между чтением и записью той же транзакции.
 * Свежая попытка — это свежие чтения: заново читаются участники, и placeShip выбирает уже
 * с поправкой на то, кто успел встать. Три попытки, а не бесконечно — если и третья гонка
 * не разрешилась, дело не в одном невезении, а в том, что кораблей и правда набежало больше,
 * чем можно честно рассадить за один заход.
 */
const retryOnBerthTaken = async <T>(attempt: () => Promise<T>): Promise<T> => {
    // Попытки идут одна за другой нарочно: следующая должна читать бронь заново, после того
    // как предыдущая её потеряла, а не наперегонки с ней же.
    for (let i = 0; i < MAX_BERTH_ATTEMPTS; i++) {
        try {
            // eslint-disable-next-line no-await-in-loop -- заход за заходом, не наперегонки, см. выше
            return await attempt();
        } catch (error) {
            if (!(error instanceof BerthTaken)) {
                throw error;
            }
        }
    }
    throw new ChannelError('unknown', 'Слишком много кораблей встают разом. Попробуйте ещё раз');
};

/**
 * Встать на рейд. Повторный вызов с тем же userId (участие адресуется личностью, memberId
 * === userId, см. docs/FIREBASE.md) не заводит второй корабль: это и есть цена, которую мы
 * платим за то, чтобы ответ, потерявшийся в пути, можно было просто спросить ещё раз.
 */
export const joinChannel = ({
    db,
    channelId,
    userId,
    member: draft,
    code,
}: {
    db: Firestore;
    channelId: string;
    userId: string;
    member: MemberDraft;
    code?: string;
}): Promise<{ member: Member }> =>
    retryOnBerthTaken(() =>
        db.runTransaction(async (transaction) => {
            const channel = await readChannel(transaction, db, channelId);
            const members = await readMembers(transaction, db, channelId);

            const already = members.find((item) => item.memberId === userId);
            if (already) {
                return { member: already };
            }

            // Код спрашиваем только у того, кто входит на закрытый рейд по-настоящему первым
            // разом: свой повторный вход (already, выше) — тот же самый пропуск, а не чужой,
            // а самому первому на рейде (владельца ещё нет) сверять код не с чем — это он сам
            // его секунду назад и придумал, заводя канал.
            if (channel.closed && channel.owner && channel.code !== code) {
                throw new ChannelError('channel-closed', 'Код доступа неверен. Обратитесь к старшему на рейде.');
            }

            checkDraftIsFree(members, draft);

            // Выбранное в форме место — пожелание: занято, значит корабль встанет на ближайшее
            // свободное (nearestBerth внутри placeShip). Предела числом кораблей нет вовсе —
            // предел кладёт само место на рейде: свободных не осталось, значит канал полон.
            const place = placeShip(draft.shipKind, members, draft.berth, draft.facing);
            if (!place) {
                throw new ChannelError('channel-full', 'На рейде не осталось свободного места');
            }

            // Критическое чтение: placeShip выше решал по составу участников, а место на рейде
            // занимается ещё и бронью — вдруг её кто-то создал быстрее нас, пока мы читали
            // участников и считали расстановку. Бронь занята — не отказ, а сигнал пересчитать
            // всё заново (см. retryOnBerthTaken).
            const berthRef = db.doc(paths.berth({ channelId, slot: place.slot, corridor: place.corridor }));
            const berthSnapshot = await transaction.get(berthRef);
            if (berthSnapshot.exists) {
                throw new BerthTaken();
            }

            const joinedAt = Date.now();
            const joined: Member = {
                memberId: userId,
                name: draft.name.trim(),
                hullNumber: draft.hullNumber.trim(),
                shipKind: draft.shipKind,
                color: draft.color,
                place,
                joinedAt,
                // Заход на рейд — тоже манёвр: пришедший через полсекунды после нас застанет
                // корабль ещё за кромкой кадра и доиграет его заход (см. `Manoeuvre`).
                manoeuvre: manoeuvreFrom(undefined, draft.manoeuvre?.seconds, joinedAt),
            };

            transaction.create(db.doc(paths.member({ channelId, memberId: userId })), memberToDoc(joined));
            transaction.create(berthRef, {
                slot: place.slot,
                corridor: place.corridor,
                memberId: userId,
                takenAt: joined.joinedAt,
            } satisfies BerthDoc);
            transaction.create(db.doc(paths.userChannel({ userId, channelId })), {
                memberId: userId,
                joinedAt: joined.joinedAt,
            } satisfies UserChannelDoc);
            // Первый вставший на рейд становится старшим: канал заводят пустым, и до этого мига
            // отвечать за него некому.
            if (!channel.owner) {
                transaction.update(db.doc(paths.channel({ channelId })), { owner: { memberId: userId } });
            }
            // Вход отмечается в ленте: корабль заплывает в кадр молча, и без строчки в чате
            // непонятно, кто пришёл. Автор — сам вошедший, снимком того, как его зовут сейчас.
            writeNotice(transaction, db, channelId, {
                author: memberRef(joined),
                notice: { event: 'joined', before: shipTitle(joined) },
                sentAt: joined.joinedAt,
            });

            return { member: joined };
        })
    );

/**
 * Переоснастить корабль: позывной, номер, силуэт, цвет и, если понадобится, место. Место
 * трогаем ровно там же, где и localBackend.updateMember, — только когда корабль и правда
 * куда-то идёт: сам не выбирал новое место и по-прежнему помещается там, где стоял, — переход
 * не переигрывает ни бронь, ни сторону захода.
 */
export const updateMember = ({
    db,
    channelId,
    userId,
    member: draft,
}: {
    db: Firestore;
    channelId: string;
    userId: string;
    member: MemberDraft;
}): Promise<{ member: Member }> =>
    retryOnBerthTaken(() =>
        db.runTransaction(async (transaction) => {
            await readChannel(transaction, db, channelId);
            const members = await readMembers(transaction, db, channelId);
            const others = members.filter((item) => item.memberId !== userId);

            // Тот же порядок, что и в localBackend.updateMember: свободен ли черновик спрашиваем
            // раньше, чем и вставал ли вообще такой участник, — так же расходится и обратная
            // связь для формы, и разъезжаться с ней в этой мелочи незачем.
            checkDraftIsFree(others, draft);
            const before = members.find((item) => item.memberId === userId);
            if (!before) {
                throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
            }

            // «Своё место» проверяется заново, потому что переоснащение меняет и размер: катер,
            // ставший ракетным кораблём, может уже не помещаться там, где стоял, — и тогда ему
            // приходится искать себе место, даже если он его не выбирал. Смена курса — тоже
            // перемена места: развернуться на якоре корабль не может, и заход разыгрывается
            // заново, с другого борта.
            const wanted = draft.berth ?? before.place;
            const stays = isSameBerth(before.place, wanted) && isBerthFree(before.place, draft.shipKind, others);
            const turns = Boolean(draft.facing) && draft.facing !== before.place.facing;
            const moves = !stays || turns;
            // placeShip может не найти места и для перехода (весь рейд занят под завязку) —
            // тогда, как и в localBackend, корабль остаётся на прежнем месте молча: отказывать
            // тому, кто просто сменил позывной, из-за тесноты на рейде было бы странно.
            const place = moves
                ? (placeShip(draft.shipKind, others, wanted, draft.facing) ?? before.place)
                : before.place;
            const berthChanged = moves && !isSameBerth(place, before.place);

            // Чтение до всякой записи: если место и правда меняется, проверяем бронь нового —
            // тем же приёмом и с тем же смыслом, что и при входе.
            if (berthChanged) {
                const newBerthSnapshot = await transaction.get(
                    db.doc(paths.berth({ channelId, slot: place.slot, corridor: place.corridor }))
                );
                if (newBerthSnapshot.exists) {
                    throw new BerthTaken();
                }
            }

            const started = Date.now();
            const afloat = { place, shipKind: draft.shipKind };
            const updated: Member = {
                ...before,
                name: draft.name.trim(),
                hullNumber: draft.hullNumber.trim(),
                shipKind: draft.shipKind,
                color: draft.color,
                place,
                // Корабль тронулся — запоминаем, откуда и когда: по этой записи вошедшие
                // посреди манёвра его и доигрывают. Решает `isManoeuvre` — тот же самый,
                // по которому решает и сцена: два мнения о том, тронулся корабль или нет,
                // были бы двумя разными правдами. Не тронулся — прежняя запись остаётся
                // лежать как есть: она давно протухла, и вреда от неё нет.
                ...(isManoeuvre(before, afloat)
                    ? { manoeuvre: manoeuvreFrom(before, draft.manoeuvre?.seconds, started) }
                    : {}),
            };

            // merge: true, а не полная перезапись — у документа участника есть поле, которым
            // распоряжается не эта функция, а сам владелец напрямую (lastSeen, см.
            // docs/FIREBASE.md и правило allow update: if isMe(memberId) в firestore.rules).
            // Переоснащение не должно стирать то, докуда человек дочитал.
            transaction.set(db.doc(paths.member({ channelId, memberId: userId })), memberToDoc(updated), {
                merge: true,
            });
            if (berthChanged) {
                transaction.delete(
                    db.doc(paths.berth({ channelId, slot: before.place.slot, corridor: before.place.corridor }))
                );
                transaction.create(db.doc(paths.berth({ channelId, slot: place.slot, corridor: place.corridor })), {
                    slot: place.slot,
                    corridor: place.corridor,
                    memberId: userId,
                    takenAt: Date.now(),
                } satisfies BerthDoc);
            }

            // По записи на каждую перемену, одна за другой, со своим временем: в ленте они
            // встают отдельными сообщениями, и каждое можно процитировать по отдельности.
            // Снимок в записи — прежний, до правки: строчка говорит о том корабле, каким он был.
            // Строчка о перемене места идёт первой: корабль тронулся, и это новость крупнее
            // сменившегося позывного. Пишется она в начале манёвра, а не по прибытии, —
            // канал рассказывает о происходящем, а не подводит итоги.
            const author = memberRef(before);
            [...moveNotices(before, updated), ...refitNotices(before, updated)].forEach((notice, index) => {
                writeNotice(transaction, db, channelId, { author, notice, sentAt: started + index });
            });

            return { member: updated };
        })
    );

/**
 * Сняться с рейда. Дважды для одного и того же userId — не ошибка, а такой же безответный
 * повтор, как и у входа: запрос мог дойти и стереть участие, а ответ потеряться на обратном
 * пути. Берту здесь ретраить незачем: уход только освобождает бронь, а не занимает чужую,
 * и гонки за свободное место тут нет.
 */
export const leaveChannel = ({
    db,
    channelId,
    userId,
    course = '',
    nextOwnerId,
}: {
    db: Firestore;
    channelId: string;
    userId: string;
    course?: string;
    nextOwnerId?: string;
}): Promise<Record<string, never>> => {
    // Длину курса проверяем до транзакции: это проверка формы запроса, а не состояния рейда,
    // и незачем платить за неё чтением канала.
    const newCourse = course.trim();
    if (overLimit(newCourse, MAX_COURSE_LENGTH)) {
        throw new ChannelError('course-too-long', limitMessage(newCourse, MAX_COURSE_LENGTH));
    }
    return db.runTransaction(async (transaction) => {
        const channel = await readChannel(transaction, db, channelId);

        const memberDocRef = db.doc(paths.member({ channelId, memberId: userId }));
        const memberSnapshot = await transaction.get(memberDocRef);
        if (!memberSnapshot.exists) {
            return {};
        }
        const gone = memberFromDoc(userId, memberSnapshot.data() as MemberDoc);

        // Кто станет старшим, читаем заранее (реестр — до всякой записи), но только если это
        // вообще нужно: старшего трогаем, только когда с рейда уходит он сам.
        const wasSenior = channel.owner?.memberId === userId;
        const rest = wasSenior
            ? (await readMembers(transaction, db, channelId)).filter((item) => item.memberId !== userId)
            : [];

        transaction.delete(memberDocRef);
        transaction.delete(db.doc(paths.berth({ channelId, slot: gone.place.slot, corridor: gone.place.corridor })));
        transaction.delete(db.doc(paths.userChannel({ userId, channelId })));

        if (wasSenior) {
            // Преемника называет сам уходящий старший (nextOwnerId), и только если тот и правда
            // ещё на рейде — подсказка могла устареть, пока корабль набирал курс. Нет подсказки
            // или она устарела — старшинство переходит к тому, кто дольше всех на рейде. Ушли
            // все — старшего снова нет, и им станет тот, кто придёт следующим.
            const named = rest.find((item) => item.memberId === nextOwnerId);
            const senior = named ?? [...rest].sort((one, other) => one.joinedAt - other.joinedAt)[0];
            const channelRef = db.doc(paths.channel({ channelId }));
            if (senior) {
                transaction.update(channelRef, { owner: { memberId: senior.memberId } });
            } else {
                transaction.update(channelRef, { owner: FieldValue.delete() });
            }
        }

        // Курса может и не быть — тогда поля в записи нет вовсе, а не пустая строка: «не сказал»
        // и «сказал пустое» в хранилище одно и то же, и хранить это двумя разными способами
        // значит однажды сложить строчку про пустой курс.
        writeNotice(transaction, db, channelId, {
            author: memberRef(gone),
            notice: { event: 'left', before: shipTitle(gone), ...(newCourse ? { course: newCourse } : {}) },
            sentAt: Date.now(),
        });

        return {};
    });
};

/**
 * Высадить чужой корабль. Право есть только у старшего, и не над собой: снимается с рейда
 * старший сам, через leaveChannel, а не через эту функцию. Как и уход, берту не ретраит —
 * высадка тоже только освобождает бронь.
 */
export const kickMember = ({
    db,
    channelId,
    userId,
    member: target,
}: {
    db: Firestore;
    channelId: string;
    userId: string;
    member: { memberId: string };
}): Promise<Record<string, never>> => {
    const targetId = target.memberId;
    return db.runTransaction(async (transaction) => {
        const channel = await readChannel(transaction, db, channelId);
        if (channel.owner?.memberId !== userId) {
            throw new ChannelError('not-senior', 'Высадить корабль может только старший на рейде');
        }
        if (targetId === userId) {
            throw new ChannelError('not-senior', 'Старший снимается с рейда сам, а не высаживает себя');
        }

        const targetDocRef = db.doc(paths.member({ channelId, memberId: targetId }));
        const targetSnapshot = await transaction.get(targetDocRef);
        if (!targetSnapshot.exists) {
            throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
        }
        const gone = memberFromDoc(targetId, targetSnapshot.data() as MemberDoc);

        // Автор записи — распорядившийся старший, снимком того, как его самого зовут сейчас.
        // Читаем его же документ участника: он и есть каноничный источник этого снимка.
        const seniorSnapshot = await transaction.get(db.doc(paths.member({ channelId, memberId: userId })));
        const senior = seniorSnapshot.exists ? memberFromDoc(userId, seniorSnapshot.data() as MemberDoc) : null;

        transaction.delete(targetDocRef);
        transaction.delete(db.doc(paths.berth({ channelId, slot: gone.place.slot, corridor: gone.place.corridor })));
        transaction.delete(db.doc(paths.userChannel({ userId: targetId, channelId })));

        // Старшинство высадка не трогает: высаживает сам старший, и им же остаётся.
        writeNotice(transaction, db, channelId, {
            author: senior ? memberRef(senior) : { memberId: userId },
            notice: { event: 'kicked', before: shipTitle(gone) },
            sentAt: Date.now(),
        });

        return {};
    });
};
