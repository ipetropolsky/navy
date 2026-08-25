import { FunctionsError } from 'firebase/functions';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { attemptWrite, toChannelError, withTimeout } from '@/backend/firebaseBackend';
import { ChannelError } from '@/backend/types';

/**
 * Разбор чужого отказа (toChannelError) и таймаут поверх запроса (withTimeout) — вот и весь
 * настоящий бэкенд, что можно проверить без похода в Firestore: остальное (правила, транзакции,
 * провод функций) — дело эмулятора, см. firestore/*.test.ts и `npm run test:emulator`. Здесь —
 * только эти две чистые функции.
 */

describe('toChannelError', () => {
    test('свою ChannelError возвращает как есть, той же ссылкой', () => {
        const original = new ChannelError('channel-not-found', 'Канал не найден');
        expect(toChannelError(original)).toBe(original);
    });

    test('FunctionsError со знакомым details.code — точный код и его же сообщение', () => {
        // Так сервер заворачивает свой отказ (functions/src/index.ts, httpsCodeFor):
        // 'not-senior' -> HttpsError('permission-denied', message, { code: 'not-senior' }).
        // Первым доводом конструктора код идёт голым — FunctionsError сама добавляет
        // префикс 'functions/' и кладёт его в .code, а .details достаётся как есть.
        const failure = new FunctionsError('permission-denied', 'Высадить может только старший', {
            code: 'not-senior',
        });
        const error = toChannelError(failure);
        expect(error.code).toBe('not-senior');
        expect(error.message).toBe('Высадить может только старший');
    });

    test('FunctionsError без details.code — разбирается по её собственному коду', () => {
        const failure = new FunctionsError('deadline-exceeded', 'сервер долго не отвечал');
        expect(toChannelError(failure).code).toBe('timeout');
    });

    test('FunctionsError с details.code не из наших — тоже мимо, по её собственному коду', () => {
        const failure = new FunctionsError('unavailable', 'msg', { code: 'something-unknown' });
        expect(toChannelError(failure).code).toBe('unavailable');
    });

    test.each([
        ['unavailable', 'unavailable'],
        ['deadline-exceeded', 'timeout'],
        ['permission-denied', 'permission-denied'],
        ['unauthenticated', 'permission-denied'],
    ])('чужая ошибка с code=%s распознаётся как %s', (foreignCode, expected) => {
        // FirestoreError сюда не подставить напрямую — у неё приватный конструктор
        // (см. комментарий над toChannelError), поэтому берём ту же форму объекта:
        // Error с полем code, голым, без префикса 'functions/'.
        const failure = Object.assign(new Error('boom'), { code: foreignCode });
        expect(toChannelError(failure).code).toBe(expected);
    });

    test('незнакомый code — unknown, а не падение разбора', () => {
        const failure = Object.assign(new Error('boom'), { code: 'кто-то новый' });
        expect(toChannelError(failure).code).toBe('unknown');
    });

    test('ошибка совсем без code — тоже unknown', () => {
        expect(toChannelError(new Error('boom')).code).toBe('unknown');
    });

    test('брошено не Error — тоже unknown, а не падение разбора', () => {
        expect(toChannelError('строка вместо ошибки').code).toBe('unknown');
        expect(toChannelError(undefined).code).toBe('unknown');
    });
});

describe('withTimeout', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test('офлайн — отказ сразу, запрос не запускается вовсе', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        const run = vi.fn(() => new Promise<string>(() => {}));
        await expect(withTimeout(run, 1000)).rejects.toMatchObject({ code: 'offline' });
        expect(run).not.toHaveBeenCalled();
    });

    test('успевший ответ отдаётся как есть', async () => {
        await expect(withTimeout(() => Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    });

    test('свой отказ до срока доходит как есть, не подменяется на timeout', async () => {
        const own = new ChannelError('slug-taken', 'Канал с таким адресом уже есть');
        await expect(withTimeout(() => Promise.reject(own), 1000)).rejects.toBe(own);
    });

    test('молчание дольше срока — отказ с кодом timeout', async () => {
        vi.useFakeTimers();
        const pending = withTimeout(() => new Promise(() => {}), 1000);
        const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });
});

/**
 * attemptWrite — то же самое ожидание с гонкой против срока, но для отправки сообщения
 * (см. комментарий над attemptWrite в firebaseBackend.ts): без офлайн-огражки withTimeout
 * (run() должен дойти до setDoc(), даже когда сети нет вовсе — тогда в дело вступает
 * локальный кеш Firestore), и отказ по сроку не бросается, а возвращается значением —
 * это и есть статус доставки, который решает sendMessage/retryMessage.
 */
describe('attemptWrite', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test('офлайн, но run() всё равно вызывается — не как у withTimeout', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        const run = vi.fn(() => Promise.resolve());
        await attemptWrite(run, 1000);
        expect(run).toHaveBeenCalledOnce();
    });

    test('run() успел — null, а не отказ: доставлено', async () => {
        await expect(attemptWrite(() => Promise.resolve(), 1000)).resolves.toBeNull();
    });

    test('не успел, сеть есть — код timeout', async () => {
        vi.stubGlobal('navigator', { onLine: true });
        vi.useFakeTimers();
        const pending = attemptWrite(() => new Promise(() => {}), 1000);
        const assertion = expect(pending).resolves.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    test('не успел, сети нет — код offline, тоже значением, а не исключением', async () => {
        vi.stubGlobal('navigator', { onLine: false });
        vi.useFakeTimers();
        const pending = attemptWrite(() => new Promise(() => {}), 1000);
        const assertion = expect(pending).resolves.toMatchObject({ code: 'offline' });
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    test('run() бросил раньше срока — исключение доходит как есть, не подменяется значением', async () => {
        const own = new ChannelError('member-not-found', 'Корабль не найден');
        await expect(attemptWrite(() => Promise.reject(own), 1000)).rejects.toBe(own);
    });
});
