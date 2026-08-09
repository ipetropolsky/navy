import { Member, Message } from '@/types/channel';
import { isValidSlug } from '@/utils/slug';

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

const STORAGE_KEY = 'kilvater.v1';
const BROADCAST_NAME = 'kilvater';

/** Ответ приходит с задержкой нарочно: у настоящего сервера мгновенных ответов не бывает,
 *  и UI не должен рассчитывать на то, что состояние обновится к следующей строке кода. */
const LATENCY_MS = 40;

/** Состояние «сервера» целиком: каналов может быть сколько угодно, адресуются по id. */
interface ServerState {
    channels: Record<string, ChannelSnapshot>;
}

/**
 * Событие без служебных полей — их проставляет сам бэкенд. Omit по объединению нужно
 * применять к каждому варианту отдельно, иначе TypeScript схлопнет их в один тип
 * и потеряет разбор по `type`.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type ChannelEventPayload = DistributiveOmit<ChannelEvent, 'id' | 'channelId' | 'at'>;

const delay = <T>(value: T): Promise<T> =>
    new Promise((resolve) => {
        window.setTimeout(() => resolve(value), LATENCY_MS);
    });

const readState = (): ServerState => {
    const raw = localStore.read(STORAGE_KEY);
    if (raw) {
        try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && 'channels' in parsed) {
                return parsed as ServerState;
            }
        } catch {
            // Битый или чужой JSON по нашему ключу: начинаем заново.
        }
    }
    // Первый запуск: кладём демо-канал, чтобы чат было на что посмотреть. Если состояние
    // уже есть, сюда не попадаем и ничего не перетираем — вчерашний разговор остаётся.
    const fresh: ServerState = { channels: { [DEMO_CHANNEL_ID]: createDemoChannel() } };
    localStore.write(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
};

const writeState = (state: ServerState): void => {
    localStore.write(STORAGE_KEY, JSON.stringify(state));
};

const randomId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Адрес свободен, если его не занял другой канал. Сам себя канал не блокирует. */
const isSlugFree = (state: ServerState, slug: string, exceptId?: string): boolean =>
    !Object.values(state.channels).some((channel) => channel.slug === slug && channel.id !== exceptId);

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
        if (seenEventIds.has(event.id)) {
            return;
        }
        seenEventIds.add(event.id);
        listeners.get(event.channelId)?.forEach((listener) => listener(event));
    };

    wire?.addEventListener('message', (message: MessageEvent<ChannelEvent>) => deliver(message.data));

    /** Разослать событие всем: и соседним вкладкам, и подписчикам этой. */
    const emit = (channelId: string, payload: ChannelEventPayload): void => {
        const event = { ...payload, id: randomId('e'), channelId, at: Date.now() } as ChannelEvent;
        wire?.postMessage(event);
        deliver(event);
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
        const others = snapshot.members.filter((member) => member.id !== exceptId);
        if (others.some((member) => member.name.toLowerCase() === draft.name.trim().toLowerCase())) {
            throw new ChannelError('name-taken', 'Корабль с таким позывным уже на связи');
        }
        if (others.some((member) => member.hullNumber === draft.hullNumber.trim())) {
            throw new ChannelError('hull-taken', 'Этот бортовой номер уже занят');
        }
    };

    return {
        getChannel: (channelId) => delay(readState().channels[channelId] ?? null),

        getChannelBySlug: (slug) =>
            delay(Object.values(readState().channels).find((channel) => channel.slug === slug) ?? null),

        createChannel: async ({ slug, title }) => {
            const state = readState();
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы и дефис');
            }
            if (!isSlugFree(state, slug)) {
                throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
            }
            const snapshot: ChannelSnapshot = {
                id: randomId('ch'),
                slug,
                title: title.trim(),
                createdAt: Date.now(),
                members: [],
                messages: [],
            };
            state.channels[snapshot.id] = snapshot;
            writeState(state);
            emit(snapshot.id, { type: 'channel-created', channel: snapshot });
            return delay(snapshot);
        },

        updateChannel: async (channelId, { slug, title }) => {
            const state = readState();
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы и дефис');
            }
            if (!isSlugFree(state, slug, channelId)) {
                throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
            }
            const updated = mutate(channelId, (snapshot) => {
                snapshot.slug = slug;
                snapshot.title = title.trim();
                return { ...snapshot };
            });
            emit(channelId, { type: 'channel-updated', slug: updated.slug, title: updated.title });
            return delay(updated);
        },

        join: async (channelId, draft) => {
            const snapshot = requireChannel(channelId);
            if (snapshot.members.length >= MAX_MEMBERS) {
                throw new ChannelError('channel-full', 'В канале уже пять кораблей');
            }
            checkDraftIsFree(snapshot, draft);
            const member: Member = {
                id: randomId('m'),
                name: draft.name.trim(),
                hullNumber: draft.hullNumber.trim(),
                shipKind: draft.shipKind,
                color: draft.color,
                joinedAt: Date.now(),
            };
            mutate(channelId, (current) => current.members.push(member));
            emit(channelId, { type: 'member-joined', member });
            return delay(member);
        },

        updateMember: async (channelId, memberId, draft) => {
            checkDraftIsFree(requireChannel(channelId), draft, memberId);
            const updated = mutate(channelId, (current) => {
                const member = current.members.find((item) => item.id === memberId);
                if (!member) {
                    throw new ChannelError('member-not-found', 'Такого корабля в канале нет');
                }
                member.name = draft.name.trim();
                member.hullNumber = draft.hullNumber.trim();
                member.shipKind = draft.shipKind;
                member.color = draft.color;
                return { ...member };
            });
            emit(channelId, { type: 'member-updated', member: updated });
            return delay(updated);
        },

        leave: async (channelId, memberId) => {
            mutate(channelId, (snapshot) => {
                snapshot.members = snapshot.members.filter((member) => member.id !== memberId);
            });
            emit(channelId, { type: 'member-left', memberId });
            return delay(undefined);
        },

        sendMessage: async (channelId, draft) => {
            const message: Message = {
                id: randomId('msg'),
                memberId: draft.memberId,
                text: draft.text,
                threadId: draft.threadId,
                sentAt: Date.now(),
            };
            mutate(channelId, (snapshot) => snapshot.messages.push(message));
            emit(channelId, { type: 'message-added', message });
            return delay(message);
        },

        setTyping: (channelId, memberId, chars) => {
            // Мимо хранилища: печать нигде не оседает.
            emit(channelId, { type: 'typing', memberId, chars });
            return Promise.resolve();
        },

        subscribe: (channelId, listener): Unsubscribe => {
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
