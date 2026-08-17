import { ReactNode, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

/** Шторка в стопке: чем её закрыть, когда поверх ложится та, что соседей под собой не терпит. */
interface Layer {
    id: string;
    close: () => void;
}

interface Stack {
    /** Встать в стопку поверх всех открытых. `cover` — лечь на них, иначе закрыть их за собой. */
    enter: (id: string, close: () => void, cover: boolean) => void;
    /** Уйти из стопки совсем — когда шторку сняли с экрана. */
    leave: (id: string) => void;
    /** Открытые шторки снизу вверх: место в списке и есть этаж. */
    order: string[];
}

const ShadeStackContext = createContext<Stack>({
    enter: () => undefined,
    leave: () => undefined,
    order: [],
});

/**
 * Стопка шторок: кто над кем лежит и что случается, когда поверх открывают ещё одну.
 *
 * Порядок в разметке для этого не годится вовсе. Шторки написаны в App одна за другой,
 * и порядок этот — тот, в котором о них рассказано, а не тот, в котором их открывали:
 * открытая позже вылезала под открытой раньше, потому что стояла в разметке выше. Стопка
 * же считает по времени: кто открылся последним, тот и наверху.
 *
 * Что делать с теми, кто уже открыт, шторка выбирает сама (`cover` у `Shade`):
 *
 * - **Закрыть за собой** — если новая шторка отвечает на другой вопрос. Список кораблей
 *   открывают из шапки, и накрывать им карточку одного корабля незачем: разговор про этот
 *   корабль кончился.
 * - **Лечь поверх** — если новая шторка продолжает ту, из которой её открыли. Карточку
 *   открывают из строчки списка, и закрыв её, человек ждёт увидеть список, а не пустой рейд.
 *   Затемнение новой шторки при этом накрывает и старую: под верхней шторкой ничего
 *   не выбирают, чем бы это ни было.
 *
 * Закрываются они, соответственно, в обратном порядке — по одной, сверху вниз.
 */
export function ShadeStack({ children }: { children: ReactNode }) {
    // Сама стопка живёт в ссылке, а наружу отдаётся списком id. Иначе никак: `enter` зовут
    // из эффекта шторки, и ему нужна стопка на этот самый миг, а не та, что была на проходе,
    // в котором эффект завели.
    const layersRef = useRef<Layer[]>([]);
    const [order, setOrder] = useState<string[]>([]);

    const enter = useCallback((id: string, close: () => void, cover: boolean) => {
        const below = layersRef.current.filter((layer) => layer.id !== id);
        if (!cover) {
            for (const layer of below) {
                layer.close();
            }
        }
        // Закрытые не выкидываем: закрытая шторка ещё едет вниз и на экране остаётся. Уйдёт
        // она сама, `leave`, когда доедет, — а до тех пор держит свой этаж и уезжает под новой.
        layersRef.current = [...below, { id, close }];
        setOrder(layersRef.current.map((layer) => layer.id));
    }, []);

    const leave = useCallback((id: string) => {
        layersRef.current = layersRef.current.filter((layer) => layer.id !== id);
        setOrder(layersRef.current.map((layer) => layer.id));
    }, []);

    const stack = useMemo(() => ({ enter, leave, order }), [enter, leave, order]);

    return <ShadeStackContext.Provider value={stack}>{children}</ShadeStackContext.Provider>;
}

/**
 * Этаж этой шторки в стопке: 0 — самая нижняя. По нему считаются z-index шторки и её
 * затемнения (см. `--shade-floor` в стилях).
 *
 * Считается от `mounted`, а не от `open`: в стопку шторка встаёт, когда появляется на экране,
 * и уходит из неё, когда с экрана снята. Закрытая, но ещё едущая вниз, остаётся на своём
 * этаже — иначе она проваливалась бы под ту, что её сменила, ровно посреди ухода.
 */
export const useShadeFloor = (mounted: boolean, onClose: () => void, cover: boolean): number => {
    const { enter, leave, order } = useContext(ShadeStackContext);
    const id = useId();
    // Закрывалка живёт в ссылке: стопке она отдаётся один раз, а снаружи приходит новой
    // на каждый проход, и записанная напрямую перезаводила бы этаж на ровном месте.
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!mounted) {
            return undefined;
        }
        enter(id, () => closeRef.current(), cover);
        return () => leave(id);
    }, [mounted, cover, id, enter, leave]);

    // До первого прохода эффекта шторки в стопке ещё нет — этаж у неё первый.
    return Math.max(order.indexOf(id), 0);
};
