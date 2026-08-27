import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, WriteResult, getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paths } from '../../shared/config/model';
import { ChannelError } from '../../shared/errors';
import { berthAt } from '../../shared/placement';
import { MemberDraft } from '../../shared/types/calls';
import { MAX_COURSE_LENGTH, ShipKind } from '../../shared/types/channel';
import { joinChannel, kickMember, leaveChannel, updateMember } from './raid';

/**
 * Проверки правил рейда (raid.ts) — против настоящего эмулятора Firestore, Admin SDK, взятый
 * из functions/node_modules: это тот же пакет и то же подключение, какими пользуются сами
 * функции, — проверяются настоящие транзакции, а не пересказ их своими словами.
 *
 * Функции зовутся напрямую, в обход onCall и parse.ts: набору нужны правила рейда, а не форма
 * запроса, — вызываемых функций эмулятор здесь и не поднят (`npm run test:emulator` держит
 * только firestore, см. package.json). Разбор входа проверять тут нечем и незачем: он сводится
 * к разбору JSON, а решения, которые стоит проверять транзакцией, начинаются уже в raid.ts.
 *
 * Свой project id (demo-navy-raid), как и у соседей по эмулятору (demo-navy-rules — правила,
 * demo-navy-channels — бэкенд каналов): раздельные id держат данные наборов друг от друга,
 * даже когда все три гоняются в одном поднятом эмуляторе. Канал под каждую проверку свой —
 * seedChannel заводит его без владельца, ровно как это делает сегодняшний createChannel.
 */

const PROJECT_ID = 'demo-navy-raid';
// Хост и порт — как в firebase.json (emulators.firestore) и в EMULATORS из src/config/firebase.ts.
const EMULATOR_HOST = '127.0.0.1:8080';

process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

const app: App = initializeApp({ projectId: PROJECT_ID });
const db: Firestore = getFirestore(app);

afterAll(async () => {
    // Модульный App (firebase-admin/app) — не объект с методами, а обычный интерфейс:
    // закрывает его отдельная функция, deleteApp, а не app.delete() из старого admin.app().
    await deleteApp(app);
});

/** Стереть всё в проекте между проверками — тем же путём, каким это делает сам emulator UI. */
const clearFirestore = (): Promise<Response> =>
    fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
        method: 'DELETE',
    });

beforeEach(async () => {
    await clearFirestore();
});

// ---- помощники ----

/** Канал без владельца — так его заводит и сегодняшний createChannel, до первого вошедшего. */
const seedChannel = (channelId: string): Promise<WriteResult> =>
    db.doc(paths.channel({ channelId })).set({ slug: channelId, title: channelId, createdAt: Date.now() });

const draft = (name: string, hullNumber: string, extra: Partial<MemberDraft> = {}): MemberDraft => ({
    name,
    hullNumber,
    shipKind: 'pr1234' as ShipKind,
    color: '#8ecae6',
    ...extra,
});

const readDoc = async (path: string): Promise<Record<string, unknown> | undefined> => (await db.doc(path).get()).data();

const readCollection = async (path: string): Promise<Record<string, unknown>[]> =>
    (await db.collection(path).get()).docs.map((snapshot) => snapshot.data());

/** Форма строчки в ленте, какой её пишет writeNotice, — только то, что проверки в ней читают. */
interface RawNotice {
    author?: { memberId: string };
    kind?: string;
    sentAt?: number;
    notice?: { event?: string; changed?: string; course?: string; before?: { name?: string } };
}

/**
 * Ошибка с ожидаемым кодом. Проверяем код, а не текст: текст — дело интерфейса.
 *
 * try/await, а не run().then(...): leaveChannel бросает course-too-long ещё до транзакции,
 * то есть синхронно, до всякого Promise, — на такой бросок `.then` у промиса, который
 * ещё не вернули, опереться не может, а await внутри try ловит оба случая одинаково.
 */
