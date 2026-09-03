import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_COURSE_LENGTH, MAX_MESSAGE_LENGTH, Member, Message, ShipNoticeMessage } from '@shared/types/channel';

import { MESSAGE_PAGE } from '@/config/network';

import * as auth from '@/backend/auth';
import { createLocalBackend } from '@/backend/localBackend';
import { ChannelBackend, ChannelError, ChannelEvent, MemberDraft } from '@/backend/types';

/**
 * Эмулятор сервера целиком: правила входа, старшинство, высадка, пределы длины и провод
 * между вкладками.
 *
 * Всё это раньше проверялось только в браузере — двумя окнами Playwright, ходами кораблей
 * и ожиданием записей в ленте. Браузер тут не предмет, а помеха: правила счётные, и минута
 * прогона уходила на то, чтобы корабль доплыл до места. Вкладка эмулируется бэкендом:
 * их можно завести сколько угодно в одном процессе, и разговаривают они ровно тем же
 * проводом, что и настоящие, — `BroadcastChannel`.
 *
 * Гонка двух вкладок сюда тоже переезжает: в браузере она случалась через раз, здесь двум
 * входам достаточно не дожидаться друг друга.
 */

/**
 * Хранилище «сервера». Одно на все бэкенды в проверке — как один localStorage на все вкладки
 * браузера; отсюда и общее состояние, и весь смысл проверок про две вкладки.
 */
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

/**
 * Ящик неотправленного (backend/outbox.ts) лежит в sessionStorage — своя карта, отдельная
 * от shelf выше: у вкладки своя память, общей на все бэкенды здесь ей быть незачем. Полнее
 * localStorage-подложки (с length/key): discardOutboxMessage и автоподхват при связи
 * (см. localBackend.ts) перебирают ключи, а не читают по одному известному.
 */
const sessionShelf = new Map<string, string>();

const fakeSessionStorage = {
    getItem: (key: string): string | null => sessionShelf.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        sessionShelf.set(key, value);
    },
    removeItem: (key: string): void => {
        sessionShelf.delete(key);
    },
    get length(): number {
        return sessionShelf.size;
    },
    key: (index: number): string | null => [...sessionShelf.keys()][index] ?? null,
};

/**
 * Провод между вкладками. Настоящий `BroadcastChannel` в node есть, но своё же сообщение
 * он доставляет не сразу, и проверке пришлось бы ждать неизвестно сколько. Свой провод
 * доставляет его тем же тиком: очередь событий у эмулятора всё равно своя, а проверять
 * мы собираемся правила, а не расторопность браузера.
 */
const wires = new Set<{ post: (data: unknown) => void; take: (data: unknown) => void }>();

class TestBroadcastChannel {
    private readonly self = {
        post: (data: unknown) => {
            wires.forEach((other) => {
                if (other !== this.self) {
                    other.take(data);
                }
            });
        },
        take: (data: unknown) => {
            this.listeners.forEach((listener) => listener({ data } as MessageEvent));
        },
    };

    private readonly listeners = new Set<(event: MessageEvent) => void>();

    constructor(readonly name: string) {
        wires.add(this.self);
    }

    addEventListener(_type: string, listener: (event: MessageEvent) => void): void {
        this.listeners.add(listener);
    }

    postMessage(data: unknown): void {
        this.self.post(data);
    }
}

const draft = (name: string, hullNumber: string, over: Partial<MemberDraft> = {}): MemberDraft => ({
    name,
    hullNumber,
    shipKind: 'pr1234',
    color: '#8ecae6',
    ...over,
});

/** Ошибка с ожидаемым кодом. Проверяем код, а не текст: текст — дело интерфейса. */
const failsWith = async (run: () => Promise<unknown>, code: string): Promise<ChannelError> => {
    const error = await run().then(
        () => null,
        (thrown: unknown) => thrown
    );
    expect(error).toBeInstanceOf(ChannelError);
    expect((error as ChannelError).code).toBe(code);
    return error as ChannelError;
};

/**
 * Пустой канал под своим адресом: демо-канал для проверок правил слишком населён. `over`
 * донашивает closed/code до createChannel — по умолчанию их нет вовсе, тем же открытым
 * каналом, что и раньше этой возможности.
 */
const freshChannel = async (
    backend: ChannelBackend,
    slug = 'proverka',
    over: { closed?: boolean; code?: string } = {}
): Promise<string> => {
    const { channel } = await backend.createChannel({ channel: { slug, title: 'Проверка', ...over } });
    return channel.channelId;
};

/**
 * Бэкенд для проверки — тот же createLocalBackend(), но перед каждым join() сбрасывает
 * запомненный userId вкладки (`kilvater.entrance.local`, см. backend/auth.ts).
 *
 * Настоящие вкладки не мешают друг другу: у каждой свой sessionStorage, и localAccount()
 * заводит свой userId в каждой сам, один раз. Здесь же на весь файл одна карта на двоих
 * (см. sessionShelf выше) — так и было задумано, ради проверок про две вкладки, — и без
 * сброса второй join() в проверке заставал бы userId уже занятым первым, отчего два разных
 * участника вставали бы одним и тем же кораблём. Сброс перед каждым join() и воспроизводит
 * то, что у настоящих вкладок получается само: очередной вошедший — это всегда кто-то новый.
 */
const testBackend = (): ChannelBackend => {
    const backend = createLocalBackend();
    return {
        ...backend,
        join: (request) => {
            sessionShelf.delete('kilvater.entrance.local');
            return backend.join(request);
        },
    };
};

/**
 * Записанные события канала: по ним видно, что вкладка узнала о случившемся. `userId` не
 * передан по умолчанию — вход большинству проверок не важен (см. types.ts); гостю (см. ниже)
 * нужен явный `null`.
 */
const watch = (backend: ChannelBackend, channelId: string, userId?: string | null): ChannelEvent[] => {
    const seen: ChannelEvent[] = [];
    backend.subscribe({ channelId, userId, onEvent: (event) => seen.push(event) });
    return seen;
};

