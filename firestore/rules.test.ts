/**
 * Юнит-проверки firestore.rules — против настоящего эмулятора Firestore, а не пересказа
 * правил своими словами.
 *
 * Файл лежит не в src и гоняется не обычным `npm run test`, а отдельным `npm run test:emulator`
 * (конфиг — vitest.emulator.config.ts, порт эмулятора — из firebase.json): этим проверкам нужен
 * поднятый эмулятор, а обычный набор участвует в сборке на GitHub Pages, где никакого Firebase
 * нет и поднимать эмулятор незачем. Смешать наборы значило бы тянуть Java и firebase-tools
 * в каждый прогон `npm run test`.
 *
 * Правила берутся из корневого firestore.rules файлом (`readFileSync`), а не переписаны здесь
 * текстом: переписанная копия рано или поздно разойдётся с тем, что реально уходит в бой,
 * и проверка станет защищать не те правила, что действуют на самом деле.
 */
import { readFileSync } from 'fs';
import path from 'path';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

import { paths } from '@shared/config/model';
import { ACCESS_CODE_MAX_LENGTH, MAX_MESSAGE_LENGTH, NAME_MAX_LENGTH, TITLE_MAX_LENGTH } from '@shared/types/channel';
import { SLUG_MAX_LENGTH } from '@/utils/slug';

// Проект-пустышка: настоящий Firebase-проект эмулятору не нужен, а demo-префикс — явная
// метка, что это не 'navy-chat' из .firebaserc. Тот же id стоит в `--project` у `npm run test:emulator`.
const PROJECT_ID = 'demo-navy-rules';

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

// Изоляция между проверками: у каждой — пустая база, а не хвост данных от соседней.
beforeEach(async () => {
    await testEnv.clearFirestore();
});

/**
 * Заводит документ в обход правил. Проверки в этом файле проверяют одно действие —
 * чтение, запись, — а не то, как рядом с ним появились данные, от которых это действие
 * зависит (свой канал, своя личность, чужая бронь).
 */
const seedDoc = (docPath: string, data: Record<string, unknown>): Promise<void> =>
    testEnv.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), docPath), data));

