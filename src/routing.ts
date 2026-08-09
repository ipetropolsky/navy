import { useCallback, useEffect, useState } from 'react';

/**
 * Вся навигация сервиса — два параметра в адресе. Роутера нет и не нужно: экранов три,
 * и выбираются они по тому, что известно про канал и участника.
 *
 * `channelId` — какой канал открыт. Без него мы на главной: пустое море и предложение
 * создать канал. `memberId` необязателен и нужен только для проверки разговора в соседней
 * вкладке: он перебивает сохранённый в localStorage, не трогая его.
 */

export interface Route {
    channelId: string | null;
    memberId: string | null;
}

const readRoute = (): Route => {
    const params = new URLSearchParams(window.location.search);
    return { channelId: params.get('channelId'), memberId: params.get('memberId') };
};

const routeToUrl = (channelId: string | null): string => {
    const url = new URL(window.location.href);
    url.search = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return url.toString();
};

/** Адрес и состояние всегда сходятся: назад в браузере работает сам собой. */
export function useRoute(): Route & { openChannel: (channelId: string) => void; openHome: () => void } {
    const [route, setRoute] = useState<Route>(readRoute);

    useEffect(() => {
        const onPop = () => setRoute(readRoute());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const go = useCallback((channelId: string | null) => {
        window.history.pushState(null, '', routeToUrl(channelId));
        setRoute(readRoute());
    }, []);

    const openChannel = useCallback((channelId: string) => go(channelId), [go]);
    const openHome = useCallback(() => go(null), [go]);

    return { ...route, openChannel, openHome };
}