/** Что лежит в ленте канала. Строчки самого канала приходят обычными сообщениями. */
const messages = async (backend: ChannelBackend, channelId: string): Promise<Message[]> =>
    (await backend.getChannel({ channelId }))?.messages ?? [];

/** Что сказано репликой. У строчек самого канала текста нет вовсе — у них данные. */
const textOf = (message: Message): string | undefined => ('text' in message ? message.text : undefined);

/** Только строчки самого канала: о входе, переоснащении, уходе и высадке. */
const notices = async (backend: ChannelBackend, channelId: string): Promise<ShipNoticeMessage[]> =>
    (await messages(backend, channelId)).filter((message): message is ShipNoticeMessage => message.kind === 'system');

const members = async (backend: ChannelBackend, channelId: string): Promise<Member[]> =>
    (await backend.getChannel({ channelId }))?.members ?? [];

const ownerOf = async (backend: ChannelBackend, channelId: string): Promise<string | undefined> =>
    (await backend.getChannel({ channelId }))?.channel.owner?.memberId;

/**
 * Много сообщений подряд, для проверок страниц. Часы должны быть подложными (`vi.useFakeTimers`)
 * ещё до вызова: `delay()` внутри бэкенда крутит настоящий `setTimeout`, и без подмены сотни
 * сообщений шли бы по живым миллисекундам.
 */
const sendMany = async (
    backend: ChannelBackend,
    channelId: string,
    memberId: string,
    count: number
): Promise<Message[]> => {
    const sent: Message[] = [];
    for (let i = 0; i < count; i += 1) {
        const pending = backend.sendMessage({ channelId, memberId, message: { text: `msg-${i}` } });
        // eslint-disable-next-line no-await-in-loop -- подложные часы двигаем ровно на одно сообщение за раз
        await vi.advanceTimersByTimeAsync(50);
        // eslint-disable-next-line no-await-in-loop -- отправка идёт по одной, через общую очередь бэкенда
        sent.push((await pending).message);
    }
    return sent;
};

/**
 * Дождаться, пока опустеет очередь микрозадач. Автоподхват при связи (watchOnlineStatus
 * в localBackend.ts) запускает flushPending синхронно, но сама запись идёт через mutate() —
 * то есть уже отложенно, микрозадачей (см. exclusive() в localBackend.ts: без настоящего
 * navigator.locks там `Promise.resolve().then(run)`). Между концом конструктора бэкенда
 * и следующей строкой проверки эта микрозадача ещё не успевает выполниться, и чтение
 * состояния тут же после перезагрузки застало бы старое.
 *
 * Настоящий setTimeout, а не подложные часы окна: микрозадачи опустошаются дочиста
 * перед всяким макрозаданием, даже нулевым таймером, — это правило цикла событий JS,
 * а не везение.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    shelf.clear();
    sessionShelf.clear();
    wires.clear();
    // Проверки идут в node, а бэкенд живёт в браузере: подставляем ему хранилище, часы
    // и провод. Больше ему от окна ничего не нужно — замка (`navigator.locks`) тут нет,
    // и он обходится без очереди, как и в старом браузере.
    (globalThis as unknown as { window: unknown }).window = {
        localStorage: fakeStorage,
        sessionStorage: fakeSessionStorage,
        setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    };
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = TestBroadcastChannel;
});

afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
    // На случай проверки с подложным navigator (см. «статус отправки»): следующему тесту
    // он нужен настоящим, а не оставшимся от предыдущего.
    vi.unstubAllGlobals();
    // На случай теста с подложными часами (см. «лента страницами»): следующему тесту
    // настоящие часы нужны настоящими, а не оставшимися от предыдущего.
    vi.useRealTimers();
    // На случай теста с подменённым localAccount (см. «две вкладки, вошедшие разом»):
    // следующему тесту нужен настоящий, читающий sessionStorage, а не оставшийся от предыдущего.
    vi.restoreAllMocks();
});

describe('адрес канала', () => {
    test('заводится по годному адресу и находится по нему же', async () => {
        const backend = testBackend();
        const { channel } = await backend.createChannel({ channel: { slug: 'eskadra', title: '  Эскадра  ' } });

        expect(channel.slug).toBe('eskadra');
        // Название подрезано: пробелы по краям в заголовке канала не значат ничего.
        expect(channel.title).toBe('Эскадра');
        expect((await backend.getChannelBySlug({ slug: 'eskadra' }))?.channel.channelId).toBe(channel.channelId);
    });

    test('адрес не той формы не проходит', async () => {
        const backend = testBackend();

        await failsWith(() => backend.createChannel({ channel: { slug: '-', title: 'Полночь' } }), 'slug-invalid');
        await failsWith(() => backend.createChannel({ channel: { slug: 'Полночь', title: 'П' } }), 'slug-invalid');
    });

    test('занятый адрес не достаётся второму каналу, а себе самому не мешает', async () => {
        const backend = testBackend();
        const { channel } = await backend.createChannel({ channel: { slug: 'zanyato', title: 'Первый' } });

        await failsWith(() => backend.createChannel({ channel: { slug: 'zanyato', title: 'Второй' } }), 'slug-taken');

        // Своё имя каналу не помеха: переименование с тем же адресом — обычное дело.
        const renamed = await backend.updateChannel({
            channelId: channel.channelId,
            channel: { slug: 'zanyato', title: 'Первый и единственный' },
        });
        expect(renamed.channel.title).toBe('Первый и единственный');
    });

    test('канала по адресу нет — и в ответ пустота, а не выдуманный канал', async () => {
        const backend = testBackend();

        expect(await backend.getChannelBySlug({ slug: 'nesushchestvuyushchiy' })).toBeNull();
        expect(await backend.getChannel({ channelId: 'ch-net-takogo' })).toBeNull();
    });
});

describe('вход на рейд', () => {
    test('позывной и бортовой номер заняты — отказ, а с исправленными вход проходит', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        await backend.join({ channelId, member: draft('Альбатрос', '317') });

        // Позывной сверяется без оглядки на регистр: «альбатрос» и «Альбатрос» в ленте
        // не различить.
        await failsWith(() => backend.join({ channelId, member: draft('альбатрос', '777') }), 'name-taken');
        await failsWith(() => backend.join({ channelId, member: draft('Гроза', '317') }), 'hull-taken');

        const { member } = await backend.join({ channelId, member: draft('Гроза', '777') });
        expect(member.name).toBe('Гроза');
        expect(await members(backend, channelId)).toHaveLength(2);
    });

    test('шестому кораблю в канале место находится: предела числом больше нет', async () => {
        // Предел был числом («не больше пяти») и не имел отношения к тому, вмещает ли рейд
        // ещё один корабль. Реальный предел кладёт расстановка (см. placement.test.ts,
        // «мест нет вовсе — расстановка отказывает») — здесь проверяется только то, что
        // здесь этого искусственного числа больше нет.
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        await [...Array(6).keys()].reduce(async (before, index) => {
            await before;
            await backend.join({ channelId, member: draft(`Борт ${index}`, `10${index}`) });
        }, Promise.resolve());

        expect(await members(backend, channelId)).toHaveLength(6);
    });

    test('вход отмечается в ленте, и позывной в записи — тот, с каким вошли', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        await backend.updateMember({ channelId, memberId: member.memberId, member: draft('Буревестник', '317') });

        const [notice] = await notices(backend, channelId);
        expect(notice.notice).toEqual({
            event: 'joined',
            before: { shipKind: 'pr1234', name: 'Альбатрос', hullNumber: '317' },
        });
    });

    test('повторный вход тем же userId не заводит второй корабль', async () => {
        // Без testBackend(): проверке нужна ровно та же личность на обоих вызовах, а её
        // сброс перед каждым join() тут только бы мешал (см. testBackend выше).
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const first = await backend.join({ channelId, member: draft('Алый', '001') });
        const second = await backend.join({ channelId, member: draft('Синий', '999') });

        // То же решение и по той же причине, что у joinChannel на настоящем бэкенде
        // (functions/src/raid.ts): memberId === userId, а второго корабля с тем же
        // memberId на одном рейде не бывает — второй вызов просто возвращает первый
        // корабль, будто заявки и не было, и в ленте о ней нет ни следа.
        expect(second.member).toEqual(first.member);
        expect(await members(backend, channelId)).toHaveLength(1);
        expect(await messages(backend, channelId)).toHaveLength(1);
    });

    test('место на рейде назначает канал, а не вкладка', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);

        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        // Место пришло в ответе целиком — с коридором, слотом и курсом. Без этого корабль
        // у каждой вкладки вставал бы на своё.
        expect(member.place.corridor).toBeTruthy();
        expect(member.place.slot).toBeGreaterThanOrEqual(0);
        expect(member.place.facing).toBeTruthy();
    });
});

/**
 * Закрытая частота: тот же набор проверок, что и у joinChannel на настоящем бэкенде
 * (functions/src/raid.test.ts, «закрытая частота») — код спрашивается у всех, кроме
 * самого первого (он его и придумал) и уже стоящего на рейде (тому не спрашивать заново).
 * Добавлены проверки, которых у настоящего бэкенда нет: checkAccessCode — своя функция
 * лишь у бэкендов, previewChannel её на месте joinChannel не подменяет, — и то, что
 * посторонний видит closed, но не сам код.
 */