const failsWith = async (run: () => Promise<unknown>, code: string): Promise<void> => {
    let failure: unknown = null;
    try {
        await run();
    } catch (thrown) {
        failure = thrown;
    }
    expect(failure).toBeInstanceOf(ChannelError);
    expect((failure as ChannelError).code).toBe(code);
};

describe('вход', () => {
    test('пишет участие, бронь, реестр и строчку в ленту разом', async () => {
        const channelId = 'ch-join';
        await seedChannel(channelId);

        const { member } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        expect(member.memberId).toBe('u-a');

        const memberDoc = await readDoc(paths.member({ channelId, memberId: 'u-a' }));
        expect(memberDoc?.name).toBe('Алый');
        expect(memberDoc?.user).toEqual({ userId: 'u-a' });

        const berthDoc = await readDoc(
            paths.berth({ channelId, slot: member.place.slot, corridor: member.place.corridor })
        );
        expect(berthDoc?.memberId).toBe('u-a');

        const registryDoc = await readDoc(paths.userChannel({ userId: 'u-a', channelId }));
        expect(registryDoc?.memberId).toBe('u-a');

        const messages = await readCollection(paths.messages({ channelId }));
        expect(messages).toHaveLength(1);
        const [notice] = messages as RawNotice[];
        expect(notice.kind).toBe('system');
        expect(notice.notice?.event).toBe('joined');
        expect(notice.author?.memberId).toBe('u-a');
    });

    test('первый вошедший становится старшим, второй — нет', async () => {
        const channelId = 'ch-senior';
        await seedChannel(channelId);
        const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        await joinChannel({ db, channelId, userId: 'u-b', member: draft('Белый', '002') });

        const channelDoc = await readDoc(paths.channel({ channelId }));
        expect(channelDoc?.owner).toEqual({ memberId: a.memberId });
    });

    test('повторный вход тем же userId не заводит второй корабль', async () => {
        const channelId = 'ch-idempotent';
        await seedChannel(channelId);
        const first = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        const second = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Синий', '999') });

        expect(second.member).toEqual(first.member);
        expect(await readCollection(paths.members({ channelId }))).toHaveLength(1);
        expect(await readCollection(paths.messages({ channelId }))).toHaveLength(1);
    });

    test('желаемое место занято — встаёт на ближайшее свободное', async () => {
        const channelId = 'ch-wish';
        await seedChannel(channelId);
        await joinChannel({
            db,
            channelId,
            userId: 'u-3',
            member: draft('С1', '101', { berth: berthAt(3, 'center') }),
        });
        await joinChannel({
            db,
            channelId,
            userId: 'u-4',
            member: draft('С2', '102', { berth: berthAt(4, 'center') }),
        });
        await joinChannel({
            db,
            channelId,
            userId: 'u-5',
            member: draft('С3', '103', { berth: berthAt(5, 'center') }),
        });
        await joinChannel({
            db,
            channelId,
            userId: 'u-6',
            member: draft('С4', '104', { berth: berthAt(6, 'center') }),
        });

        const { member } = await joinChannel({
            db,
            channelId,
            userId: 'u-new',
            member: draft('Новый', '200', { berth: berthAt(5, 'center') }),
        });
        expect(member.place).toMatchObject({ slot: 7, corridor: 'center' });
    });

    test('два входа разом на одно и то же место расходятся по разным', async () => {
        const channelId = 'ch-race';
        await seedChannel(channelId);
        const wanted = berthAt(0, 'center');

        const [a, b] = await Promise.all([
            joinChannel({ db, channelId, userId: 'u-race-a', member: draft('Алый', '001', { berth: wanted }) }),
            joinChannel({ db, channelId, userId: 'u-race-b', member: draft('Белый', '002', { berth: wanted }) }),
        ]);

        expect(a.member.place.slot === b.member.place.slot && a.member.place.corridor === b.member.place.corridor).toBe(
            false
        );

        const berths = await readCollection(paths.berths({ channelId }));
        expect(berths).toHaveLength(2);

        const messages = (await readCollection(paths.messages({ channelId }))) as RawNotice[];
        expect(messages.filter((message) => message.notice?.event === 'joined')).toHaveLength(2);
    });

    describe('отказы', () => {
        test('занятый позывной — name-taken', async () => {
            const channelId = 'ch-name-taken';
            await seedChannel(channelId);
            await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
            await failsWith(
                () => joinChannel({ db, channelId, userId: 'u-b', member: draft('алый', '002') }),
                'name-taken'
            );
        });

        test('занятый бортовой номер — hull-taken', async () => {
            const channelId = 'ch-hull-taken';
            await seedChannel(channelId);
            await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
            await failsWith(
                () => joinChannel({ db, channelId, userId: 'u-b', member: draft('Белый', '001') }),
                'hull-taken'
            );
        });

        // Вместимость рейда — 17 кораблей (см. shared/placement.ts, SLOT_CAPACITY): по одному
        // на трёх ближних к острову слотах (остров уже занял по кораблю каждому) и по два
        // на семи остальных. Самый узкий силуэт (pr1400), чтобы разойтись бортами удавалось
        // всегда, — иначе тесноту решала бы ещё и геометрия, а не только число мест.
        test('свободных мест не осталось — channel-full', async () => {
            const channelId = 'ch-full';
            await seedChannel(channelId);
            const spots: { slot: number; corridor: 'left' | 'center' | 'right' }[] = [
                { slot: 0, corridor: 'center' },
                { slot: 1, corridor: 'center' },
                { slot: 2, corridor: 'center' },
            ];
            for (let slot = 3; slot < 10; slot++) {
                spots.push({ slot, corridor: 'left' }, { slot, corridor: 'center' });
            }
            expect(spots).toHaveLength(17);

            // Заполняем рейд по одному месту за раз нарочно: следующее пожелание должно видеть
            // уже вставших, а не спорить с ними за то же место.
            for (const [index, spot] of spots.entries()) {
                // eslint-disable-next-line no-await-in-loop -- по одному, не наперегонки, см. выше
                await joinChannel({
                    db,
                    channelId,
                    userId: `u-full-${index}`,
                    member: draft(`Катер${index}`, String(300 + index), {
                        shipKind: 'pr1400',
                        berth: berthAt(spot.slot, spot.corridor),
                    }),
                });
            }

            await failsWith(
                () =>
                    joinChannel({
                        db,
                        channelId,
                        userId: 'u-lonely',
                        member: draft('Лишний', '999', { shipKind: 'pr1400' }),
                    }),
                'channel-full'
            );
        }, 20000);
    });
});

