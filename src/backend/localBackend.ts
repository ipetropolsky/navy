import {
    Channel,
    MAX_COURSE_LENGTH,
    MAX_MESSAGE_LENGTH,
    Member,
    MemberRef,
    Message,
    ShipNotice,
    isSameBerth,
    memberRef,
} from '@/types/channel';
import { limitMessage, overLimit } from '@/utils/limit';
import { isValidSlug } from '@/utils/slug';
import { localStore } from '@/utils/storage';

import { ServerState, archiveKey, restoreState } from '@/backend/migrate';
import { refitNotices, shipTitle } from '@/backend/notice';
import { isBerthFree, placeShip } from '@/backend/placement';
import { DEMO_CHANNEL_ID, createDemoChannel } from '@/backend/seed';
import {
    ChannelBackend,
    ChannelError,
    ChannelEvent,
    ChannelSnapshot,
    MAX_MEMBERS,
    MemberDraft,
    Unsubscribe,
} from '@/backend/types';

/**
 * Эмулятор сервера: состояние лежит JSON-ом в localStorage, вкладки обмениваются событиями
 * через BroadcastChannel. Этого хватает, чтобы разговаривать за разные корабли в разных
 * вкладках одного браузера — ровно так и тестируем, пока настоящего сервера нет.
 *
 * Почему хранилище и провод разделены. localStorage — это память: пережил перезагрузку
 * и отдал состояние тому, кто пришёл позже. BroadcastChannel — это провод: доставил новость
 * тем, кто уже здесь. Печать идёт только по проводу и никуда не пишется: она живёт секунды,
 * хранить её незачем, а перезагрузка не должна воскрешать чужой набор.
 */

const STORAGE_KEY = 'kilvater.state';
const BROADCAST_NAME = 'kilvater';

/**
 * Версия формы хранимого состояния. Поднимается всякий раз, когда меняется схема:
 * поля переименовали, добавили обязательное, разделили одно на два. Старое состояние
 * тогда не подходит — и это не теория: канал раньше адресовался прямо своим id, потом
 * у него появился отдельный slug, и сохранённые каналы стали не находиться по адресу
 * при живом и на вид исправном хранилище.
 *
 * Несовпадение версии значит «данные другой формы», а не «стереть»: состояние приводится
 * к нынешней форме приведением на каждый переход (см. `backend/migrate`). Поднимая версию
 * здесь, туда же кладут и функцию перехода — иначе разговор, лежащий в хранилище, дальше
 * этой выкладки не проедет.
 */
const STORAGE_VERSION = 15;

/** Ключ, под которым состояние лежало до появления версии. Чистим, чтобы не мусорить. */
const LEGACY_STORAGE_KEY = 'kilvater.v1';

/** Ответ приходит с задержкой нарочно: у настоящего сервера мгновенных ответов не бывает,
 *  и UI не должен рассчитывать на то, что состояние обновится к следующей строке кода. */
const LATENCY_MS = 40;

/**
 * Событие без служебных полей — их проставляет сам бэкенд. Omit по объединению нужно
 * применять к каждому варианту отдельно, иначе TypeScript схлопнет их в один тип
 * и потеряет разбор по `type`.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ChannelEventPayload = DistributiveOmit<ChannelEvent, 'eventId' | 'channelId' | 'at'>;

const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => {
        window.setTimeout(() => resolve(value), LATENCY_MS);
    });

const readState = (): ServerState => {
    const raw = localStore.read(STORAGE_KEY);
    const { state, was } = restoreState(raw, STORAGE_VERSION);
    // Прежнее откладываем, а не переписываем поверх: приведение могло чего-то не знать,
    // и тогда единственный шанс вернуть разговор — тот самый JSON, каким он лежал.
    // Раскладывается архив по версиям, так что копия у каждой формы своя и одна.
    if (raw && was !== null) {
        localStore.write(archiveKey(STORAGE_KEY, was), raw);
    }
    if (state) {
        // Переписываем только приведённое: у состояния, и так лежащего нынешней формой,
        // `was` пуст, и трогать хранилище на каждом чтении незачем.
        if (was !== null) {
            localStore.write(STORAGE_KEY, JSON.stringify(state));
        }
        return state;
    }
    // Восстанавливать оказалось не из чего: первый запуск, чужой JSON под нашим ключом или
    // форма старше всех написанных приведений. Кладём демо-канал, чтобы чат было на что
    // посмотреть; отложенное в архив при этом остаётся лежать.
    const fresh: ServerState = { version: STORAGE_VERSION, channels: { [DEMO_CHANNEL_ID]: createDemoChannel() } };
    localStore.write(STORAGE_KEY, JSON.stringify(fresh));
    localStore.remove(LEGACY_STORAGE_KEY);
    return fresh;
};

const writeState = (state: ServerState): void => {
    localStore.write(STORAGE_KEY, JSON.stringify(state));
};

const randomId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Адрес свободен, если его не занял другой канал. Сам себя канал не блокирует. */
const isSlugFree = (state: ServerState, slug: string, exceptId?: string): boolean =>
    !Object.values(state.channels).some(
        (snapshot) => snapshot.channel.slug === slug && snapshot.channel.channelId !== exceptId
    );