describe('закрытая частота', () => {
    test('первый вошедший становится старшим без кода — сам его только что придумал', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-pervy', { closed: true, code: 'акула' });

        const { member } = await backend.join({ channelId, member: draft('Алый', '001') });

        expect(await ownerOf(backend, channelId)).toBe(member.memberId);
    });

    test('верный код — второй вошедший становится участником', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-verny-kod', { closed: true, code: 'акула' });
        await backend.join({ channelId, member: draft('Алый', '001') });

        const { member } = await backend.join({ channelId, member: draft('Белый', '002'), code: 'акула' });

        expect(member.name).toBe('Белый');
        expect(await members(backend, channelId)).toHaveLength(2);
    });

    test('неверный код — channel-closed, и второй корабль не появляется', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-neverny-kod', { closed: true, code: 'акула' });
        await backend.join({ channelId, member: draft('Алый', '001') });

        await failsWith(
            () => backend.join({ channelId, member: draft('Белый', '002'), code: 'кит' }),
            'channel-closed'
        );
        expect(await members(backend, channelId)).toHaveLength(1);
    });

    test('код не передан вовсе — тоже channel-closed', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-bez-koda', { closed: true, code: 'акула' });
        await backend.join({ channelId, member: draft('Алый', '001') });

        await failsWith(() => backend.join({ channelId, member: draft('Белый', '002') }), 'channel-closed');
    });

    test('уже стоящий на рейде — повторный вход не спрашивает код заново', async () => {
        // Без testBackend(): проверке нужна та же личность на обоих join(), а сброс перед
        // каждым (см. testBackend выше) как раз завёл бы второго вместо повторного входа.
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend, 'zakryt-povtorny', { closed: true, code: 'акула' });
        const first = await backend.join({ channelId, member: draft('Алый', '001') });

        const second = await backend.join({ channelId, member: draft('Алый', '001') });

        expect(second.member).toEqual(first.member);
    });

    test('открытый канал код не спрашивает вовсе', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-otkryty');
        await backend.join({ channelId, member: draft('Алый', '001') });

        const { member } = await backend.join({ channelId, member: draft('Белый', '002') });

        expect(member.name).toBe('Белый');
    });

    test('checkAccessCode: верный код проходит бесследно, неверный — channel-closed', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-proverka-koda', { closed: true, code: 'акула' });

        await expect(backend.checkAccessCode({ channelId, code: 'акула' })).resolves.toBeUndefined();
        await failsWith(() => backend.checkAccessCode({ channelId, code: 'кит' }), 'channel-closed');
        // Сама подсказка ничего не решает — ни на рейде, ни в канале ничего не изменилось.
        expect(await members(backend, channelId)).toHaveLength(0);
    });

    test('checkAccessCode для несуществующего канала — channel-not-found', async () => {
        const backend = testBackend();

        await failsWith(
            () => backend.checkAccessCode({ channelId: 'net-takogo-kanala', code: 'что угодно' }),
            'channel-not-found'
        );
    });

    test('постороннему виден флаг closed, но не сам код', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'zakryt-dlya-chuzhogo', { closed: true, code: 'акула' });
        await backend.join({ channelId, member: draft('Алый', '001') });

        const snapshot = await backend.getChannel({ channelId, userId: 'stranger-uid' });

        expect(snapshot?.channel.closed).toBe(true);
        expect(snapshot?.channel).not.toHaveProperty('code');
    });
});

