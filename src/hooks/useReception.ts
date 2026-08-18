import { useCallback, useEffect, useRef, useState } from 'react';

import { paced } from '@/config/time';
import { MorseFeed } from '@/types/channel';

import { charDelay, receptionParts } from '@/hooks/reception';

/**
 * Приём сообщения: пришедший текст печатается по буквам, а корабль отправителя всё это время
 * мигает лампой. Почему так, а не живой передачей во время набора, — в `hooks/reception`.
 */

/** Что сейчас печатается. Пусто — принимать нечего, лента показывает всё как есть. */
export interface Reception {
    /** Какое сообщение печатается: по номеру лента и подменяет у него текст. */
    messageId: string;
    /** Чей корабль мигает лампой. */
    memberId: string;
    /** Сколько текста уже напечаталось. */
    shown: string;
    /** Что лампа передаёт с последней пройденной границы. */
    feed: MorseFeed;
}

/** Пришедшее сообщение — всё, что нужно, чтобы его разыграть. */
export interface Arrival {
    messageId: string;
    memberId: string;
    text: string;
}

export interface ReceptionController {
    reception: Reception | null;
    receive: (arrival: Arrival) => void;
}

export default function useReception(): ReceptionController {
    const [reception, setReception] = useState<Reception | null>(null);
    const timerRef = useRef<number | undefined>(undefined);
    /**
     * Сквозной счётчик поводов передавать. Лампе нужен новый повод на каждой границе, и хватило
     * бы номера границы — но приёмы идут один за другим, и у следующего сообщения первая граница
     * пришлась бы на тот же номер, что и у предыдущего. Лампа сочла бы это тем же поводом
     * и промолчала бы там, где как раз началась новая передача.
     */
    const seqRef = useRef(0);

    useEffect(() => () => window.clearTimeout(timerRef.current), []);

    const receive = useCallback(({ messageId, memberId, text }: Arrival) => {
        // Прежний приём обрываем, а не ставим в очередь: сообщения приходят и пачкой, и держать
        // их строем значило бы показывать разговор с опозданием на всё, что не допечаталось.
        // Оборванное при этом не пропадает — лента и без приёма показывает его целиком.
        window.clearTimeout(timerRef.current);
        const parts = receptionParts(text);
        if (!parts.length) {
            setReception(null);
            return;
        }
        // Повод держим в замыкании цепочки: между границами он тот же самый, и новый объект
        // на каждую букву заставил бы лампу начинать заново на каждой из них.
        let feed: MorseFeed = { seq: 0, text: '', restart: true };
        const tick = (at: number): void => {
            const part = parts.find((item) => item.at === at);
            if (part) {
                seqRef.current += 1;
                feed = { seq: seqRef.current, text: part.text, restart: true };
            }
            setReception({ messageId, memberId, shown: text.slice(0, at + 1), feed });
            const wait = paced(charDelay(text[at]));
            timerRef.current = window.setTimeout(
                // Допечатали — приём снимается, и дальше текст показывает сама лента. Лампу это
                // не обрывает: очередь у неё своя, и последнюю часть она договаривает.
                at + 1 < text.length ? () => tick(at + 1) : () => setReception(null),
                wait
            );
        };
        tick(0);
    }, []);

    return { reception, receive };
}
