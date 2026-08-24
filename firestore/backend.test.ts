/**
 * Проверки бэкенда каналов на Firestore (`createFirebaseBackend`) — против настоящего
 * эмулятора, а не заглушки. Приём тот же, что и в firestore/rules.test.ts:
 * `@firebase/rules-unit-testing` поднимает эмулятор и правила из корневого firestore.rules,
 * `testEnv.authenticatedContext(uid).firestore()` даёт подключение — то же самое, какое
 * в `createFirebaseBackend({ db })` получает и приложение. Раз правила настоящие, а не
 * отключены и не пересказаны своими словами, каждая проверка заодно доказывает, что сам
 * бэкенд их не нарушает: слушается их, а не полагается на то, что рядом стоит обход.
 *
 * Канал, участники и лента читаются прямо из Firestore — это здесь и проверяется. join,
 * updateMember, leave и kick идут вызовом функций и в набор не входят: им нужен поднятый
 * эмулятор функций, а `npm run test:emulator` держит поднятым только Firestore (см.
 * firebase.json, emulators). `createFirebaseBackend` всё равно просит `functions` при
 * постройке — он собран по-настоящему, через `getFunctions` над отдельным `initializeApp`
 * с тем же projectId, — но само построение соединения не открывает: оно происходит внутри
 * вызова httpsCallable(...)(), а до вызова дело в этом наборе не доходит.
 *
 * Заводить корабль настоящим join здесь нечем по той же причине: там, где проверке нужен
 * участник, документ пишется в обход правил (seedMember, тем же приёмом, что и seedDoc
 * с seedOwner ниже). Старшего (`owner`) канала правила писать отсюда тоже не дают — назначает
 * его сервер, — и там, где для проверки нужен старший, документ дописывается тем же обходом.
 */
import { readFileSync } from 'fs';
import path from 'path';

import { RulesTestContext, RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp } from 'firebase/app';
import {
    DocumentSnapshot,
    Firestore,
    QuerySnapshot,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { Functions, getFunctions } from 'firebase/functions';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createFirebaseBackend } from '@/backend/firebaseBackend';
import { ChannelBackend, ChannelError, ChannelEvent } from '@/backend/types';
import { paths } from '@shared/config/model';
import { MAX_MESSAGE_LENGTH } from '@shared/types/channel';

const PROJECT_ID = 'demo-navy-backend';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
            // Хост и порт — как в firebase.json (emulators.firestore) и в EMULATORS
            // из src/config/firebase.ts, которым пользуется само приложение.
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

beforeEach(async () => {
    await testEnv.clearFirestore();
});

// ---- помощники ----

/**
 * Подключение к эмулятору. Приведение одно и только здесь: `@firebase/rules-unit-testing`
 * объявляет возврат `firestore()` compat-типом (`firebase/compat/app`), хотя на деле отдаёт
 * обычный модульный `Firestore` — тот же самый, что и `firebase/firestore` в остальном
 * приложении. Расхождение в объявлениях самого пакета, а не в нашем коде; дальше по файлу
 * и до самого `createFirebaseBackend` ходит уже настоящий тип.
 */
const emulatorDb = (context: RulesTestContext): Firestore => context.firestore() as unknown as Firestore;

/**
 * `Functions` на весь файл, а не на каждый бэкенд отдельно: соединение открывается вызовом,
 * а вызовов здесь нет (см. header-комментарий), — заводить свежий экземпляр на каждый
 * backendAs(uid) было бы работой без смысла. Имя приложения своё, а не дефолтное: чтобы
 * не столкнуться, поднимись когда-нибудь в этом же процессе ещё один клиентский
 * `initializeApp` без имени.
 */
const functionsApp = initializeApp({ projectId: PROJECT_ID }, 'backend-test-functions');
const testFunctions: Functions = getFunctions(functionsApp, 'europe-central2');

/** Бэкенд от имени вошедшего с этим uid — тем самым подключением, что получит приложение. */
const backendAs = (uid: string): ChannelBackend =>
    createFirebaseBackend({ db: emulatorDb(testEnv.authenticatedContext(uid)), functions: testFunctions });