describe('старшинство на рейде', () => {
    test('первый вставший на рейд становится старшим', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);

        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });

        expect(await ownerOf(backend, channelId)).toBe(first.memberId);
        expect(await ownerOf(backend, channelId)).not.toBe(second.memberId);
    });

    test('ушёл старший — старшинство достаётся тому, кто дольше всех на рейде', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });
        const { member: third } = await backend.join({ channelId, member: draft('Третий', '103') });

        await backend.leave({ channelId, memberId: first.memberId });
        expect(await ownerOf(backend, channelId)).toBe(second.memberId);

        // И дальше по цепочке: канал без старшего не остаётся, пока на рейде есть хоть кто-то.
        await backend.leave({ channelId, memberId: second.memberId });
        expect(await ownerOf(backend, channelId)).toBe(third.memberId);
    });

    test('старший называет преемника — старшинство достаётся ему, а не самому давнему', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });
        const { member: third } = await backend.join({ channelId, member: draft('Третий', '103') });

        // Дольше всех на рейде — «Второй», но старший называет «Третьего».
        await backend.leave({ channelId, memberId: first.memberId, nextOwnerId: third.memberId });
        expect(await ownerOf(backend, channelId)).toBe(third.memberId);
        expect(await ownerOf(backend, channelId)).not.toBe(second.memberId);
    });

    test('названный преемник уже ушёл — старшинство достаётся тому, кто дольше всех на рейде', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });

        // Подсказка устарела (названного уже нет на рейде) — правило по умолчанию не ломается.
        await backend.leave({ channelId, memberId: first.memberId, nextOwnerId: 'm-nikogo-net' });
        expect(await ownerOf(backend, channelId)).toBe(second.memberId);
    });

    test('ушли все — старшим станет следующий пришедший', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: alone } = await backend.join({ channelId, member: draft('Один', '101') });

        await backend.leave({ channelId, memberId: alone.memberId });
        expect(await ownerOf(backend, channelId)).toBeUndefined();

        const { member: next } = await backend.join({ channelId, member: draft('Новый', '102') });
        expect(await ownerOf(backend, channelId)).toBe(next.memberId);
    });

    test('высаживает только старший, и не себя', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: senior } = await backend.join({ channelId, member: draft('Старший', '101') });
        const { member: other } = await backend.join({ channelId, member: draft('Другой', '102') });

        await failsWith(
            () => backend.kick({ channelId, memberId: other.memberId, member: { memberId: senior.memberId } }),
            'not-senior'
        );
        await failsWith(
            () => backend.kick({ channelId, memberId: senior.memberId, member: { memberId: senior.memberId } }),
            'not-senior'
        );

        await backend.kick({ channelId, memberId: senior.memberId, member: { memberId: other.memberId } });
        expect(await members(backend, channelId)).toHaveLength(1);
    });

    test('запись о высадке идёт от старшего, а о своём уходе — от ушедшего', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: senior } = await backend.join({ channelId, member: draft('Старший', '101') });
        const { member: other } = await backend.join({ channelId, member: draft('Другой', '102') });
        const { member: third } = await backend.join({ channelId, member: draft('Третий', '103') });

        await backend.kick({ channelId, memberId: senior.memberId, member: { memberId: other.memberId } });
        await backend.leave({ channelId, memberId: third.memberId, course: 'на Кронштадт' });

        const written = await notices(backend, channelId);
        const kicked = written.find((message) => message.notice.event === 'kicked');
        const left = written.find((message) => message.notice.event === 'left');

        // Распорядился старший — в его цепочке запись и стоит.
        expect(kicked?.author.memberId).toBe(senior.memberId);
        expect(kicked?.notice.before).toEqual({ shipKind: 'pr1234', name: 'Другой', hullNumber: '102' });
        expect(left?.author.memberId).toBe(third.memberId);
        expect(left?.notice.course).toBe('на Кронштадт');
    });

    test('уход без курса не оставляет в записи пустого поля', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Один', '101') });

        await backend.leave({ channelId, memberId: member.memberId });

        const left = (await notices(backend, channelId)).find((message) => message.notice.event === 'left');
        expect(left && 'course' in left.notice).toBe(false);
    });
});

