import { useEffect, useState } from 'react';

import { backend } from '@/backend';

/**
 * Оценка сдвига часов этой вкладки относительно сервера, в мс (issue #230, см.
 * backend/clock.ts) — тонкая обвязка над watchClockOffset, тем же приёмом, что и useConnection
 * над watchConnection: компонент знает только сам сдвиг, не то, как он посчитан и откуда берётся.
 *
 * Начальное значение — 0: до первого ответа подписки (он приходит следом, уже после первой
 * отрисовки) сдвига не знает никто, и «часы не врут» — то, с чем меньше всего риска ошибиться.
 */
export function useClockOffset(): number {
    const [offsetMs, setOffsetMs] = useState(0);
    useEffect(() => backend.watchClockOffset({ onChange: setOffsetMs }), []);
    return offsetMs;
}
