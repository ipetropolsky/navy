// @ts-check
// Note the `/flat` suffix here, the difference from default entry is that
// `/flat` added `name` property to the exported object to improve
// [config-inspector](https://eslint.org/blog/2024/04/eslint-config-inspector/) experience.
import eslintConfigPrettier from 'eslint-config-prettier/flat';

import { generateEslintConfig, PROJECT_TYPES } from '@hh.ru/eslint-config';

export default [
    ...generateEslintConfig(PROJECT_TYPES.SERVICE),
    {
        // Собранные функции: lib/ вне корня общий игнор пакета не ловит — только вложенный путь.
        // Рядом — сборка с бэкендом Firebase для test:e2e:firebase: общий игнор знает про
        // `build`, но не про эту папку, и без неё линтер идёт разбирать сжатый бандл
        // и выдаёт шестнадцать тысяч замечаний к чужому коду (см. playwright.firebase.config.ts).
        ignores: ['functions/lib', 'build-firebase'],
    },
    {
        // shared/ и functions/src собирает обычный tsc, без бандлера, — а алиасы из tsconfig
        // paths в собранный JS не попадают, поэтому импорты в обоих каталогах только
        // относительные: поставь там алиас, и собранный код не найдёт, куда за ним идти.
        files: ['shared/**/*.ts', 'functions/src/**/*.ts'],
        rules: { 'no-restricted-imports': 'off' },
    },
    { rules: { 'prettier/prettier': 'off' } },
    eslintConfigPrettier,
];
