import { useSyncExternalStore } from 'react';

import { MOBILE_MEDIA_QUERY } from '@/config/layout';

/**
 * Мобильный вид или нет — один ответ на всё приложение, и тот же, что у стилей: и там,
 * и там одно медиавыражение из `config/layout`. Спрашивать ширину окна напрямую нельзя:
 * так появляется второе мнение о том, где кончается телефон.
 *
 * Пользоваться этим стоит редко. Всё, что можно решить в CSS, решается в CSS; сюда попадает
 * только то, что стилями не выразить, — например, ставить ли фокус в поле сразу (на телефоне
 * это выкидывает клавиатуру поверх формы).
 */
const query = (): MediaQueryList => window.matchMedia(MOBILE_MEDIA_QUERY);

export const isMobile = (): boolean => query().matches;

const subscribe = (onChange: () => void): (() => void) => {
    const list = query();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
};

/** То же самое, но с перерисовкой: окно можно и растянуть, и повернуть телефон. */
export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, isMobile);
