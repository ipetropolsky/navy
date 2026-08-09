// @ts-check
// Note the `/flat` suffix here, the difference from default entry is that
// `/flat` added `name` property to the exported object to improve
// [config-inspector](https://eslint.org/blog/2024/04/eslint-config-inspector/) experience.
import eslintConfigPrettier from 'eslint-config-prettier/flat';

import { generateEslintConfig, PROJECT_TYPES } from '@hh.ru/eslint-config';

export default [
    ...generateEslintConfig(PROJECT_TYPES.SERVICE),
    {
        rules: {
            'prettier/prettier': 'off',
            // Тот же список, что в общем конфиге, но без запрета Array.from:
            // для генерации массива фиксированной длины он читается лучше спреда
            // и, в отличие от [...Array(n)], не даёт массив any.
            'no-restricted-properties': [
                'error',
                { property: '__defineGetter__', message: 'Please use Object.defineProperty instead.' },
                { property: '__defineSetter__', message: 'Please use Object.defineProperty instead.' },
                { object: 'Reflect' },
            ],
        },
    },
    eslintConfigPrettier,
];
