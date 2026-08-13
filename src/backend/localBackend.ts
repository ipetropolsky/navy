import { Channel, MAX_MESSAGE_LENGTH, Member, Message, SHIP_KIND_LABELS, ShipKind, isSameBerth } from '@/types/channel';
import { isValidSlug } from '@/utils/slug';

import { isBerthFree, placeShip } from '@/backend/placement';
import { DEMO_CHANNEL_ID, createDemoChannel } from '@/backend/seed';
import { localStore } from '@/backend/storage';
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
 * при живом и на вид исправном хранилище. Проверка версии превращает такую поломку
 * в понятное «начали заново» вместо молчаливого «канала нет».
 *
 * Данные при несовпадении версии сейчас выбрасываются, и это временно. Пока идёт разработка
 * и настоящих разговоров ни у кого нет, тащить хвост приведений ради вчерашнего тестового
 * канала незачем. Правило же — обратное: к чужой истории относимся бережно, изменения делаем
 * совместимыми, а версия схемы означает «привести данные к нынешней форме», а не «стереть».
 * Здесь должна появиться миграция раньше, чем в канале заведётся первый неигрушечный разговор.
 * Подробно — в docs/BACKEND-API.md, раздел «К чужим данным — бережно».
 */
const STORAGE_VERSION = 11;

/** Ключ, под которым состояние лежало до появления версии. Чистим, чтобы не мусорить. */
const LEGACY_STORAGE_KEY = 'kilvater.v1';

/** Ответ приходит с задержкой нарочно: у настоящего сервера мгновенных ответов не бывает,
 *  и UI не должен рассчитывать на то, что состояние обновится к следующей строке кода. */
const LATENCY_MS = 40;

/** Состояние «сервера» целиком: каналов может быть сколько угодно, адресуются по id. */
interface ServerState {
    version: number;
    channels: Record<string, ChannelSnapshot>;
}

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
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Partial<ServerState>;
            // Версия должна совпасть: состояние прошлой схемы выглядит исправным,
            // но ведёт себя непредсказуемо — лучше начать заново, чем ловить призраков.
            if (parsed.version === STORAGE_VERSION && parsed.channels) {
                return parsed as ServerState;
            }
        } catch {
            // Битый или чужой JSON по нашему ключу: начинаем заново.
        }
    }
    // Первый запуск (или смена схемы): кладём демо-канал, чтобы чат было на что посмотреть.
    // Если состояние есть и версия совпала, сюда не попадаем и ничего не перетираем —
    // вчерашний разговор остаётся.
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

/** Название силуэта со строчной буквы: в строчке оно идёт не первым словом. */
const kindLabel = (kind: ShipKind): string => {
    const label = SHIP_KIND_LABELS[kind];
    return label.charAt(0).toLowerCase() + label.slice(1);
};

/**
 * Как корабль зовут целиком: тип, позывной, бортовой номер. Именно в таком порядке его
 * и называют — «сторожевой катер „Гром“ 111», — и с этого начинается любая системная строчка,
 * иначе по одному позывному не понять, о ком речь.
 */
const shipTitle = (member: Member): string =>
    `${SHIP_KIND_LABELS[member.shipKind]} «${member.name}» ${member.hullNumber}`;

/**
 * Строчка о переоснащении: кем корабль был и что в нём поменялось. Перечисляем только
 * изменившееся — «„Буран“ 042 теперь „Буран“ 517» читается как оговорка, а не как новость.
 * Новые значения выделены жирным: глазу нужно за что-то зацепиться, а искать отличие
 * между двумя почти одинаковыми строчками он не должен.
 *
 * Цвет позывного не отмечаем: он не меняет ни имени, ни облика.
 */
const refitNotice = (before: Member, after: Member): string | null => {
    const changes: string[] = [];
    if (before.shipKind !== after.shipKind) {
        changes.push(kindLabel(after.shipKind));
    }
    if (before.name !== after.name) {
        changes.push(`«${after.name}»`);
    }
    if (before.hullNumber !== after.hullNumber) {
        changes.push(after.hullNumber);
    }
    return changes.length ? `${shipTitle(before)} теперь **${changes.join(' ')}**` : null;
};

