import { useEffect, useRef, useState } from 'react';

import { backend } from '@/backend';
import { ChannelSnapshot } from '@/backend/types';
import { MARK_SEEN_THROTTLE } from '@/config/network';

/**
 * Чем отмечаются: номер сообщения и его же метка времени. Метка идёт из самого сообщения,
 * а не снимается часами в миг записи, — и обе черты ниже (`localSeenAt`, `persistedAt`)
 * поэтому лежат на одних часах с тем, с чем их сравнивает счёт (см. `Member.lastSeen`).
 */
interface SeenMark {
    messageId: string;
    sentAt: number;
}

/**
 * Черта, начиная с которой копим счётчик, — позже местной памяти вкладки (`localSeenAt`,
 * см. `useUnread`) и позже того, что успел записать сервер (`persistedAt`), смотря что
 * свежее. Ни того ни другого нет вовсе (свежий участник, ещё ничего не отметивший, и этот же
 * разговор ни разу не был виден в этой вкладке) — считать не от чего, и это не «всё
 * непрочитано», а «пока нечего показывать»: так же вела себя и прежняя, местная версия
 * счётчика (см. git-историю hooks/unread.ts).
 *
 * Отдельной функцией, а не строкой внутри хука, — ради этого же файла: `useUnread` не рвётся
 * между React и веткой правил, а сама ветка проверяется без рендера, как и остальные чистые
 * разборы в этом проекте (см. hooks/useLayout.ts).
 */
export const unreadBoundary = (localSeenAt: number | null, persistedAt: number | null): number | null =>
    localSeenAt !== null || persistedAt !== null ? Math.max(localSeenAt ?? 0, persistedAt ?? 0) : null;

/**
 * Сколько непрочитанного накопилось, пока разговор был убран с экрана — и запись отметки
 * о прочитанном, которая делает этот счёт возможным (issue #70).
 *
 * `watching` — виден ли разговор (см. App.tsx: спрашивается про `shown`, не про `talking` —
 * свёрнутый до пола разговор всё ещё живой, писать в него можно, и панель, на которой стояла
 * бы пилюля счётчика, никуда не делась). Пока виден, счётчик стоит в нуле, а место, докуда
 * человек дочитал, едет вслед за хвостом ленты — не чаще чем раз в MARK_SEEN_THROTTLE,
 * см. `ChannelBackend.markSeen`. Убрали разговор — отметка встаёт на место, и всё, что придёт
 * после, копится в счётчик уже без счёта каждой реплики по имени: `ChannelBackend.countUnread`
 * спрашивает число, а не ленту (см. docs/FIREBASE.md, «Непрочитанное»).
 *
 * Мерка «прочитанным считается всё, что человек мог видеть» не разбирает здесь ни автора,
 * ни системную строчку про рейд отдельно, хоть раньше (см. git-историю hooks/unread.ts)
 * и разбирала: разбор по автору сервер не может выполнить в одном запросе со счётом по
 * времени (Firestore пускает не больше одного `!=`-условия на запрос — своё сообщение
 * потребовало бы второго, вдобавок к системному), а разбор по системности потребовал бы
 * либо явного поля вместо нынешнего «есть kind — системное, нет — нет» (правит его отправка,
 * не этот счёт), либо составного индекса под `firestore.indexes.json`, которого сегодня
 * в проекте нет вовсе, — то и другое за рамками задачи. Собственные сообщения при этом
 * исключены и без счёта на сервере: поле ввода стоит `inert` вместе со всей убранной панелью
 * (см. App.tsx, `<main inert={!shown}>`), и отправить что-то, пока панель убрана, попросту
 * нечем. Системная строчка (кто-то встал на рейд, ушёл, переоснастился) в это малое время
 * пилюлю действительно может слегка раздуть — единственное, чем это решение отличается
 * от прежнего локального счёта, и разница эта признанная, а не незамеченная
 * (см. docs/FIREBASE.md и docs/PROJECT.md — вынесена и туда).
 */
