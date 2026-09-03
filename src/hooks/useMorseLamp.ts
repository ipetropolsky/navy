import { useCallback, useEffect, useRef, useState } from 'react';

import { charToSegments, LampSegment } from '@/hooks/morse';

const MAX_QUEUE_SEGMENTS = 40;

/**
 * Лампа сигнальщика: transmit() ставит символы в очередь,
 * on — текущее состояние лампы (мягкое вкл/выкл по таймингам Морзе).
 */
export default function useMorseLamp(): { on: boolean; transmit: (text: string, restart?: boolean) => void } {
    const [on, setOn] = useState(false);
    const queueRef = useRef<LampSegment[]>([]);
    const runningRef = useRef(false);
    const timerRef = useRef<number | undefined>(undefined);

    const pump = useCallback(() => {
        const segment = queueRef.current.shift();
        if (!segment) {
            runningRef.current = false;
            setOn(false);
            return;
        }
        if (segment.on > 0) {
            setOn(true);
        }
        timerRef.current = window.setTimeout(() => {
            setOn(false);
            timerRef.current = window.setTimeout(pump, segment.off);
        }, segment.on);
    }, []);

    const transmit = useCallback(
        (text: string, restart = false) => {
            // eslint-disable-next-line @typescript-eslint/no-misused-spread -- передаём по кодпоинтам, эмодзи уходят в fallback-мигание
            const segments = [...text].flatMap(charToSegments);
            if (restart) {
                // Передачу переставили в другое место текста: очередь заменяется целиком.
                // Обрезать её тут нечем и незачем — кусок приходит отмеренный, длиной
                // в несколько знаков (см. `hooks/reception`).
                queueRef.current = segments;
            } else {
                const queue = queueRef.current;
                queue.push(...segments);
                // Копится очередь от своего же набора и растёт быстрее, чем лампа успевает
                // её проигрывать. Отрезаем начало: отставшее на полминуты мигание — это уже
                // не отклик на набор, а сигнал сам по себе.
                if (queue.length > MAX_QUEUE_SEGMENTS) {
                    queue.splice(0, queue.length - MAX_QUEUE_SEGMENTS);
                }
            }
            if (!runningRef.current) {
                runningRef.current = true;
                pump();
            }
        },
        [pump]
    );

    useEffect(() => () => window.clearTimeout(timerRef.current), []);

    return { on, transmit };
}