describe('firestore.rules: users/{userId}', () => {
    test('свою личность читает — почта видна только хозяину', async () => {
        const userId = 'u-1';
        await seedDoc(paths.user({ userId }), { createdAt: 1, account: { name: 'Иван' }, serverAt: serverTimestamp() });

        const owner = testEnv.authenticatedContext(userId);
        await assertSucceeds(getDoc(doc(owner.firestore(), paths.user({ userId }))));
    });

    test('чужую личность не прочитать', async () => {
        const userId = 'u-1';
        await seedDoc(paths.user({ userId }), { createdAt: 1, account: { name: 'Иван' }, serverAt: serverTimestamp() });

        const stranger = testEnv.authenticatedContext('u-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.user({ userId }))));
    });

    test('невошедшему личность не показывают', async () => {
        const userId = 'u-1';
        await seedDoc(paths.user({ userId }), { createdAt: 1, account: { name: 'Иван' }, serverAt: serverTimestamp() });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(getDoc(doc(unauthed.firestore(), paths.user({ userId }))));
    });

    test('личность заводится при первом входе — createdAt, account, serverAt', async () => {
        const userId = 'u-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertSucceeds(
            setDoc(doc(owner.firestore(), paths.user({ userId })), {
                createdAt: Date.now(),
                account: { name: 'Иван', email: 'ivan@example.com' },
                serverAt: serverTimestamp(),
            })
        );
    });

    test('лишнее поле в личности (role) не проходит', async () => {
        const userId = 'u-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertFails(
            setDoc(doc(owner.firestore(), paths.user({ userId })), {
                createdAt: Date.now(),
                account: { name: 'Иван' },
                serverAt: serverTimestamp(),
                role: 'admin',
            })
        );
    });

    test('чужую личность не переписать', async () => {
        const attacker = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(attacker.firestore(), paths.user({ userId: 'u-2' })), {
                createdAt: Date.now(),
                account: { name: 'Подмена' },
                serverAt: serverTimestamp(),
            })
        );
    });

    test('личность не стирается — за ней тянутся корабли в каналах', async () => {
        const userId = 'u-1';
        await seedDoc(paths.user({ userId }), { createdAt: 1, account: { name: 'Иван' }, serverAt: serverTimestamp() });

        const owner = testEnv.authenticatedContext(userId);
        await assertFails(deleteDoc(doc(owner.firestore(), paths.user({ userId }))));
    });

    test('личности не перебираются списком', async () => {
        await seedDoc(paths.user({ userId: 'u-1' }), { createdAt: 1, account: {}, serverAt: serverTimestamp() });

        // Даже свой собственный документ так не найти: список запрещён вообще, безусловно.
        const owner = testEnv.authenticatedContext('u-1');
        await assertFails(getDocs(collection(owner.firestore(), paths.users())));
    });

    test('слияние поверх своей личности проходит — им и запоминает вход', async () => {
        // См. rememberUser в src/backend/auth.ts: повторный вход не переписывает личность
        // целиком, а сливается поверх — createdAt в нём уже не пишут повторно.
        const userId = 'u-1';
        await seedDoc(paths.user({ userId }), {
            createdAt: 1000,
            account: { name: 'Иван' },
            serverAt: serverTimestamp(),
        });

        const owner = testEnv.authenticatedContext(userId);
        await assertSucceeds(
            setDoc(
                doc(owner.firestore(), paths.user({ userId })),
                { account: { name: 'Иван', email: 'ivan@example.com' }, serverAt: serverTimestamp() },
                { merge: true }
            )
        );
    });

    test('createdAt строкой вместо числа не проходит', async () => {
        const owner = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(owner.firestore(), paths.user({ userId: 'u-1' })), {
                createdAt: String(Date.now()),
                account: { name: 'Иван' },
                serverAt: serverTimestamp(),
            })
        );
    });

    test('лишний ключ внутри account (phone) не проходит', async () => {
        const owner = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(owner.firestore(), paths.user({ userId: 'u-1' })), {
                createdAt: Date.now(),
                account: { name: 'Иван', phone: '+70000000000' },
                serverAt: serverTimestamp(),
            })
        );
    });

    test('serverAt числом вместо serverTimestamp() у личности не проходит', async () => {
        const owner = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(owner.firestore(), paths.user({ userId: 'u-1' })), {
                createdAt: Date.now(),
                account: { name: 'Иван' },
                serverAt: Date.now(),
            })
        );
    });
});

describe('firestore.rules: users/{userId}/channels/{channelId}', () => {
    test('реестр участий читает только хозяин, и списком тоже', async () => {
        const userId = 'u-1';
        const channelId = 'ch-1';
        await seedDoc(paths.userChannel({ userId, channelId }), { memberId: userId, joinedAt: 1 });

        const owner = testEnv.authenticatedContext(userId);
        await assertSucceeds(getDoc(doc(owner.firestore(), paths.userChannel({ userId, channelId }))));
        await assertSucceeds(getDocs(collection(owner.firestore(), paths.userChannels({ userId }))));
    });

    test('чужой реестр участий не прочитать', async () => {
        const userId = 'u-1';
        const channelId = 'ch-1';
        await seedDoc(paths.userChannel({ userId, channelId }), { memberId: userId, joinedAt: 1 });

        const stranger = testEnv.authenticatedContext('u-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.userChannel({ userId, channelId }))));
    });

    test('реестр участий не пишет клиент — даже свой', async () => {
        const userId = 'u-1';
        const channelId = 'ch-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertFails(
            setDoc(doc(owner.firestore(), paths.userChannel({ userId, channelId })), {
                memberId: userId,
                joinedAt: Date.now(),
            })
        );
    });
});

