import { sessionStore } from '@/utils/storage';
import { ChatMessage } from '@shared/types/channel';

import { ChannelSnapshot } from '@/backend/types';

/**
 * Ящик неотправленного: что набрано в этой вкладке и ещё не подтверждено сервером
 * (см. docs/FIREBASE.md, «Ящик неотправленного»). Оба бэкенда пишут сюда одинаково —
 * модуль не знает, Firestore за ним стоит или локальный эмулятор.
 *
 * Память — `sessionStorage`, а не `localStorage`: ящик про эту вкладку, а `localStorage`
 * в этом проекте общий на браузер (в нём — состояние «сервера» локального бэкенда).
 * Неотправленное, положенное в общую память, всплывало бы в соседней вкладке чужой строкой.
 * Перезагрузку вкладки такая память переживает, а закрытие — нет, и это осознанная граница:
 * то, что человек не отправил и закрыл, он не отправлял.
 *
 * Ключ — `kilvater.outbox.<userId>.<channelId>`: один человек — один браузер, а вкладок
 * несколько, и набранное в одной не должно приезжать в другую. `userId`, а не `memberId`:
 * у настоящего бэкенда они равны всегда, а у локального memberId свой на каждую вкладку,
 * а userId — общий (см. `LOCAL_ACCOUNT` в auth.ts), и по нему ящик находит и пишущая,
 * и читающая сторона одну и ту же запись.
 *
 * Собственная очередь Firestore (незаписанное в IndexedDB) при этом никуда не девается
 * и лежит по-своему — но она про запись документа, а этот ящик про набранный человеком
 * текст и про то, что ему показать (см. firebaseBackend.ts).
 */

const outboxKey = (userId: string, channelId: string): string => `kilvater.outbox.${userId}.${channelId}`;

/**
 * Что лежит в ящике канала прямо сейчас. Порядок записи не гарантирован — кому нужен
 * хронологический, сортирует по `sentAt` сам (см. слияние в firebaseBackend.ts/localBackend.ts).
 */
export const readOutbox = (userId: string, channelId: string): ChatMessage[] => {
    const raw = sessionStore.read(outboxKey(userId, channelId));
    if (!raw) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
    } catch {
        // Испорченная запись — старый формат или чужая правка руками. Не рушим вкладку
        // из-за неё: пустой ящик безопаснее выдуманного.
        return [];
    }
};

const writeOutbox = (userId: string, channelId: string, messages: ChatMessage[]): void => {
    if (messages.length === 0) {
        // Пустой ящик не должен лежать пустым массивом вечно — если запись когда-нибудь
        // почитают руками (или другой вкладкой того же человека), там должно быть пусто,
        // а не устаревший синтаксис.
        sessionStore.remove(outboxKey(userId, channelId));
    } else {
        sessionStore.write(outboxKey(userId, channelId), JSON.stringify(messages));
    }
};

/**
 * Положить запись в ящик или переписать уже лежащую. Ключ внутри — `messageId`: повторная
 * запись с тем же (первая попытка → pending, она же после обрыва → failed) занимает тот же
 * слот, а не заводит второй.
 */
export const putOutboxMessage = (userId: string, channelId: string, message: ChatMessage): void => {
    const rest = readOutbox(userId, channelId).filter((item) => item.messageId !== message.messageId);
    writeOutbox(userId, channelId, [...rest, message]);
};

/** Убрать запись: сервер подтвердил приём, или человек передумал (см. discardMessage). */
export const removeOutboxMessage = (userId: string, channelId: string, messageId: string): void => {
    const rest = readOutbox(userId, channelId).filter((item) => item.messageId !== messageId);
    writeOutbox(userId, channelId, rest);
};

const OUTBOX_PREFIX = 'kilvater.outbox.';

/**
 * Все ключи ящиков в этой вкладке — сколько бы каналов и (в теории) чужих userId в них
 * ни лежало. Только для discardOutboxMessage: обычное чтение/запись всегда знает свой
 * userId и в переборе не нуждается.
 */
const listOutboxKeys = (): string[] => sessionStore.keys().filter((key) => key.startsWith(OUTBOX_PREFIX));

/**
 * Выбросить запись, не зная userId, — так вызывает discardMessage: в его адресе
 * (ChannelAddress & { message }) участника нет, ящик общий у канала, а не у члена внутри
 * него (см. types.ts). Ищем перебором ключей самой вкладки, а не угадыванием: userId здесь
 * ровно один — свой собственный, — но полагаться на это не обязательно, раз перебор и так
 * безопасен и дешёв (ключей в вкладке — единицы).
 *
 * Срез по длине префикса/суффикса, а не поиск разделителя: userId или channelId, случись
 * в них точка, не собьёт разбор ключа на части.
 */
export const discardOutboxMessage = (channelId: string, messageId: string): void => {
    const suffix = `.${channelId}`;
    for (const key of listOutboxKeys()) {
        if (key.endsWith(suffix)) {
            const userId = key.slice(OUTBOX_PREFIX.length, -suffix.length);
            removeOutboxMessage(userId, channelId, messageId);
        }
    }
};

/**
 * Все каналы, у которых в ящике этого userId есть хоть одна запись. Нужен там, где надо
 * пройтись по всем сразу, а не по одному открытому, — восстановление связи у локального
 * бэкенда оживляет отправку разом во всех каналах (см. localBackend.ts), а не только в том,
 * что сейчас на экране.
 */
export const listOutboxChannels = (userId: string): string[] => {
    const prefix = `${OUTBOX_PREFIX}${userId}.`;
    return listOutboxKeys()
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
};

/**
 * Подмешать в прочитанную ленту своё неотправленное из ящика — то, что эта вкладка ещё
 * не подтвердила сервером, включая пережившее перезагрузку: своя же лента без этого
 * не рассказывала бы, что человек вообще что-то набирал. Общая для обоих бэкендов
 * (см. firebaseBackend.ts и localBackend.ts, оба зовут её из getChannel/getChannelBySlug).
 *
 * `userId` необязателен вслед за контрактом (см. types.ts, ChannelBackend.getChannel):
 * не передан — ключа ящика не собрать, и ответ отдаётся как есть, без подмешивания.
 *
 * Запись, которую сервер уже подтвердил (в ленте она уже есть, а ящик почистить не успели —
 * например, подписки не было, когда пришло подтверждение), не дублируется, а заодно убирается
 * из ящика: раз уж всё равно читаем, второй раз не понадобится.
 */
export const mergeOutbox = (
    snapshot: ChannelSnapshot,
    userId: string | undefined,
    channelId: string
): ChannelSnapshot => {
    if (!userId) {
        return snapshot;
    }
    const known = new Set(snapshot.messages.map((message) => message.messageId));
    const pending = readOutbox(userId, channelId).filter((message) => {
        if (known.has(message.messageId)) {
            removeOutboxMessage(userId, channelId, message.messageId);
            return false;
        }
        return true;
    });
    if (pending.length === 0) {
        return snapshot;
    }
    return { ...snapshot, messages: [...snapshot.messages, ...pending].sort((a, b) => a.sentAt - b.sentAt) };
};
