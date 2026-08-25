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
    Timestamp,
    collection,
    deleteDoc,
    disableNetwork,
    doc,
    enableNetwork,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { Functions, getFunctions } from 'firebase/functions';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createFirebaseBackend } from '@/backend/firebaseBackend';
import { putOutboxMessage, readOutbox } from '@/backend/outbox';
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
 * Сообщение в обход правил, с точным sentAt — чтобы страницы `loadOlderMessages` резались
 * по известным границам, а не по тому, как быстро отвечает эмулятор на настоящий sendMessage.
 */
const seedMessage = (channelId: string, messageId: string, sentAt: number, text: string): Promise<void> =>
    seedDoc(paths.message({ channelId, messageId }), {
        author: { memberId: 'seed-author', look: { name: 'Сеятель', hullNumber: '000', color: '#8ecae6' } },
        sentAt,
        text,
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

describe('loadOlderMessages', () => {
    test('страницы поднимаются по цепочке до начала разговора, hasMore ложно только на последней', async () => {
        const backend = backendAs('u-page');
        const { channel } = await backend.createChannel({ channel: { slug: 'stranitsy', title: 'Страницы' } });
        const base = 1_700_000_000_000;
        // sentAt строго по возрастанию индекса — порядок страниц предсказан заранее и сверяется
        // ниже поштучно, а не просто длиной ответа.
        await Promise.all(
            [...Array(12).keys()].map((i) =>
                seedMessage(channel.channelId, `msg-${i}`, base + i * 1000, `Реплика ${i}`)
            )
        );

        const page1 = await backend.loadOlderMessages({
            channelId: channel.channelId,
            before: { messageId: 'msg-11' },
            limit: 5,
        });
        expect(page1.messages.map((message) => message.messageId)).toEqual([
            'msg-6',
            'msg-7',
            'msg-8',
            'msg-9',
            'msg-10',
        ]);
        expect(page1.hasMore).toBe(true);

        const page2 = await backend.loadOlderMessages({
            channelId: channel.channelId,
            before: { messageId: 'msg-6' },
            limit: 5,
        });
        expect(page2.messages.map((message) => message.messageId)).toEqual([
            'msg-1',
            'msg-2',
            'msg-3',
            'msg-4',
            'msg-5',
        ]);
        // Дальше него ровно один документ (msg-0) — «плюс один» его застаёт, и это законное
        // hasMore: true, а не перебор мимо конца.
        expect(page2.hasMore).toBe(true);

        const page3 = await backend.loadOlderMessages({
            channelId: channel.channelId,
            before: { messageId: 'msg-1' },
            limit: 5,
        });
        expect(page3.messages.map((message) => message.messageId)).toEqual(['msg-0']);
        expect(page3.hasMore).toBe(false);
    });

    test('before не нашёлся в базе — пустой ответ, а не отказ', async () => {
        const backend = backendAs('u-page-missing');
        const { channel } = await backend.createChannel({ channel: { slug: 'net-kursora', title: 'Нет курсора' } });

        const page = await backend.loadOlderMessages({
            channelId: channel.channelId,
            before: { messageId: 'net-takogo-soobshcheniya' },
        });
        expect(page).toEqual({ messages: [], hasMore: false });
    });

    test('курсор различает соседей с одинаковым sentAt до миллисекунды', async () => {
        const backend = backendAs('u-page-tie');
        const { channel } = await backend.createChannel({ channel: { slug: 'sovpadenie', title: 'Совпадение' } });
        const tie = 1_700_000_000_000;
        // Оба совпадают по sentAt до миллисекунды — числовой startAfter не отличил бы их
        // друг от друга и потерял бы либо msg-tied-a, либо оба разом (см. комментарий
        // у loadOlderMessages в firebaseBackend.ts). msg-newer старше по sentAt — она задаёт
        // границу первой страницы.
        await seedMessage(channel.channelId, 'msg-tied-a', tie, 'Первая из пары');
        await seedMessage(channel.channelId, 'msg-tied-b', tie, 'Вторая из пары');
        await seedMessage(channel.channelId, 'msg-newer', tie + 1000, 'Самая новая');

        // Порядок между msg-tied-a и msg-tied-b здесь не важен: какая из них окажется
        // «первой после msg-newer», решает Firestore (сортировка по имени документа
        // при равенстве sentAt), а не эта проверка. Важно, что после неё в базе не осталось
        // ни потерянных, ни задвоенных строк, — это и проверяет docs.map() ниже.
        const [tied] = (
            await backend.loadOlderMessages({
                channelId: channel.channelId,
                before: { messageId: 'msg-newer' },
                limit: 1,
            })
        ).messages;
        expect(['msg-tied-a', 'msg-tied-b']).toContain(tied.messageId);
        const other = tied.messageId === 'msg-tied-a' ? 'msg-tied-b' : 'msg-tied-a';

        // Курсор — по этому самому документу с sentAt=tie, а не по числу tie: следующий вызов
        // обязан вернуть именно оставшегося соседа, а не пустоту и не его же самого повторно.
        const rest = await backend.loadOlderMessages({
            channelId: channel.channelId,
            before: { messageId: tied.messageId },
            limit: 1,
        });
        expect(rest.messages.map((message) => message.messageId)).toEqual([other]);
        expect(rest.hasMore).toBe(false);
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
    test('новое сообщение приходит со статусом pending (hasPendingWrites), подтверждение сервера — отдельным событием без него', async () => {
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

        // Своя запись (setDoc) доходит до подписки локальным эхом раньше, чем сервер её
        // подтвердит: сперва message-added со значком «в пути» (metadata.hasPendingWrites,
        // см. firebaseBackend.ts, subscribe), потом подтверждение — уже без него. Ждём именно
        // подтверждения, а не первого пришедшего события: порог — про то, что подписка
        // не замолчала насовсем, а не про то, сколько именно снимков пришло.
        await expect
            .poll(
                () =>
                    events.some(
                        (event) =>
                            (event.type === 'message-added' || event.type === 'message-updated') &&
                            event.message.delivery === undefined
                    ),
                { timeout: 5000, interval: 50 }
            )
            .toBe(true);
        await sleep(300);

        // Первым подписка узнаёт о сообщении всегда через message-added — будь оно тут же
        // подтверждённым (сервер успел раньше, чем дошёл до слушателя первый снимок) или ещё
        // в пути; в этой связке (свой же клиент почти сразу за отправкой) оно приходит именно
        // «в пути» — так и проверяем, а не гадаем между двумя вариантами.
        expect(events[0].type).toBe('message-added');
        const [added, ...rest] = events;
        let addedMessageId = '';
        if (added.type === 'message-added') {
            addedMessageId = added.message.messageId;
            expect(added.message.kind).toBeUndefined();
            if (added.message.kind === undefined) {
                expect(added.message.text).toBe('Приняли ветер в правый борт');
            }
            expect(added.message.delivery).toEqual({ status: 'pending' });
        }

        // Дальше — только подтверждения того же сообщения, без значка. Подтверждает и сама
        // подписка (настоящее modified у Firestore), и sendMessage синтетикой изнутри
        // (см. settleDelivery) — оба несут одни и те же данные, повторное применение одного
        // и того же не вредит (см. комментарий у settleDelivery в firebaseBackend.ts), и здесь
        // важно не их число, а то, что ни одно не рассказывает что-то другое.
        expect(rest.length).toBeGreaterThan(0);
        for (const event of rest) {
            expect(event.type).toBe('message-updated');
            if (event.type === 'message-updated') {
                expect(event.message.messageId).toBe(addedMessageId);
                expect(event.message.delivery).toBeUndefined();
                expect(event.message.kind).toBeUndefined();
                if (event.message.kind === undefined) {
                    expect(event.message.text).toBe('Приняли ветер в правый борт');
                }
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

    test('serverAt — настоящая серверная метка, отдельная от sentAt', async () => {
        const memberId = 'u-server-at';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'server-at', title: 'ServerAt' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        const before = Date.now();
        const { message } = await backend.sendMessage({
            channelId: channel.channelId,
            memberId,
            message: { text: 'Метка времени' },
        });
        const after = Date.now();

        const raw = await rawDoc(paths.message({ channelId: channel.channelId, messageId: message.messageId }));
        const data = raw.data() as Record<string, unknown>;

        // sentAt — клиентские часы, то же число, что уже вернул ответ.
        expect(data.sentAt).toBe(message.sentAt);
        expect(data.sentAt).toBeGreaterThanOrEqual(before);
        expect(data.sentAt).toBeLessThanOrEqual(after);

        // serverAt — не число и не то же самое значение, а настоящая Timestamp, проставленная
        // сервером при подтверждении записи (serverTimestamp()); к моменту чтения она уже
        // разрешилась, иначе документа с этим полем не было бы вовсе (см. комментарий
        // у MessageDoc в firebaseBackend.ts).
        expect(data.serverAt).toBeInstanceOf(Timestamp);
        const serverAtMs = (data.serverAt as Timestamp).toMillis();
        expect(serverAtMs).toBeGreaterThanOrEqual(before);
        // Проверка и эмулятор — один процесс на одной машине: секунды между часами разойтись
        // не должны, если это вообще одна и та же запись.
        expect(Math.abs(serverAtMs - (data.sentAt as number))).toBeLessThan(5000);
    });
});

describe('задержка доставки', () => {
    test('чужая реплика доходит до соседней вкладки за доли секунды', async () => {
        const senderId = 'u-latency-sender';
        const listenerId = 'u-latency-listener';
        const sender = backendAs(senderId);
        const listener = backendAs(listenerId);
        const { channel } = await sender.createChannel({ channel: { slug: 'zaderzhka', title: 'Задержка' } });
        await seedMember(channel.channelId, senderId, 'Отправитель', '001', 100);

        // «Соседняя вкладка» — тот же канал, но своя подписка от другого uid: ровно то, чем
        // была бы вторая вкладка чужого человека в этом канале.
        let onDelivered: (() => void) | null = null;
        const delivered = new Promise<void>((resolve) => {
            onDelivered = resolve;
        });
        const unsubscribe = listener.subscribe({
            channelId: channel.channelId,
            onEvent: (event) => {
                if (event.type === 'message-added') {
                    onDelivered?.();
                }
            },
        });
        // Первый снимок подписки — не событие (см. «подписка на ленту» выше); отправлять
        // раньше, чем он осядет, — значит мерить не задержку доставки, а время до оседания.
        await sleep(400);

        const startedAt = performance.now();
        await sender.sendMessage({
            channelId: channel.channelId,
            memberId: senderId,
            message: { text: 'Доброй вахты' },
        });
        await delivered;
        const latencyMs = performance.now() - startedAt;

        unsubscribe();

        // Порог — не гарантия для прод-сети, а сторож от подписки, замолчавшей насовсем;
        // само число идёт в отчёт по задаче как измеренная задержка (см. «доли секунды»).
        expect(latencyMs).toBeLessThan(5000);
        // eslint-disable-next-line no-console -- число нужно в выводе прогона человеку, не только ассерту
        console.log(`[задержка доставки] сообщение дошло до соседней вкладки за ${latencyMs.toFixed(0)} мс`);
    }, 15000);
});

describe('статус отправки', () => {
    /**
     * retryMessage и discardMessage читают ящик неотправленного напрямую (см. readOutbox
     * в firebaseBackend.ts) — он и есть источник истины о том, что вкладка ещё не подтвердила.
     * Ящик живёт в sessionStorage (backend/outbox.ts), а этот набор гоняется в среде `node`
     * (см. vitest.emulator.config.ts) — настоящего окна тут нет вовсе, и без подмены
     * sessionStore (src/utils/storage.ts) молча работает вхолостую: `window` не определён,
     * try/catch внутри guarded() глотает ReferenceError, readOutbox всегда отвечает пустым
     * списком. Подмена — своя карта на ключ-значение, тот же приём, что и в outbox.test.ts
     * и localBackend.test.ts, и заведена только в этом describe: остальным проверкам файла
     * работающий ящик не нужен и не должен менять их поведение.
     */
    const shelf = new Map<string, string>();
    const fakeSessionStorage = {
        getItem: (key: string): string | null => shelf.get(key) ?? null,
        setItem: (key: string, value: string): void => {
            shelf.set(key, value);
        },
        removeItem: (key: string): void => {
            shelf.delete(key);
        },
        get length(): number {
            return shelf.size;
        },
        key: (index: number): string | null => [...shelf.keys()][index] ?? null,
    };

    beforeEach(() => {
        shelf.clear();
        (globalThis as unknown as { window: unknown }).window = { sessionStorage: fakeSessionStorage };
    });

    afterEach(() => {
        delete (globalThis as unknown as { window?: unknown }).window;
    });

    /**
     * writeTimeout короткий и намеренно детерминированный, а не «мало ли, вдруг успеет»:
     * сеть по-настоящему выключена вызовом disableNetwork (firebase/firestore) — setDoc
     * внутри attemptWrite не может долететь ни при какой нагрузке машины, пока она выключена,
     * так что 500 мс — не гонка со временем отклика, а просто «сколько ждём, прежде чем
     * сдаться» (см. firebaseBackend.ts, doc-комментарий у writeTimeout: «см.
     * firestore/backend.test.ts, «статус отправки»» — это он и есть).
     *
     * Прогрев через getChannel() — обязателен: он настоящим чтением (getDocs по составу)
     * кладёт документ участника в локальный кеш клиента, и getDoc(участника) внутри
     * sendMessage потом резолвится из кеша быстро, даже пока сеть выключена. Без прогрева
     * ChannelError бросается раньше, чем что-либо успевает попасть в ящик неотправленного
     * (см. sendMessage: `if (!base) throw …` — не успели даже прочитать участника).
     */
    const OFFLINE_TIMEOUT = 500;

    test('нет сети — sendMessage отвечает delivery failed/timeout, не бросает и не зависает; набранное остаётся в ящике', async () => {
        const memberId = 'u-delivery-offline';
        const db = emulatorDb(testEnv.authenticatedContext(memberId));
        const backend = createFirebaseBackend({ db, functions: testFunctions, writeTimeout: OFFLINE_TIMEOUT });
        const { channel } = await backend.createChannel({ channel: { slug: 'delivery-offline', title: 'Офлайн' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);
        await backend.getChannel({ channelId: channel.channelId });

        await disableNetwork(db);
        try {
            const { message } = await backend.sendMessage({
                channelId: channel.channelId,
                memberId,
                message: { text: 'В шторм без связи' },
            });

            expect(message.delivery?.status).toBe('failed');
            expect(message.delivery?.error?.code).toBe('timeout');

            // То же самое человек увидит и после «перезагрузки вкладки» — не выдумка по
            // промису, а действительно записанное в ящик неотправленного.
            const stored = readOutbox(memberId, channel.channelId);
            expect(stored).toHaveLength(1);
            expect(stored[0].messageId).toBe(message.messageId);
            expect(stored[0].delivery?.status).toBe('failed');

            // Сеть по-прежнему выключена: до сервера набранное ещё не долетело.
            expect((await rawCollection(paths.messages({ channelId: channel.channelId }))).empty).toBe(true);
        } finally {
            await enableNetwork(db);
        }
    }, 15000);

    test('подписка видит весь путь: pending (локальное эхо) → failed (не дождались) → подтверждено само, без клика', async () => {
        const memberId = 'u-delivery-lifecycle';
        const db = emulatorDb(testEnv.authenticatedContext(memberId));
        const backend = createFirebaseBackend({ db, functions: testFunctions, writeTimeout: OFFLINE_TIMEOUT });
        const { channel } = await backend.createChannel({ channel: { slug: 'delivery-lifecycle', title: 'Путь' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);
        await backend.getChannel({ channelId: channel.channelId });

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });

        await disableNetwork(db);
        let sentMessageId = '';
        try {
            const { message } = await backend.sendMessage({
                channelId: channel.channelId,
                memberId,
                message: { text: 'Курс не меняем' },
            });
            sentMessageId = message.messageId;
            expect(message.delivery?.status).toBe('failed');
        } finally {
            await enableNetwork(db);
        }

        // Без этого клика — второй раз никто ничего не нажимал: доставилось само, как
        // только вернулась сеть (см. «Готово, когда» в тексте задачи).
        await expect
            .poll(
                () =>
                    events.some(
                        (event) =>
                            event.type === 'message-updated' &&
                            event.message.messageId === sentMessageId &&
                            event.message.delivery === undefined
                    ),
                { timeout: 5000, interval: 50 }
            )
            .toBe(true);

        unsubscribe();

        expect(events[0].type).toBe('message-added');
        if (events[0].type === 'message-added') {
            expect(events[0].message.messageId).toBe(sentMessageId);
            expect(events[0].message.delivery).toEqual({ status: 'pending' });
        }

        const failedSeen = events.some(
            (event) =>
                event.type === 'message-updated' &&
                event.message.messageId === sentMessageId &&
                event.message.delivery?.status === 'failed'
        );
        expect(failedSeen).toBe(true);

        // Ровно один документ в базе, сколько бы промежуточных событий ни случилось по пути.
        const docs = await rawCollection(paths.messages({ channelId: channel.channelId }));
        expect(docs.docs).toHaveLength(1);
        expect(docs.docs[0].id).toBe(sentMessageId);
    }, 15000);

    test('повтор после отказа уходит тем же messageId — без второй копии; два клика подряд не плодят двойника', async () => {
        const memberId = 'u-delivery-retry';
        const db = emulatorDb(testEnv.authenticatedContext(memberId));
        const backend = createFirebaseBackend({ db, functions: testFunctions, writeTimeout: OFFLINE_TIMEOUT });
        const { channel } = await backend.createChannel({ channel: { slug: 'delivery-retry', title: 'Повтор' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);
        await backend.getChannel({ channelId: channel.channelId });

        await disableNetwork(db);
        let sentMessageId = '';
        try {
            const { message } = await backend.sendMessage({
                channelId: channel.channelId,
                memberId,
                message: { text: 'Повторим при случае' },
            });
            sentMessageId = message.messageId;
            expect(message.delivery?.status).toBe('failed');
        } finally {
            await enableNetwork(db);
        }

        // Два клика по значку (!) почти разом — не должны завести двойника. И не заведут:
        // запись всё это время стоит в очереди Firestore, retryMessage дожидается её
        // (waitForPendingWrites), видит документ на месте и ничего не переписывает —
        // писать заново он берётся, только когда документа нет вовсе (см. firebaseBackend.ts,
        // retryMessage). Двойника, впрочем, не вышло бы и тогда: id у повтора тот же самый,
        // а два setDoc с одним id — это один документ, не два.
        const [first, second] = await Promise.all([
            backend.retryMessage({ channelId: channel.channelId, memberId, message: { messageId: sentMessageId } }),
            backend.retryMessage({ channelId: channel.channelId, memberId, message: { messageId: sentMessageId } }),
        ]);

        expect(first.message.messageId).toBe(sentMessageId);
        expect(second.message.messageId).toBe(sentMessageId);
        expect(first.message.delivery).toBeUndefined();
        expect(second.message.delivery).toBeUndefined();

        expect(readOutbox(memberId, channel.channelId)).toEqual([]);

        const docs = await rawCollection(paths.messages({ channelId: channel.channelId }));
        expect(docs.docs).toHaveLength(1);
        expect(docs.docs[0].id).toBe(sentMessageId);
    }, 15000);

    /**
     * Ящик помнит неотправленное дольше, чем очередь Firestore, — и это не выдумка ради
     * проверки. Очередь теряет запись всякий раз, когда попытка отвалилась насовсем:
     * отказ по правилам, скажем, выбрасывает её оттуда, а в ящике она остаётся лежать
     * помеченной «не вышло», как ей и положено, — ждать клика по значку (!).
     *
     * Здесь этот расклад заводится напрямую (запись в ящик, документа нет вовсе) — так
     * короче и вернее, чем гоняться за настоящим отказом правил. Проверяем то, из-за чего
     * это вообще важно: повтор не должен верить одному лишь «очередь пуста». Поверил бы —
     * объявил бы доставленным то, чего на сервере нет, убрал бы из ящика, и сообщение
     * пропало бы молча, с видом отправленного.
     */
    test('повтор дописывает документ, если ждать в очереди уже нечего, а не объявляет доставленным', async () => {
        const memberId = 'u-delivery-retry-lost';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'retry-lost', title: 'Потерялось' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        const messageId = 'msg-poteryalos';
        putOutboxMessage(memberId, channel.channelId, {
            messageId,
            author: { memberId, look: { name: 'Связист', hullNumber: '007', color: '#8ecae6' } },
            sentAt: 1_700_000_000_000,
            text: 'Дошло со второй попытки',
            delivery: { status: 'failed', error: { code: 'timeout', message: 'Сервер долго не отвечает' } },
        });
        expect((await rawCollection(paths.messages({ channelId: channel.channelId }))).empty).toBe(true);

        const { message } = await backend.retryMessage({
            channelId: channel.channelId,
            memberId,
            message: { messageId },
        });

        expect(message.messageId).toBe(messageId);
        expect(message.delivery).toBeUndefined();
        expect(readOutbox(memberId, channel.channelId)).toEqual([]);

        // Главное: документ теперь и правда есть, тем же id и тем же текстом — доставленным
        // объявили не пустоту.
        const docs = await rawCollection(paths.messages({ channelId: channel.channelId }));
        expect(docs.docs).toHaveLength(1);
        expect(docs.docs[0].id).toBe(messageId);
        expect(docs.docs[0].data().text).toBe('Дошло со второй попытки');
        expect(docs.docs[0].data().sentAt).toBe(1_700_000_000_000);
    }, 15000);

    test('retryMessage для сообщения не из ящика — отказ unknown, а не выдумка', async () => {
        const memberId = 'u-delivery-retry-unknown';
        const backend = backendAs(memberId);
        const { channel } = await backend.createChannel({ channel: { slug: 'retry-unknown', title: 'Unknown' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);

        await failsWith(
            () =>
                backend.retryMessage({
                    channelId: channel.channelId,
                    memberId,
                    message: { messageId: 'net-takogo-v-yashike' },
                }),
            'unknown'
        );
    });

    test('discardMessage выбрасывает неотправленное из ящика и оповещает подписку — до того, как сеть вернулась', async () => {
        const memberId = 'u-delivery-discard';
        const db = emulatorDb(testEnv.authenticatedContext(memberId));
        const backend = createFirebaseBackend({ db, functions: testFunctions, writeTimeout: OFFLINE_TIMEOUT });
        const { channel } = await backend.createChannel({ channel: { slug: 'delivery-discard', title: 'Отказ' } });
        await seedMember(channel.channelId, memberId, 'Связист', '007', 100);
        await backend.getChannel({ channelId: channel.channelId });

        const events: ChannelEvent[] = [];
        const unsubscribe = backend.subscribe({ channelId: channel.channelId, onEvent: (event) => events.push(event) });

        await disableNetwork(db);
        try {
            const { message } = await backend.sendMessage({
                channelId: channel.channelId,
                memberId,
                message: { text: 'Передумал отправлять' },
            });
            expect(message.delivery?.status).toBe('failed');

            await backend.discardMessage({ channelId: channel.channelId, message: { messageId: message.messageId } });

            expect(readOutbox(memberId, channel.channelId)).toEqual([]);

            await expect
                .poll(
                    () =>
                        events.some(
                            (event) => event.type === 'message-removed' && event.message.messageId === message.messageId
                        ),
                    { timeout: 2000, interval: 50 }
                )
                .toBe(true);
        } finally {
            unsubscribe();
            await enableNetwork(db);
        }
    }, 15000);
});