describe('firestore.rules: users/{userId}/ships/{shipId}', () => {
    // Корабль, каким его завели, — ровно то, что пишет rememberLook в src/backend/auth.ts.
    const ship = { name: 'Дозорный', hullNumber: '007', shipKind: 'pr1234', color: '#8ecae6', channelId: 'ch-1' };

    test('хозяин заводит корабль в своей истории — и читает её же, списком', async () => {
        const userId = 'u-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertSucceeds(
            setDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' })), {
                ...ship,
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
        await assertSucceeds(getDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' }))));
        await assertSucceeds(getDocs(collection(owner.firestore(), paths.userShips({ userId }))));
    });

    test('в чужую историю кораблей не записаться', async () => {
        const attacker = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(attacker.firestore(), paths.userShip({ userId: 'u-2', shipId: 'sh-1' })), {
                ...ship,
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('чужую историю кораблей не прочитать — ни по одному, ни списком', async () => {
        const userId = 'u-1';
        await seedDoc(paths.userShip({ userId, shipId: 'sh-1' }), {
            ...ship,
            createdAt: 1,
            serverAt: serverTimestamp(),
        });

        const stranger = testEnv.authenticatedContext('u-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.userShip({ userId, shipId: 'sh-1' }))));
        await assertFails(getDocs(collection(stranger.firestore(), paths.userShips({ userId }))));
    });

    test('лишнее поле в корабле (note) не проходит', async () => {
        const userId = 'u-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertFails(
            setDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' })), {
                ...ship,
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                note: 'лишнее',
            })
        );
    });

    test('serverAt без serverTimestamp() не проходит', async () => {
        const userId = 'u-1';
        const owner = testEnv.authenticatedContext(userId);

        await assertFails(
            setDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' })), {
                ...ship,
                createdAt: Date.now(),
                serverAt: Date.now(),
            })
        );
    });

    test('заведённый корабль не переписать', async () => {
        const userId = 'u-1';
        await seedDoc(paths.userShip({ userId, shipId: 'sh-1' }), {
            ...ship,
            createdAt: 1,
            serverAt: serverTimestamp(),
        });

        const owner = testEnv.authenticatedContext(userId);
        await assertFails(
            updateDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' })), { color: '#000000' })
        );
    });

    test('заведённый корабль не стереть', async () => {
        const userId = 'u-1';
        await seedDoc(paths.userShip({ userId, shipId: 'sh-1' }), {
            ...ship,
            createdAt: 1,
            serverAt: serverTimestamp(),
        });

        const owner = testEnv.authenticatedContext(userId);
        await assertFails(deleteDoc(doc(owner.firestore(), paths.userShip({ userId, shipId: 'sh-1' }))));
    });
});

describe('firestore.rules: slugs/{slug}', () => {
    test('бронь адреса читается по ключу кем угодно, включая невошедшего', async () => {
        const slug = 'nord';
        await seedDoc(paths.slug({ slug }), { channelId: 'ch-1', createdAt: 1 });

        const unauthed = testEnv.unauthenticatedContext();
        await assertSucceeds(getDoc(doc(unauthed.firestore(), paths.slug({ slug }))));
    });

    test('брони не перебираются списком — иначе так нашлись бы все каналы разом', async () => {
        await seedDoc(paths.slug({ slug: 'nord' }), { channelId: 'ch-1', createdAt: 1 });

        const someone = testEnv.authenticatedContext('u-1');
        await assertFails(getDocs(collection(someone.firestore(), paths.slugs())));
    });

    test('вошедший заводит бронь адреса — вместе с каналом, одним батчем', async () => {
        // Ровно то, что делает createChannel: бронь и канал пишутся одной атомарной
        // операцией, поэтому existsAfter() в правиле видит канал уже существующим.
        const sailor = testEnv.authenticatedContext('u-1');
        const channelId = 'ch-1';
        const slug = 'ost';

        const batch = writeBatch(sailor.firestore());
        batch.set(doc(sailor.firestore(), paths.channel({ channelId })), {
            slug,
            title: 'Ост',
            createdAt: Date.now(),
            serverAt: serverTimestamp(),
        });
        batch.set(doc(sailor.firestore(), paths.slug({ slug })), { channelId, createdAt: Date.now() });

        await assertSucceeds(batch.commit());
    });

    test('бронь под несуществующий канал не заводится', async () => {
        // Иначе адрес выжигается навсегда: снять бронь может только старший канала,
        // а у канала, которого нет, старшего не бывает — и удалить её потом нечем.
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.slug({ slug: 'sbor' })), {
                channelId: 'ch-does-not-exist',
                createdAt: Date.now(),
            })
        );
    });

    test('бронь на уже существующий канал заводится и одиночной записью', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.channel({ channelId }), { slug: 'nord', title: 'Норд', createdAt: 1 });

        const sailor = testEnv.authenticatedContext('u-1');
        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.slug({ slug: 'nord' })), { channelId, createdAt: Date.now() })
        );
    });

    test('невошедший бронь не заводит', async () => {
        const unauthed = testEnv.unauthenticatedContext();

        await assertFails(
            setDoc(doc(unauthed.firestore(), paths.slug({ slug: 'ost' })), { channelId: 'ch-1', createdAt: Date.now() })
        );
    });

    test('занятую бронь не переписать — даже тому, кто вправе её удалить', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'nord',
            title: 'Норд',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.slug({ slug: 'nord' }), { channelId, createdAt: 1 });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertFails(updateDoc(doc(owner.firestore(), paths.slug({ slug: 'nord' })), { channelId: 'ch-2' }));
    });

    test('старший канала снимает свою бронь адреса', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'nord',
            title: 'Норд',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.slug({ slug: 'nord' }), { channelId, createdAt: 1 });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertSucceeds(deleteDoc(doc(owner.firestore(), paths.slug({ slug: 'nord' }))));
    });

    test('посторонний участник чужую бронь не снимает', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        const strangerUid = 'stranger-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'nord',
            title: 'Норд',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.slug({ slug: 'nord' }), { channelId, createdAt: 1 });
        // Стоит на том же рейде, но не старший — этого мало.
        await seedDoc(paths.member({ channelId, memberId: strangerUid }), { name: 'Чужой' });

        const stranger = testEnv.authenticatedContext(strangerUid);
        await assertFails(deleteDoc(doc(stranger.firestore(), paths.slug({ slug: 'nord' }))));
    });

    test('лишнее поле в брони не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.slug({ slug: 'ost' })), {
                channelId: 'ch-1',
                createdAt: Date.now(),
                note: 'лишнее',
            })
        );
    });
});

