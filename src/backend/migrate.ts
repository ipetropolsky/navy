import { Channel, Member, Message, ShipField } from '@/types/channel';

import { ChannelSnapshot } from '@/backend/types';

/**
 * Приведение хранимого состояния к нынешней форме.
 *
 * Разговор в канале принадлежит не нам, и версия схемы — не разрешение его стереть, а всего
 * лишь сообщение «данные другой формы». Правильный ответ на такое сообщение один: привести
 * данные к нынешней форме. Правило целиком — в docs/BACKEND-API.md, раздел «К чужим данным —
 * бережно».
 *
 * Устроено это здесь двумя разными вещами, и путать их не надо.
 *
 * Первое — цепочка приведений: по функции на переход версии. Каждая знает только соседнюю
 * пару форм — свою и следующую, — и потому пишется один раз, вместе с той правкой схемы,
 * из-за которой версия и поднялась. Состояние тринадцатой формы доходит до нынешней, пройдя
 * все ступеньки по одной; писать приведение «из любой прошлой в нынешнюю» не приходится
 * никогда.
 *
 * Второе — разбор: проверка того, что в состоянии лежит именно то, чем оно назвалось.
 * Идёт он всегда, даже когда версия совпала: битое состояние нынешней версии бывает и без
 * всяких схем — оборвалась запись, залезли руками в консоль. Разбор устроен по тому же
 * правилу: что не разобрали — пропускаем, чего не хватает — достраиваем, но экран не роняем
 * и соседнее не трогаем.
 *
 * И ничего из этого не удаляет. Даже то, что привести не удалось, не переписывается поверх:
 * прежний JSON целиком уходит в архивный ключ (см. `archiveKey`), и написанное к нему
 * приведение может забрать его оттуда хоть завтра.
 */

/** Состояние «сервера» целиком: каналов может быть сколько угодно, адресуются по id. */
export interface ServerState {
    version: number;
    channels: Record<string, ChannelSnapshot>;
}

/** Разобранный JSON, форма которого ещё ничем не подтверждена. */
type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Порядок полей корабля — тот же, что и в `backend/notice`: от крупного к мелкому.
 * Повторён здесь нарочно: приведение описывает прошлое, и меняться вместе с нынешним
 * кодом оно не должно (см. `splitRefit`).
 */
const SHIP_FIELDS: ShipField[] = ['shipKind', 'name', 'hullNumber'];

/**
 * Тринадцатая форма в четырнадцатую: запись о переоснащении разбирается на отдельные
 * сообщения — по одному на каждую перемену.
 *
 * До четырнадцатой корабль, сменивший разом силуэт, позывной и номер, давал одну запись
 * с пометкой `changed: ['shipKind', 'name', 'hullNumber']`. Стало — три записи с пометкой
 * `changed: 'shipKind'` и так далее; лента показывает их тремя сообщениями. Прочитать
 * старую запись нынешним кодом нельзя: он ждёт в `changed` строку и получил бы массив.
 *
 * Разбираем, а не берём первую перемену: выбросить две из трёх было бы стиранием — в ленте
 * пропала бы половина того, что канал о корабле написал. Номера новым сообщениям делаем
 * от прежнего и от поля: они должны быть разными (по ним отвечают) и одинаковыми от запуска
 * к запуску (иначе ответ на такое сообщение потеряет предмет при следующем чтении).
 */
const splitRefit = (state: Raw): Raw => {
    const channels = Object.values(isRecord(state.channels) ? state.channels : {});
    for (const snapshot of channels.filter((value) => isRecord(value) && Array.isArray(value.messages)) as Raw[]) {
        snapshot.messages = (snapshot.messages as Raw[]).flatMap((message) => {
            const notice = isRecord(message) && isRecord(message.notice) ? message.notice : null;
            if (!notice || !Array.isArray(notice.changed)) {
                return [message];
            }
            const changed = SHIP_FIELDS.filter((field) => (notice.changed as unknown[]).includes(field));
            // Пометок не оказалось вовсе — записи о перемене, которой не было, быть не может,
            // но и выбрасывать её не наше дело: оставляем без пометки, как есть.
            if (!changed.length) {
                return [{ ...message, notice: { ...notice, changed: undefined } }];
            }
            return changed.map((field) => ({
                ...message,
                messageId: `${String(message.messageId)}-${field}`,
                notice: { ...notice, changed: field },
            }));
        });
    }
    return state;
};

/**
 * Приведения по переходам: ключ — версия, из которой приведение выводит. `MIGRATIONS[13]`
 * превращает тринадцатую форму в четырнадцатую, и версию за ним проставляет сам `climb` —
 * чтобы приведение не могло об этом забыть.
 *
 * Ниже наименьшего здешнего ключа приведений нет, и это осознанный конец, а не пробел:
 * до четырнадцатой версии их не писали вовсе, пока разговоров ни у кого не было. Дальше
 * так не будет — всякая правка схемы приносит сюда свою функцию.
 */
