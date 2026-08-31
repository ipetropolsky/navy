import { Firestore } from 'firebase-admin/firestore';

import { paths } from '../../shared/config/model';
import { ChannelError } from '../../shared/errors';
import { PreviewChannelResponse } from '../../shared/types/calls';

/**
 * Вход в канал для того, кто на него ещё не встал (см. previewChannel в index.ts): участники,
 * лента и брони мест закрыты правилами для всех, кроме вошедших (firestore.rules, isMember) —
 * снаружи и до входа видно только название канала и то, закрыт ли он. Читает Admin SDK, минуя
 * правила, — ровно за этим, за отдельным Firestore-инстансом, и заведён этот файл, а не raid.ts:
 * тот про то, как рейд меняется, этот — про то, что из него видно снаружи и до входа.
 *
 * Без транзакции: это разовый показ на загрузку страницы, а не шаг рейда — расхождение в доли
 * секунды между тем, что в канале, и тем, что увидит гость, не тот случай, ради которого стоит
 * платить лишним чтением.
 */
interface ChannelDoc {
    title: string;
    closed?: boolean;
    code?: string;
}

export const previewChannel = async (
    db: Firestore,
    channelId: string,
    code?: string
): Promise<PreviewChannelResponse> => {
    const snapshot = await db.doc(paths.channel({ channelId })).get();
    if (!snapshot.exists) {
        throw new ChannelError('channel-not-found', 'Канал не найден');
    }
    const channel = snapshot.data() as ChannelDoc;
    const closed = channel.closed === true;
    // Код здесь сверяем только ради мгновенной подсказки на экране «Закрытая частота»: не ввёл
    // код вовсе — значит просто ещё не дошёл до поля, а не ошибся, и ругать за это рано. Взаправду
    // код проверяет joinChannel (raid.ts) заново при самом входе — этот вызов ничего не запирает.
    if (closed && code !== undefined && code !== channel.code) {
        throw new ChannelError('channel-closed', 'Код доступа неверен. Обратитесь к старшему на рейде.');
    }
    return { title: channel.title, closed };
};
