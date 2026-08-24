import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Отдельный конфиг, а не часть vite.config.ts: набору из firestore/ нужен поднятый эмулятор
 * Firestore (см. `npm run test:emulator` в package.json и порт в firebase.json), а обычный
 * `npm run test` гоняется и при сборке на GitHub Pages, где ни Java, ни firebase-tools не нужны
 * и не стоят. Смешай их в один конфиг — и обычный прогон стал бы зависеть от эмулятора.
 *
 * Имя — по эмулятору, а не по правилам: набор проверяет не только firestore.rules
 * (firestore/rules.test.ts), но и то, как настоящий бэкенд ходит в Firestore и подчиняется
 * тем же правилам (firestore/channels.test.ts), а с ними — и то, как те же правила соблюдает
 * сервер (functions/src/raid.test.ts) — все они живут в разных каталогах, но требуют одного
 * и того же поднятого эмулятора.
 *
 * Алиасы '@' и '@shared' — те же, что в resolve.alias у vite.config.ts: без них файлы
 * из firestore/ пришлось бы заново называть коллекции строками, а имена коллекций и пути
 * к документам собирают только функции из shared/config/model.ts. Файлам из functions/src
 * они не нужны — там сборка ходит относительными путями (см. functions/tsconfig.json),
 * но на общий набор алиасов это не влияет: лишний алиас не мешает файлам, которые им не пользуются.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@shared': path.resolve(__dirname, './shared'),
        },
    },
    test: {
        include: ['firestore/**/*.test.ts', 'functions/src/**/*.test.ts'],
        environment: 'node',
    },
});
