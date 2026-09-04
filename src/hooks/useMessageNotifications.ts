import { useCallback, useEffect, useRef } from 'react';

import { ChannelSnapshot } from '@/backend/types';
import { Message } from '@shared/types/channel';

/**
 * Заголовок вкладки, пока непрочитанное копится без внимания, — «(N) Название».
 * Отдельной функцией, а не строкой внутри эффекта: сравнить с ожидаемым в тесте проще,
 * чем гонять настоящий DOM (см. тот же приём у unreadBoundary в useUnread.ts).
 */
export const flashedTitle = (base: string, count: number): string => `(${count}) ${base}`;

/**
 * Стоит ли заводить уведомление на это сообщение: чужая реплика, а не своя и не системная
 * строчка о корабле. Своя не приходит, пока панель убрана (поле ввода стоит `inert` вместе
 * с ней — см. App.tsx), но проверка от этого не лишняя: без неё функция была бы права лишь
 * пока это остаётся так. Системную запись (кто-то встал на рейд, ушёл, переоснастился)
 * уведомлением не бьём — реплик в ней нет, а раздувать всплывающими окнами вход и выход
 * с рейда не тот повод, ради которого эта задача затевалась (issue #83).
 */
export const isNotifiable = (message: Message, myId: string | null): boolean =>
    message.kind !== 'system' && message.author.memberId !== myId;

/** Как часто меняются местами обычный и мигающий заголовок, мс. */
const TITLE_FLASH_INTERVAL = 1000;

/**
 * Уведомления о новых репликах — браузерным `Notification`, пока вкладка не на виду,
 * и миганием её заголовка следом, если разрешения на первое нет или в нём отказали
 * (issue #83). Без изменений в бэкенде: чистая надстройка над тем же каналом, что уже
 * приходит и в useUnread — просто на другой сигнал («вкладка не активна», а не «панель
 * убрана») и с другим откликом (уведомление, а не цифра в углу кнопки).
 *
 * «Не активна» здесь — либо разговор убран/свёрнут (`watching` лживо, тот же смысл,
 * что и у useUnread), либо сама вкладка не видна или не в фокусе: со свёрнутым до пола
 * разговором, но открытой вкладкой человек ленту всё равно не видит, а с открытой,
 * но фоновой вкладкой — тем более.
 *
 * Возвращает `requestPermission` — её стоит дёрнуть ещё и из настоящего пользовательского
 * действия (открыл разговор, отправил реплику): один лишь вход в канал через `useEffect`
 * разрешения не покажет — современные браузеры показывают диалог только в ответ на жест,
 * а без него либо молчат совсем, либо сворачивают его в мелкий значок в адресной строке
 * (Chrome — «тихая» подсказка при низком «engagement» сайта). Здесь она всё равно вызывается
 * и при входе в канал — тем самым не пропуская решение, если браузер согласится показать
 * его и так, — но полагаться только на это нельзя.
 */
