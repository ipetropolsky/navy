import { RefObject, useEffect } from 'react';

/**
 * Свайп пальцем по блоку: в какую сторону провели.
 *
 * Пальцем, а не указателем: мышью то же самое делают кнопкой, а тянущее движение мышью
 * по кадру — это выделение и выбор места на рейде, и отбирать его у них нечем.
 *
 * Своим мы объявляем движение только вдоль: поперёк и двумя пальцами уходит системе нетронутым.
 * Отменять при этом нечего — вертикаль кадра запрещена стилями (`touch-action` у .scene),
 * и браузеру тут не за что взяться. Слушатели поэтому ленивые, а нажатие по кораблю доживает
 * до конца и срабатывает, даже если палец по дороге дрогнул.
 */

/**
 * Насколько палец должен уйти, чтобы стало понятно, куда его ведут, px. Меньше — тычок:
 * попасть в экран и не сдвинуть палец на пиксель-другой невозможно.
 */
const CLAIM_SLOP = 8;

/** Сколько надо пройти вдоль, чтобы жест сработал, px. */
const SWIPE_DISTANCE = 48;

export const useSwipe = (ref: RefObject<HTMLElement | null>, onSwipe: (direction: 'up' | 'down') => void): void => {
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

            if (!ours) {
                if (Math.abs(dx) <= CLAIM_SLOP && Math.abs(dy) <= CLAIM_SLOP) {
                    return;
                }
                // Поперёк — не наше. Забываем начало: жест уже опознан чужим, и доводить его
                // до вертикали разворотом посреди пути нельзя.
                if (Math.abs(dx) > Math.abs(dy)) {
                    start = null;
                    return;
                }
                ours = true;
            }

            if (Math.abs(dy) >= SWIPE_DISTANCE) {
                done = true;
                onSwipe(dy > 0 ? 'down' : 'up');
            }
        };

        const handleEnd = () => {
            start = null;
        };

        node.addEventListener('touchstart', handleStart, { passive: true });
        node.addEventListener('touchmove', handleMove, { passive: true });
        node.addEventListener('touchend', handleEnd, { passive: true });
        node.addEventListener('touchcancel', handleEnd, { passive: true });
        return () => {
            node.removeEventListener('touchstart', handleStart);
            node.removeEventListener('touchmove', handleMove);
            node.removeEventListener('touchend', handleEnd);
            node.removeEventListener('touchcancel', handleEnd);
        };
    }, [ref, onSwipe]);
};
