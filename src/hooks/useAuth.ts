import { useCallback, useEffect, useRef, useState } from 'react';

import { Account, AuthState, entrance } from '@/backend';
import { Look, ShipSetup } from '@shared/types/channel';

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
    /**
     * Чем вошедший выходил в море в последний раз — силуэт и цвет. Ими открывается форма
     * у того, кто в этом канале ещё не стоит: позывной с номером в новом канале свои,
     * а корабль человек чаще берёт тот же. Ни разу не выходил — null.
     */
    lastLook: Look | null;
    /** Записать во флот корабль, которым встали в строй или переоснастились (см. `entrance.rememberLook`). */
    rememberLook: (ship: ShipSetup) => void;
}

export function useAuth(): AuthController {
    const [state, setState] = useState<AuthState>({ status: 'unknown' });
    const [lastLook, setLastLook] = useState<Look | null>(null);
    /** Чей вкус сейчас в руках: флот принадлежит человеку, и чужой корабль подставлять нельзя. */
    const lookOwner = useRef<string | null>(null);

    // Состояние приезжает подпиской, а не из ответа: вход мог произойти и в другой вкладке,
    // и ветка «это сделал я» тут не нужна — ровно как с событиями канала.
    //
    // onChange зовётся на этот вход дважды: сперва без look (аккаунт уже известен, а внешность
    // ещё не пришла из хранилища), потом ещё раз, когда она пришла, — так и должна вести себя
    // подписка. Второй раз может не случиться вовсе, если вошедший ни разу не выходил в море.
    useEffect(
        () =>
            entrance.watch({
                onChange: (next) => {
                    setState(next);
                    const userId = next.status === 'signed' ? next.account.userId : null;
                    // Вошедший сменился (вышел или за той же вкладкой вошёл другой) — прежнюю
                    // внешность выбрасываем сразу, не дожидаясь второго прихода: у нового
                    // человека его может не случиться вовсе, и форма встретила бы его
                    // чужим кораблём.
                    if (userId !== lookOwner.current) {
                        lookOwner.current = userId;
                        setLastLook(null);
                    }
                    if (next.status === 'signed' && next.account.look) {
                        setLastLook(next.account.look);
                    }
                },
            }),
        []
    );

    const signIn = useCallback(async () => {
        await entrance.signIn();
    }, []);

    const signOut = useCallback(async () => {
        await entrance.signOut();
    }, []);

    // Своё состояние меняем сразу, не дожидаясь ответа: форма отдаёт выбор в ту же секунду,
    // а не после того, как запись дойдёт до сервера (см. entrance.rememberLook — неудачную
    // запись он проглатывает молча, не запомнить вкус не беда).
    const rememberLook = useCallback((ship: ShipSetup) => {
        setLastLook({ shipKind: ship.shipKind, color: ship.color });
        void entrance.rememberLook(ship);
    }, []);

    return {
        known: state.status !== 'unknown',
        account: state.status === 'signed' ? state.account : null,
        signIn,
        signOut,
        lastLook,
        rememberLook,
    };
}
