import { useCallback, useEffect, useState } from 'react';

/**
 * Вся навигация сервиса — два параметра в адресе. Роутера нет и не нужно: экранов три,
 * и выбираются они по тому, что известно про канал и участника.
 *
 * `channel` — адрес канала (slug), а не его идентификатор: ссылка должна читаться, а id
 * канала машинный и меняться не должен. Без адреса мы на главной: пустое море и предложение
 * создать канал. `memberId` необязателен и нужен только для проверки разговора в соседней
 * вкладке: он перебивает сохранённый в localStorage, не трогая его.
 */

export interface Route {
    /** Адрес канала из ссылки, он же slug. */
    channel: string | null;
    memberId: string | null;
}

const readRoute = (): Route => {
    const params = new URLSearchParams(window.location.search);
    return { channel: params.get('channel'), memberId: params.get('memberId') };
};

const routeToUrl = (slug: string | null): string => {
    const url = new URL(window.location.href);
    url.search = slug ? `?channel=${encodeURIComponent(slug)}` : '';
    return url.toString();
};

/**
 * Ссылка на канал целиком — та, которой зовут остальных. Собирается тут же, где разбирается
 * адрес: иначе однажды разъедутся.
 */
export const channelLink = (slug: string): string =>
    `${window.location.origin}${window.location.pathname}?channel=${encodeURIComponent(slug)}`;

/**
 * Адрес главной — та же страница без канала в параметрах. Собирается тут же, где и ссылка
 * на канал, и по той же причине: адрес приложения знает routing.ts, и знать его дважды незачем.
 */
export const homeLink = (): string => `${window.location.origin}${window.location.pathname}`;

/** Адрес и состояние всегда сходятся: назад в браузере работает сам собой. */
export function useRoute(): Route & { openChannel: (slug: string) => void; openHome: () => void } {
    const [route, setRoute] = useState<Route>(readRoute);

    useEffect(() => {
        const onPop = () => setRoute(readRoute());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const go = useCallback((slug: string | null) => {
        window.history.pushState(null, '', routeToUrl(slug));
        setRoute(readRoute());
    }, []);

    const openChannel = useCallback((slug: string) => go(slug), [go]);
    const openHome = useCallback(() => go(null), [go]);

    return { ...route, openChannel, openHome };
}
