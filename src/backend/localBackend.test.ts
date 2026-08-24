import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MAX_COURSE_LENGTH, MAX_MESSAGE_LENGTH, Member, Message, ShipNoticeMessage } from '@shared/types/channel';

import { MESSAGE_PAGE } from '@/config/network';

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

/** Пустой канал под своим адресом: демо-канал для проверок правил слишком населён. */
const freshChannel = async (backend: ChannelBackend, slug = 'proverka'): Promise<string> => {
    const { channel } = await backend.createChannel({ channel: { slug, title: 'Проверка' } });
    return channel.channelId;
};

/** Записанные события канала: по ним видно, что вкладка узнала о случившемся. */
const watch = (backend: ChannelBackend, channelId: string): ChannelEvent[] => {
    const seen: ChannelEvent[] = [];
    backend.subscribe({ channelId, onEvent: (event) => seen.push(event) });
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

beforeEach(() => {
    shelf.clear();
    wires.clear();
    // Проверки идут в node, а бэкенд живёт в браузере: подставляем ему хранилище, часы
    // и провод. Больше ему от окна ничего не нужно — замка (`navigator.locks`) тут нет,
    // и он обходится без очереди, как и в старом браузере.
    (globalThis as unknown as { window: unknown }).window = {
        localStorage: fakeStorage,
        setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    };
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = TestBroadcastChannel;
});

afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
    // На случай теста с подложными часами (см. «лента страницами»): следующему тесту
    // настоящие часы нужны настоящими, а не оставшимися от предыдущего.
    vi.useRealTimers();
});

describe('адрес канала', () => {
    test('заводится по годному адресу и находится по нему же', async () => {
        const backend = createLocalBackend();
        const { channel } = await backend.createChannel({ channel: { slug: 'eskadra', title: '  Эскадра  ' } });

        expect(channel.slug).toBe('eskadra');
        // Название подрезано: пробелы по краям в заголовке канала не значат ничего.
        expect(channel.title).toBe('Эскадра');
        expect((await backend.getChannelBySlug({ slug: 'eskadra' }))?.channel.channelId).toBe(channel.channelId);
    });

    test('адрес не той формы не проходит', async () => {
        const backend = createLocalBackend();

        await failsWith(() => backend.createChannel({ channel: { slug: '-', title: 'Полночь' } }), 'slug-invalid');
        await failsWith(() => backend.createChannel({ channel: { slug: 'Полночь', title: 'П' } }), 'slug-invalid');
    });

    test('занятый адрес не достаётся второму каналу, а себе самому не мешает', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();

        expect(await backend.getChannelBySlug({ slug: 'nesushchestvuyushchiy' })).toBeNull();
        expect(await backend.getChannel({ channelId: 'ch-net-takogo' })).toBeNull();
    });
});

describe('вход на рейд', () => {
    test('позывной и бортовой номер заняты — отказ, а с исправленными вход проходит', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        await [...Array(6).keys()].reduce(async (before, index) => {
            await before;
            await backend.join({ channelId, member: draft(`Борт ${index}`, `10${index}`) });
        }, Promise.resolve());

        expect(await members(backend, channelId)).toHaveLength(6);
    });

    test('вход отмечается в ленте, и позывной в записи — тот, с каким вошли', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        await backend.updateMember({ channelId, memberId: member.memberId, member: draft('Буревестник', '317') });

        const [notice] = await notices(backend, channelId);
        expect(notice.notice).toEqual({
            event: 'joined',
            before: { shipKind: 'pr1234', name: 'Альбатрос', hullNumber: '317' },
        });
    });

    test('место на рейде назначает канал, а не вкладка', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);

        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        // Место пришло в ответе целиком — с коридором, слотом и курсом. Без этого корабль
        // у каждой вкладки вставал бы на своё.
        expect(member.place.corridor).toBeTruthy();
        expect(member.place.slot).toBeGreaterThanOrEqual(0);
        expect(member.place.facing).toBeTruthy();
    });
});

