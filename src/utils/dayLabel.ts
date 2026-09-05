/**
 * Разделитель-дата в ленте: где он встаёт и что на нём написано.
 *
 * Судить о дне позволяет только локальное время смотрящего: сообщение, отправленное в 23:50
 * во Владивостоке, для читающего из Калининграда — уже другой день, а `sentAt` в хранилище
 * этого не знает вовсе (см. MessageBase.sentAt в shared/types/channel.ts, «формат для показа
 * выбирает интерфейс, а не хранилище»). Поэтому граница считается тут же, при показе,
 * а не хранится вместе с сообщением.
 */

/** Полночь того календарного дня (по местному времени), в который попадает `at`. */
const startOfLocalDay = (at: number): Date => {
    const day = new Date(at);
    day.setHours(0, 0, 0, 0);
    return day;
};

/** Тот же календарный день по местному времени — независимо от часа и минуты внутри него. */
export const isSameLocalDay = (a: number, b: number): boolean =>
    startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();

/**
 * Перед какими сообщениями лентой встаёт разделитель: перед первым — всегда, а дальше —
 * там, где календарный день сменился по сравнению с предыдущим сообщением. Ушли не самим
 * сообщением, а голыми метками времени: это не даёт разрастись до квадрата на длинной
 * переписке и позволяет проверить границу отдельно от разметки строчек.
 */
export const dayBoundaries = (sentAts: number[]): boolean[] =>
    sentAts.map((at, index) => index === 0 || !isSameLocalDay(sentAts[index - 1], at));

/**
 * Подпись разделителя: «Сегодня» и «Вчера» — для соседних с текущим дней, иначе число
 * с месяцем, а за прошлый год — ещё и год, чтобы старая переписка не читалась как свежая.
 *
 * `now` — время смотрящего, а не сообщения: приходит параметром, а не берётся из `Date.now()`
 * внутри, чтобы «сегодня» можно было проверить в юните, не подделывая системные часы.
 */
export const daySeparatorLabel = (at: number, now: number): string => {
    const day = startOfLocalDay(at);
    const today = startOfLocalDay(now);
    const dayNumber = Math.round(day.getTime() / 86_400_000);
    const todayNumber = Math.round(today.getTime() / 86_400_000);
    if (dayNumber === todayNumber) {
        return 'Сегодня';
    }
    if (dayNumber === todayNumber - 1) {
        return 'Вчера';
    }
    const sameYear = day.getFullYear() === today.getFullYear();
    return new Date(at).toLocaleDateString(
        'ru-RU',
        sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' }
    );
};
