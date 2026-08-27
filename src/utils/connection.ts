/**
 * Есть ли связь с миром — то немногое, что можно узнать про сеть, не спрашивая сервер.
 * Лежит в utils, а не в backend: это факт о браузере, а не о канале, и местный бэкенд
 * читает его наравне с настоящим — иначе полоску «нет связи» было бы нечем проверить
 * в браузерных прогонах (см. `backend/localBackend.ts`).
 */

export type ConnectionStatus = 'online' | 'offline';

export interface ConnectionState {
    status: ConnectionStatus;
    /** `Date.now()` того момента, с которого действует текущий статус. */
    since: number;
}

/**
 * Типы уверяют, что navigator.onLine всегда boolean, но это не то, что бывает в деле:
 * в Node (юниты) navigator есть, а .onLine у него undefined — и это не офлайн, а «спросить
 * не у кого». Параметр объявлен как boolean | undefined, а не boolean, ровно затем, чтобы
 * различить их сравнением с false, а не отрицанием (у отрицания оба дают true).
 */
const wasReportedOnline = (value: boolean | undefined): boolean => value !== false;

/** navigator бывает не определён (юниты в Node) — тогда верить не во что, считаем «на связи». */
export const isOnline = (): boolean => typeof navigator === 'undefined' || wasReportedOnline(navigator.onLine);

/**
 * Следить за online/offline браузера. Первый вызов onChange — сразу с текущим состоянием,
 * дальше — по событиям window. Без window (юниты) состояние отдаётся один раз и не меняется:
 * подписываться там не на что.
 */
export const watchOnlineStatus = (onChange: (state: ConnectionState) => void): (() => void) => {
    let state: ConnectionState = { status: isOnline() ? 'online' : 'offline', since: Date.now() };
    onChange(state);

    if (typeof window === 'undefined' || !window.addEventListener) {
        return () => {};
    }

    const set = (status: ConnectionStatus): void => {
        if (state.status === status) {
            return;
        }
        state = { status, since: Date.now() };
        onChange(state);
    };
    const handleOnline = (): void => set('online');
    const handleOffline = (): void => set('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
    };
};
