import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { AuthState, createLocalEntrance, localAccount } from '@/backend/auth';

/**
 * Вход понарошку целиком живёт в sessionStorage — здесь она подложная, той же формы,
 * что и у outbox.test.ts: своя карта вместо настоящего окна браузера. Смена вкладки
 * внутри одного теста — это просто новая, пустая карта (shelf.clear()): у настоящих
 * вкладок так и получается, каждая при открытии видит свою пустую sessionStorage.
 */
const shelf = new Map<string, string>();

const fakeSessionStorage = {
    getItem: (key: string): string | null => shelf.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        shelf.set(key, value);
    },
    removeItem: (key: string): void => {
        shelf.delete(key);
    },
};

beforeEach(() => {
    shelf.clear();
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: fakeSessionStorage };
});

afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
});

/** Первое (и для большинства проверок здесь единственное) состояние, полученное подпиской. */
const firstState = (entrance: ReturnType<typeof createLocalEntrance>): AuthState => {
    let state: AuthState | undefined;
    entrance.watch({ onChange: (next) => (state = next) })();
    if (!state) {
        throw new Error('watch не ответил ни разу');
    }
    return state;
};

describe('localAccount', () => {
    test('в той же вкладке — тот же userId, при каждом обращении', () => {
        const first = localAccount().userId;
        const second = localAccount().userId;
        expect(second).toBe(first);
    });

    test('в другой вкладке — другой userId', () => {
        const here = localAccount().userId;
        shelf.clear();
        const there = localAccount().userId;
        expect(there).not.toBe(here);
    });
});

describe('вход понарошку: внешность корабля', () => {
    test('ни разу не выходил в море — look не приходит вовсе', () => {
        const state = firstState(createLocalEntrance());
        expect(state.status === 'signed' ? state.account.look : undefined).toBeUndefined();
    });

    test('запомненное переживает перезагрузку той же вкладки', async () => {
        const entrance = createLocalEntrance();
        await entrance.rememberLook({
            name: 'Альбатрос',
            hullNumber: '317',
            shipKind: 'pr1234',
            color: '#8ecae6',
            channelId: 'ch-1',
        });

        // Новый вход над тем же (подложным) хранилищем — как вкладка после перезагрузки.
        const reloaded = createLocalEntrance();
        const state = firstState(reloaded);
        expect(state.status === 'signed' ? state.account.look : undefined).toEqual({
            shipKind: 'pr1234',
            color: '#8ecae6',
        });
    });

    test('другой вкладке чужой вкус не достаётся', async () => {
        const entrance = createLocalEntrance();
        await entrance.rememberLook({
            name: 'Альбатрос',
            hullNumber: '317',
            shipKind: 'pr1234',
            color: '#8ecae6',
            channelId: 'ch-1',
        });

        shelf.clear();
        const otherTab = firstState(createLocalEntrance());
        expect(otherTab.status === 'signed' ? otherTab.account.look : undefined).toBeUndefined();
    });

    test('вышел и снова вошёл в той же вкладке — тот же корабль и та же внешность', async () => {
        const entrance = createLocalEntrance();
        await entrance.rememberLook({
            name: 'Гром',
            hullNumber: '141',
            shipKind: 'pr1141',
            color: '#ffb703',
            channelId: 'ch-1',
        });
        const before = await entrance.signIn();

        await entrance.signOut();
        const after = await entrance.signIn();

        expect(after.userId).toBe(before.userId);
        expect(after.look).toEqual({ shipKind: 'pr1141', color: '#ffb703' });
    });
});
