import { useSyncExternalStore } from 'react';

import { MOBILE_MEDIA_QUERY, SHORT_WINDOW_MEDIA_QUERY } from '@/config/layout';

/**
 * Мерки окна — один ответ на всё приложение, и тот же, что у стилей: медиавыражения берутся
 * из `config/layout`, откуда их же подставляет в Less сборка. Спрашивать размеры окна напрямую
 * нельзя: так появляется второе мнение о том, где кончается телефон.
 *
 * Пользоваться этим стоит редко. Всё, что можно решить в CSS, решается в CSS; сюда попадает
 * только то, что стилями не выразить, — например, ставить ли фокус в поле сразу (на телефоне
 * это выкидывает клавиатуру поверх формы) и рисовать ли шторке ручку.
 *
 * Подписка и замер заведены на каждое выражение по разу и живут в замыкании: useSyncExternalStore
 * зовёт их по ссылке и на новой отписывается и подписывается заново, то есть собранные на лету
 * они перетряхивали бы слушателей на каждой отрисовке.
 */
const matcher = (media: string) => {
    const list = (): MediaQueryList => window.matchMedia(media);
    return {
        matches: (): boolean => list().matches,
        subscribe: (onChange: () => void): (() => void) => {
            const query = list();
            query.addEventListener('change', onChange);
            return () => query.removeEventListener('change', onChange);
        },
    };
};

const mobile = matcher(MOBILE_MEDIA_QUERY);
const shortWindow = matcher(SHORT_WINDOW_MEDIA_QUERY);

export const isMobile = (): boolean => mobile.matches();

/** То же самое, но с перерисовкой: окно можно и растянуть, и повернуть телефон. */
export const useIsMobile = (): boolean => useSyncExternalStore(mobile.subscribe, mobile.matches);

/**
 * Короткое окно: такое, в котором сцене и шторке вдвоём не поместиться (см.
 * SHORT_WINDOW_MAX_HEIGHT). Телефон на боку — как раз оно.
 */
export const useIsShortWindow = (): boolean => useSyncExternalStore(shortWindow.subscribe, shortWindow.matches);