const MIGRATIONS: Record<number, (state: Raw) => Raw> = {
    13: splitRefit,
    // Четырнадцатая в пятнадцатую: приводить нечего. Появился снимок автора (`look`
    // в `MemberRef`), но поле необязательное, и у старого сообщения его отсутствие читается
    // само — автор ищется среди нынешних участников, как и раньше (см. `authorLook`).
    // Совместимая правка схемы выглядит именно так, и версию за неё подняли с запасом.
    14: (state) => state,
};

/** Самая старая форма, из которой ещё есть чем выводить. */
export const OLDEST_VERSION = Math.min(...Object.keys(MIGRATIONS).map(Number));

/** Пройти по ступенькам от своей версии до нынешней. Бросит — значит приведение не удалось. */
const climb = (state: Raw, from: number, target: number): Raw => {
    let current = state;
    for (let version = from; version < target; version += 1) {
        current = MIGRATIONS[version](current);
        current.version = version + 1;
    }
    return current;
};

/** Канал сам по себе: без этих полей он не канал, и восстановить их не из чего. */
const isChannel = (value: unknown): value is Channel =>
    isRecord(value) &&
    typeof value.channelId === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.title === 'string' &&
    typeof value.createdAt === 'number';

/**
 * Что в состоянии удалось разобрать. `whole` отвечает не за годность состояния, а за то,
 * досталось ли оно разбору в точности нынешней формы: что-то пропустили или достроили —
 * значит хранилище надо переписать, а прежнее отложить.
 */
interface Parsed {
    channels: Record<string, ChannelSnapshot>;
    whole: boolean;
}

/**
 * Разобрать каналы. Канал без своих полей пропускаем — назвать его нечем и показать нечего;
 * канал без списков достраиваем пустыми — пустой рейд и пустая лента это законное состояние,
 * с которого всякий канал и начинается.
 *
 * Участников и сообщения поштучно не проверяем нарочно. Незнакомое поле у сообщения ничему
 * не мешает, а недостающее читается запасным вариантом там, где читается (`authorLook`,
 * `place.tried`); придирчивый разбор выбрасывал бы разговор из-за мелочи, которую никто
 * и не заметил бы.
 */
const parseChannels = (value: unknown): Parsed => {
    const channels: Record<string, ChannelSnapshot> = {};
    let whole = true;
    for (const [id, snapshot] of Object.entries(isRecord(value) ? value : {})) {
        if (isRecord(snapshot) && isChannel(snapshot.channel)) {
            const members = Array.isArray(snapshot.members) ? (snapshot.members as Member[]) : [];
            const messages = Array.isArray(snapshot.messages) ? (snapshot.messages as Message[]) : [];
            whole = whole && Array.isArray(snapshot.members) && Array.isArray(snapshot.messages);
            channels[id] = { channel: snapshot.channel, members, messages };
        } else {
            whole = false;
        }
    }
    return { channels, whole };
};

/** Чем кончилось чтение хранилища. */
export interface Restored {
    /** Состояние нынешней формы. Пусто — восстанавливать оказалось не из чего. */
    state: ServerState | null;
    /**
     * Какой версией состояние лежало, если оно было и в нынешнюю форму не годилось: его
     * привели, разобрали не целиком или не смогли ни того, ни другого. Это же и знак,
     * что прежнее надо отложить в архив, а хранилище переписать. Пусто — хранилище уже
     * ровно такое, каким и должно быть, и трогать его незачем.
     */
    was: number | null;
}

/** Ключ, под которым откладывается прежнее состояние: по ключу на версию. */
export const archiveKey = (key: string, version: number): string => `${key}.was.${version}`;

/**
 * Прочитать хранимое состояние: разобрать, привести к нынешней форме и сказать, надо ли
 * перезаписывать хранилище.
 *
 * Пустой ответ бывает по трём причинам, и все три означают одно — тому, кто зовёт, придётся
 * заводить состояние заново: под ключом ничего нет; там лежит не наш и не разбираемый JSON;
 * версия старше самого старого приведения (см. `OLDEST_VERSION`). Ни в одном из случаев
 * прежнее не пропадает — зовущий откладывает его в архив по `was`.
 */
export const restoreState = (raw: string | null, target: number): Restored => {
    if (!raw) {
        return { state: null, was: null };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // Битый или чужой JSON по нашему ключу: разбирать нечего, но и стирать не станем.
        return { state: null, was: 0 };
    }
    if (!isRecord(parsed) || typeof parsed.version !== 'number' || parsed.version > target) {
        // Версия из будущего — тоже чужая форма: соседняя вкладка может быть открыта
        // на новой выкладке, и приводить её состояние вниз мы не умеем.
        return { state: null, was: isRecord(parsed) && typeof parsed.version === 'number' ? parsed.version : 0 };
    }
    const was = parsed.version;
    if (was < target && was < OLDEST_VERSION) {
        return { state: null, was };
    }
    let climbed: Raw;
    try {
        climbed = climb(parsed, was, target);
    } catch {
        // Приведение споткнулось о форму, которой не ожидало. Роняться из-за этого нельзя:
        // начинаем заново, а прежнее уходит в архив целиком и дожидается там правки.
        return { state: null, was };
    }
    const { channels, whole } = parseChannels(climbed.channels);
    return { state: { version: target, channels }, was: was === target && whole ? null : was };
};