describe('переоснащение', () => {
    test('на каждую перемену своя запись, и обе стороны названы целиком', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Буревестник', '561', { shipKind: 'pr1141' }),
        });

        const refits = (await notices(backend, channelId)).filter((message) => message.notice.event === 'refit');
        expect(refits).toHaveLength(3);
        // Порядок от крупного к мелкому: силуэт — новость крупнее номера (см. notice.ts).
        expect(refits.map((message) => message.notice.changed)).toEqual(['shipKind', 'name', 'hullNumber']);
        // В каждой записи оба состояния целиком: строчка складывается из них, а не из одного
        // изменившегося поля.
        expect(refits[0].notice.before).toEqual({ shipKind: 'pr1234', name: 'Альбатрос', hullNumber: '317' });
        expect(refits[0].notice.after).toEqual({ shipKind: 'pr1141', name: 'Буревестник', hullNumber: '561' });
    });

    test('ничего не поменялось — и записи нет', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const before = (await messages(backend, channelId)).length;

        await backend.updateMember({ channelId, memberId: member.memberId, member: draft('Альбатрос', '317') });

        expect(await messages(backend, channelId)).toHaveLength(before);
    });

    test('оставшийся на своём месте с него не снимается', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const { member: renamed } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Буревестник', '317'),
        });

        expect(renamed.place).toEqual(member.place);
    });

    test('перемена места пишет свою запись, и она встаёт перед переоснащением', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const berth = { slot: member.place.slot === 0 ? 1 : 0, corridor: 'right' as const, left: 80 };

        await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Буревестник', '317', { berth }),
        });

        const written = await notices(backend, channelId);
        // Снявшийся с якоря корабль — новость крупнее сменённого позывного, и стоит она выше.
        expect(written.map((message) => message.notice.event)).toEqual(['joined', 'moved', 'refit']);
        expect(written[1].notice.before).toEqual({ shipKind: 'pr1234', name: 'Буревестник', hullNumber: '317' });
    });

    test('манёвр записывается в участии со сроком и прежним местом', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const berth = { slot: member.place.slot === 0 ? 1 : 0, corridor: 'right' as const, left: 80 };

        const { member: moved } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Альбатрос', '317', { berth, manoeuvre: { seconds: 24 } }),
        });

        // Прежнее место — то, откуда корабль пошёл: по нему кадр и доигрывает манёвр.
        expect(moved.manoeuvre?.from).toEqual({ place: member.place, shipKind: 'pr1234' });
        expect(moved.manoeuvre?.seconds).toBe(24);
        expect(moved.manoeuvre?.startedAt).toBeGreaterThan(0);
    });

    test('без срока манёвр не записывается вовсе: доигрывать по такой записи нечего', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const berth = { slot: member.place.slot === 0 ? 1 : 0, corridor: 'right' as const, left: 80 };

        const { member: moved } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Альбатрос', '317', { berth }),
        });

        expect(moved.manoeuvre).toBeUndefined();
    });

    test('переоснащение на месте манёвром не считается: корабль с якоря не снимался', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const { member: renamed } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Буревестник', '317', { manoeuvre: { seconds: 24 } }),
        });

        expect(renamed.manoeuvre).toBeUndefined();
    });

    test('смена курса — тоже перемена места: корабль заходит заново', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317', { facing: 'left' }) });

        const { member: turned } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Альбатрос', '317', { facing: 'right' }),
        });

        expect(member.place.facing).toBe('left');
        expect(turned.place.facing).toBe('right');
    });

    test('чужой позывной не занять и переоснащением, а свой оставить можно', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member: first } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        await backend.join({ channelId, member: draft('Гроза', '777') });

        await failsWith(
            () => backend.updateMember({ channelId, memberId: first.memberId, member: draft('Гроза', '317') }),
            'name-taken'
        );
        // Сам себе не помеха: своё имя в списке занятых не считается.
        await backend.updateMember({
            channelId,
            memberId: first.memberId,
            member: draft('Альбатрос', '317', { shipKind: 'pr1141' }),
        });
    });
});

describe('пределы длины', () => {
    test('слишком длинное сообщение не уходит', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const before = (await messages(backend, channelId)).length;

        const error = await failsWith(
            () =>
                backend.sendMessage({
                    channelId,
                    memberId: member.memberId,
                    message: { text: 'я'.repeat(MAX_MESSAGE_LENGTH + 5) },
                }),
            'message-too-long'
        );

        // В отказе сказано, насколько перебрали: обрезать чужой текст нельзя, и человек
        // должен знать, сколько убрать.
        expect(error.message).toBe(`Максимум ${MAX_MESSAGE_LENGTH} символов, у вас ${MAX_MESSAGE_LENGTH + 5}`);
        expect(await messages(backend, channelId)).toHaveLength(before);
    });

    test('слишком длинный курс не уводит с рейда', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        await failsWith(
            () => backend.leave({ channelId, memberId: member.memberId, course: 'я'.repeat(MAX_COURSE_LENGTH + 1) }),
            'course-too-long'
        );

        // Отказ ничего не сделал за человека: корабль на рейде.
        expect(await members(backend, channelId)).toHaveLength(1);
    });

    test('ровно по пределу проходит', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'я'.repeat(MAX_MESSAGE_LENGTH) },
        });
        expect(textOf(message)).toHaveLength(MAX_MESSAGE_LENGTH);
    });
});

