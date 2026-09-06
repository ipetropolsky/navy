import { Channel } from '@shared/types/channel';

/**
 * «Свои каналы» — те рейды, на которых стоит корабль этой личности. Счётная часть ответа
 * живёт здесь, отдельно от обоих бэкендов: у них разные источники — общее состояние вкладки
 * у одного и реестр участий в Firestore у другого, — а порядок строчек и правило «показываем
 * только то, о чём знаем всё» должны быть одни. Разъедься они, и список в браузере отличался
 * бы от списка на настоящем сервере, притом что данные в обоих одинаковые.
 */

/** Строчка списка своих каналов. */
export interface MyChannel {
    channelId: string;
    /** Адрес: им канал и открывают (см. `routing.ts`, openChannel). */
    slug: string;
    title: string;
    /** Когда корабль этой личности встал на этот рейд. По нему список и упорядочен. */
    joinedAt: number;
}

/**
 * Запись реестра участий, как она лежит в `users/{userId}/channels/{channelId}`: пишет её
 * сервер той же транзакцией, что и сам корабль (см. functions/src/raid.ts). Про канал в ней
 * нет ничего, кроме его идентификатора, — название и адрес живут в самом канале и правятся
 * там же, а копия в реестре устаревала бы с первым же переименованием.
 */
export interface MyChannelEntry {
    channelId: string;
    joinedAt: number;
}

/**
 * Порядок строчек: последний рейд сверху. Человек возвращается туда, где был только что,
 * и искать эту строчку глазами по всему списку ему незачем.
 *
 * Одинаковое время входа — не выдумка: реестр заводится в одной транзакции, и два канала,
 * засеянные разом (см. tools/seed-firestore.ts), встают с одной меткой. Разрешаем такую
 * ничью названием, чтобы порядок не зависел от того, в каком порядке ответило хранилище.
 */
export const sortMyChannels = (channels: MyChannel[]): MyChannel[] =>
    [...channels].sort((one, other) => other.joinedAt - one.joinedAt || one.title.localeCompare(other.title));

/**
 * Свои каналы из общего состояния локального «сервера»: там все каналы лежат вперемешку,
 * и «мой» — тот, на рейде которого стоит корабль с этим `memberId`. Личность и корабль здесь
 * одно лицо (`memberId === userId`, см. join в localBackend.ts), поэтому спрашивать больше
 * нечего.
 *
 * Тип входа нарочно шире `StoredChannel`: счёту нужны только канал и пара полей участника,
 * и знать про ленту, код доступа и форму хранилища ему незачем.
 */
export const pickMyChannels = (
    stored: { channel: Channel; members: { memberId: string; joinedAt: number }[] }[],
    userId: string
): MyChannel[] =>
    sortMyChannels(
        stored.flatMap(({ channel, members }) => {
            const mine = members.find((member) => member.memberId === userId);
            return mine
                ? [{ channelId: channel.channelId, slug: channel.slug, title: channel.title, joinedAt: mine.joinedAt }]
                : [];
        })
    );

/**
 * Свои каналы из реестра участий и прочитанных по нему каналов: реестр называет только id,
 * название с адресом берутся из самого канала.
 *
 * Канала может не оказаться — документ не прочитался (правило не пустило: корабль сняли
 * с рейда, пока мы читали список) или его нет вовсе. Такая строчка выбрасывается молча,
 * а не встаёт в список без названия: строчка, ведущая в канал, куда не пускают, хуже, чем
 * её отсутствие. Отказ всего запроса это тоже не повод — остальные каналы прочитались,
 * и показать их человеку можно.
 */
export const joinMyChannels = (
    entries: MyChannelEntry[],
    found: Map<string, Pick<Channel, 'slug' | 'title'>>
): MyChannel[] =>
    sortMyChannels(
        entries.flatMap((entry) => {
            const channel = found.get(entry.channelId);
            return channel
                ? [{ channelId: entry.channelId, slug: channel.slug, title: channel.title, joinedAt: entry.joinedAt }]
                : [];
        })
    );
