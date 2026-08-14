import { TransitionEvent, useEffect, useState } from 'react';

/**
 * Блок, который выезжает снизу и уезжает обратно: сколько его держать на экране.
 *
 * Показать уход можно только тому, что в этот момент нарисовано. Снятый в тот же миг, когда
 * его закрыли, блок исчезает без движения — а закрывается он тем же путём, каким появился,
 * иначе выезд читается как показ, а уход как поломка. Поэтому блок остаётся на экране, пока
 * едет, и снимается по концу перехода.
 *
 * Ехать при этом обязан `transform`: по нему и считается, что переход кончился. Переходы
 * всего остального внутри блока — свои и до конца выезда не относятся, поэтому и цель события
 * проверяется, и его свойство.
 *
 * Так устроены обе выезжающие вещи в приложении — шторка со списком кораблей и форма корабля
 * поверх разговора, — и правило у них одно на двоих.
 */
export const useSlide = (
    open: boolean
): { mounted: boolean; onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void } => {
    const [mounted, setMounted] = useState(open);

    // Открыли — рисуем. Обратно в состоянии это не отражается: закрытый блок ещё едет,
    // и снимет его конец перехода.
    useEffect(() => {
        if (open) {
            setMounted(true);
        }
    }, [open]);

    const onTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
        if (!open && event.target === event.currentTarget && event.propertyName === 'transform') {
            setMounted(false);
        }
    };

    return { mounted: open || mounted, onTransitionEnd };
};
