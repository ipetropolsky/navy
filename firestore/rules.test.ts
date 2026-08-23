/**
 * Юнит-проверки firestore.rules — против настоящего эмулятора Firestore, а не пересказа
 * правил своими словами.
 *
 * Файл лежит не в src и гоняется не обычным `npm run test`, а отдельным `npm run test:rules`
 * (конфиг — vitest.rules.config.ts, порт эмулятора — из firebase.json): этим проверкам нужен
 * поднятый эмулятор, а обычный набор участвует в сборке на GitHub Pages, где никакого Firebase
 * нет и поднимать эмулятор незачем. Смешать наборы значило бы тянуть Java и firebase-tools
 * в каждый прогон `npm run test`.
 *
 * Правила берутся из корневого firestore.rules файлом (`readFileSync`), а не переписаны здесь
 * текстом: переписанная копия рано или поздно разойдётся с тем, что реально уходит в бой,
 * и проверка станет защищать не те правила, что действуют на самом деле.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, test } from 'vitest';

import { paths } from '@/config/model';

// Проект-пустышка: настоящий Firebase-проект эмулятору не нужен, а demo-префикс — явная
// метка, что это не 'navy-chat' из .firebaserc. Тот же id стоит в `--project` у `npm run test:rules`.
const PROJECT_ID = 'demo-navy-rules';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: PROJECT_ID,
        firestore: {
            rules: readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
            // Хост и порт — как в firebase.json (emulators.firestore) и в EMULATORS
            // из src/config/firebase.ts, которым пользуется само приложение.
            host: '127.0.0.1',
            port: 8080,
        },
    });
});

afterAll(async () => {
    await testEnv.cleanup();
});

describe('firestore.rules: channels/{channelId}', () => {
    test('невошедший читает канал по ключу — разрешено', async () => {
        const channelId = 'smoke-channel';

        // Канал заводим в обход правил: эта проверка про чтение, а не про запись.
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), paths.channel({ channelId })), {
                slug: 'dozor',
                title: 'Дозор',
            });
        });

        const unauthed = testEnv.unauthenticatedContext();
        await assertSucceeds(getDoc(doc(unauthed.firestore(), paths.channel({ channelId }))));
    });
});
