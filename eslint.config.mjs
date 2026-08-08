// @ts-check
// Note the `/flat` suffix here, the difference from default entry is that
// `/flat` added `name` property to the exported object to improve
// [config-inspector](https://eslint.org/blog/2024/04/eslint-config-inspector/) experience.
import eslintConfigPrettier from 'eslint-config-prettier/flat';

import { generateEslintConfig, PROJECT_TYPES } from '@hh.ru/eslint-config';

export default [
    ...generateEslintConfig(PROJECT_TYPES.SERVICE),
    { rules: { 'prettier/prettier': 'off' } },
    eslintConfigPrettier,
];
