import { GoogleAuthProvider, User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/config/firebase';
import { paths } from '@/config/model';

import { ChannelError, Unsubscribe } from '@/backend/types';

/**
 * Вход. Отсюда приложение узнаёт, кто перед ним, и здесь же кончается прежняя выдумка,
 * что личность заводит себе вкладка (см. `backend/identity.ts`).
 *
 * Вход через аккаунт, а не анонимный: корабли и участия привязаны к человеку, а не к вкладке,
 * и человек, открывший чат на телефоне и на ноутбуке, должен встретить там свой корабль,
 * а не двойника. Обратная сторона того же решения — две вкладки одного браузера теперь один
 * и тот же корабль; так и задумано.
 */

/** Кто вошёл. Имя и почта нужны только ему самому — в канале человека представляет корабль. */
export interface Account {
    userId: string;
    name?: string;
    email?: string;
}

/**
 * Состояние входа. Три, а не два: пока Firebase не ответил, «не вошёл» утверждать нельзя —
 * иначе человек, у которого вход уже есть, на мгновение увидит приглашение войти.
 */
export type AuthState = { status: 'unknown' } | { status: 'guest' } | { status: 'signed'; account: Account };

export interface Entrance {
    /** Следить за тем, кто перед нами. Отвечает и «вошёл», и «не вошёл» — ждать надо оба. */
    watch(request: { onChange: (state: AuthState) => void }): Unsubscribe;
    signIn(): Promise<Account>;
    signOut(): Promise<void>;
}

const accountOf = (user: User): Account => ({
    userId: user.uid,
    ...(user.displayName ? { name: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
});

/**
 * Человеческий текст на каждый отказ входа. Их три, и они про разное: окно закрыли сами,
 * окно не дал открыть браузер, связи нет. Один общий текст «не вышло войти» тут не годится —
 * в двух случаях из трёх человек может это поправить, если ему сказать, чем именно.
 */
const toSignInError = (failure: unknown): ChannelError => {
    const code = failure instanceof Error && 'code' in failure ? String(failure.code) : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return new ChannelError('sign-in-cancelled', 'Вход не завершён');
    }
    if (code === 'auth/popup-blocked') {
        return new ChannelError('sign-in-blocked', 'Браузер не пустил окно входа. Разрешите его и попробуйте снова');
    }
    if (code === 'auth/network-request-failed') {
        return new ChannelError('offline', 'Нет связи. Войти не выйдет, пока она не появится');
    }
    return new ChannelError('unknown', 'Не вышло войти. Попробуйте ещё раз');
};

/**
 * Запомнить вошедшего. Документ личности заводится сам, при первом входе: пустая база —
 * рабочее состояние, и «сначала накатите пользователей» в этом пути нет.
 *
 * `createdAt` пишется только тому, кого ещё нет: слияние поверх затёрло бы день, когда
 * человек пришёл, каждым следующим входом. Отказ записи вход не рушит — не записали снимок
 * аккаунта, и ладно: в чат человек всё равно вошёл.
 */
const rememberUser = async (user: User): Promise<void> => {
    const ref = doc(firestore(), paths.user({ userId: user.uid }));
    const account = accountOf(user);
    try {
        const known = await getDoc(ref);
        await setDoc(
            ref,
            {
                account: { name: account.name ?? null, email: account.email ?? null },
                serverAt: serverTimestamp(),
                ...(known.exists() ? {} : { createdAt: Date.now() }),
            },
            { merge: true }
        );
    } catch {
        // Правила не пустили или сети нет — вход от этого не отменяется.
    }
};

export function createFirebaseEntrance(): Entrance {
    return {
        watch: ({ onChange }) =>
            onAuthStateChanged(firebaseAuth(), (user) => {
                if (user) {
                    onChange({ status: 'signed', account: accountOf(user) });
                    void rememberUser(user);
                } else {
                    onChange({ status: 'guest' });
                }
            }),

        signIn: async () => {
            // Окно, а не переход: приложение живёт на чужом домене (GitHub Pages), а переход
            // через `authDomain` ломается в браузерах, режущих стороннее хранилище.
            try {
                const { user } = await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
                await rememberUser(user);
                return accountOf(user);
            } catch (failure) {
                throw toSignInError(failure);
            }
        },

        signOut: () => signOut(firebaseAuth()),
    };
}

/** Кем эта вкладка входит, пока за бэкендом стоит эмулятор. */
const LOCAL_ACCOUNT: Account = { userId: 'local', name: 'Местный' };

/**
 * Вход понарошку — для локального бэкенда, где никакого сервера нет и спрашивать не у кого.
 * Начинает вошедшим: локальный бэкенд ведёт себя ровно так, как вёл до появления входа,
 * и браузерные проверки этого не замечают. Выход при этом настоящий — им и смотрят
 * на гостевые экраны, не поднимая Firebase.
 */
export function createLocalEntrance(): Entrance {
    let state: AuthState = { status: 'signed', account: LOCAL_ACCOUNT };
    const listeners = new Set<(state: AuthState) => void>();
    const settle = (next: AuthState): void => {
        state = next;
        listeners.forEach((listener) => listener(state));
    };

    return {
        watch: ({ onChange }) => {
            listeners.add(onChange);
            onChange(state);
            return () => {
                listeners.delete(onChange);
            };
        },
        signIn: () => {
            settle({ status: 'signed', account: LOCAL_ACCOUNT });
            return Promise.resolve(LOCAL_ACCOUNT);
        },
        signOut: () => {
            settle({ status: 'guest' });
            return Promise.resolve();
        },
    };
}