describe('две вкладки', () => {
    test('сказанное в одной приходит в другую событием', async () => {
        const first = testBackend();
        const second = testBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const heard = watch(second, channelId);
        await first.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Доброй вахты' } });

        const said = heard.filter((event) => event.type === 'message-added');
        expect(said).toHaveLength(1);
        expect(said[0].type === 'message-added' && textOf(said[0].message)).toBe('Доброй вахты');
    });

    test('вошедший в одной вкладке появляется в другой, и старшинство видно обеим', async () => {
        const first = testBackend();
        const second = testBackend();
        const channelId = await freshChannel(first);

        const heard = watch(second, channelId);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        expect(heard.some((event) => event.type === 'member-joined' && event.member.memberId === member.memberId)).toBe(
            true
        );
        // Про нового старшего вкладке говорят отдельно: без этого вымпел появился бы у неё
        // только после перезагрузки.
        const owned = heard.filter((event) => event.type === 'channel-updated');
        expect(owned.at(-1)?.type === 'channel-updated' && owned.at(-1)?.channel.owner?.memberId).toBe(member.memberId);
        expect(await members(second, channelId)).toHaveLength(1);
    });

    test('ушедший в одной пропадает и у другой', async () => {
        const first = testBackend();
        const second = testBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const heard = watch(second, channelId);
        await first.leave({ channelId, memberId: member.memberId });

        expect(heard.some((event) => event.type === 'member-left' && event.member.memberId === member.memberId)).toBe(
            true
        );
        expect(await members(second, channelId)).toHaveLength(0);
    });

    test('свою же новость вкладка получает ровно один раз', async () => {
        const first = testBackend();
        const second = testBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const echo = watch(first, channelId);
        const heard = watch(second, channelId);
        await first.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Раз' } });

        // Своё событие приходит и по проводу, и напрямую; по одному разу его получают обе.
        expect(echo.filter((event) => event.type === 'message-added')).toHaveLength(1);
        expect(heard.filter((event) => event.type === 'message-added')).toHaveLength(1);
    });

    test('отписавшаяся вкладка новостей больше не слышит', async () => {
        const first = testBackend();
        const second = testBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const heard: ChannelEvent[] = [];
        const stop = second.subscribe({ channelId, onEvent: (event) => heard.push(event) });
        stop();
        await first.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Раз' } });

        expect(heard).toHaveLength(0);
    });

    test('новости чужого канала своей вкладке не достаются', async () => {
        const first = testBackend();
        const second = testBackend();
        const ours = await freshChannel(first, 'nash');
        const theirs = await freshChannel(first, 'chuzhoy');
        const { member } = await first.join({ channelId: theirs, member: draft('Чужой', '317') });

        const heard = watch(second, ours);
        await first.sendMessage({ channelId: theirs, memberId: member.memberId, message: { text: 'Не сюда' } });

        expect(heard).toHaveLength(0);
    });

    test('две вкладки, вошедшие разом, не встают на одно место', async () => {
        const first = createLocalBackend();
        const second = createLocalBackend();
        const channelId = await freshChannel(first);

        // Не дожидаются друг друга нарочно: это и есть та гонка, из-за которой на рейде
        // появлялись два корабля на одной точке. Замка в проверках нет — очередь тут
        // держит однопоточность самого JS, и запись каждой вкладки ложится целиком.
        //
        // localAccount() здесь подложный, и не через testBackend(): у настоящих двух вкладок
        // к началу гонки уже разные userId, каждый в своём sessionStorage, а сброс перед
        // join() (как в testBackend()) на такой гонке только мешает — оба сброса происходят
        // синхронно, раньше, чем join() успевает дочитаться до самого localAccount(), и оба
        // вызова заводят себе один и тот же новый userId. Подложный localAccount() отвечает
        // ровно как два разных, уже вошедших человека — join() читает его по одному разу
        // на вызов, и очередь мутаций (mutate) не даёт этим чтениям перепутаться местами.
        const asTab = vi.spyOn(auth, 'localAccount');
        asTab.mockReturnValueOnce({ userId: 'pervaya-vkladka', name: 'Местный' });
        asTab.mockReturnValueOnce({ userId: 'vtoraya-vkladka', name: 'Местный' });

        const [one, other] = await Promise.all([
            first.join({ channelId, member: draft('Первый', '101') }),
            second.join({ channelId, member: draft('Второй', '102') }),
        ]);

        expect(await members(first, channelId)).toHaveLength(2);
        expect(one.member.place).not.toEqual(other.member.place);
    });
});

describe('лента страницами', () => {
    test('лента режется на страницы по MESSAGE_PAGE, а loadOlderMessages подряд восстанавливает её без потерь и дублей', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'bolshaya-lenta');
        const { member } = await backend.join({ channelId, member: draft('Связист', '007') });
        const [joinNotice] = await messages(backend, channelId);

        vi.useFakeTimers();
        const sent = await sendMany(backend, channelId, member.memberId, MESSAGE_PAGE * 2 + 20);
        vi.useRealTimers();

        const tail = await messages(backend, channelId);
        const tailHasMore = (await backend.getChannel({ channelId }))?.hasMoreMessages;
        expect(tail).toHaveLength(MESSAGE_PAGE);
        expect(tailHasMore).toBe(true);
        expect(tail.map((message) => message.messageId)).toEqual(
            sent.slice(-MESSAGE_PAGE).map((message) => message.messageId)
        );

        // Поднимаемся страницами до самого верха, каждый раз подставляя новую страницу
        // перед уже собранным: так же, как это будет делать интерфейс.
        let older: Message[] = [];
        let before = tail[0].messageId;
        let hasMore = tailHasMore ?? false;
        let guard = 0;
        while (hasMore) {
            guard += 1;
            // Строк отправлено ровно на три страницы — если цикл не остановился на третьей,
            // это уже не пагинация, а зацикливание.
            expect(guard).toBeLessThan(10);
            // eslint-disable-next-line no-await-in-loop -- страницы поднимаются по цепочке: следующий before известен только из ответа на предыдущую
            const page = await backend.loadOlderMessages({ channelId, before: { messageId: before } });
            older = [...page.messages, ...older];
            before = page.messages[0].messageId;
            hasMore = page.hasMore;
        }

        const full = [...older, ...tail];
        expect(full.map((message) => message.messageId)).toEqual([
            joinNotice.messageId,
            ...sent.map((message) => message.messageId),
        ]);
        expect(new Set(full.map((message) => message.messageId)).size).toBe(full.length);
    }, 15000);

    test('канал короче страницы — hasMoreMessages ложно что у getChannel, что у getChannelBySlug', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'malenkaya-lenta');
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Раз' } });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Два' } });

        expect((await backend.getChannel({ channelId }))?.hasMoreMessages).toBe(false);
        expect((await backend.getChannelBySlug({ slug: 'malenkaya-lenta' }))?.hasMoreMessages).toBe(false);
    });

    test('loadOlderMessages: before не найден в ленте — пустая страница, а не отказ', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'bez-etogo-soobshcheniya');
        await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const page = await backend.loadOlderMessages({ channelId, before: { messageId: 'net-takogo-soobshcheniya' } });
        expect(page).toEqual({ messages: [], hasMore: false });
    });

    test('loadOlderMessages: limit задаёт размер одной страницы, а не всей ленты', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'svoy-limit');
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const sent: Message[] = [];
        for (let i = 0; i < 10; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- десяток сообщений: без подложных часов проще ждать по одному
            const { message } = await backend.sendMessage({
                channelId,
                memberId: member.memberId,
                message: { text: `m${i}` },
            });
            sent.push(message);
        }

        const all = await messages(backend, channelId);
        const before = all[all.length - 1]; // последнее из десяти отправленных
        const page = await backend.loadOlderMessages({ channelId, before: { messageId: before.messageId }, limit: 3 });

        expect(page.messages).toHaveLength(3);
        expect(page.hasMore).toBe(true);
        expect(page.messages.map((message) => message.messageId)).toEqual(
            sent.slice(-4, -1).map((message) => message.messageId)
        );
    });
});

