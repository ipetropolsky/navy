import { useCallback, useEffect, useRef, useState } from 'react';

import { stillness } from '@/utils/motion';

/**
 * Блок, который выезжает снизу и уезжает обратно: сколько его держать на экране.
 *
 * Показать уход можно только тому, что в этот момент нарисовано. Снятый в тот же миг, когда
 * его закрыли, блок исчезает без движения — а закрывается он тем же путём, каким появился,
 * иначе выезд читается как показ, а уход как поломка. Поэтому блок остаётся на экране, пока
 * едет, и снимается, когда доехал.
 *
 * «Доехал» спрашиваем у самого блока (см. `stillness` в utils/motion), а не отмеряем сроком:
 * отмеренный срок обрывает уход на полпути везде, где движение оказалось длиннее него.
 *
 * Так устроены все три приезжающие вещи в приложении — шторка, список кораблей и форма корабля
 * поверх разговора, — и правило у них одно на всех.
 *
 * `ref` вешают на тот самый блок, который едет: без него спрашивать не у кого, и такой блок
 * снимается сразу. Так же снимается и блок, которому ехать нечем: в системе с выключенным
 * движением переходов нет вовсе, и ждать там нечего.
 */
export const useSlide = (open: boolean): { mounted: boolean; ref: (node: HTMLElement | null) => void } => {
    const [mounted, setMounted] = useState(open);
    const nodeRef = useRef<HTMLElement | null>(null);
    const ref = useCallback((node: HTMLElement | null) => {
        nodeRef.current = node;
    }, []);

    // Открыли — рисуем. Обратно в состоянии это не отражается: закрытый блок ещё едет,
    // и снимет его конец движения.
    useEffect(() => {
        if (open) {
            setMounted(true);
        }
    }, [open]);

    useEffect(() => {
        if (open) {
            return undefined;
        }
        const node = nodeRef.current;
        if (!node) {
            setMounted(false);
            return undefined;
        }
        // Открыли обратно, не дождавшись конца, — ждать больше нечего: блок остаётся на экране
        // и разворачивается с полдороги.
        let stale = false;
        void stillness(node, () => stale).then((still) => {
            if (still) {
                setMounted(false);
            }
        });
        return () => {
            stale = true;
        };
    }, [open]);

    return { mounted: open || mounted, ref };
};
