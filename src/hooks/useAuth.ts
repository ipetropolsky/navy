import { useCallback, useEffect, useState } from 'react';

import { Account, AuthState, entrance } from '@/backend';

/**
 * Кто перед нами. Единственное место, где приложение разговаривает со входом; компоненты
 * знают только «вошёл или нет» и две кнопки.
 *
 * Состояний три, и третье — `unknown` — не лишнее: Firebase отвечает о входе не сразу,
 * и без него человек, у которого вход уже есть, на мгновение видел бы приглашение войти.
 * Поэтому наружу торчит `known`: пока он ложный, гостевых экранов не показываем вовсе.
 */

export interface AuthController {
    /** Ответил ли вход хоть что-нибудь. */
    known: boolean;
    /** Вошедший или null. */
    account: Account | null;
    signIn: () => Promise<void>;
    signOut: () => Promise<void>;
}

export function useAuth(): AuthController {
    const [state, setState] = useState<AuthState>({ status: 'unknown' });

    useEffect(() => entrance.watch({ onChange: setState }), []);

    // Состояние приезжает подпиской, а не из ответа: вход мог произойти и в другой вкладке,
    // и ветка «это сделал я» тут не нужна — ровно как с событиями канала.
    const signIn = useCallback(async () => {
        await entrance.signIn();
    }, []);

    const signOut = useCallback(async () => {
        await entrance.signOut();
    }, []);

    return {
        known: state.status !== 'unknown',
        account: state.status === 'signed' ? state.account : null,
        signIn,
        signOut,
    };
}