describe('статус отправки', () => {
    test('нет связи — сообщение остаётся в ленте со значком (!), а соседняя вкладка о нём не узнаёт', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'bez-svyazi');
        const { member } = await backend.join({ channelId, member: draft('Тральщик', '221') });

        const otherTab = testBackend();
        const seenByOther = watch(otherTab, channelId);

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Ушёл ли ты' },
        });

        // Код проверяем, текст — нет: текст — дело интерфейса (см. failsWith выше).
        expect(message.delivery?.status).toBe('failed');
        expect(message.delivery?.error?.code).toBe('offline');
        expect((await messages(backend, channelId)).some((item) => item.messageId === message.messageId)).toBe(true);
        expect(
            seenByOther.some((event) => event.type === 'message-added' && event.message.messageId === message.messageId)
        ).toBe(false);
    });

    test('офлайн-отправка не трогает общее состояние: текст переживает «перезагрузку вкладки»', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'perezhivaet-perezagruzku');
        const { member } = await backend.join({ channelId, member: draft('Буксир', '512') });

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'До связи' },
        });
        expect(message.delivery?.status).toBe('failed');

        // Новый бэкенд над тем же (подложным) хранилищем — как вкладка после перезагрузки.
        const reloadedOffline = testBackend();
        const stillThere = (await messages(reloadedOffline, channelId)).find(
            (item) => item.messageId === message.messageId
        );
        expect(stillThere?.delivery?.status).toBe('failed');
    });

    test('связь вернулась к моменту «перезагрузки» — неотправленное досылается само, без клика', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'svyaz-k-perezagruzke');
        const { member } = await backend.join({ channelId, member: draft('Ледокол', '901') });

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Два' },
        });

        // К моменту «перезагрузки» связь уже вернулась — новый бэкенд подхватывает
        // осевшее в ящике сам, конструктором, без клика по значку.
        vi.stubGlobal('navigator', { onLine: true });
        const reloaded = testBackend();
        await settle();

        const after = await messages(reloaded, channelId);
        const found = after.find((item) => item.messageId === message.messageId);
        expect(found).toBeDefined();
        expect(found?.delivery).toBeUndefined();
    });

    test('связь вернулась прямо во время открытой вкладки, без перезагрузки, — тоже досылается сама', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        // Своё окно для этой проверки, не общее из beforeEach: там window нарочно без
        // addEventListener (см. connection.test.ts), а здесь нужно настоящее событие online.
        const target = Object.assign(new EventTarget(), {
            localStorage: fakeStorage,
            sessionStorage: fakeSessionStorage,
            setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
        });
        (globalThis as unknown as { window: unknown }).window = target;

        const backend = testBackend();
        const channelId = await freshChannel(backend, 'vernulas-pryamo-seychas');
        const { member } = await backend.join({ channelId, member: draft('Корвет', '333') });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Жду' },
        });
        expect(message.delivery?.status).toBe('failed');

        vi.stubGlobal('navigator', { onLine: true });
        target.dispatchEvent(new Event('online'));
        await settle();

        const after = await messages(backend, channelId);
        const found = after.find((item) => item.messageId === message.messageId);
        expect(found).toBeDefined();
        expect(found?.delivery).toBeUndefined();
    });

    test('повтор без связи — то же самое неотправленное, без изменений и без второй копии', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'povtor-bez-svyazi');
        const { member } = await backend.join({ channelId, member: draft('Землечерпалка', '804') });

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Раз' },
        });

        const { message: retried } = await backend.retryMessage({
            channelId,
            memberId: member.memberId,
            message: { messageId: message.messageId },
        });

        expect(retried).toEqual(message);
        expect(
            (await messages(backend, channelId)).filter((item) => item.messageId === message.messageId)
        ).toHaveLength(1);
    });

    test('повтор, когда связь уже есть, — сообщение уходит; два клика подряд не плодят двойника', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'povtor-so-svyazyu');
        const { member } = await backend.join({ channelId, member: draft('Ледокол', '552') });

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Два' },
        });

        vi.stubGlobal('navigator', { onLine: true });
        const request = { channelId, memberId: member.memberId, message: { messageId: message.messageId } };
        // Не дожидаясь друг друга нарочно: тот самый двойной клик, для которого и нужна
        // проверка «уже записано» внутри mutate() (см. flushPending в localBackend.ts).
        const [firstResult, secondResult] = await Promise.all([
            backend.retryMessage(request),
            backend.retryMessage(request),
        ]);

        expect(firstResult.message.delivery).toBeUndefined();
        expect(secondResult.message.delivery).toBeUndefined();
        const stored = await messages(backend, channelId);
        expect(stored.filter((item) => item.messageId === message.messageId)).toHaveLength(1);
    });

    test('retryMessage для незнакомого сообщения — отказ unknown, а не выдумка', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'net-v-yashchike');
        const { member } = await backend.join({ channelId, member: draft('Шлюп', '446') });

        await failsWith(
            () =>
                backend.retryMessage({
                    channelId,
                    memberId: member.memberId,
                    message: { messageId: 'net-takogo-soobshcheniya' },
                }),
            'unknown'
        );
    });

    test('discardMessage выбрасывает неотправленное из ленты и из ящика — насовсем', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'peredumal');
        const { member } = await backend.join({ channelId, member: draft('Сейнер', '117') });

        vi.stubGlobal('navigator', { onLine: false });
        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Не надо' },
        });
        expect((await messages(backend, channelId)).some((item) => item.messageId === message.messageId)).toBe(true);

        await backend.discardMessage({ channelId, message: { messageId: message.messageId } });
        expect((await messages(backend, channelId)).some((item) => item.messageId === message.messageId)).toBe(false);

        // Выброшенное не воскресает и связью: раз человек передумал, повторной попытки
        // больше нет, даже когда автоподхват мог бы её найти.
        vi.stubGlobal('navigator', { onLine: true });
        const reloaded = testBackend();
        await settle();
        expect((await messages(reloaded, channelId)).some((item) => item.messageId === message.messageId)).toBe(false);
    });

    test('онлайновая отправка уважает messageId черновика — тот же приём, что и у Firebase-бэкенда', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'svoy-messageid');
        const { member } = await backend.join({ channelId, member: draft('Фрегат', '733') });

        const { message } = await backend.sendMessage({
            channelId,
            memberId: member.memberId,
            message: { text: 'Раз', messageId: 'svoy-id-42' },
        });

        expect(message.messageId).toBe('svoy-id-42');
    });
});

