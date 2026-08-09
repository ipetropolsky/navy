import { createLocalBackend } from '@/backend/localBackend';
import { ChannelBackend } from '@/backend/types';

/**
 * Единственная точка, где приложение выбирает реализацию бэкенда. Всё остальное
 * работает с типом ChannelBackend, поэтому подмена на FirebaseBackend — правка этой строки.
 */
export const backend: ChannelBackend = createLocalBackend();

export * from '@/backend/types';
