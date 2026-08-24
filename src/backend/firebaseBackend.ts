import {
    Firestore,
    Timestamp,
    collection,
    doc,
    getDoc,
    onSnapshot,
    runTransaction,
    serverTimestamp,
} from 'firebase/firestore';

import { isValidSlug } from '@/utils/slug';
import { paths } from '@shared/config/model';
import { Channel } from '@shared/types/channel';

import { createLocalBackend, mirrorChannel } from '@/backend/localBackend';
import { ChannelBackend, ChannelError, ChannelSnapshot } from '@/backend/types';

/**
 * Настоящий бэкенд, шаг «каналы» (issue #65). Канал и бронь адреса переезжают в Firestore;
 * участники и лента остаются на локальном эмуляторе — им ещё предстоит переехать следующим
 * шагом, вместе с рейдом на сервере (см. docs/FIREBASE.md, «План по шагам»). Поэтому внутри
 * два источника данных сразу: свой `createLocalBackend()` для всего, кроме самого канала,
 * и Firestore для канала и брони адреса.
 *
 * `db` приходит доводом, а не берётся из `firestore()` в config/firebase.ts: тогда проверки
 * подсовывают сюда подключение к эмулятору, а приложение — настоящее, и подменять для этого
 * ничего внутри файла не приходится.
 *
 * Про ошибки. Свои отказы (адрес не той формы, адрес занят, канала нет) бросаются
 * `ChannelError` с тем же кодом и текстом, что и у локального бэкенда, — читатели уже умеют
 * их разбирать. Всё чужое (правило не пустило, оборвалась сеть) заворачивается в тот же
 * `ChannelError` с кодом `unknown`, а не пробрасывается как есть: весь остальной код
 * (см. `components/**`) ловит именно `ChannelError` и показывает `.message`, а на что-то
 * другое отвечает одной и той же общей фразой, — отдать чужую форму ошибки значило бы каждый
 * раз попадать в этот безымянный запасной путь. Разбор по кодам (`offline`, `permission-denied`
 * и так далее) — это #67, здесь достаточно одного кода на всё, что не наше.
 */

/**
 * Как канал хранится в Firestore на этом шаге. Ключ документа — сам `channelId`, отдельным
 * полем его в документе нет. Поля `owner` тут нет ни у кого: старшинство назначает сервер,
 * и назначать его будет #66 — до тех пор оно живёт только в зеркале на эмуляторе.
 */
interface ChannelDoc {
    slug: string;
    title: string;
    createdAt: number;
    serverAt: Timestamp;
}

/** Документ → сущность контракта. `serverAt` наружу не отдаётся — это внутренняя метка. */
const toChannel = (channelId: string, data: ChannelDoc): Channel => ({
    channelId,
    slug: data.slug,
    title: data.title,
    createdAt: data.createdAt,
});

/** Не наша ошибка — в ChannelError с кодом unknown; своя — возвращается как есть (см. выше). */
const toChannelError = (failure: unknown): ChannelError =>
    failure instanceof ChannelError ? failure : new ChannelError('unknown', 'Сервер не ответил. Попробуйте ещё раз');