/**
 * Документ в обход правил — как в firestore/rules.test.ts: заводим данные, от которых
 * зависит проверка, а не действие, которое проверяем.
 */
const seedDoc = (docPath: string, data: Record<string, unknown>): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) => setDoc(doc(emulatorDb(context), docPath), data));

/**
 * Дописать старшего в уже существующий документ канала — в обход правил, тем же приёмом.
 * Нужно там, где канал заводится по-настоящему, через backend.createChannel (значит, без
 * owner — его назначает только сервер, когда на рейд встаёт первый корабль, см.
 * functions/src/raid.ts), но дальше проверке требуется старший, чтобы прошло правило isOwner
 * на update. merge, а не перезапись: остальные поля документа трогать не нужно.
 */
const seedOwner = (channelId: string, memberId: string): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) =>
        updateDoc(doc(emulatorDb(context), paths.channel({ channelId })), { owner: { memberId } })
    );

/**
 * Завести корабль в обход правил: по-настоящему его пишет только join (см. header-комментарий,
 * этот вызов здесь недоступен), а проверкам ниже участник нужен готовым. memberId — тот же,
 * что и uid, которым потом ходит backendAs: правило messages.create сверяет автора записи
 * именно с ним (isMember, author.memberId == me()).
 */
const seedMember = (
    channelId: string,
    memberId: string,
    name: string,
    hullNumber: string,
    joinedAt: number
): Promise<void> =>
    seedDoc(paths.member({ channelId, memberId }), {
        name,
        hullNumber,
        shipKind: 'pr1234',
        color: '#8ecae6',
        place: { slot: 0, corridor: 'center', left: 50, facing: 'left', enterFrom: 'right' },
        joinedAt,
        user: { userId: memberId },
    });

/**
 * Прочитать документ в обход правил — сверяем, что реально легло в базу, а не то, что видит
 * приложение. `withSecurityRulesDisabled` возврат обратного вызова не пробрасывает (сам
 * он объявлен как `Promise<void>`), поэтому снимок забирается во внешнюю переменную.
 */
const rawDoc = async (docPath: string): Promise<DocumentSnapshot> => {
    let snap!: DocumentSnapshot;
    await testEnv.withSecurityRulesDisabled(async (context) => {
        snap = await getDoc(doc(emulatorDb(context), docPath));
    });
    return snap;
};

/** То же самое, но всей коллекцией — для «в базе ничего не осталось». */
const rawCollection = async (collectionPath: string): Promise<QuerySnapshot> => {
    let snap!: QuerySnapshot;
    await testEnv.withSecurityRulesDisabled(async (context) => {
        snap = await getDocs(collection(emulatorDb(context), collectionPath));
    });
    return snap;
};

/** Убрать документ в обход правил — ни корабль, ни сообщение сам с рейда/из ленты не удаляются. */
const dropDoc = (docPath: string): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) => deleteDoc(doc(emulatorDb(context), docPath)));