export function useMessageNotifications(
    channel: ChannelSnapshot | null,
    myId: string | null,
    watching: boolean
): { requestPermission: () => void } {
    const channelId = channel?.channel.channelId ?? null;
    const messages = channel?.messages ?? [];
    const lastMessage = messages.length ? messages[messages.length - 1] : null;

    /** Черта, до которой реплики уже разобраны — не про «прочитано», а про «уведомление уже решено». */
    const knownMessageId = useRef<string | null>(null);
    const knownChannel = useRef<string | null>(null);
    /** Сколько накопилось, пока заголовок мигает, — само число идёт в него же. */
    const unseenCount = useRef(0);
    /** Исходный заголовок вкладки — снят один раз, перед первым миганием, а не при монтировании. */
    const baseTitle = useRef<string | null>(null);
    const flashTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
    const flashOn = useRef(false);

    if (knownChannel.current !== channelId) {
        knownChannel.current = channelId;
        // Другой канал (или его пока нет) — прежняя черта не про него: не разослать
        // уведомление разом на весь его хвост, едва он приехал.
        knownMessageId.current = lastMessage?.messageId ?? null;
    }

    /** Погасить мигание и вернуть исходный заголовок — досчитывать нечего, вкладка снова на виду. */
    const stopFlashing = (): void => {
        clearInterval(flashTimer.current);
        flashTimer.current = undefined;
        unseenCount.current = 0;
        if (baseTitle.current !== null) {
            document.title = baseTitle.current;
        }
    };

    /** Тронуть заголовок ещё разом — новая реплика пришла, пока он уже мигал. */
    const startFlashing = (): void => {
        if (baseTitle.current === null) {
            baseTitle.current = document.title;
        }
        if (flashTimer.current !== undefined) {
            return;
        }
        flashOn.current = false;
        flashTimer.current = setInterval(() => {
            flashOn.current = !flashOn.current;
            document.title = flashOn.current
                ? flashedTitle(baseTitle.current ?? '', unseenCount.current)
                : (baseTitle.current ?? '');
        }, TITLE_FLASH_INTERVAL);
    };

    // «default» — единственный запрашиваемый исход: спрошенный уже «granted» переспрашивать
    // незачем, а отказавшего («denied») спросить второй раз браузер и не даст — само вернёт
    // тот же «denied» без всякого диалога.
    const requestPermission = useCallback((): void => {
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            void Notification.requestPermission();
        }
    }, []);

    // При входе в канал — тоже: не единственный повод спросить (см. requestPermission выше
    // и её вызовы из настоящих жестов в App.tsx), но и не помешает, если браузер согласится
    // показать диалог без жеста.
    useEffect(() => {
        if (channelId !== null) {
            requestPermission();
        }
    }, [channelId, requestPermission]);

    // Вкладка (снова) на виду — мигание, если оно шло, ни к чему: человек и так сейчас увидит ленту.
    useEffect(() => {
        if (watching) {
            stopFlashing();
        }
    }, [watching]);

    // Видимость и фокус самой вкладки — сигнал того же рода, что и watching, но про окно
    // браузера, а не про убранную панель: со свёрнутым разговором, но развёрнутой вкладкой
    // человек ленту не видит ровно так же, как с открытой, но фоновой вкладкой.
    useEffect(() => {
        const onPageShown = (): void => {
            if (watching && !document.hidden && document.hasFocus()) {
                stopFlashing();
            }
        };
        document.addEventListener('visibilitychange', onPageShown);
        window.addEventListener('focus', onPageShown);
        return () => {
            document.removeEventListener('visibilitychange', onPageShown);
            window.removeEventListener('focus', onPageShown);
        };
    }, [watching]);

    useEffect(() => {
        if (!lastMessage || lastMessage.messageId === knownMessageId.current) {
            return;
        }
        knownMessageId.current = lastMessage.messageId;
        if (!isNotifiable(lastMessage, myId)) {
            return;
        }
        const active = watching && typeof document !== 'undefined' && !document.hidden && document.hasFocus();
        if (active) {
            return;
        }

        // Системная строчка сюда не доходит вовсе (см. isNotifiable выше), поэтому автор
        // и текст всегда от ChatMessage; имя — из снимка в самой ссылке (см. MemberRef),
        // а не из списка участников: искать там того, кто мог уже сняться с рейда, незачем —
        // то же рассуждение, что и у authorLook, но без нынешнего корабля под рукой.
        const author = lastMessage.author.look?.name ?? 'Кто-то';
        const body = lastMessage.kind === undefined ? lastMessage.text : '';

        if (typeof Notification === 'undefined') {
            unseenCount.current += 1;
            startFlashing();
            return;
        }
        if (Notification.permission === 'granted') {
            try {
                new Notification(author, { body, tag: channelId ?? undefined });
                return;
            } catch {
                // Разрешение дано, а показать всё равно нечем: у части браузеров (Chrome
                // на Android) `new Notification(...)` вовсе не работает — решает только
                // ServiceWorkerRegistration.showNotification(), а сервис-воркера в проекте
                // нет. Не оставлять человека совсем без знака — мигаем заголовком, как
                // при отказе.
            }
        }
        // Пока не решили («default») или отказали («denied») — заголовок мигает в любом
        // случае: разрешение уже спрошено при входе в канал (см. эффект выше), и ждать его
        // здесь ещё раз незачем — а решение всё равно могло прийти позже этой самой реплики.
        unseenCount.current += 1;
        startFlashing();
    }, [lastMessage, watching, myId, channelId]);

    // Размонтировались с мигающим заголовком на экране — вернуть как было.
    useEffect(() => () => stopFlashing(), []);

    return { requestPermission };
}