describe('переоснащение', () => {
    test('смена позывного и номера — по записи на каждую перемену, друг за другом', async () => {
        const channelId = 'ch-refit-notices';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Старый', '001') });

        const { member: after } = await updateMember({
            db,
            channelId,
            userId: 'u-a',
            member: draft('Новый', '002'),
        });
        expect(after.name).toBe('Новый');
        expect(after.hullNumber).toBe('002');

        const messages = (await readCollection(paths.messages({ channelId }))) as RawNotice[];
        const refits = messages
            .filter((message) => message.notice?.event === 'refit')
            .sort((one, other) => (one.sentAt ?? 0) - (other.sentAt ?? 0));
        expect(refits).toHaveLength(2);
        // Порядок — как в SHIP_FIELDS (shared/notice.ts): позывной раньше номера.
        expect(refits[0].notice?.changed).toBe('name');
        expect(refits[1].notice?.changed).toBe('hullNumber');
        expect(refits[0].author?.memberId).toBe('u-a');
        expect(refits[0].sentAt).toBeLessThan(refits[1].sentAt!);
    });

    test('в больший корпус — переходит на соседнее место со своей бронью', async () => {
        const channelId = 'ch-refit-oversized';
        await seedChannel(channelId);
        await joinChannel({
            db,
            channelId,
            userId: 'u-mover',
            member: draft('Катер', '001', { shipKind: 'pr1400', berth: berthAt(9, 'left') }),
        });
        await joinChannel({
            db,
            channelId,
            userId: 'u-neighbor',
            member: draft('Сосед', '002', { shipKind: 'pr1400', berth: berthAt(9, 'center') }),
        });

        // pr1234 у борта pr1400 на девятом (самом дальнем) слоте уже не расходится бортами —
        // проверено расстановкой (freeCorridors) отдельно, не на глаз.
        const { member: refit } = await updateMember({
            db,
            channelId,
            userId: 'u-mover',
            member: draft('Катер', '001', { shipKind: 'pr1234' }),
        });

        expect(refit.place).toMatchObject({ slot: 8, corridor: 'left' });
        expect(await readDoc(paths.berth({ channelId, slot: 9, corridor: 'left' }))).toBeUndefined();
        const newBerth = await readDoc(paths.berth({ channelId, slot: 8, corridor: 'left' }));
        expect(newBerth?.memberId).toBe('u-mover');
    });

    test('которое всё ещё помещается — место и бронь не трогает', async () => {
        const channelId = 'ch-refit-stays';
        await seedChannel(channelId);
        const { member: before } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Корабль', '001') });
        const berthBefore = await readDoc(
            paths.berth({ channelId, slot: before.place.slot, corridor: before.place.corridor })
        );

        const { member: after } = await updateMember({
            db,
            channelId,
            userId: 'u-a',
            member: draft('Корабль', '001', { color: '#f2cc8f' }),
        });

        expect(after.place).toEqual(before.place);
        expect(
            await readDoc(paths.berth({ channelId, slot: before.place.slot, corridor: before.place.corridor }))
        ).toEqual(berthBefore);
    });
});

