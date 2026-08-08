import path from 'path';
import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    // base: process.env.NODE_ENV === 'production' ? '/project-name/' : '/',
    base: './',
    resolve: {
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        alias: {
            '@': path.resolve(__dirname, './src'),
            '~': path.resolve(__dirname, './node_modules'),
        },
    },
    build: {
        target: 'esnext',
        outDir: 'build',
    },
    server: {
        port: 3000,
        open: true,
    },
});
