import { Corridor, CORRIDORS } from '../types/channel';

/**
 * Модель приложения: что за коллекции есть на сервере и какими путями к ним ходят.
 *
 * Смысл файла не в экономии строк, а в том, чтобы модель читалась целиком с одного экрана.
 * Строк с именами коллекций больше нигде в проекте нет: путь собирают только эти функции,
 * и правка модели начинается здесь.
 *
 * ```
 * users/{userId}                          личность: аккаунт, чем ходит
 *     channels/{channelId}                реестр: в каких каналах она стоит
 * channels/{channelId}                    канал: адрес, название, старший
 *     members/{memberId}                  корабль в этом канале
 *     messages/{messageId}                лента канала
 *     berths/{berthId}                    бронь места на рейде
 * slugs/{slug}                            бронь адреса
 * ```
 *
 * Заводить эти коллекции заранее не нужно и нечем: в Firestore коллекция появляется вместе
 * с первым документом, а пустая и отсутствующая — одно и то же. Отсюда правило, которое
 * держит всё остальное: отсутствие документа — обычный ответ, а не поломка.
 *
 * Файл общий (`shared/`): раньше по этим путям ходил только клиент, обращаясь к серверу,
 * теперь те же функции собирают путь и на самом сервере — расхождения быть не может.
 */

/** Имена коллекций. */
export const COLLECTIONS = {
    users: 'users',
    channels: 'channels',
    members: 'members',
    messages: 'messages',
    berths: 'berths',
    slugs: 'slugs',
} as const;

/** Адрес канала: то, что в настоящем API стояло бы в пути запроса. */
export interface ChannelAddress {
    channelId: string;
}

export interface MemberAddress extends ChannelAddress {
    memberId: string;
}

export interface MessageAddress extends ChannelAddress {
    messageId: string;
}

export interface UserAddress {
    userId: string;
}

/** Место на рейде, каким его знает бронь: дальность и коридор. Точка внутри коридора не ключ. */
export interface BerthKey {
    slot: number;
    corridor: Corridor;
}

/**
 * Ключ брони места — само место. Составное значение в ключе документа: единственное место,
 * где мы так делаем, и это не нарушение правила «не кодируем несколько значений в одну строку»,
 * а его изнанка — ключ документа и есть составной ключ. Внутри документа слот и коридор лежат
 * отдельными полями, а собирает и разбирает ключ одна и та же пара функций: разъедься они,
 * и бронь перестала бы находиться по своему же месту.
 */
export const berthId = ({ slot, corridor }: BerthKey): string => `${slot}-${corridor}`;

/** Разбор ключа обратно. Чужая строка под нашим ключом — null: разбирать нечего. */
export const parseBerthId = (id: string): BerthKey | null => {
    const dash = id.indexOf('-');
    if (dash <= 0) {
        return null;
    }
    const slot = Number(id.slice(0, dash));
    const corridor = id.slice(dash + 1);
    if (!Number.isInteger(slot) || slot < 0 || !CORRIDORS.includes(corridor as Corridor)) {
        return null;
    }
    return { slot, corridor: corridor as Corridor };
};

/**
 * Пути — функциями, потому что путь в Firestore параметризован: в нём стоят идентификаторы
 * канала, участника, сообщения. Принимают именованный объект, как и всё остальное в проекте
 * (см. docs/API-PRINCIPLES.md).
 */
export const paths = {
    users: (): string => COLLECTIONS.users,
    user: ({ userId }: UserAddress): string => `${COLLECTIONS.users}/${userId}`,
    userChannels: ({ userId }: UserAddress): string => `${paths.user({ userId })}/${COLLECTIONS.channels}`,
    userChannel: ({ userId, channelId }: UserAddress & ChannelAddress): string =>
        `${paths.userChannels({ userId })}/${channelId}`,

    channels: (): string => COLLECTIONS.channels,
    channel: ({ channelId }: ChannelAddress): string => `${COLLECTIONS.channels}/${channelId}`,

    members: ({ channelId }: ChannelAddress): string => `${paths.channel({ channelId })}/${COLLECTIONS.members}`,
    member: ({ channelId, memberId }: MemberAddress): string => `${paths.members({ channelId })}/${memberId}`,

    messages: ({ channelId }: ChannelAddress): string => `${paths.channel({ channelId })}/${COLLECTIONS.messages}`,
    message: ({ channelId, messageId }: MessageAddress): string => `${paths.messages({ channelId })}/${messageId}`,

    berths: ({ channelId }: ChannelAddress): string => `${paths.channel({ channelId })}/${COLLECTIONS.berths}`,
    berth: ({ channelId, ...berth }: ChannelAddress & BerthKey): string =>
        `${paths.berths({ channelId })}/${berthId(berth)}`,

    slugs: (): string => COLLECTIONS.slugs,
    slug: ({ slug }: { slug: string }): string => `${COLLECTIONS.slugs}/${slug}`,
};
