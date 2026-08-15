import { Member, ShipField, ShipNotice, ShipTitle } from '@/types/channel';

/**
 * Что канал пишет в ленту о корабле — данными, а не фразой.
 *
 * Отдельным файлом от самого эмулятора: это чистые функции без хранилища и без вкладок,
 * и проверять их надо так же — вызовом, а не через браузер.
 */

/**
 * Как корабль зовут: тип, позывной, бортовой номер. Снимок, а не ссылка на участника —
 * канал пишет о том, что было, и написанное не должно меняться задним числом.
 */
export const shipTitle = (member: Member): ShipTitle => ({
    shipKind: member.shipKind,
    name: member.name,
    hullNumber: member.hullNumber,
});

/**
 * Поля, по которым канал и различает переоснащение. Цвет позывного сюда не входит:
 * он не меняет ни имени, ни облика. Место на рейде — тоже: корабль на нём тот же самый,
 * а о его переходах рассказывает сцена, и дублировать её строчкой в ленте незачем.
 */
const SHIP_FIELDS: ShipField[] = ['shipKind', 'name', 'hullNumber'];

/**
 * Запись о переоснащении: каким корабль был, каким стал и что в нём поменялось.
 *
 * Текста здесь нет и быть не должно: бэкенд знает, что случилось, а как об этом сказать —
 * дело интерфейса (см. `components/chat/ShipNoticeLine`). Сравнение всё же остаётся тут:
 * оба состояния на руках только у бэкенда, и второй раз выводить одно из другого интерфейсу
 * незачем. Ничего не поменялось — записи нет вовсе.
 */
export const refitNotice = (before: Member, after: Member): ShipNotice | null => {
    const from = shipTitle(before);
    const to = shipTitle(after);
    const changed = SHIP_FIELDS.filter((field) => from[field] !== to[field]);
    return changed.length ? { event: 'refit', before: from, after: to, changed } : null;
};
