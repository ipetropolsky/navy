export default {
    // ts-check через arrow function, чтобы исключить аргументы,
    // которые передаёт lint-staged (имена staged-файлов).
    '*.ts|*.tsx': [() => 'npm run ts-check', 'npm run lint-files', 'npm run format-files'],
    '*.js|*.mjs|*.cjs': ['npm run lint-files', 'npm run format-files'],
    '!(*.ts|*.tsx|*.js|*.mjs|*.cjs)': ['npm run format-files'],
};