describe('уход', () => {
    test('стирает участие, бронь и реестр, а в ленте остаётся курс', async () => {
        const channelId = 'ch-leave';
        await seedChannel(channelId);
        const { member } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });

        await leaveChannel({ db, channelId, userId: 'u-a', course: 'В Кронштадт, на зимовку' });

        expect(await readDoc(paths.member({ channelId, memberId: 'u-a' }))).toBeUndefined();
        expect(
            await readDoc(paths.berth({ channelId, slot: member.place.slot, corridor: member.place.corridor }))
        ).toBeUndefined();
        expect(await readDoc(paths.userChannel({ userId: 'u-a', channelId }))).toBeUndefined();

        const messages = (await readCollection(paths.messages({ channelId }))) as RawNotice[];
        const left = messages.find((message) => message.notice?.event === 'left');
        expect(left?.notice?.course).toBe('В Кронштадт, на зимовку');
    });

    test('без курса — поля course в записи нет вовсе', async () => {
        const channelId = 'ch-leave-no-course';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });

        await leaveChannel({ db, channelId, userId: 'u-a' });

        const messages = (await readCollection(paths.messages({ channelId }))) as RawNotice[];
        const left = messages.find((message) => message.notice?.event === 'left');
        expect(left?.notice && 'course' in left.notice).toBe(false);
    });

    test('повторный уход — не ошибка', async () => {
        const channelId = 'ch-leave-twice';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        await leaveChannel({ db, channelId, userId: 'u-a' });

        await expect(leaveChannel({ db, channelId, userId: 'u-a' })).resolves.toEqual({});
    });

    test('курс длиннее предела — course-too-long', async () => {
        const channelId = 'ch-leave-course-long';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });

        await failsWith(
            () => leaveChannel({ db, channelId, userId: 'u-a', course: 'о'.repeat(MAX_COURSE_LENGTH + 1) }),
            'course-too-long'
        );
    });

    describe('старшинство', () => {
        test('старший назвал преемника — тот и становится старшим', async () => {
            const channelId = 'ch-succession-named';
            await seedChannel(channelId);
            const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });
            await joinChannel({ db, channelId, userId: 'u-b', member: draft('Б', '002') });
            const { member: c } = await joinChannel({ db, channelId, userId: 'u-c', member: draft('В', '003') });

            await leaveChannel({ db, channelId, userId: a.memberId, nextOwnerId: c.memberId });

            const channelDoc = await readDoc(paths.channel({ channelId }));
            expect(channelDoc?.owner).toEqual({ memberId: c.memberId });
        });

        test('названный преемник уже ушёл — старшинство переходит самому давнему из оставшихся', async () => {
            const channelId = 'ch-succession-fallback';
            await seedChannel(channelId);
            const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });
            const { member: b } = await joinChannel({ db, channelId, userId: 'u-b', member: draft('Б', '002') });
            const { member: c } = await joinChannel({ db, channelId, userId: 'u-c', member: draft('В', '003') });
            await joinChannel({ db, channelId, userId: 'u-d', member: draft('Г', '004') });

            await leaveChannel({ db, channelId, userId: c.memberId });
            await leaveChannel({ db, channelId, userId: a.memberId, nextOwnerId: c.memberId });

            const channelDoc = await readDoc(paths.channel({ channelId }));
            expect(channelDoc?.owner).toEqual({ memberId: b.memberId });
        });

        test('уходит последний — старшего не остаётся вовсе', async () => {
            const channelId = 'ch-succession-empty';
            await seedChannel(channelId);
            const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });

            await leaveChannel({ db, channelId, userId: a.memberId });

            const channelDoc = (await readDoc(paths.channel({ channelId })))!;
            expect('owner' in channelDoc).toBe(false);
        });
    });
});

