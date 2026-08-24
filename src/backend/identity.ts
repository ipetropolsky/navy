import { sessionStore } from '@/utils/storage';
import { ShipKind } from '@shared/types/channel';

/**
 * Кто эта вкладка. Лежит отдельно от данных «сервера»: бэкенд знает про всех участников,
 * а вот кто из них — ты, это дело клиента, и в настоящей системе тут был бы токен входа.
 *
 * Ступеней две, и они про разное. Первая — **личность**: один идентификатор, который
 * заводится при первом обращении и в пределах вкладки больше не меняется. Вторая — **связка
 * каналов**: `channelId → memberId`, по записи на канал. Личность у человека одна, а корабли
 * у неё разные: в одном канале «Альбатрос», в другом «Гроза», — и связка отвечает ровно
 * на вопрос «каким кораблём эта личность ходит вот здесь».
 *
 * Разделение это не ради порядка, а ради завтрашнего входа в систему: на месте личности
 * окажется тот же самый идентификатор, только выданный не вкладкой, а входом, — и связка
 * каналов переедет к нему, не меняя формы.
 *
 * Личность хранится в `sessionStorage`, то есть у каждой вкладки своя, — и это ровно то,
 * что нужно эмулятору. Данные канала общие на браузер (`localStorage`), поэтому с общей
 * личностью вторая вкладка молча оказывалась бы тем же кораблём и поговорить сам с собой
 * было бы не с кем. За настоящий вход это, конечно, не считается: закрыли вкладку — личность
 * потеряли.
 *
 * Сами параметры корабля — позывной, номер, силуэт, цвет, место — здесь не лежат вовсе:
 * они живут на бэкенде, а вкладка помнит только, кто она такая. Единственное исключение —
 * внешность (см. `readLastLook`), и она не про канал, а про вкус человека.
 *
 * Ещё memberId можно передать в адресе (`&memberId=…`) — он перебивает сохранённый,
 * но сам не сохраняется. Без адреса и без сохранённого id канал предложит встать в строй.
 */

const IDENTITY_KEY = 'kilvater.identity';
const CREW_KEY_PREFIX = 'kilvater.crew.';
const LOOK_KEY_PREFIX = 'kilvater.look.';

/** Как эта личность звалась, пока связка лежала по записи на канал. */
const LEGACY_KEY_PREFIX = 'kilvater.member.';

const newIdentityId = (): string => `me-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Идентификатор этой личности. Заводится при первом обращении и дальше только читается:
 * всё, что вкладка о себе помнит, лежит под ним.
 */
export const myIdentity = (): string => {
    const known = sessionStore.read(IDENTITY_KEY);
    if (known) {
        return known;
    }
    const fresh = newIdentityId();
    sessionStore.write(IDENTITY_KEY, fresh);
    return fresh;
};

/** Связка каналов целиком. Битую запись считаем пустой: помнить нечего — значит, не помним. */
const readCrew = (): Record<string, string> => {
    const raw = sessionStore.read(CREW_KEY_PREFIX + myIdentity());
    if (!raw) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
        return {};
    }
};

const writeCrew = (crew: Record<string, string>): void => {
    sessionStore.write(CREW_KEY_PREFIX + myIdentity(), JSON.stringify(crew));
};

/**
 * Каким кораблём эта личность ходит в этом канале.
 *
 * Заодно подбирает запись прежней формы — по ключу на канал. Вкладка, открытая до выкладки
 * новой версии, переживает перезагрузку вместе со своим `sessionStorage`, и без этого человек
 * на ровном месте оказался бы перед пустой формой в канале, где он уже стоит.
 */
export const readMemberId = (channelId: string): string | null => {
    const crew = readCrew();
    if (crew[channelId]) {
        return crew[channelId];
    }
    const legacy = sessionStore.read(LEGACY_KEY_PREFIX + channelId);
    if (legacy) {
        writeCrew({ ...crew, [channelId]: legacy });
        sessionStore.remove(LEGACY_KEY_PREFIX + channelId);
    }
    return legacy;
};

export const rememberMemberId = (channelId: string, memberId: string): void => {
    writeCrew({ ...readCrew(), [channelId]: memberId });
};

export const forgetMemberId = (channelId: string): void => {
    const crew = readCrew();
    delete crew[channelId];
    writeCrew(crew);
    sessionStore.remove(LEGACY_KEY_PREFIX + channelId);
};

/**
 * Внешность корабля: силуэт и цвет. Единственное, что помнится не по каналу, а по личности, —
 * потому что это и не про канал: позывной с номером в новом канале человек выбирает заново,
 * а ходить предпочитает на том же корабле и того же цвета.
 */
export interface Look {
    shipKind: ShipKind;
    color: string;
}

/** Чем эта личность выходила в море в последний раз. Никогда не выходила — null. */
export const readLastLook = (): Look | null => {
    const raw = sessionStore.read(LOOK_KEY_PREFIX + myIdentity());
    if (!raw) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        const { shipKind, color } = parsed as Partial<Look>;
        return typeof shipKind === 'string' && typeof color === 'string' ? { shipKind, color } : null;
    } catch {
        return null;
    }
};

export const rememberLastLook = (look: Look): void => {
    sessionStore.write(LOOK_KEY_PREFIX + myIdentity(), JSON.stringify(look));
};