/** Ошибка с ожидаемым кодом. Проверяем код, а не текст: текст — дело интерфейса. */
const failsWith = async (run: () => Promise<unknown>, code: string): Promise<void> => {
    const failure = await run().then(
        () => null,
        (thrown: unknown) => thrown
    );
    expect(failure).toBeInstanceOf(ChannelError);
    expect((failure as ChannelError).code).toBe(code);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('createChannel', () => {
    test('на пустой базе заводит канал и бронь адреса — без owner', async () => {
        const backend = backendAs('u-create');

        const { channel } = await backend.createChannel({ channel: { slug: 'ost-pervy', title: '  Ост  ' } });

        expect(channel.slug).toBe('ost-pervy');
        expect(channel.title).toBe('Ост');
        expect(typeof channel.createdAt).toBe('number');

        const channelSnap = await rawDoc(paths.channel({ channelId: channel.channelId }));
        expect(channelSnap.exists()).toBe(true);
        const data = channelSnap.data() as Record<string, unknown>;
        expect(Object.keys(data).sort()).toEqual(['createdAt', 'serverAt', 'slug', 'title']);
        expect(data.owner).toBeUndefined();
        expect(data.slug).toBe('ost-pervy');
        expect(data.title).toBe('Ост');
        expect(data.createdAt).toBe(channel.createdAt);

        const slugSnap = await rawDoc(paths.slug({ slug: 'ost-pervy' }));
        expect(slugSnap.exists()).toBe(true);
        const slugData = slugSnap.data() as Record<string, unknown>;
        expect(Object.keys(slugData).sort()).toEqual(['channelId', 'createdAt']);
        expect(slugData.channelId).toBe(channel.channelId);
    });

    test('занятый адрес — slug-taken, исходный канал не переписывается', async () => {
        const backend = backendAs('u-taken');
        const { channel: first } = await backend.createChannel({ channel: { slug: 'zanyato', title: 'Первый' } });

        await failsWith(() => backend.createChannel({ channel: { slug: 'zanyato', title: 'Второй' } }), 'slug-taken');

        const slugSnap = await rawDoc(paths.slug({ slug: 'zanyato' }));
        expect((slugSnap.data() as { channelId: string }).channelId).toBe(first.channelId);

        const channelSnap = await rawDoc(paths.channel({ channelId: first.channelId }));
        expect((channelSnap.data() as { title: string }).title).toBe('Первый');
    });

    test('адрес неправильной формы — slug-invalid, в базе ничего не остаётся', async () => {
        const backend = backendAs('u-invalid');

        await failsWith(
            () => backend.createChannel({ channel: { slug: 'Неверно Так!', title: 'Как-то' } }),
            'slug-invalid'
        );

        expect((await rawCollection(paths.channels())).empty).toBe(true);
        expect((await rawCollection(paths.slugs())).empty).toBe(true);
    });
});

describe('чтение канала', () => {
    test('getChannelBySlug находит заведённый канал', async () => {
        const backend = backendAs('u-read');
        const { channel } = await backend.createChannel({ channel: { slug: 'naiden', title: 'Найден' } });

        const snapshot = await backend.getChannelBySlug({ slug: 'naiden' });
        expect(snapshot?.channel.channelId).toBe(channel.channelId);
        expect(snapshot?.channel.slug).toBe('naiden');
        expect(snapshot?.members).toEqual([]);
        expect(snapshot?.messages).toEqual([]);
    });

    test('getChannelBySlug на чужой адрес — null', async () => {
        const backend = backendAs('u-read-2');
        expect(await backend.getChannelBySlug({ slug: 'net-takogo-adresa' })).toBeNull();
    });

    test('getChannel по несуществующему channelId — null', async () => {
        const backend = backendAs('u-read-3');
        expect(await backend.getChannel({ channelId: 'net-takogo-kanala' })).toBeNull();
    });

    // Пишем участников и сообщения в обратном порядке — так проверка ловит настоящую
    // сортировку по joinedAt/sentAt, а не случайное совпадение с порядком записи в базу.
    test('участники по времени входа, лента по времени отправки, старший из документа канала', async () => {
        const ownerUid = 'owner-full';
        await seedDoc(paths.channel({ channelId: 'ch-full' }), {
            slug: 'polny-kanal',
            title: 'Полный канал',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedMember('ch-full', 'm-second', 'Младший', '002', 2000);
        await seedMember('ch-full', ownerUid, 'Старший', '001', 1000);

        await seedDoc(paths.message({ channelId: 'ch-full', messageId: 'msg-second' }), {
            author: { memberId: 'm-second', look: { name: 'Младший', hullNumber: '002', color: '#8ecae6' } },
            sentAt: 2000,
            text: 'Второе по счёту',
        });
        // Системную запись клиенту не завести — kind и notice пишет только сервер (см.
        // firestore.rules, messages.create) — здесь она нужна готовой, для проверки разбора.
        await seedDoc(paths.message({ channelId: 'ch-full', messageId: 'msg-first' }), {
            author: { memberId: ownerUid, look: { name: 'Старший', hullNumber: '001', color: '#8ecae6' } },
            sentAt: 1000,
            kind: 'system',
            notice: { event: 'joined', before: { shipKind: 'pr1234', name: 'Старший', hullNumber: '001' } },
        });

        const backend = backendAs('u-reader');
        const snapshot = await backend.getChannel({ channelId: 'ch-full' });

        expect(snapshot?.channel.owner?.memberId).toBe(ownerUid);
        expect(snapshot?.members.map((member) => member.memberId)).toEqual([ownerUid, 'm-second']);
        expect(snapshot?.messages.map((message) => message.messageId)).toEqual(['msg-first', 'msg-second']);

        const [first, second] = snapshot!.messages;
        expect(first.kind).toBe('system');
        if (first.kind === 'system') {
            expect(first.notice.event).toBe('joined');
            expect(first.notice.before.name).toBe('Старший');
        }
        expect(second.kind).toBeUndefined();
        if (second.kind === undefined) {
            expect(second.text).toBe('Второе по счёту');
        }
    });
});

describe('updateChannel', () => {
    test('переименование заводит новую бронь, снимает старую, освободившийся адрес переиспользуется', async () => {
        const ownerUid = 'owner-rename';
        await seedDoc(paths.channel({ channelId: 'ch-rename' }), {
            slug: 'staryi-adres',
            title: 'Старое название',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.slug({ slug: 'staryi-adres' }), { channelId: 'ch-rename', createdAt: 1 });

        const backend = backendAs(ownerUid);
        const { channel } = await backend.updateChannel({
            channelId: 'ch-rename',
            channel: { slug: 'novyi-adres', title: '  Новое название  ' },
        });
        expect(channel.slug).toBe('novyi-adres');
        expect(channel.title).toBe('Новое название');

        const newSlugSnap = await rawDoc(paths.slug({ slug: 'novyi-adres' }));
        expect(newSlugSnap.exists()).toBe(true);
        expect((newSlugSnap.data() as { channelId: string }).channelId).toBe('ch-rename');

        const oldSlugSnap = await rawDoc(paths.slug({ slug: 'staryi-adres' }));
        expect(oldSlugSnap.exists()).toBe(false);

        // Освободившийся адрес и правда свободен — на него заводится другой канал.
        const other = backendAs('u-reuse');
        const { channel: reused } = await other.createChannel({
            channel: { slug: 'staryi-adres', title: 'Другой канал' },
        });
        expect(reused.slug).toBe('staryi-adres');
    });

    test('переименование в адрес другого канала — slug-taken, старая бронь цела', async () => {
        const ownerUid = 'owner-conflict';
        await seedDoc(paths.channel({ channelId: 'ch-a' }), {
            slug: 'a-adres',
            title: 'А',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.slug({ slug: 'a-adres' }), { channelId: 'ch-a', createdAt: 1 });
        await seedDoc(paths.channel({ channelId: 'ch-b' }), { slug: 'b-adres', title: 'Б', createdAt: 1 });
        await seedDoc(paths.slug({ slug: 'b-adres' }), { channelId: 'ch-b', createdAt: 1 });

        const backend = backendAs(ownerUid);
        await failsWith(
            () => backend.updateChannel({ channelId: 'ch-a', channel: { slug: 'b-adres', title: 'А переименован' } }),
            'slug-taken'
        );

        expect((await rawDoc(paths.slug({ slug: 'a-adres' }))).exists()).toBe(true);

        const bSlugSnap = await rawDoc(paths.slug({ slug: 'b-adres' }));
        expect((bSlugSnap.data() as { channelId: string }).channelId).toBe('ch-b');

        const aChannelSnap = await rawDoc(paths.channel({ channelId: 'ch-a' }));
        expect((aChannelSnap.data() as { slug: string }).slug).toBe('a-adres');
    });

    test('переименование несуществующего канала — channel-not-found', async () => {
        const backend = backendAs('u-none');
        await failsWith(
            () =>
                backend.updateChannel({
                    channelId: 'net-takogo-kanala',
                    channel: { slug: 'kakoy-to', title: 'Неважно' },
                }),
            'channel-not-found'
        );
    });
});

describe('подписка на канал', () => {
    test('первый снимок молчит, следующая правка канала присылает channel-updated со старшим', async () => {
        const ownerUid = 'owner-sub';
        const backend = backendAs(ownerUid);
        const { channel } = await backend.createChannel({ channel: { slug: 'podpiska', title: 'Подписка' } });
        // Старшего правило писать отсюда не даёт (назначает сервер) — дописываем в обход,
        // тем же приёмом, что и в rules.test.ts; join здесь не участвует (см. header-комментарий).
        await seedOwner(channel.channelId, ownerUid);

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });

        // Первый снимок onSnapshot — состояние, а не событие; ждём и убеждаемся, что подписка
        // молчит, прежде чем что-то менять.
        await sleep(400);
        expect(events).toHaveLength(0);

        await backend.updateChannel({
            channelId: channel.channelId,
            channel: { slug: 'podpiska', title: 'Другое название' },
        });

        // Своя же запись через onSnapshot иногда приходит двумя снимками: сразу же,
        // неподтверждённой сервером (metadata.hasPendingWrites), и снова, когда сервер её
        // подтвердил. У транзакции (runTransaction) этой развилки нет: в отличие от setDoc
        // и updateDoc, у неё нет отдельной локальной, ещё не подтверждённой фазы — её промис
        // и так не решается, пока сервер не ответит, — так что здесь достаточно снимка одного.
        // Ждём с запасом и сверяем итоговый счёт, а не гадаем по первому пришедшему.
        await expect.poll(() => events.length, { timeout: 5000, interval: 50 }).toBeGreaterThan(0);
        await sleep(500);

        expect(events).toHaveLength(1);
        const [event] = events;
        expect(event.type).toBe('channel-updated');
        if (event.type === 'channel-updated') {
            expect(event.channel.title).toBe('Другое название');
            expect(event.channel.owner?.memberId).toBe(ownerUid);
        }

        unsubscribe();
    }, 15000);

    test('после отписки следующая правка канала уже не приходит', async () => {
        const ownerUid = 'owner-unsub';
        const backend = backendAs(ownerUid);
        const { channel } = await backend.createChannel({ channel: { slug: 'otpiska', title: 'Отписка' } });
        await seedOwner(channel.channelId, ownerUid);

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });
        await sleep(400); // пропускаем первый снимок

        unsubscribe();

        await backend.updateChannel({
            channelId: channel.channelId,
            channel: { slug: 'otpiska', title: 'После отписки' },
        });
        await sleep(500);

        expect(events).toHaveLength(0);
    }, 15000);
});

describe('подписка на участников', () => {
    test('первый снимок молчит, потом раздельные события на вход, правку и уход', async () => {
        const backend = backendAs('u-members-sub');
        const { channel } = await backend.createChannel({ channel: { slug: 'uchastniki', title: 'Участники' } });

        // Уже стоящий на рейде корабль — чтобы в первом снимке подписки было что пропускать:
        // без него подписка и так начиналась бы с пустого списка, и «первый снимок молчит»
        // проверялось бы вырожденным случаем, а не настоящим пропуском состояния.
        await seedMember(channel.channelId, 'm-already', 'Дозорный', '000', 500);

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });

        await sleep(400);
        expect(events).toHaveLength(0);

        await seedMember(channel.channelId, 'm-new', 'Новичок', '001', 1000);
        await expect.poll(() => events.length, { timeout: 5000, interval: 50 }).toBeGreaterThan(0);
        await sleep(300);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('member-joined');
        if (events[0].type === 'member-joined') {
            expect(events[0].member.memberId).toBe('m-new');
            expect(events[0].member.name).toBe('Новичок');
        }

        // Правка — тот же документ, другое содержимое; правило разрешает клиенту менять
        // только lastSeen, но запись здесь идёт в обход правил (см. header-комментарий),
        // а подписке всё равно, кто написал, — ей важно только что документ изменился.
        await seedDoc(paths.member({ channelId: channel.channelId, memberId: 'm-new' }), {
            name: 'Переименован',
            hullNumber: '001',
            shipKind: 'pr1234',
            color: '#8ecae6',
            place: { slot: 0, corridor: 'center', left: 50, facing: 'left', enterFrom: 'right' },
            joinedAt: 1000,
            user: { userId: 'm-new' },
        });
        await expect.poll(() => events.length, { timeout: 5000, interval: 50 }).toBeGreaterThan(1);
        await sleep(300);
        expect(events).toHaveLength(2);
        expect(events[1].type).toBe('member-updated');
        if (events[1].type === 'member-updated') {
            expect(events[1].member.name).toBe('Переименован');
        }

        await dropDoc(paths.member({ channelId: channel.channelId, memberId: 'm-new' }));
        await expect.poll(() => events.length, { timeout: 5000, interval: 50 }).toBeGreaterThan(2);
        await sleep(300);
        expect(events).toHaveLength(3);
        expect(events[2].type).toBe('member-left');
        if (events[2].type === 'member-left') {
            expect(events[2].member.memberId).toBe('m-new');
        }

        unsubscribe();
    }, 20000);
});

