import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, WriteResult, getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paths } from '../../shared/config/model';
import { ChannelError } from '../../shared/errors';
import { previewChannel } from './preview';

/**
 * Проверки previewChannel — против настоящего эмулятора Firestore, тем же Admin SDK, каким
 * читает сама функция. Канал заводим сырой записью (seedChannel), а не через createChannel:
 * previewChannel сама ничего не решает про форму документа канала, только читает готовые
 * title/closed/code, — то, что их туда кладёт клиент, проверяют правила (firestore/rules.test.ts).
 *
 * Свой project id (demo-navy-preview), как и у соседей по эмулятору (demo-navy-raid,
 * demo-navy-rules, demo-navy-channels) — раздельные id держат данные наборов друг от друга,
 * даже когда все они гоняются в одном поднятом эмуляторе.
 */

const PROJECT_ID = 'demo-navy-preview';
// Хост и порт — как в firebase.json (emulators.firestore) и в EMULATORS из src/config/firebase.ts.
const EMULATOR_HOST = '127.0.0.1:8080';

process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

const app: App = initializeApp({ projectId: PROJECT_ID });
const db: Firestore = getFirestore(app);

afterAll(async () => {
    await deleteApp(app);
});

/** Стереть всё в проекте между проверками — тем же путём, каким это делает сам emulator UI. */
const clearFirestore = (): Promise<Response> =>
    fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
        method: 'DELETE',
    });

beforeEach(async () => {
    await clearFirestore();
});

// ---- помощники ----

/** Канал без владельца — так его заводит и сегодняшний createChannel, до первого вошедшего. */
const seedChannel = (channelId: string, extra: { closed?: boolean; code?: string } = {}): Promise<WriteResult> =>
    db.doc(paths.channel({ channelId })).set({ slug: channelId, title: channelId, createdAt: Date.now(), ...extra });

/** Ошибка с ожидаемым кодом. Проверяем код, а не текст: текст — дело интерфейса. */
const failsWith = async (run: () => Promise<unknown>, code: string): Promise<void> => {
    let failure: unknown = null;
    try {
        await run();
    } catch (thrown) {
        failure = thrown;
    }
    expect(failure).toBeInstanceOf(ChannelError);
    expect((failure as ChannelError).code).toBe(code);
};

describe('previewChannel', () => {
    test('открытый канал — название и closed: false', async () => {
        const channelId = 'ch-preview-open';
        await seedChannel(channelId);

        await expect(previewChannel(db, channelId)).resolves.toEqual({ title: channelId, closed: false });
    });

    test('закрытый канал без кода — название и closed: true, без отказа', async () => {
        const channelId = 'ch-preview-closed';
        await seedChannel(channelId, { closed: true, code: 'акула' });

        await expect(previewChannel(db, channelId)).resolves.toEqual({ title: channelId, closed: true });
    });

    test('закрытый канал, верный код — тот же ответ, без отказа', async () => {
        const channelId = 'ch-preview-closed-right-code';
        await seedChannel(channelId, { closed: true, code: 'акула' });

        await expect(previewChannel(db, channelId, 'акула')).resolves.toEqual({ title: channelId, closed: true });
    });

    test('закрытый канал, неверный код — channel-closed', async () => {
        const channelId = 'ch-preview-closed-wrong-code';
        await seedChannel(channelId, { closed: true, code: 'акула' });

        await failsWith(() => previewChannel(db, channelId, 'кит'), 'channel-closed');
    });

    test('канала нет вовсе — channel-not-found, а не пустой ответ', async () => {
        await failsWith(() => previewChannel(db, 'net-takogo-kanala'), 'channel-not-found');
    });
});