describe('firestore.rules: channels/{channelId}', () => {
    test('участник читает канал по ключу', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.channel({ channelId }), { slug: 'dozor', title: 'Дозор', createdAt: 1 });
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(getDoc(doc(sailor.firestore(), paths.channel({ channelId }))));
    });

    test('вошедший не с этого рейда канал не читает', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.channel({ channelId }), { slug: 'dozor', title: 'Дозор', createdAt: 1 });
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const stranger = testEnv.authenticatedContext('m-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.channel({ channelId }))));
    });

    test('невошедший канал не читает', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.channel({ channelId }), { slug: 'dozor', title: 'Дозор', createdAt: 1 });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(getDoc(doc(unauthed.firestore(), paths.channel({ channelId }))));
    });

    test('каналы не перебираются списком — иначе рейды нашлись бы один за другим', async () => {
        await seedDoc(paths.channel({ channelId: 'ch-1' }), { slug: 'nord', title: 'Норд', createdAt: 1 });

        const someone = testEnv.authenticatedContext('u-1');
        await assertFails(getDocs(collection(someone.firestore(), paths.channels())));
    });

    test('вошедший заводит канал: slug, title, createdAt, serverAt', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('невошедший канал не заводит', async () => {
        const unauthed = testEnv.unauthenticatedContext();

        await assertFails(
            setDoc(doc(unauthed.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('название длиннее предела не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'a'.repeat(TITLE_MAX_LENGTH + 1),
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('название ровно в предел кириллицей — можно (size() считает символы, а не байты)', async () => {
        // Кириллица в UTF-8 — два байта на букву: если бы size() в правилах мерил байты,
        // а не символы, ровно предельное название отказало бы, хотя предел не нарушен.
        const sailor = testEnv.authenticatedContext('u-1');

        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'ё'.repeat(TITLE_MAX_LENGTH),
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('адрес длиннее предела не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'a'.repeat(SLUG_MAX_LENGTH + 1),
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
            })
        );
    });

    test('с полем owner при заведении — нет: старшего назначает сервер', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                owner: { memberId: 'u-1' },
            })
        );
    });

    test('serverAt, написанный числом вместо serverTimestamp(), не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: Date.now(),
            })
        );
    });

    test('закрытая частота с кодом доступа — можно', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: true,
                code: 'shtorm-7',
            })
        );
    });

    test('closed без code не проходит — пара строго вместе (closedSane)', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: true,
            })
        );
    });

    test('code без closed не проходит — пара строго вместе (closedSane)', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                code: 'shtorm-7',
            })
        );
    });

    test('closed: true с пустым code не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: true,
                code: '',
            })
        );
    });

    test('closed: false не проходит — у открытого канала нет этого поля вовсе', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: false,
            })
        );
    });

    test('код доступа длиннее предела не проходит', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: true,
                code: 'a'.repeat(ACCESS_CODE_MAX_LENGTH + 1),
            })
        );
    });

    test('код доступа ровно в предел — можно', async () => {
        const sailor = testEnv.authenticatedContext('u-1');

        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.channel({ channelId: 'ch-new' })), {
                slug: 'nord',
                title: 'Норд',
                createdAt: Date.now(),
                serverAt: serverTimestamp(),
                closed: true,
                code: 'a'.repeat(ACCESS_CODE_MAX_LENGTH),
            })
        );
    });

    test('старший переименовывает канал: slug, title, serverAt', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'staroe',
            title: 'Старое название',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertSucceeds(
            updateDoc(doc(owner.firestore(), paths.channel({ channelId })), {
                slug: 'novoe',
                title: 'Новое название',
                serverAt: serverTimestamp(),
            })
        );
    });

    test('название списком вместо строки не проходит — у списка тоже есть .size(), но это не строка', async () => {
        // Список из трёх элементов проходит .size() <= maxTitle() как и любая короткая строка:
        // без явной проверки типа это был обход предела длины через чужой тип данных.
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'staroe',
            title: 'Старое название',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertFails(
            updateDoc(doc(owner.firestore(), paths.channel({ channelId })), {
                slug: 'novoe',
                title: ['a', 'b', 'c'],
                serverAt: serverTimestamp(),
            })
        );
    });

    test('участник, не старший, канал не переименует', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        const memberUid = 'member-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'staroe',
            title: 'Старое название',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });
        await seedDoc(paths.member({ channelId, memberId: memberUid }), { name: 'Не старший' });

        const member = testEnv.authenticatedContext(memberUid);
        await assertFails(
            updateDoc(doc(member.firestore(), paths.channel({ channelId })), {
                slug: 'novoe',
                title: 'Новое название',
                serverAt: serverTimestamp(),
            })
        );
    });

    test('невошедший канал не переименует', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'staroe',
            title: 'Старое название',
            createdAt: 1,
            owner: { memberId: 'owner-uid' },
        });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(
            updateDoc(doc(unauthed.firestore(), paths.channel({ channelId })), {
                slug: 'novoe',
                title: 'Новое название',
                serverAt: serverTimestamp(),
            })
        );
    });

    test('старший не переставит владельца сам — старшинство передаёт только сервер', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'nord',
            title: 'Норд',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertFails(
            updateDoc(doc(owner.firestore(), paths.channel({ channelId })), {
                owner: { memberId: 'member-uid' },
                serverAt: serverTimestamp(),
            })
        );
    });

    test('канал не стирается никем', async () => {
        const channelId = 'ch-1';
        const ownerUid = 'owner-uid';
        await seedDoc(paths.channel({ channelId }), {
            slug: 'nord',
            title: 'Норд',
            createdAt: 1,
            owner: { memberId: ownerUid },
        });

        const owner = testEnv.authenticatedContext(ownerUid);
        await assertFails(deleteDoc(doc(owner.firestore(), paths.channel({ channelId }))));
    });
});