/** Адрес свободен, если его не занял другой канал. Сам себя канал не блокирует. */
const isSlugFree = (state: ServerState, slug: string, exceptId?: string): boolean =>
    !Object.values(state.channels).some(
        (snapshot) => snapshot.channel.slug === slug && snapshot.channel.channelId !== exceptId
    );

/** Прочитал — поменял — записал одним движением: между вкладками так теряется меньше. */
const mutate = <T>(channelId: string, change: (channel: ChannelSnapshot) => T): T => {
    const state = readState();
    const channel = state.channels[channelId];
    if (!channel) {
        throw new ChannelError('channel-not-found', 'Канал не найден');
    }
    const result = change(channel);
    writeState(state);
    return result;
};

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

    /** Записать в ленту строчку от самого канала и разослать её как обычное сообщение. */
    const postNotice = (channelId: string, memberId: string, text: string, sentAt: number): void => {
        const notice: Message = { messageId: randomId('msg'), author: { memberId }, kind: 'system', text, sentAt };
        mutate(channelId, (current) => current.messages.push(notice));
        emit(channelId, { type: 'message-added', message: notice });
    };

    const requireChannel = (channelId: string): ChannelSnapshot => {
        const found = readState().channels[channelId];
        if (!found) {
            throw new ChannelError('channel-not-found', 'Канал не найден');
        }
        return found;
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
     */
    const dropMember = (channelId: string, memberId: string): Member | null => {
        const { gone, channel } = mutate(channelId, (snapshot) => {
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
            const state = readState();
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            if (!isSlugFree(state, slug)) {
                throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
            }
            const channel: Channel = {
                channelId: randomId('ch'),
                slug,
                title: title.trim(),
                createdAt: Date.now(),
            };
            state.channels[channel.channelId] = { channel, members: [], messages: [] };
            writeState(state);
            emit(channel.channelId, { type: 'channel-created', channel });
            return delay({ channel });
        },

        updateChannel: async ({ channelId, channel: { slug, title } }) => {
            const state = readState();
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            if (!isSlugFree(state, slug, channelId)) {
                throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
            }
            const updated = mutate(channelId, (snapshot) => {
                snapshot.channel.slug = slug;
                snapshot.channel.title = title.trim();
                return { ...snapshot.channel };
            });
            emit(channelId, { type: 'channel-updated', channel: updated });
            return delay({ channel: updated });
        },

        join: async ({ channelId, member: draft }) => {
            const snapshot = requireChannel(channelId);
            if (snapshot.members.length >= MAX_MEMBERS) {
                throw new ChannelError('channel-full', 'В канале уже пять кораблей');
            }
            checkDraftIsFree(snapshot, draft);
            // Место на рейде назначаем здесь, а не в сцене: тогда оно уедет вместе с участником
            // во все вкладки, и корабль у всех окажется в одном и том же месте. Выбранное
            // в форме место — пожелание: занято, значит корабль встанет на свободное.
            const place = placeShip(draft.shipKind, snapshot.members, draft.berth, draft.facing);
            if (!place) {
                throw new ChannelError('channel-full', 'На рейде не осталось свободного места');
            }
            const member: Member = {
                memberId: randomId('m'),
                name: draft.name.trim(),
                hullNumber: draft.hullNumber.trim(),
                shipKind: draft.shipKind,
                color: draft.color,
                place,
                joinedAt: Date.now(),
            };
            // Первый вставший на рейд становится старшим: канал заводят пустым, и до этого
            // мига отвечать за него некому.
            const channel = mutate(channelId, (current) => {
                current.members.push(member);
                if (current.channel.owner) {
                    return null;
                }
                current.channel.owner = { memberId: member.memberId };
                return { ...current.channel };
            });
            emit(channelId, { type: 'member-joined', member });
            if (channel) {
                emit(channelId, { type: 'channel-updated', channel });
            }
            // Вход отмечается в ленте: корабль заплывает в кадр молча, и без строчки в чате
            // непонятно, кто пришёл. Текст складывает бэкенд — тогда он останется прежним,
            // даже если корабль потом сменит позывной.
            postNotice(channelId, member.memberId, `${shipTitle(member)} встал на рейд`, member.joinedAt);
            return delay({ member });
        },

        updateMember: async ({ channelId, memberId, member: draft }) => {
            checkDraftIsFree(requireChannel(channelId), draft, memberId);
            let before: Member | null = null;
            const updated = mutate(channelId, (current) => {
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
                if (!stays) {
                    member.place = placeShip(draft.shipKind, others, wanted, draft.facing) ?? member.place;
                } else if (draft.facing && draft.facing !== member.place.facing) {
                    // Место оставили, а курс сменили: корабль разворачивается там, где стоит,
                    // никуда не идя. Сторону захода при этом не трогаем — она про то, откуда
                    // он сюда пришёл, и разворот на якоре её не отменяет.
                    member.place = { ...member.place, facing: draft.facing };
                }
                return { ...member };
            });
            emit(channelId, { type: 'member-updated', member: updated });
            const text = before && refitNotice(before, updated);
            if (text) {
                postNotice(channelId, updated.memberId, text, Date.now());
            }
            return delay({ member: updated });
        },

        leave: async ({ channelId, memberId }) => {
            // Кем корабль был, узнаём до того, как вычеркнем его: после вычёркивания
            // называть в строчке будет нечего.
            const gone = dropMember(channelId, memberId);
            if (gone) {
                // «Сняться с рейда» — это и значит покинуть якорную стоянку: подняли якорь
                // и пошли. Ровно то, что происходит в кадре, и ровно так об этом и говорят.
                postNotice(channelId, memberId, `${shipTitle(gone)} снялся с рейда`, Date.now());
            }
            return delay(undefined);
        },

        kick: async ({ channelId, memberId, member: { memberId: targetId } }) => {
            const snapshot = requireChannel(channelId);
            if (snapshot.channel.owner?.memberId !== memberId) {
                throw new ChannelError('not-senior', 'Высадить корабль может только старший на рейде');
            }
            if (targetId === memberId) {
                throw new ChannelError('not-senior', 'Старший снимается с рейда сам, а не высаживает себя');
            }
            if (!snapshot.members.some((item) => item.memberId === targetId)) {
                throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
            }
            const gone = dropMember(channelId, targetId);
            if (gone) {
                // Строчка от старшего, а не от высаженного: распорядился он, и по цвету
                // позывного в ленте это видно.
                postNotice(channelId, memberId, `${shipTitle(gone)} выдворен с рейда`, Date.now());
            }
            return delay(undefined);
        },

        sendMessage: async ({ channelId, memberId, message: draft }) => {
            // Длину проверяет бэкенд, а не только форма: интерфейсов может стать больше одного,
            // и правило должно жить там, где данные, а не там, где поле ввода.
            if (draft.text.length > MAX_MESSAGE_LENGTH) {
                throw new ChannelError(
                    'message-too-long',
                    `Максимум ${MAX_MESSAGE_LENGTH} символов, у вас ${draft.text.length}`
                );
            }
            const message: Message = {
                messageId: randomId('msg'),
                author: { memberId },
                text: draft.text,
                thread: draft.thread,
                sentAt: Date.now(),
            };
            mutate(channelId, (snapshot) => snapshot.messages.push(message));
            emit(channelId, { type: 'message-added', message });
            return delay({ message });
        },

        setTyping: ({ channelId, memberId, typing }) => {
            // Мимо хранилища: печать нигде не оседает.
            emit(channelId, { type: 'typing', member: { memberId }, typing });
            return Promise.resolve();
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
