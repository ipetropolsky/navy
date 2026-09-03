import { afterEach, describe, expect, test, vi } from 'vitest';

import { isOnline, watchOnlineStatus } from '@/utils/connection';

/**
 * Источник у обеих функций — navigator.onLine и события window online/offline. Юниты живут
 * в голом Node, поэтому оба на заглушках: navigator — через vi.stubGlobal, окно — настоящим
 * EventTarget (он и есть весь window, что здесь нужно: addEventListener и dispatchEvent).
 */

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
});

describe('isOnline', () => {
    test('navigator.onLine === true — на связи', () => {
        vi.stubGlobal('navigator', { onLine: true });
        expect(isOnline()).toBe(true);
    });

    test('navigator.onLine === false — офлайн', () => {
        vi.stubGlobal('navigator', { onLine: false });
        expect(isOnline()).toBe(false);
    });

    test('navigator.onLine === undefined (как в голом Node) — по умолчанию «на связи»', () => {
        vi.stubGlobal('navigator', { onLine: undefined });
        expect(isOnline()).toBe(true);
    });
});

describe('watchOnlineStatus', () => {
    test('без window состояние отдаётся один раз и дальше не меняется', () => {
        vi.stubGlobal('navigator', { onLine: true });
        const seen: string[] = [];
        const unsubscribe = watchOnlineStatus((state) => seen.push(state.status));
        expect(seen).toEqual(['online']);
        // Отписка ничего не роняет, даже когда подписываться было не на что.
        unsubscribe();
        expect(seen).toEqual(['online']);
    });

    test('window есть, но без addEventListener (см. localBackend.test.ts) — тоже без подписки', () => {
        vi.stubGlobal('navigator', { onLine: false });
        (globalThis as unknown as { window: unknown }).window = {};
        const seen: string[] = [];
        watchOnlineStatus((state) => seen.push(state.status));
        expect(seen).toEqual(['offline']);
    });

    test('первый вызов — текущим статусом, дальше — по событиям window; отписка их выключает', () => {
        vi.stubGlobal('navigator', { onLine: true });
        const target = new EventTarget();
        (globalThis as unknown as { window: unknown }).window = target;

        const seen: string[] = [];
        const unsubscribe = watchOnlineStatus((state) => seen.push(state.status));
        expect(seen).toEqual(['online']);

        target.dispatchEvent(new Event('offline'));
        expect(seen).toEqual(['online', 'offline']);

        target.dispatchEvent(new Event('online'));
        expect(seen).toEqual(['online', 'offline', 'online']);

        unsubscribe();
        target.dispatchEvent(new Event('offline'));
        expect(seen).toEqual(['online', 'offline', 'online']);
    });

    test('повтор того же статуса — без лишнего вызова', () => {
        vi.stubGlobal('navigator', { onLine: true });
        const target = new EventTarget();
        (globalThis as unknown as { window: unknown }).window = target;

        const seen: string[] = [];
        watchOnlineStatus((state) => seen.push(state.status));
        target.dispatchEvent(new Event('offline'));
        target.dispatchEvent(new Event('offline'));
        expect(seen).toEqual(['online', 'offline']);
    });

    test('since — момент, с которого действует статус, обновляется на каждой перемене', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000);
        vi.stubGlobal('navigator', { onLine: true });
        const target = new EventTarget();
        (globalThis as unknown as { window: unknown }).window = target;

        const seen: { status: string; since: number }[] = [];
        watchOnlineStatus((state) => seen.push(state));
        expect(seen[0]).toEqual({ status: 'online', since: 1000 });

        vi.setSystemTime(5000);
        target.dispatchEvent(new Event('offline'));
        expect(seen[1]).toEqual({ status: 'offline', since: 5000 });
    });
});
