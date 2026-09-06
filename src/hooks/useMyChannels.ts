import { useCallback, useEffect, useState } from 'react';

import { ChannelError, MyChannel, backend } from '@/backend';

/**
 * Свои каналы вошедшего — то, с чего начинается главная. Спрашиваем их один раз на вход
 * и заново по кнопке: список меняется только тогда, когда человек сам куда-то встал или
 * откуда-то ушёл, а оба этих действия происходят внутри канала — то есть уже не на этом
 * экране. Подписки поэтому нет: она стоила бы живого соединения ради новостей, которых
 * на главной не бывает.
 *
 * `userId` приходит доводом и решает всё: сменился (вошёл другой) — список перечитывается,
 * пуст (никто не вошёл) — не спрашиваем вовсе, у гостя своих каналов не бывает.
 */

export interface MyChannelsController {
    /** Пока не ответили, показывать нечего: каналы могут быть, а может и не быть ни одного. */
    loading: boolean;
    channels: MyChannel[];
    /**
     * Спросить не вышло — сеть или сервер подвели. Текст уже человеческий, годится прямо
     * в Panel.hint. null, если последняя попытка удалась или ещё идёт.
     */
    error: string | null;
    /** Спросить заново — после отказа или когда список мог устареть. */
    reload: () => void;
}

export function useMyChannels(userId: string | null): MyChannelsController {
    const [channels, setChannels] = useState<MyChannel[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** Счётчик попыток: меняясь, он и перезапускает чтение (см. `reload`). */
    const [attempt, setAttempt] = useState(0);

    const reload = useCallback(() => setAttempt((count) => count + 1), []);

    useEffect(() => {
        if (!userId) {
            setChannels([]);
            setLoading(false);
            setError(null);
            return () => {};
        }
        // Ответ на отменённый запрос не применяем: вошедший мог смениться, пока сервер думал,
        // — и тогда в списке оказались бы чужие каналы.
        let alive = true;
        setLoading(true);
        setError(null);
        backend
            .listMyChannels({ userId })
            .then((result) => {
                if (!alive) {
                    return;
                }
                setChannels(result.channels);
                setLoading(false);
            })
            .catch((failure: unknown) => {
                if (!alive) {
                    return;
                }
                setChannels([]);
                setError(failure instanceof ChannelError ? failure.message : 'Не вышло спросить о каналах');
                setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [userId, attempt]);

    return { loading, channels, error, reload };
}

export default useMyChannels;