describe('firestore.rules: channels/{channelId}/members/{memberId}', () => {
    test('участник читает участников — и любого поодиночке, и списком весь рейд', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });
        await seedDoc(paths.member({ channelId, memberId: 'm-2' }), { name: 'Смотрящий' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(getDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-2' }))));
        await assertSucceeds(getDocs(collection(sailor.firestore(), paths.members({ channelId }))));
    });

    test('вошедший не с этого рейда участников не читает — ни одного, ни списком', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const stranger = testEnv.authenticatedContext('m-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.member({ channelId, memberId: 'm-1' }))));
        await assertFails(getDocs(collection(stranger.firestore(), paths.members({ channelId }))));
    });

    test('невошедший участников не читает — ни одного, ни списком', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(getDoc(doc(unauthed.firestore(), paths.member({ channelId, memberId: 'm-1' }))));
        await assertFails(getDocs(collection(unauthed.firestore(), paths.members({ channelId }))));
    });

    test('участие не заводит клиент — даже своё', async () => {
        const channelId = 'ch-1';
        const sailor = testEnv.authenticatedContext('m-1');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' })), { name: 'Самозванец' })
        );
    });

    test('участие не снимает клиент', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(deleteDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' }))));
    });

    test('свой lastSeen правит хозяин корабля', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный', lastSeen: null });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(
            updateDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' })), {
                lastSeen: { messageId: 'msg-1', at: Date.now() },
            })
        );
    });

    test('lastSeen с messageId числом не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный', lastSeen: null });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            updateDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' })), {
                lastSeen: { messageId: 12345, at: Date.now() },
            })
        );
    });

    test('lastSeen без at не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный', lastSeen: null });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            updateDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' })), {
                lastSeen: { messageId: 'msg-1' },
            })
        );
    });

    test('чужой lastSeen не переписать', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный', lastSeen: null });

        const stranger = testEnv.authenticatedContext('m-2');
        await assertFails(
            updateDoc(doc(stranger.firestore(), paths.member({ channelId, memberId: 'm-1' })), {
                lastSeen: { messageId: 'msg-1', at: Date.now() },
            })
        );
    });

    test('lastSeen правится один — заодно с именем или местом не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный', lastSeen: null });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            updateDoc(doc(sailor.firestore(), paths.member({ channelId, memberId: 'm-1' })), {
                lastSeen: { messageId: 'msg-1', at: Date.now() },
                name: 'Новое имя',
            })
        );
    });
});

