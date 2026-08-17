import { useCallback, useEffect, useRef, useState } from 'react';

import { charToSegments, LampSegment } from '@/hooks/morse';

const MAX_QUEUE_SEGMENTS = 40;

/**
 * Лампа сигнальщика: transmit() ставит символы в очередь,
 * on — текущее состояние лампы (мягкое вкл/выкл по таймингам Морзе).
 */
export default function useMorseLamp(): { on: boolean; transmit: (text: string) => void } {
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
        (text: string) => {
            const queue = queueRef.current;
            // eslint-disable-next-line @typescript-eslint/no-misused-spread -- передаём по кодпоинтам, эмодзи уходят в fallback-мигание
            queue.push(...[...text].flatMap(charToSegments));
            if (queue.length > MAX_QUEUE_SEGMENTS) {
                queue.splice(0, queue.length - MAX_QUEUE_SEGMENTS);
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