describe('высадка', () => {
    test('высаживает только старший', async () => {
        const channelId = 'ch-kick-not-senior';
        await seedChannel(channelId);
        const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });
        const { member: b } = await joinChannel({ db, channelId, userId: 'u-b', member: draft('Б', '002') });

        await failsWith(
            () => kickMember({ db, channelId, userId: b.memberId, member: { memberId: a.memberId } }),
            'not-senior'
        );
    });

    test('старший не высаживает себя', async () => {
        const channelId = 'ch-kick-self';
        await seedChannel(channelId);
        const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });

        await failsWith(
            () => kickMember({ db, channelId, userId: a.memberId, member: { memberId: a.memberId } }),
            'not-senior'
        );
    });

    test('незнакомый корабль — member-not-found', async () => {
        const channelId = 'ch-kick-unknown';
        await seedChannel(channelId);
        const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });

        await failsWith(
            () => kickMember({ db, channelId, userId: a.memberId, member: { memberId: 'net-takogo' } }),
            'member-not-found'
        );
    });

    test('запись в ленте — от старшего, а не от высаженного', async () => {
        const channelId = 'ch-kick-notice';
        await seedChannel(channelId);
        const { member: a } = await joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') });
        const { member: b } = await joinChannel({ db, channelId, userId: 'u-b', member: draft('Б', '002') });

        await kickMember({ db, channelId, userId: a.memberId, member: { memberId: b.memberId } });

        expect(await readDoc(paths.member({ channelId, memberId: b.memberId }))).toBeUndefined();
        const messages = (await readCollection(paths.messages({ channelId }))) as RawNotice[];
        const kicked = messages.find((message) => message.notice?.event === 'kicked');
        expect(kicked?.author?.memberId).toBe(a.memberId);
        expect(kicked?.notice?.before?.name).toBe('Б');
    });
});

describe('канала нет', () => {
    test('все четыре операции отвечают channel-not-found', async () => {
        const channelId = 'net-takogo-kanala';
        await failsWith(
            () => joinChannel({ db, channelId, userId: 'u-a', member: draft('А', '001') }),
            'channel-not-found'
        );
        await failsWith(
            () => updateMember({ db, channelId, userId: 'u-a', member: draft('А', '001') }),
            'channel-not-found'
        );
        await failsWith(() => leaveChannel({ db, channelId, userId: 'u-a' }), 'channel-not-found');
        await failsWith(
            () => kickMember({ db, channelId, userId: 'u-a', member: { memberId: 'u-b' } }),
            'channel-not-found'
        );
    });
});
