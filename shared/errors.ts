/**
 * Отказ бэкенда — один класс и один список кодов на оба конца провода. Сервер бросает
 * `ChannelError` изнутри транзакции, клиент ловит её же и показывает `.message` — двум разным
 * копиям тут неоткуда взяться не разъехавшись, а значит, класс живёт в общем каталоге.
 */

/**
 * Коды перечислены значениями массива, а не одним union — так список читаем и на клиенте,
 * который проверяет код из ответа функции (`details.code`) на принадлежность известным,
 * не полагаясь на то, что сервер не пришлёт что-то незнакомое.
 */
export const CHANNEL_ERROR_CODES = [
    'channel-not-found',
    'channel-full',
    'slug-taken',
    'slug-invalid',
    'name-taken',
    'hull-taken',
    'member-not-found',
    'not-senior',
    'message-too-long',
    'course-too-long',
    // Сеть и вход. Тем же перечислением и той же ошибкой: у приложения один способ отказать,
    // и читателю не приходится гадать, какой из двух он поймал.
    'offline',
    'timeout',
    'unavailable',
    'permission-denied',
    // Не вошёл — не «правила не пустили»: код свой, потому что ответ на него не извинение,
    // а кнопка входа (см. toChannelError в firebaseBackend.ts и разбор в App.tsx).
    'sign-in-required',
    // Закрытая частота: код доступа не совпал или не введён вовсе. Бросают previewChannel
    // и joinChannel (см. functions/src/preview.ts, raid.ts) при входе в канал с галочкой
    // «Закрытая частота» — текстом «Код доступа неверен. Обратитесь к старшему на рейде.».
    'channel-closed',
    'sign-in-cancelled',
    'sign-in-blocked',
    'unknown',
] as const;

/** Почему действие не вышло. Коды перечислены, чтобы UI мог показать внятный текст. */
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

export class ChannelError extends Error {
    constructor(
        readonly code: ChannelErrorCode,
        message: string
    ) {
        super(message);
        this.name = 'ChannelError';
    }
}
