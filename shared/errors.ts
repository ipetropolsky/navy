/**
 * Отказ бэкенда — один класс и один список кодов на оба конца провода. Сервер бросает
 * `ChannelError` изнутри транзакции, клиент ловит её же и показывает `.message` — двум разным
 * копиям тут неоткуда взяться не разъехавшись, а значит, класс живёт в общем каталоге.
 */

/** Почему действие не вышло. Коды перечислены, чтобы UI мог показать внятный текст. */
export type ChannelErrorCode =
    | 'channel-not-found'
    | 'channel-full'
    | 'slug-taken'
    | 'slug-invalid'
    | 'name-taken'
    | 'hull-taken'
    | 'member-not-found'
    | 'not-senior'
    | 'message-too-long'
    | 'course-too-long'
    // Сеть и вход. Тем же перечислением и той же ошибкой: у приложения один способ отказать,
    // и читателю не приходится гадать, какой из двух он поймал.
    | 'offline'
    | 'sign-in-cancelled'
    | 'sign-in-blocked'
    | 'unknown';

export class ChannelError extends Error {
    constructor(
        readonly code: ChannelErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'ChannelError';
    }
}