describe('подписка на ленту', () => {
    test('новое сообщение — message-added, подтверждение serverAt — тишина', async () => {
        const memberId = 'u-feed-sub';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'lenta', title: 'Лента' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });
        await sleep(400);
        expect(events).toHaveLength(0);

        await backend.sendMessage({
            channelId: channel.channelId,
            memberId,
            message: { text: 'Приняли ветер в правый борт' },
        });

        // Своя запись (setDoc) может дойти и одним снимком, и двумя — сразу же, ещё
        // не подтверждённой сервером, и снова, когда serverAt проставлен взамен временной
        // пустоты. Второй снимок подписка отдаёт молчанием (см. firebaseBackend.ts,
        // комментарий у modified в подписке на ленту), так что итог не зависит от того,
        // сколько снимков пришло на самом деле, — событие должно остаться одно.
        await expect.poll(() => events.length, { timeout: 5000, interval: 50 }).toBeGreaterThan(0);
        await sleep(500);

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('message-added');
        if (events[0].type === 'message-added') {
            expect(events[0].message.kind).toBeUndefined();
            if (events[0].message.kind === undefined) {
                expect(events[0].message.text).toBe('Приняли ветер в правый борт');
            }
        }

        unsubscribe();
    }, 15000);
});

describe('sendMessage', () => {
    test('пишет документ со снимком автора и отвечает тем же сообщением', async () => {
        const memberId = 'u-send';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'otpravka', title: 'Отправка' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        const { message } = await backend.sendMessage({
            channelId: channel.channelId,
            memberId,
            message: { text: 'Курс норд-ост' },
        });

        expect(message.kind).toBeUndefined();
        if (message.kind === undefined) {
            expect(message.text).toBe('Курс норд-ост');
        }
        expect(message.author.memberId).toBe(memberId);
        expect(message.author.look?.name).toBe('Связист');
        expect(typeof message.sentAt).toBe('number');

        const raw = await rawDoc(paths.message({ channelId: channel.channelId, messageId: message.messageId }));
        expect(raw.exists()).toBe(true);
        const data = raw.data() as Record<string, unknown>;
        // Ровно то, что разрешает правило (firestore.rules, match /messages/{messageId}):
        // ни kind, ни notice клиентской записи не положено, thread не задан и потому не пишется.
        expect(Object.keys(data).sort()).toEqual(['author', 'sentAt', 'serverAt', 'text']);
        expect((data.author as { memberId: string }).memberId).toBe(memberId);
        expect(data.text).toBe('Курс норд-ост');
    });

    test('слишком длинный текст — message-too-long, в базе ничего не остаётся', async () => {
        const memberId = 'u-send-long';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'dlinnoe', title: 'Длинное' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        const text = 'ы'.repeat(MAX_MESSAGE_LENGTH + 1);
        await failsWith(
            () => backend.sendMessage({ channelId: channel.channelId, memberId, message: { text } }),
            'message-too-long'
        );

        expect((await rawCollection(paths.messages({ channelId: channel.channelId }))).empty).toBe(true);
    });
});
