import { GoogleAuthProvider, User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';

import { firebaseAuth, firestore } from '@/config/firebase';
import { sessionStore } from '@/utils/storage';
import { paths } from '@shared/config/model';
import { Look, ShipSetup } from '@shared/types/channel';

import { ChannelError, Unsubscribe } from '@/backend/types';

/**
 * Вход. Отсюда приложение узнаёт, кто перед ним.
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
    /** Каким кораблём и какого цвета ходили в прошлый раз. Нет — значит, ещё не выходили в море. */
    look?: Look;
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
    /**
     * Записать во флот корабль, которым встали в строй или переоснастились. Запись переживает
     * и новую вкладку, и другое устройство; наружу из неё возвращается только внешность —
     * тем же вызовом `watch`, полем `Account.look`.
     */
    rememberLook(ship: ShipSetup): Promise<void>;
}

const accountOf = (user: User): Account => ({
    userId: user.uid,
    ...(user.displayName ? { name: user.displayName } : {}),
    ...(user.email ? { email: user.email } : {}),
});

/** Проверить и привести к Look: годится и для документа Firestore, и для JSON из sessionStorage. */
const toLook = (raw: unknown): Look | undefined => {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const { shipKind, color } = raw as Partial<Look>;
    return typeof shipKind === 'string' && typeof color === 'string' ? { shipKind, color } : undefined;
};

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

/**
 * Внешность последнего заведённого корабля — та, что предложит следующая форма постановки
 * в строй. Берётся не полем документа, а последней записью личной истории кораблей
 * (`users/{userId}/ships`, см. docs/FIREBASE.md): сортировка по одному полю, составного индекса
 * не требует. Отказ (сеть, ещё нет ни одного корабля) — не беда, просто нечего подставить.
 */
const lastShip = async (userId: string): Promise<Look | undefined> => {
    try {
        const found = await getDocs(
            query(collection(firestore(), paths.userShips({ userId })), orderBy('createdAt', 'desc'), limit(1))
        );
        return toLook(found.docs[0]?.data());
    } catch {
        return undefined;
    }
};