/**
 * Имя общей очереди на изменение состояния. Одно на все вкладки — они и стоят в ней друг
 * за другом.
 */
const STATE_LOCK = 'kilvater.state';

/**
 * Выполнить, пока никто другой не пишет. Это и есть то, чего у эмулятора не было: настоящий
 * сервер обрабатывает запросы по очереди, а здесь их обрабатывают вкладки, и каждая — у себя.
 *
 * Без очереди выходила потерянная запись, и она была видна глазами. Состояние лежит одним
 * JSON-ом, и всякое изменение — это «прочитал целиком, поменял, записал целиком». Две вкладки,
 * переставляющие корабли в один и тот же миг, читают одно и то же состояние, а записывают
 * каждая своё: та, что записала второй, стирает чужую перестановку. Хуже того, место на рейде
 * обе выбирают по своему снимку — обе видят точку свободной и обе на неё встают. В кадре это
 * и выглядит как пропажа: два корабля стоят на одном месте, ближний закрывает дальнего.
 *
 * Web Locks — межвкладочный замок, ровно для этого и заведённый: очередь у него общая на
 * происхождение, и пока один держит замок, остальные ждут. Внутрь замка убрано всё решение
 * целиком — и чтение состояния, и проверки, и выбор места, — иначе вкладка решала бы по
 * снимку, снятому до своей очереди.
 *
 * Замка может не быть (старый браузер, jsdom в юнит-проверках) — тогда работаем без него:
 * без очереди, но так же, как раньше. Одной вкладке она и не нужна: JS однопоточен,
 * и «прочитал — поменял — записал» внутри вкладки и так неделимо.
 */
const exclusive = <T>(run: () => T): Promise<T> => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (!locks) {
        return Promise.resolve().then(run);
    }
    return locks.request(STATE_LOCK, run);
};

/** Прочитал — поменял — записал, стоя в общей очереди. Бросил — не записал вовсе. */
const mutateState = <T>(change: (state: ServerState) => T): Promise<T> =>
    exclusive(() => {
        const state = readState();
        const result = change(state);
        writeState(state);
        return result;
    });

/** То же самое, но про один канал: его отсутствие — общая для всех ошибка. */
const mutate = <T>(channelId: string, change: (channel: ChannelSnapshot) => T): Promise<T> =>
    mutateState((state) => {
        const channel = state.channels[channelId];
        if (!channel) {
            throw new ChannelError('channel-not-found', 'Канал не найден');
        }
        return change(channel);
    });

