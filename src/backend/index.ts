import { createLocalBackend } from '@/backend/localBackend';
import { ChannelBackend } from '@/backend/types';

/**
 * Единственная точка, где приложение выбирает реализацию бэкенда. Всё остальное
 * работает с типом ChannelBackend, поэтому подмена на FirebaseBackend — правка этой строки.
 */
export const backend: ChannelBackend = createLocalBackend();

export * from '@/backend/types';

/**
 * Правила рейда наружу: по ним форма показывает свободные места, а сцена разводит тесную пару
 * на линии. Назначает место всё равно бэкенд — выбор человека для него только пожелание, — но
 * нарисовать овалы нужно до того, как что-то отправлено, и считаются они из того же списка
 * кораблей, который у вкладки и так есть. Поэтому это чистые функции рядом с контрактом,
 * а не ещё один запрос.
 *
 * Расхождение живёт там же по другой причине: помещаются ли двое на линии и на сколько им
 * ради этого разойтись — один и тот же счёт (spreadPair). Разъедься эти правила по разным
 * модулям, и рано или поздно расстановка пустила бы на линию пару, которую сцена развести
 * не сумеет.
 */
export { freeBerths, fleetLefts, restingDrift, restingLeft, restingYaw, suggestBerth } from '@/backend/placement';
export type { Anchored } from '@/backend/placement';