describe('гость (userId: null)', () => {
    test('getChannel отдаёт вход, а не рейд — ни участников, ни ленты, ни старшинства', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'dlya-gostya');
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Не для гостя' } });

        const snapshot = await backend.getChannel({ channelId, userId: null });

        // Название и closed — настоящие, это и есть весь экран входа; кто на рейде и кто
        // старший — уже сведения о рейде, а не о канале, и гостю их не видать вовсе
        // (см. localBackend.ts, previewOf).
        expect(snapshot?.channel.title).toBe('Проверка');
        expect(snapshot?.channel.owner).toBeUndefined();
        expect(snapshot?.members).toEqual([]);
        expect(snapshot?.messages).toEqual([]);
        expect(snapshot?.hasMoreMessages).toBe(false);
    });

    test('getChannelBySlug — тот же вход, по адресу вместо id', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'gost-po-adresu');
        await backend.join({ channelId, member: draft('Буревестник', '404') });

        const snapshot = await backend.getChannelBySlug({ slug: 'gost-po-adresu', userId: null });

        expect(snapshot?.channel.channelId).toBe(channelId);
        expect(snapshot?.members).toEqual([]);
        expect(snapshot?.messages).toEqual([]);
    });

    test('канала нет вовсе — тот же null, что и вошедшему', async () => {
        const backend = testBackend();
        expect(await backend.getChannel({ channelId: 'net-takogo', userId: null })).toBeNull();
    });

    test('subscribe гостю не приносит ничего — ни рейда, ни даже смены самого канала', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'podpiska-gostya');

        const heard = watch(backend, channelId, null);
        const { member } = await backend.join({ channelId, member: draft('Клипер', '208') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Тест' } });

        // Первый вошедший становится старшим — это меняет сам документ канала, но теперь
        // и это уже сведения о рейде: без участия в канал живьём не заглянуть вовсе
        // (см. firestore.rules, allow get: if isMember(channelId) на channels).
        expect(heard).toHaveLength(0);
    });

    test('userId не передан вовсе — тот же ответ, что и раньше, гостю не спутать с этим', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'bez-userid');
        await backend.join({ channelId, member: draft('Штурман', '609') });

        // Без userId вызывающему сам факт входа не важен (см. types.ts) — это внутренний,
        // не гостевой путь: полный список, живым позывным, и подписка без фильтра.
        const full = await backend.getChannel({ channelId });
        expect(full?.members[0].name).toBe('Штурман');

        const heard = watch(backend, channelId);
        await backend.sendMessage({ channelId, memberId: full!.members[0].memberId, message: { text: 'Видно всем' } });
        expect(heard.some((event) => event.type === 'message-added')).toBe(true);
    });
});

/**
 * Вошедший по-настоящему (`userId` — не `null`), но не тот, кто стоит на этом рейде: тот же
 * вход, а не рейд, что и у гостя выше, — needsPreview в localBackend.ts не различает, откуда
 * взялась причина превью, лишь бы вызывающего не было среди участников снимка. У настоящего
 * сервера этот же случай решает isMember(channelId) в firestore.rules (см. firebaseBackend.ts,
 * readChannelForUser) — здесь сверяться не с чем, кроме самого списка участников, и делает это
 * needsPreview напрямую.
 */
describe('вошедший не с этого рейда', () => {
    test('getChannel отдаёт вход, а не рейд — как и гостю', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'ne-s-etogo-rejda');
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Не для чужого' } });

        // 'stranger-uid' — вошедший, но точно не member.memberId (тот — случайный userId
        // подложной вкладки, см. localAccount() в auth.ts, testBackend() выше).
        const snapshot = await backend.getChannel({ channelId, userId: 'stranger-uid' });

        expect(snapshot?.channel.title).toBe('Проверка');
        expect(snapshot?.channel.owner).toBeUndefined();
        expect(snapshot?.members).toEqual([]);
        expect(snapshot?.messages).toEqual([]);
        expect(snapshot?.hasMoreMessages).toBe(false);
    });

    test('getChannelBySlug — тот же вход, по адресу вместо id', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'chuzhoy-po-adresu');
        await backend.join({ channelId, member: draft('Буревестник', '404') });

        const snapshot = await backend.getChannelBySlug({ slug: 'chuzhoy-po-adresu', userId: 'stranger-uid' });

        expect(snapshot?.channel.channelId).toBe(channelId);
        expect(snapshot?.members).toEqual([]);
        expect(snapshot?.messages).toEqual([]);
    });

    test('subscribe чужому не приносит ничего — ни рейда, ни даже смены самого канала', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'podpiska-chuzhogo');

        const heard = watch(backend, channelId, 'stranger-uid');
        const { member } = await backend.join({ channelId, member: draft('Клипер', '208') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Тест' } });

        expect(heard).toHaveLength(0);
    });

    test('свой же участник (userId === memberId) — превью не нужно, видно всё', async () => {
        const backend = testBackend();
        const channelId = await freshChannel(backend, 'svoy-uchastnik');
        const { member } = await backend.join({ channelId, member: draft('Секстант', '512') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Уже виднее' } });

        // Контраст с тестами выше: тот же снимок, но userId теперь и есть member.memberId —
        // needsPreview находит его в списке участников, и это обычное чтение, не превью.
        const full = await backend.getChannel({ channelId, userId: member.memberId });
        expect(full?.members[0].name).toBe('Секстант');
        // Не одна запись: join() и сам пишет строчку канала («встал в строй») раньше
        // отправленного здесь текста — сверяем, что нужная запись среди них есть, а не что
        // лента состоит только из неё.
        expect(full?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Уже виднее' })]));

        const heard = watch(backend, channelId, member.memberId);
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'И дальше видно' } });
        expect(heard.some((event) => event.type === 'message-added')).toBe(true);
    });
});