export function createFirebaseEntrance(): Entrance {
    return {
        watch: ({ onChange }) =>
            onAuthStateChanged(firebaseAuth(), (user) => {
                if (user) {
                    const account = accountOf(user);
                    onChange({ status: 'signed', account });
                    void rememberUser(user);
                    // Внешность — отдельным запросом и отдельным приходом: `watch` уже ответил
                    // выше, не дожидаясь его, а appearance приезжает вторым вызовом того же
                    // `onChange`, когда дойдёт до Firestore и обратно.
                    void lastShip(user.uid).then((look) => {
                        if (look) {
                            onChange({ status: 'signed', account: { ...account, look } });
                        }
                    });
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

        rememberLook: async (ship) => {
            const user = firebaseAuth().currentUser;
            if (!user) {
                return;
            }
            try {
                // Свой id, не channelId: тот же канал можно перенастроить дважды, и оба раза
                // это новый корабль в списке, а не переписанный прежний (см. firestore.rules —
                // history-запись и не переписывается).
                const shipId = doc(collection(firestore(), paths.userShips({ userId: user.uid }))).id;
                await setDoc(doc(firestore(), paths.userShip({ userId: user.uid, shipId })), {
                    ...ship,
                    createdAt: Date.now(),
                    serverAt: serverTimestamp(),
                });
            } catch {
                // Не записали корабль во флот — не беда: следующая форма просто не подставит его сама.
            }
        },
    };
}

/**
 * Ключ, под которым эта вкладка держит свой userId для входа понарошку.
 *
 * `sessionStorage`, а не `localStorage`: состояние «сервера» у localBackend.ts общее на весь
 * браузер (`localStorage`), а два человека, представленных в разговоре, должны быть разными —
 * иначе отвечать за вторую сторону оказалось бы некому.
 */
const LOCAL_ACCOUNT_KEY = 'kilvater.entrance.local';

const newLocalUserId = (): string => `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Кем эта вкладка входит, пока за бэкендом стоит эмулятор: настоящего сервера нет, и спросить
 * userId не у кого, поэтому вход заводит его сам, при первом обращении, и дальше не меняет.
 *
 * Экспортирован: тот же userId нужен и localBackend.ts, и `memberId === userId` там теперь
 * действует так же, как у настоящего бэкенда (см. join в localBackend.ts). Возвращает
 * облегчённый Account, без `look`: localBackend.ts зовёт эту функцию на каждый чих, и незачем
 * на каждый такой вызов заодно поднимать ещё и внешность.
 */
export const localAccount = (): Account => {
    const known = sessionStore.read(LOCAL_ACCOUNT_KEY);
    if (known) {
        return { userId: known, name: 'Местный' };
    }
    const userId = newLocalUserId();
    sessionStore.write(LOCAL_ACCOUNT_KEY, userId);
    return { userId, name: 'Местный' };
};

const LOCAL_LOOK_PREFIX = 'kilvater.entrance.look.';

/** Чем этот userId выходил в море в последний раз. Никогда не выходил — undefined. */
const readLocalLook = (userId: string): Look | undefined => {
    const raw = sessionStore.read(LOCAL_LOOK_PREFIX + userId);
    if (!raw) {
        return undefined;
    }
    try {
        return toLook(JSON.parse(raw));
    } catch {
        return undefined;
    }
};

/**
 * Задержка перед приходом внешности из local-хранилища, мс. Столько же, сколько
 * `LATENCY_MS` у localBackend.ts (см. там) — тот же смысл, отдельная константа: значение
 * не экспортировано, а заводить ради одного числа общий модуль незачем.
 */
const LOOK_LATENCY_MS = 40;

/**
 * Вышел ли человек из входа понарошку. В памяти вкладки, а не в переменной модуля: настоящий
 * вход перезагрузку переживает, и этот обязан вести себя так же — иначе до гостевых экранов
 * канала не добраться вовсе. Гостю не показывают ни создания канала, ни демо, а перезагрузка
 * возвращала бы его вошедшим, и открыть ссылку на канал гостем было бы нечем.
 */
const LOCAL_GUEST_KEY = 'kilvater.entrance.guest';

/**
 * Вход понарошку — для локального бэкенда, где никакого сервера нет и спрашивать не у кого.
 * Начинает вошедшим: локальный бэкенд ведёт себя ровно так, как вёл до появления входа,
 * и браузерные проверки этого не замечают. Выход при этом настоящий — им и смотрят
 * на гостевые экраны, не поднимая Firebase.
 */
export function createLocalEntrance(): Entrance {
    let state: AuthState = sessionStore.read(LOCAL_GUEST_KEY)
        ? { status: 'guest' }
        : { status: 'signed', account: localAccount() };
    const listeners = new Set<(state: AuthState) => void>();
    const settle = (next: AuthState): void => {
        state = next;
        if (next.status === 'guest') {
            sessionStore.write(LOCAL_GUEST_KEY, '1');
        } else {
            sessionStore.remove(LOCAL_GUEST_KEY);
        }
        listeners.forEach((listener) => listener(state));
    };

    /**
     * Внешность — отдельным, чуть запоздалым приходом того же onChange, тем же приёмом,
     * что и у настоящего входа (см. createFirebaseEntrance выше): та отдаёт её вторым
     * вызовом, дождавшись Firestore. Читать sessionStorage в обход этой задержки было бы
     * не «локальный бэкенд без сервера», а обход самого свойства, которое отлавливает
     * баги вроде GH-81 — код, рассчитывающий на мгновенный ответ, здесь падал бы точно
     * так же, как и на настоящем Firebase.
     */
    const deliverLook = (account: Account): void => {
        window.setTimeout(() => {
            const look = readLocalLook(account.userId);
            if (look && state.status === 'signed' && state.account.userId === account.userId) {
                settle({ status: 'signed', account: { ...state.account, look } });
            }
        }, LOOK_LATENCY_MS);
    };

    return {
        watch: ({ onChange }) => {
            listeners.add(onChange);
            onChange(state);
            if (state.status === 'signed') {
                deliverLook(state.account);
            }
            return () => {
                listeners.delete(onChange);
            };
        },
        signIn: () => {
            const account = localAccount();
            settle({ status: 'signed', account });
            deliverLook(account);
            return Promise.resolve(account);
        },
        signOut: () => {
            settle({ status: 'guest' });
            return Promise.resolve();
        },
        rememberLook: (ship) => {
            // Флот здесь не заводим — эмулятору некуда: держим ровно то, что отдаём наружу,
            // саму внешность, а не историю к ней.
            const look: Look = { shipKind: ship.shipKind, color: ship.color };
            sessionStore.write(LOCAL_LOOK_PREFIX + localAccount().userId, JSON.stringify(look));
            return Promise.resolve();
        },
    };
}
