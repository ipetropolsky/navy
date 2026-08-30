import { App, deleteApp, initializeApp } from 'firebase-admin/app';
import { Firestore, WriteResult, getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paths } from '../../shared/config/model';
import { MemberDraft } from '../../shared/types/calls';
import { ShipKind } from '../../shared/types/channel';
import { previewMembers } from './preview';
import { joinChannel } from './raid';

/**
 * Проверки previewMembers — против настоящего эмулятора Firestore, тем же Admin SDK, каким
 * читает сама функция. Участников заводим настоящим joinChannel (raid.ts), а не сырой записью:
 * важно, что redactMember отработал над формой документа, какую пишет production, а не над
 * тем, что об этой форме подумал этот файл.
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
const seedChannel = (channelId: string): Promise<WriteResult> =>
    db.doc(paths.channel({ channelId })).set({ slug: channelId, title: channelId, createdAt: Date.now() });

const draft = (name: string, hullNumber: string, extra: Partial<MemberDraft> = {}): MemberDraft => ({
    name,
    hullNumber,
    shipKind: 'pr1234' as ShipKind,
    color: '#8ecae6',
    ...extra,
});

describe('previewMembers', () => {
    test('позывной заменён на бортовой номер — как и всюду у redactMember', async () => {
        const channelId = 'ch-preview-redact';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });

        const [member] = await previewMembers(db, channelId);
        expect(member.name).toBe('001');
        expect(member.hullNumber).toBe('001');
    });

    test('user и lastSeen с клиента не уходят вовсе, даже когда они есть в документе', async () => {
        const channelId = 'ch-preview-fields';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        // joinChannel сам lastSeen не пишет (это дело владельца, см. raid.ts) — заводим его
        // здесь, чтобы проверить не отсутствие поля, а именно то, что previewMembers его
        // не пропускает.
        await db
            .doc(paths.member({ channelId, memberId: 'u-a' }))
            .update({ lastSeen: { messageId: 'msg-1', at: Date.now() } });

        const [member] = await previewMembers(db, channelId);
        expect('user' in member).toBe(false);
        expect('lastSeen' in member).toBe(false);
    });

    test('список — по всем, кто встал на рейд', async () => {
        const channelId = 'ch-preview-list';
        await seedChannel(channelId);
        await joinChannel({ db, channelId, userId: 'u-a', member: draft('Алый', '001') });
        await joinChannel({ db, channelId, userId: 'u-b', member: draft('Белый', '002') });

        const members = await previewMembers(db, channelId);
        expect(members.map((member) => member.hullNumber).sort()).toEqual(['001', '002']);
    });

    test('на рейде никого — пустой список, а не отказ', async () => {
        const channelId = 'ch-preview-empty';
        await seedChannel(channelId);

        await expect(previewMembers(db, channelId)).resolves.toEqual([]);
    });

    test('канала нет вовсе — тоже пустой список: отсутствие документов здесь обычный ответ', async () => {
        await expect(previewMembers(db, 'net-takogo-kanala')).resolves.toEqual([]);
    });
});
