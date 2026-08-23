import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Отдельный конфиг, а не часть vite.config.ts: набору из firestore/ нужен поднятый эмулятор
 * Firestore (см. `npm run test:rules` в package.json и порт в firebase.json), а обычный
 * `npm run test` гоняется и при сборке на GitHub Pages, где ни Java, ни firebase-tools не нужны
 * и не стоят. Смешай их в один конфиг — и обычный прогон стал бы зависеть от эмулятора.
 *
 * Алиас '@' — тот же, что в resolve.alias у vite.config.ts: без него firestore/rules.test.ts
 * пришлось бы заново называть коллекции строками, а имена коллекций и пути к документам
 * собирают только функции из src/config/model.ts.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        include: ['firestore/**/*.test.ts'],
        environment: 'node',
    },
});
