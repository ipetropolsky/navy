/**
 * Проверки бэкенда каналов на Firestore (`createFirebaseBackend`, issue #65) — против
 * настоящего эмулятора, а не заглушки. Приём тот же, что и в firestore/rules.test.ts:
 * `@firebase/rules-unit-testing` поднимает эмулятор и правила из корневого firestore.rules,
 * `testEnv.authenticatedContext(uid).firestore()` даёт подключение — то же самое, какое
 * в `createFirebaseBackend({ db })` получает и приложение. Раз правила настоящие, а не
 * отключены и не пересказаны своими словами, каждая проверка заодно доказывает, что сам
 * бэкенд их не нарушает: слушается их, а не полагается на то, что рядом стоит обход.
 *
 * Рейд ещё не переехал (см. docs/FIREBASE.md, «План по шагам») — внутри `createFirebaseBackend`
 * по-прежнему стоит `createLocalBackend()`, а тот держит состояние в `localStorage` и ходит
 * за часами в `window.setTimeout`. В node этого окна нет, и без него состояние эмулятора
 * не переживает даже один вызов: каждое чтение находило бы хранилище пустым и заводило бы
 * заново демо-канал, а любая запись молча терялась бы — `localStore` из utils/storage.ts
 * глотает такие ошибки нарочно, ради приватного режима браузера, и в node делает то же самое.
 * Поэтому в `beforeEach` подставлено окно с фальшивым `localStorage` — тем же приёмом, что
 * и в `localBackend.test.ts`. `BroadcastChannel` в node есть настоящий, но самому себе он
 * доставляет по проводу и отдельным тиком, а `localBackend.ts` и без провода отдаёт событие
 * подписчикам синхронно (см. `deliver` внутри `emit`) — так что здесь провод без надобности,
 * и на время файла его нет вовсе.
 *
 * Старшего (`owner`) канала правила писать отсюда не дают: назначает его сервер, и появится
 * это на #66. Там, где для проверки нужен старший (переименование), документ заводится
 * в обход правил — `seedDoc`, тем же приёмом, что и в rules.test.ts.
 */
import { readFileSync } from 'fs';
import path from 'path';

import { RulesTestContext, RulesTestEnvironment, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
    DocumentSnapshot,
    Firestore,
    QuerySnapshot,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createFirebaseBackend } from '@/backend/firebaseBackend';
import { ChannelBackend, ChannelError, ChannelEvent, MemberDraft } from '@/backend/types';
import { paths } from '@shared/config/model';

const PROJECT_ID = 'demo-navy-channels';

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

// ---- окно для встроенного локального бэкенда (рейд, см. header-комментарий) ----

const shelf = new Map<string, string>();

const fakeStorage = {
    getItem: (key: string): string | null => shelf.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        shelf.set(key, value);
    },
    removeItem: (key: string): void => {
        shelf.delete(key);
    },
};

/** Настоящий BroadcastChannel из node — откладываем на время файла и возвращаем после. */
const nativeBroadcastChannel = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

beforeEach(() => {
    shelf.clear();
    (globalThis as unknown as { window: unknown }).window = {
        localStorage: fakeStorage,
        setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    };
    delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
});

afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = nativeBroadcastChannel;
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

/** Бэкенд от имени вошедшего с этим uid — тем самым подключением, что получит приложение. */
const backendAs = (uid: string): ChannelBackend =>
    createFirebaseBackend({ db: emulatorDb(testEnv.authenticatedContext(uid)) });

/**
 * Документ в обход правил — как в firestore/rules.test.ts: заводим данные, от которых
 * зависит проверка, а не действие, которое проверяем.
 */
const seedDoc = (docPath: string, data: Record<string, unknown>): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) => setDoc(doc(emulatorDb(context), docPath), data));

/**
 * Дописать старшего в уже существующий документ канала — в обход правил, тем же приёмом.
 * Нужно там, где канал заводится по-настоящему, через backend.createChannel (значит, без
 * owner — его пишет только сервер, а это #66), но дальше проверке требуется старший, чтобы
 * прошло правило isOwner на update. merge, а не перезапись: остальные поля документа трогать
 * не нужно.
 */
const seedOwner = (channelId: string, memberId: string): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) =>
        updateDoc(doc(emulatorDb(context), paths.channel({ channelId })), { owner: { memberId } })
    );

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

const memberDraft = (name: string, hullNumber: string): MemberDraft => ({
    name,
    hullNumber,
    shipKind: 'pr1234',
    color: '#8ecae6',
});

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

describe('subscribe', () => {
    test('первый снимок молчит, следующая правка канала присылает channel-updated со старшим из зеркала', async () => {
        const ownerUid = 'owner-sub';
        const backend = backendAs(ownerUid);
        const { channel } = await backend.createChannel({ channel: { slug: 'podpiska', title: 'Подписка' } });
        // Вступаем первым — у канала появляется старший в зеркале, и событие ниже должно
        // донести его, а не потерять: раз оно сведено с зеркалом, а не взято из Firestore
        // сырым, старший должен в нём остаться. Этот memberId — местный, зеркальный,
        // и нарочно не совпадает с ownerUid из seedOwner ниже: событие должно донести
        // именно его, а не то, что подставлено в Firestore для правила.
        const { member } = await backend.join({ channelId: channel.channelId, member: memberDraft('Флагман', '001') });
        // Старшего в самом Firestore правило требует для update (isOwner), а появится он там
        // только на #66 — пока дописываем в обход правил, тем же приёмом, что и в rules.test.ts.
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
            // Сведено с зеркалом: старший — местный member.memberId, а не ownerUid
            // из Firestore. Раздельные значения делают проверку однозначной — совпади
            // событие с сырым документом, тут стояло бы ownerUid, а не member.memberId.
            expect(event.channel.owner?.memberId).toBe(member.memberId);
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