export function useUnread(channel: ChannelSnapshot | null, myId: string | null, watching: boolean): number {
    const channelId = channel?.channel.channelId ?? null;
    const messages = channel?.messages ?? [];
    const lastMessage = messages.length ? messages[messages.length - 1] : null;
    const lastMessageId = lastMessage?.messageId ?? null;
    const lastSentAt = lastMessage?.sentAt ?? null;
    /** Отметка сервера — своя же строчка в участниках канала, а не отдельный запрос за ней. */
    const persistedAt = channel?.members.find((member) => member.memberId === myId)?.lastSeen?.at ?? null;

    const [count, setCount] = useState(0);

    const knownChannel = useRef<string | null>(null);
    /**
     * Свой же хвост ленты в тот миг, когда разговор в последний раз был виден, — память
     * этой вкладки, а не сервера. Нужна, чтобы не мигать чужим числом в тот самый миг,
     * когда панель только что убрали: отметка на сервере в этот миг ещё старая — запись
     * (см. эффект ниже) придерживает её throttle'ом, — а вкладка-то уже точно знает,
     * что всё до этой черты видено.
     */
    const localSeenAt = useRef<number | null>(null);

    if (knownChannel.current !== channelId) {
        knownChannel.current = channelId;
        // Другой канал — прежняя память не про него: не унести с собой чужую черту.
        localSeenAt.current = null;
    }
    if (watching && lastSentAt !== null) {
        localSeenAt.current = lastSentAt;
    }

    const boundaryAt = unreadBoundary(localSeenAt.current, persistedAt);

    // Счёт непрочитанного — отдельным запросом на число, а не проходом по messages: лента
    // с #68 приходит страницей, и по ней одной не восстановить, сколько было до её начала.
    useEffect(() => {
        if (watching) {
            setCount(0);
            return undefined;
        }
        if (channelId === null || boundaryAt === null) {
            setCount(0);
            return undefined;
        }
        let cancelled = false;
        backend
            .countUnread({ channelId, after: boundaryAt })
            .then((result) => {
                if (!cancelled) {
                    setCount(result.count);
                }
            })
            .catch(() => {
                // Не вышло — оставляем прежнее число: следующий повод (новое сообщение,
                // новый показ панели) попробует снова.
            });
        return () => {
            cancelled = true;
        };
        // lastMessageId в зависимостях не про саму черту (её несёт boundaryAt), а про повод
        // пересчитать: пришло новое сообщение, пока панель убрана, — прежний ответ сервера
        // устарел, и его пора спросить заново.
    }, [watching, channelId, boundaryAt, lastMessageId]);

    /**
     * Запись отметки — throttled: не чаще MARK_SEEN_THROTTLE. Эффект живёт весь срок,
     * пока watching у этого канала и человека остаётся правдой, и не пересоздаётся
     * на каждое новое сообщение — иначе throttle-состояние (таймер, отложенное) обнулялось
     * бы на каждой реплике, и throttle не работал бы вовсе. Пересоздание было бы к тому же
     * и лишним отказом от уже идущего таймера: сообщение пришло, разговор всё ещё виден,
     * ждать до истечения срока незачем прекращать.
     *
     * Поэтому throttle-состояние (timer/pending/sentAt) держит один долгоживущий эффект,
     * а лёгкий эффект под ним лишь сообщает о новом хвосте ленты через стабильный ref.
     */
    const scheduleMarkSeen = useRef<(message: SeenMark) => void>(() => {});

    useEffect(() => {
        if (!watching || channelId === null || myId === null) {
            scheduleMarkSeen.current = () => {};
            return undefined;
        }
        let timer: number | undefined;
        let pending: SeenMark | null = null;
        /** Когда отметку писали в последний раз — часы придержки, к самой черте отношения не имеют. */
        let wroteAt = 0;

        const send = (message: SeenMark): void => {
            pending = null;
            wroteAt = Date.now();
            backend.markSeen({ channelId, memberId: myId, message }).catch(() => {
                // Не вышло — на экране у человека всё равно то же самое; следующий повод
                // (новое сообщение или новый заход в канал) попробует снова.
            });
        };

        scheduleMarkSeen.current = (message) => {
            const elapsed = Date.now() - wroteAt;
            if (elapsed >= MARK_SEEN_THROTTLE) {
                send(message);
                return;
            }
            pending = message;
            if (timer === undefined) {
                timer = window.setTimeout(() => {
                    timer = undefined;
                    if (pending !== null) {
                        send(pending);
                    }
                }, MARK_SEEN_THROTTLE - elapsed);
            }
        };

        return () => {
            scheduleMarkSeen.current = () => {};
            window.clearTimeout(timer);
            if (pending !== null) {
                // Уходим из этого состояния (убрали панель, сменился канал или человек,
                // размонтировались) — отметка не должна застрять там, где её придержал
                // throttle: досылаем её сразу, тем же сообщением, что и ждал таймер.
                backend.markSeen({ channelId, memberId: myId, message: pending }).catch(() => {});
            }
        };
    }, [channelId, myId, watching]);

    useEffect(() => {
        if (watching && lastMessageId !== null && lastSentAt !== null) {
            scheduleMarkSeen.current({ messageId: lastMessageId, sentAt: lastSentAt });
        }
    }, [watching, lastMessageId, lastSentAt]);

    return watching ? 0 : count;
}