describe('старшинство на рейде', () => {
    test('первый вставший на рейд становится старшим', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);

        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });

        expect(await ownerOf(backend, channelId)).toBe(first.memberId);
        expect(await ownerOf(backend, channelId)).not.toBe(second.memberId);
    });

    test('ушёл старший — старшинство достаётся тому, кто дольше всех на рейде', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member: first } = await backend.join({ channelId, member: draft('Первый', '101') });
        const { member: second } = await backend.join({ channelId, member: draft('Второй', '102') });

        // Подсказка устарела (названного уже нет на рейде) — правило по умолчанию не ломается.
        await backend.leave({ channelId, memberId: first.memberId, nextOwnerId: 'm-nikogo-net' });
        expect(await ownerOf(backend, channelId)).toBe(second.memberId);
    });

    test('ушли все — старшим станет следующий пришедший', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member: alone } = await backend.join({ channelId, member: draft('Один', '101') });

        await backend.leave({ channelId, memberId: alone.memberId });
        expect(await ownerOf(backend, channelId)).toBeUndefined();

        const { member: next } = await backend.join({ channelId, member: draft('Новый', '102') });
        expect(await ownerOf(backend, channelId)).toBe(next.memberId);
    });

    test('высаживает только старший, и не себя', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Один', '101') });

        await backend.leave({ channelId, memberId: member.memberId });

        const left = (await notices(backend, channelId)).find((message) => message.notice.event === 'left');
        expect(left && 'course' in left.notice).toBe(false);
    });
});

describe('переоснащение', () => {
    test('на каждую перемену своя запись, и обе стороны названы целиком', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        const before = (await messages(backend, channelId)).length;

        await backend.updateMember({ channelId, memberId: member.memberId, member: draft('Альбатрос', '317') });

        expect(await messages(backend, channelId)).toHaveLength(before);
    });

    test('оставшийся на своём месте с него не снимается', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend);
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const { member: renamed } = await backend.updateMember({
            channelId,
            memberId: member.memberId,
            member: draft('Буревестник', '317'),
        });

        expect(renamed.place).toEqual(member.place);
    });

    test('смена курса — тоже перемена места: корабль заходит заново', async () => {
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const first = createLocalBackend();
        const second = createLocalBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const heard = watch(second, channelId);
        await first.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Доброй вахты' } });

        const said = heard.filter((event) => event.type === 'message-added');
        expect(said).toHaveLength(1);
        expect(said[0].type === 'message-added' && textOf(said[0].message)).toBe('Доброй вахты');
    });

    test('вошедший в одной вкладке появляется в другой, и старшинство видно обеим', async () => {
        const first = createLocalBackend();
        const second = createLocalBackend();
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
        const first = createLocalBackend();
        const second = createLocalBackend();
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
        const first = createLocalBackend();
        const second = createLocalBackend();
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
        const first = createLocalBackend();
        const second = createLocalBackend();
        const channelId = await freshChannel(first);
        const { member } = await first.join({ channelId, member: draft('Альбатрос', '317') });

        const heard: ChannelEvent[] = [];
        const stop = second.subscribe({ channelId, onEvent: (event) => heard.push(event) });
        stop();
        await first.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Раз' } });

        expect(heard).toHaveLength(0);
    });

    test('новости чужого канала своей вкладке не достаются', async () => {
        const first = createLocalBackend();
        const second = createLocalBackend();
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
        const backend = createLocalBackend();
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
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend, 'malenkaya-lenta');
        const { member } = await backend.join({ channelId, member: draft('Альбатрос', '317') });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Раз' } });
        await backend.sendMessage({ channelId, memberId: member.memberId, message: { text: 'Два' } });

        expect((await backend.getChannel({ channelId }))?.hasMoreMessages).toBe(false);
        expect((await backend.getChannelBySlug({ slug: 'malenkaya-lenta' }))?.hasMoreMessages).toBe(false);
    });

    test('loadOlderMessages: before не найден в ленте — пустая страница, а не отказ', async () => {
        const backend = createLocalBackend();
        const channelId = await freshChannel(backend, 'bez-etogo-soobshcheniya');
        await backend.join({ channelId, member: draft('Альбатрос', '317') });

        const page = await backend.loadOlderMessages({ channelId, before: { messageId: 'net-takogo-soobshcheniya' } });
        expect(page).toEqual({ messages: [], hasMore: false });
    });

    test('loadOlderMessages: limit задаёт размер одной страницы, а не всей ленты', async () => {
        const backend = createLocalBackend();
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