/** Свой eventId на каждое событие — тем же способом, что и у локального бэкенда. */
const randomEventId = (): string => `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createFirebaseBackend({ db }: { db: Firestore }): ChannelBackend {
    // Рейд ещё не переехал: им заведует тот же эмулятор, что и раньше, а Firestore берёт
    // на себя только канал и бронь адреса.
    const local = createLocalBackend();

    const channelRef = (channelId: string) => doc(db, paths.channel({ channelId }));
    const slugRef = (slug: string) => doc(db, paths.slug({ slug }));

    /** Читает канал в Firestore и сводит его с зеркалом. Этим отвечают оба метода чтения. */
    const readChannel = async (channelId: string): Promise<ChannelSnapshot | null> => {
        const snap = await getDoc(channelRef(channelId));
        if (!snap.exists()) {
            return null;
        }
        return mirrorChannel(toChannel(channelId, snap.data() as ChannelDoc));
    };

    return {
        getChannel: async ({ channelId }) => {
            try {
                return await readChannel(channelId);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        getChannelBySlug: async ({ slug }) => {
            try {
                const reserved = await getDoc(slugRef(slug));
                if (!reserved.exists()) {
                    return null;
                }
                const { channelId } = reserved.data() as { channelId: string };
                return await readChannel(channelId);
            } catch (failure) {
                throw toChannelError(failure);
            }
        },

        createChannel: async ({ channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            // channelId назначаем сами и до записи, один раз: повтор с тем же id попадёт
            // в тот же документ, а не заведёт второй (см. docs/FIREBASE.md, «Повтор без
            // двойников»). doc() без родителя внутри существующей коллекции просто выбирает
            // случайный id, ничего не записывая, — это чисто клиентская операция.
            const channelId = doc(collection(db, paths.channels())).id;
            const created: Channel = { channelId, slug, title: title.trim(), createdAt: Date.now() };

            try {
                await runTransaction(db, async (transaction) => {
                    const reserved = await transaction.get(slugRef(slug));
                    if (reserved.exists()) {
                        throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                    }
                    // Бронь пройдёт правило, только если канал существует после этой же
                    // записи (`existsAfter` в firestore.rules) — поэтому оба документа пишутся
                    // здесь, в одной транзакции, а не по очереди двумя разными вызовами.
                    transaction.set(channelRef(channelId), {
                        slug: created.slug,
                        title: created.title,
                        createdAt: created.createdAt,
                        serverAt: serverTimestamp(),
                    });
                    transaction.set(slugRef(slug), { channelId, createdAt: Date.now() });
                });
            } catch (failure) {
                throw toChannelError(failure);
            }

            const snapshot = await mirrorChannel(created);
            return { channel: snapshot.channel };
        },

        updateChannel: async ({ channelId, channel: { slug, title } }) => {
            if (!isValidSlug(slug)) {
                throw new ChannelError('slug-invalid', 'В адресе только латинские буквы, цифры и дефис');
            }
            const trimmedTitle = title.trim();

            let createdAt: number;
            try {
                // Транзакция может повториться, если кто-то другой записал в те же документы
                // первым, а зеркало ниже пишет через свою очередь и повторов не ждёт вовсе.
                // Поэтому внутри — только Firestore, а зеркало освежаем один раз, уже после
                // того, как транзакция действительно прошла.
                createdAt = await runTransaction(db, async (transaction) => {
                    // Все чтения — до всех записей, это требование Firestore к транзакциям.
                    const channelSnap = await transaction.get(channelRef(channelId));
                    const newSlugSnap = await transaction.get(slugRef(slug));

                    if (!channelSnap.exists()) {
                        throw new ChannelError('channel-not-found', 'Канал не найден');
                    }
                    const current = channelSnap.data() as ChannelDoc;
                    // Бронь занята другим каналом — отказ; своя же бронь (переименование
                    // с тем же адресом) помехой не считается.
                    if (newSlugSnap.exists() && (newSlugSnap.data() as { channelId: string }).channelId !== channelId) {
                        throw new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
                    }

                    if (current.slug !== slug) {
                        // Новая бронь и снятие старой — в той же транзакции: освободившийся
                        // адрес честно свободен, а не повисает ничьим до следующей записи.
                        transaction.set(slugRef(slug), { channelId, createdAt: Date.now() });
                        transaction.delete(slugRef(current.slug));
                    }
                    transaction.update(channelRef(channelId), {
                        slug,
                        title: trimmedTitle,
                        serverAt: serverTimestamp(),
                    });

                    return current.createdAt;
                });
            } catch (failure) {
                throw toChannelError(failure);
            }

            const snapshot = await mirrorChannel({ channelId, slug, title: trimmedTitle, createdAt });
            return { channel: snapshot.channel };
        },

        // Рейд не переехал — эти пять делегируются локальному бэкенду один в один.
        join: local.join,
        updateMember: local.updateMember,
        leave: local.leave,
        kick: local.kick,
        sendMessage: local.sendMessage,

        subscribe: ({ channelId, onEvent }) => {
            const unsubscribeLocal = local.subscribe({ channelId, onEvent });

            // Первый снимок onSnapshot приходит целиком и не событие, а состояние — то же
            // самое, что уже отдал getChannel. Пропускаем его флагом: иначе каждое открытие
            // канала заново рождало бы событие о нём самом (см. docs/FIREBASE.md, «Подписка:
            // первый снимок — это состояние, а не события»).
            let first = true;
            const unsubscribeSnapshot = onSnapshot(
                channelRef(channelId),
                (snap) => {
                    if (first) {
                        first = false;
                        return;
                    }
                    // Документ пропал — событие не рождаем: удалить канал сегодня нечем,
                    // но на будущее (или на ручную правку в консоли) ответ тот же, что и всюду
                    // на пустой базе, — молчание, а не ошибка.
                    if (!snap.exists()) {
                        return;
                    }
                    const raw = toChannel(channelId, snap.data() as ChannelDoc);
                    // Событие несёт канал, сведённый с зеркалом, а не сырой из Firestore:
                    // в сыром нет owner, и такое событие стёрло бы старшего в интерфейсе.
                    mirrorChannel(raw)
                        .then(({ channel }) =>
                            onEvent({
                                eventId: randomEventId(),
                                channelId,
                                at: Date.now(),
                                type: 'channel-updated',
                                channel,
                            })
                        )
                        .catch(() => {
                            // Зеркало не откликнулось — событие теряем молча. Полный разбор
                            // сетевых и прочих отказов подписки на этом шаге не делаем (#67).
                        });
                },
                () => {
                    // Подписка оборвалась (правило не пустило, сети нет) — состояние связи
                    // сюда не переехало ещё, это тоже #67. Молчим, а не роняем вкладку.
                }
            );

            return () => {
                unsubscribeLocal();
                unsubscribeSnapshot();
            };
        },
    };
}
