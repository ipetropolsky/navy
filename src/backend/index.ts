import { isFirebaseConfigured } from '@/config/firebase';

import { Entrance, createFirebaseEntrance, createLocalEntrance } from '@/backend/auth';
import { createLocalBackend } from '@/backend/localBackend';
import { ChannelBackend } from '@/backend/types';

/**
 * Единственная точка, где приложение выбирает, с чем разговаривать. Всё остальное работает
 * с типами `ChannelBackend` и `Entrance`, поэтому подмена — правка этих строк.
 *
 * Выбор — переменная сборки `VITE_BACKEND`, и он не слепой: настроек Firebase может
 * не оказаться (свежая копия репозитория, чужая ветка, забытый `.env.local`), и тогда
 * приложение работает на эмуляторе, а не встречает человека пустым экраном.
 */
const wanted = import.meta.env.VITE_BACKEND ?? 'local';
const onFirebase = wanted === 'firebase' && isFirebaseConfigured();

/** Данные канала. Firestore встаёт сюда следующими шагами (см. docs/FIREBASE.md). */
export const backend: ChannelBackend = createLocalBackend();

/** Вход. Настоящий — через аккаунт; понарошку — когда за данными стоит эмулятор. */
export const entrance: Entrance = onFirebase ? createFirebaseEntrance() : createLocalEntrance();

export type { Account, AuthState, Entrance } from '@/backend/auth';

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
