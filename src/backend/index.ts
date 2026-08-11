import { createLocalBackend } from '@/backend/localBackend';
import { ChannelBackend } from '@/backend/types';

/**
 * Единственная точка, где приложение выбирает реализацию бэкенда. Всё остальное
 * работает с типом ChannelBackend, поэтому подмена на FirebaseBackend — правка этой строки.
 */
export const backend: ChannelBackend = createLocalBackend();

export * from '@/backend/types';

/**
 * Правила рейда наружу: по ним форма показывает свободные места. Назначает место всё равно
 * бэкенд — выбор человека для него только пожелание, — но нарисовать овалы нужно до того,
 * как что-то отправлено, и считаются они из того же списка кораблей, который у вкладки
 * и так есть. Поэтому это чистая функция рядом с контрактом, а не ещё один запрос.
 */
export { freeBerths } from '@/backend/placement';
