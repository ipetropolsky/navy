import { RefObject, useEffect } from 'react';

/**
 * Свайп пальцем по блоку — в одну заранее названную сторону.
 *
 * Пальцем, а не указателем: мышью то же самое делают кнопкой, а тянущее движение мышью
 * по кадру — это выделение и выбор места на рейде, и отбирать его у них нечем.
 *
 * Сторона одна и приходит снаружи, потому что от неё зависит главное — чей это жест. Своим
 * мы объявляем движение только в свою сторону и только вдоль: всё остальное (поперёк, назад,
 * двумя пальцами) уходит системе нетронутым, вместе с потягом страницы к обновлению.
 */

/**
 * Насколько палец должен уйти, чтобы стало понятно, куда его ведут, px. Меньше — тычок:
 * попасть в экран и не сдвинуть палец на пиксель-другой невозможно.
 *
 * Зазор маленький нарочно. Решать, наш это жест или системный, приходится в первые же
 * миллиметры: браузер начинает тянуть страницу к обновлению с первого движения, и запретить
 * это позже уже нельзя.
 */
const CLAIM_SLOP = 8;

/** Сколько надо пройти в свою сторону, чтобы жест сработал, px. */
const SWIPE_DISTANCE = 48;

export const useSwipe = (ref: RefObject<HTMLElement | null>, direction: 'up' | 'down', onSwipe: () => void): void => {
    useEffect(() => {
        const node = ref.current;
        if (!node) {
            return undefined;
        }

        // Начало жеста и то, что мы про него уже решили. В замыкании эффекта, а не в состоянии:
        // от этих значений ничего не перерисовывается, а перерисовка на каждом кадре движения
        // пальца — как раз то, чего в жесте быть не должно.
        let start: { x: number; y: number } | null = null;
        let ours = false;
        let done = false;

        const handleStart = (event: TouchEvent) => {
            // Двумя пальцами масштабируют, а не свайпают.
            start = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
            ours = false;
            done = false;
        };

        const handleMove = (event: TouchEvent) => {
            if (!start || done || event.touches.length !== 1) {
                return;
            }
            const dx = event.touches[0].clientX - start.x;
            const dy = event.touches[0].clientY - start.y;
            // Насколько палец ушёл в нужную сторону: назад — отрицательное.
            const along = direction === 'down' ? dy : -dy;

            if (!ours) {
                if (Math.abs(dx) <= CLAIM_SLOP && Math.abs(dy) <= CLAIM_SLOP) {
                    return;
                }
                // Поперёк или назад — не наше. Забываем начало: жест уже опознан чужим,
                // и доводить его до нашей стороны разворотом посреди пути нельзя.
                if (along <= 0 || Math.abs(dx) > Math.abs(dy)) {
                    start = null;
                    return;
                }
                ours = true;
            }

            // Жест наш — и страницу на нём тянуть не надо. Отсюда и неленивый слушатель ниже:
            // ленивому браузер запретить ничего не даёт.
            event.preventDefault();
            if (along >= SWIPE_DISTANCE) {
                done = true;
                onSwipe();
            }
        };

        const handleEnd = () => {
            start = null;
        };

        node.addEventListener('touchstart', handleStart, { passive: true });
        node.addEventListener('touchmove', handleMove, { passive: false });
        node.addEventListener('touchend', handleEnd, { passive: true });
        node.addEventListener('touchcancel', handleEnd, { passive: true });
        return () => {
            node.removeEventListener('touchstart', handleStart);
            node.removeEventListener('touchmove', handleMove);
            node.removeEventListener('touchend', handleEnd);
            node.removeEventListener('touchcancel', handleEnd);
        };
    }, [ref, direction, onSwipe]);
};