describe('firestore.rules: channels/{channelId}/berths/{berthId}', () => {
    test('участник читает брони мест', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });
        await seedDoc(paths.berth({ channelId, slot: 0, corridor: 'center' }), { memberId: 'm-1', takenAt: 1 });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(getDoc(doc(sailor.firestore(), paths.berth({ channelId, slot: 0, corridor: 'center' }))));
    });

    test('вошедший не с этого рейда брони мест не читает', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.berth({ channelId, slot: 0, corridor: 'center' }), { memberId: 'm-1', takenAt: 1 });

        const stranger = testEnv.authenticatedContext('m-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.berth({ channelId, slot: 0, corridor: 'center' }))));
    });

    test('невошедший брони мест не читает', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.berth({ channelId, slot: 0, corridor: 'center' }), { memberId: 'm-1', takenAt: 1 });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(getDoc(doc(unauthed.firestore(), paths.berth({ channelId, slot: 0, corridor: 'center' }))));
    });

    test('бронь места не заводит клиент — даже свою', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.berth({ channelId, slot: 0, corridor: 'center' })), {
                memberId: 'm-1',
                takenAt: Date.now(),
            })
        );
    });
});

describe('firestore.rules: channels/{channelId}/messages/{messageId}', () => {
    test('участник читает ленту — и сообщение, и списком', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });
        await seedDoc(paths.message({ channelId, messageId: 'msg-1' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            text: 'Есть на связи',
        });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(getDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' }))));
        await assertSucceeds(getDocs(collection(sailor.firestore(), paths.messages({ channelId }))));
    });

    test('вошедший не с этого рейда ленту не читает — ни одно сообщение, ни списком', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.message({ channelId, messageId: 'msg-1' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            text: 'Есть на связи',
        });

        const stranger = testEnv.authenticatedContext('m-2');
        await assertFails(getDoc(doc(stranger.firestore(), paths.message({ channelId, messageId: 'msg-1' }))));
        await assertFails(getDocs(collection(stranger.firestore(), paths.messages({ channelId }))));
    });

    test('невошедший ленту не читает — ни одно сообщение, ни списком', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.message({ channelId, messageId: 'msg-1' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            text: 'Есть на связи',
        });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(getDoc(doc(unauthed.firestore(), paths.message({ channelId, messageId: 'msg-1' }))));
        await assertFails(getDocs(collection(unauthed.firestore(), paths.messages({ channelId }))));
    });

    test('участник пишет сообщение от своего имени — можно', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Вижу берег',
            })
        );
    });

    test('вошедший, но не стоящий на рейде, — нет', async () => {
        const channelId = 'ch-1';
        // Участия для m-2 нет вовсе — на этом рейде его корабля не стоит.
        const sailor = testEnv.authenticatedContext('m-2');

        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-2' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Чужой на рейде',
            })
        );
    });

    test('невошедший не пишет', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const unauthed = testEnv.unauthenticatedContext();
        await assertFails(
            setDoc(doc(unauthed.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Аноним',
            })
        );
    });

    test('от чужого имени сообщение не пройдёт', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        // m-1 стоит на рейде, но подписывается чужим кораблём.
        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-2' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Подмена автора',
            })
        );
    });

    test('лишний ключ в author (name) не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1', name: 'Дозорный' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Текст',
            })
        );
    });

    test('лишний ключ в look не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: {
                    memberId: 'm-1',
                    look: { name: 'Дозорный', hullNumber: '001', color: '#8ecae6', shipKind: 'pr1234' },
                },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Текст',
            })
        );
    });

    test('look.name длиннее предела не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: {
                    memberId: 'm-1',
                    look: { name: 'а'.repeat(NAME_MAX_LENGTH + 1), hullNumber: '001', color: '#8ecae6' },
                },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Текст',
            })
        );
    });

    test('look.name ровно в предел — можно', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: {
                    memberId: 'm-1',
                    look: { name: 'а'.repeat(NAME_MAX_LENGTH), hullNumber: '001', color: '#8ecae6' },
                },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Текст',
            })
        );
    });

    test('лишний ключ в thread не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Текст',
                thread: { messageId: 'msg-0', extra: true },
            })
        );
    });

    test('сообщение с полным правильным look и thread проходит — этим приложение пишет каждый день', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });
        await seedDoc(paths.message({ channelId, messageId: 'msg-0' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            serverAt: serverTimestamp(),
            text: 'Исходное',
        });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1', look: { name: 'Дозорный', hullNumber: '001', color: '#8ecae6' } },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Ответ с полным видом',
                thread: { messageId: 'msg-0' },
            })
        );
    });

    test('текст ровно в предел кириллицей — можно', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertSucceeds(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'о'.repeat(MAX_MESSAGE_LENGTH),
            })
        );
    });

    test('текст длиннее предела не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'о'.repeat(MAX_MESSAGE_LENGTH + 1),
            })
        );
    });

    test("kind: 'system' клиенту не даётся — так подделали бы строчку канала", async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Встал на рейд',
                kind: 'system',
            })
        );
    });

    test('notice клиенту не даётся — тем же путём подделывалась бы запись о рейде', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: serverTimestamp(),
                text: 'Встал на рейд',
                notice: { event: 'joined', before: { shipKind: 'pr1234', name: 'Дозорный', hullNumber: '001' } },
            })
        );
    });

    test('serverAt без serverTimestamp() не проходит', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.member({ channelId, memberId: 'm-1' }), { name: 'Дозорный' });

        const sailor = testEnv.authenticatedContext('m-1');
        await assertFails(
            setDoc(doc(sailor.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                author: { memberId: 'm-1' },
                sentAt: Date.now(),
                serverAt: Date.now(),
                text: 'Часы клиента — не сервер',
            })
        );
    });

    test('сказанное не переписать', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.message({ channelId, messageId: 'msg-1' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            serverAt: serverTimestamp(),
            text: 'Исходный текст',
        });

        const author = testEnv.authenticatedContext('m-1');
        await assertFails(
            updateDoc(doc(author.firestore(), paths.message({ channelId, messageId: 'msg-1' })), {
                text: 'Исправленный текст',
            })
        );
    });

    test('сказанное не стереть', async () => {
        const channelId = 'ch-1';
        await seedDoc(paths.message({ channelId, messageId: 'msg-1' }), {
            author: { memberId: 'm-1' },
            sentAt: 1,
            serverAt: serverTimestamp(),
            text: 'Исходный текст',
        });

        const author = testEnv.authenticatedContext('m-1');
        await assertFails(deleteDoc(doc(author.firestore(), paths.message({ channelId, messageId: 'msg-1' }))));
    });
});