export function createLocalBackend(): ChannelBackend {
    // Чтение состояния при старте заодно кладёт демо-канал в хранилище, если его там нет.
    // Иначе мок появлялся бы только после того, как кто-то откроет канал.
    readState();

    const listeners = new Map<string, Set<(event: ChannelEvent) => void>>();
    const seenEventIds = new Set<string>();

    const wire = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BROADCAST_NAME);

    const deliver = (event: ChannelEvent): void => {
        // Событие может прийти дважды: своё эхо и чужая доставка. Второй раз пропускаем.
        if (seenEventIds.has(event.eventId)) {
            return;
        }
        seenEventIds.add(event.eventId);
        listeners.get(event.channelId)?.forEach((listener) => listener(event));
    };

    wire?.addEventListener('message', (message: MessageEvent<ChannelEvent>) => deliver(message.data));

    /** Разослать событие всем: и соседним вкладкам, и подписчикам этой. */
    const emit = (channelId: string, payload: ChannelEventPayload): void => {
        const event = { ...payload, eventId: randomId('e'), channelId, at: Date.now() } as ChannelEvent;
        wire?.postMessage(event);
        deliver(event);
    };

    /**
     * Записать в ленту запись от самого канала и разослать её как обычное сообщение.
     *
     * Автор приходит ссылкой, а не одним id, потому что снимок к ней прикладывает тот, кто
     * зовёт: у входа это вошедший, у переоснащения — корабль, каким он был до перемены,
     * у ухода — ушедший, которого в списке участников уже нет.
     */
    const postNotice = async (
        channelId: string,
        author: MemberRef,
        notice: ShipNotice,
        sentAt: number
    ): Promise<void> => {
        const message: Message = { messageId: randomId('msg'), author, kind: 'system', notice, sentAt };
        await mutate(channelId, (current) => current.messages.push(message));
        emit(channelId, { type: 'message-added', message });
    };

    /** Позывной и бортовой номер должны быть свободны: иначе в ленте не различить, кто говорит. */
    const checkDraftIsFree = (snapshot: ChannelSnapshot, draft: MemberDraft, exceptId?: string): void => {
        const others = snapshot.members.filter((member) => member.memberId !== exceptId);
        if (others.some((member) => member.name.toLowerCase() === draft.name.trim().toLowerCase())) {
            throw new ChannelError('name-taken', 'Корабль с таким позывным уже на связи');
        }
        if (others.some((member) => member.hullNumber === draft.hullNumber.trim())) {
            throw new ChannelError('hull-taken', 'Этот бортовой номер уже занят');
        }
    };

    /**
     * Вычеркнуть корабль из канала и передать старшинство, если ушёл сам старший. Общее
     * для ухода и высадки: событий это два разных, а происходит одно и то же.
     *
     * Старшинство переходит к тому, кто дольше всех на рейде. Оставлять канал без старшего
     * нельзя: высаживать тогда некому, и первый же ушедший запирал бы правило навсегда.
     * Ушли все — старшего снова нет, и им станет тот, кто придёт следующим.
     *
     * Проверки высадки приходят сюда отдельным доводом и выполняются в той же очереди, что
     * и само вычёркивание: спрошенное до очереди к моменту записи успевает устареть — старший
     * мог смениться, а высаживаемый уйти сам.
     */
    const dropMember = async (
        channelId: string,
        memberId: string,
        check?: (snapshot: ChannelSnapshot) => void
    ): Promise<Member | null> => {
        const { gone, channel } = await mutate(channelId, (snapshot) => {
            check?.(snapshot);
            const member = snapshot.members.find((item) => item.memberId === memberId) ?? null;
            snapshot.members = snapshot.members.filter((item) => item.memberId !== memberId);
            if (snapshot.channel.owner?.memberId !== memberId) {
                return { gone: member, channel: null };
            }
            const senior = [...snapshot.members].sort((one, other) => one.joinedAt - other.joinedAt)[0];
            snapshot.channel.owner = senior ? { memberId: senior.memberId } : undefined;
            return { gone: member, channel: { ...snapshot.channel } };
        });
        emit(channelId, { type: 'member-left', member: { memberId } });
        if (channel) {
            emit(channelId, { type: 'channel-updated', channel });
        }
        return gone;
    };

    return {
        getChannel: ({ channelId }) => delay(readState().channels[channelId] ?? null),

        getChannelBySlug: ({ slug }) =>
            delay(Object.values(readState().channels).find((snapshot) => snapshot.channel.slug === slug) ?? null),

        createChannel: async ({ channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            // Свободен ли адрес, спрашиваем в той же очереди, в которой канал и заводится:
            // между вопросом и записью адрес мог занять кто-то из соседней вкладки.
            const channel = await mutateState((state) => {
                if (!isSlugFree(state, slug)) {
                    throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                }
                const created: Channel = {
                    channelId: randomId('ch'),
                    slug,
                    title: title.trim(),
                    createdAt: Date.now(),
                };
                state.channels[created.channelId] = { channel: created, members: [], messages: [] };
                return created;
            });
            emit(channel.channelId, { type: 'channel-created', channel });
            return delay({ channel });
        },

        updateChannel: async ({ channelId, channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            const updated = await mutateState((state) => {
                if (!isSlugFree(state, slug, channelId)) {
                    throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                }
                const snapshot = state.channels[channelId];
                if (!snapshot) {
                    throw new ChannelError('channel-not-found', 'Канал не найден');
                }
                snapshot.channel.slug = slug;
                snapshot.channel.title = title.trim();
                return { ...snapshot.channel };
            });
            emit(channelId, { type: 'channel-updated', channel: updated });
            return delay({ channel: updated });
        },

        join: async ({ channelId, member: draft }) => {
            // Всё решение целиком — в одной очереди: и сколько кораблей в канале, и свободен ли
            // позывной, и какое место достанется. Спрошенное до очереди устаревает к записи,
            // и на рейде от этого появлялись два корабля на одной точке.
            const { member, channel } = await mutate(channelId, (current) => {
                if (current.members.length >= MAX_MEMBERS) {
                    throw new ChannelError('channel-full', 'В канале уже пять кораблей');
                }
                checkDraftIsFree(current, draft);
                // Место на рейде назначаем здесь, а не в сцене: тогда оно уедет вместе
                // с участником во все вкладки, и корабль у всех окажется в одном и том же месте.
                // Выбранное в форме место — пожелание: занято, значит корабль встанет
                // на свободное.
                const place = placeShip(draft.shipKind, current.members, draft.berth, draft.facing);
                if (!place) {
                    throw new ChannelError('channel-full', 'На рейде не осталось свободного места');
                }
                const joined: Member = {
                    memberId: randomId('m'),
                    name: draft.name.trim(),
                    hullNumber: draft.hullNumber.trim(),
                    shipKind: draft.shipKind,
                    color: draft.color,
                    place,
                    joinedAt: Date.now(),
                };
                current.members.push(joined);
                // Первый вставший на рейд становится старшим: канал заводят пустым, и до этого
                // мига отвечать за него некому.
                if (current.channel.owner) {
                    return { member: joined, channel: null };
                }
                current.channel.owner = { memberId: joined.memberId };
                return { member: joined, channel: { ...current.channel } };
            });
            emit(channelId, { type: 'member-joined', member });
            if (channel) {
                emit(channelId, { type: 'channel-updated', channel });
            }
            // Вход отмечается в ленте: корабль заплывает в кадр молча, и без строчки в чате
            // непонятно, кто пришёл. В записи лежит снимок того, как корабль звали сейчас, —
            // тогда строчка останется прежней, даже если он потом сменит позывной.
            await postNotice(
                channelId,
                memberRef(member),
                { event: 'joined', before: shipTitle(member) },
                member.joinedAt
            );
            return delay({ member });
        },

        updateMember: async ({ channelId, memberId, member: draft }) => {
            let before: Member | null = null;
            const updated = await mutate(channelId, (current) => {
                checkDraftIsFree(current, draft, memberId);
                const member = current.members.find((item) => item.memberId === memberId);
                if (!member) {
                    throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
                }
                // Запоминаем, каким корабль был: по этому и складывается строчка о переоснащении.
                before = { ...member };
                member.name = draft.name.trim();
                member.hullNumber = draft.hullNumber.trim();
                member.shipKind = draft.shipKind;
                member.color = draft.color;
                // Место меняем, только если корабль и правда куда-то идёт: у оставшегося
                // на своём месте не должна заново разыгрываться сторона захода.
                //
                // «Своё место» проверяется заново, потому что переоснащение меняет и размер:
                // катер, ставший ракетным кораблём, может уже не помещаться там, где стоял,
                // — и тогда ему приходится искать себе место, даже если он его не выбирал.
                const others = current.members.filter((item) => item.memberId !== memberId);
                const wanted = draft.berth ?? member.place;
                const stays = isSameBerth(member.place, wanted) && isBerthFree(member.place, draft.shipKind, others);
                // Смена курса — тоже перемена, и такая же, как перемена места: развернуться
                // на якоре корабль не может, а отзеркалить силуэт на глазах — то же самое,
                // что подменить его. Поэтому и здесь корабль снимается с места и заходит
                // заново, с другого борта: сторона захода считается от нового курса.
                const turns = Boolean(draft.facing) && draft.facing !== member.place.facing;
                if (!stays || turns) {
                    member.place = placeShip(draft.shipKind, others, wanted, draft.facing) ?? member.place;
                }
                return { ...member };
            });
            emit(channelId, { type: 'member-updated', member: updated });
            // По записи на каждую перемену, одна за другой: у каждой свой номер, своё время
            // и свой ответ — в ленте они встают отдельными сообщениями. Подряд, а не разом:
            // запись идёт через общую очередь, и каждая должна лечь в состояние целиком,
            // прежде чем возьмётся следующая.
            // Снимок в записи — прежний, до перемены: запись стоит в прежней цепочке ленты
            // и рассказывает о том корабле, а новый начинается после неё (см. группировку
            // в `components/chat/MessageList`).
            const author = before ? memberRef(before) : { memberId: updated.memberId };
            for (const notice of before ? refitNotices(before, updated) : []) {
                // eslint-disable-next-line no-await-in-loop -- очередь тут и нужна: записи ложатся в ленту по одной и по порядку
                await postNotice(channelId, author, notice, Date.now());
            }
            return delay({ member: updated });
        },

        leave: async ({ channelId, memberId, course = '' }) => {
            // Длину курса проверяет бэкенд, а не только шторка ухода: интерфейсов может стать
            // больше одного, и правило должно жить там, где данные, а не там, где поле ввода.
            const newCourse = course.trim();
            if (overLimit(newCourse, MAX_COURSE_LENGTH)) {
                throw new ChannelError('course-too-long', limitMessage(newCourse, MAX_COURSE_LENGTH));
            }
            // Кем корабль был, узнаём до того, как вычеркнем его: после вычёркивания
            // называть в строчке будет нечего.
            const gone = await dropMember(channelId, memberId);
            if (gone) {
                // Курса может и не быть — тогда поля в записи нет вовсе, а не пустая строка:
                // «не сказал» и «сказал пустое» в хранилище одно и то же, и хранить это
                // двумя разными способами значит однажды сложить строчку про пустой курс.
                await postNotice(
                    channelId,
                    memberRef(gone),
                    { event: 'left', before: shipTitle(gone), ...(newCourse ? { course: newCourse } : {}) },
                    Date.now()
                );
            }
            return delay(undefined);
        },

        kick: async ({ channelId, memberId, member: { memberId: targetId } }) => {
            // Кто распорядился: запись встаёт в его цепочку, и снимок в ней его же. Берём
            // старшего из того же снимка состояния, в котором проверяем его право высаживать.
            let senior: Member | null = null;
            const gone = await dropMember(channelId, targetId, (snapshot) => {
                senior = snapshot.members.find((item) => item.memberId === memberId) ?? null;
                if (snapshot.channel.owner?.memberId !== memberId) {
                    throw new ChannelError('not-senior', 'Высадить корабль может только старший на рейде');
                }
                if (targetId === memberId) {
                    throw new ChannelError('not-senior', 'Старший снимается с рейда сам, а не высаживает себя');
                }
                if (!snapshot.members.some((item) => item.memberId === targetId)) {
                    throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
                }
            });
            if (gone) {
                // Запись от старшего, а не от высаженного: распорядился он, и по тому, в чьей
                // цепочке она встала, это видно.
                await postNotice(
                    channelId,
                    senior ? memberRef(senior) : { memberId },
                    { event: 'kicked', before: shipTitle(gone) },
                    Date.now()
                );
            }
            return delay(undefined);
        },

        sendMessage: async ({ channelId, memberId, message: draft }) => {
            // Длину проверяет бэкенд, а не только форма: интерфейсов может стать больше одного,
            // и правило должно жить там, где данные, а не там, где поле ввода.
            if (overLimit(draft.text, MAX_MESSAGE_LENGTH)) {
                throw new ChannelError('message-too-long', limitMessage(draft.text, MAX_MESSAGE_LENGTH));
            }
            // Снимок автора складываем в той же очереди, в которой сообщение и записывается:
            // отправитель на этот миг ещё в составе, и другого случая спросить, как он тогда
            // выглядел, уже не будет — снимется с рейда, и в ленте останется одно сообщение.
            const message = await mutate(channelId, (snapshot) => {
                const author = snapshot.members.find((item) => item.memberId === memberId);
                const posted: Message = {
                    messageId: randomId('msg'),
                    author: author ? memberRef(author) : { memberId },
                    text: draft.text,
                    thread: draft.thread,
                    sentAt: Date.now(),
                };
                snapshot.messages.push(posted);
                return posted;
            });
            emit(channelId, { type: 'message-added', message });
            return delay({ message });
        },

        subscribe: ({ channelId, onEvent: listener }): Unsubscribe => {
            const forChannel = listeners.get(channelId) ?? new Set();
            forChannel.add(listener);
            listeners.set(channelId, forChannel);
            return () => {
                forChannel.delete(listener);
                if (!forChannel.size) {
                    listeners.delete(channelId);
                }
            };
        },
    };
}
