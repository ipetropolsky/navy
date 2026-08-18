import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

import { MagnetSettings, normalizeMagnets, settleMagnet, trackFling } from '@/utils/magnet';

/**
 * Потяг за ручку коробки, которую двигают пальцем: куда она едет и где встанет, когда её
 * отпустят.
 *
 * Механика одна на всех, кого в приложении тянут: на шторки (карточка корабля, прощание
 * с рейдом) и на форму своего корабля, которую приспускают, чтобы разглядеть рейд под ней.
 * Различаются они только точками магнита, а правила движения у них общие, и общими они должны
 * и остаться: разойдись они хоть чем, один и тот же бросок пальца закрывал бы одно
 * и не закрывал другое.
 *
 * Тянут за ручку, и только за неё. Внутри коробки живут кнопки, поля, ссылки и текст, который
 * выделяют, — и всё это устроено браузером как надо ровно до тех пор, пока движение пальца
 * по ним ничего не значит. Ручка же не значит ничего другого: на ней нет ни нажатия, ни текста,
 * и спорить за движение с ней некому.
 *
 * Считается всё в открытости: сколько коробки видно над её кромкой. Наружу отдаётся обратное —
 * сдвиг от раскрытого положения: рисуют коробку именно им.
 */

export interface SheetDragSettings {
    /**
     * Открыта ли коробка. Закрытая свайпа под собой не помнит: незаконченное движение
     * обрывается, сдвиг снимается.
     */
    open: boolean;
    /** Что делать, когда коробку утянули до конца. */
    onClose: () => void;
    /** Где ей позволено останавливаться (см. `@/utils/magnet`). */
    magnet?: MagnetSettings;
}

export interface SheetDrag {
    /**
     * Сдвиг от раскрытого положения, px: вниз. Пока тянут — идёт за пальцем без
     * перехода; отпустили — остаётся тем, на чём коробка встала, и она приезжает туда переходом.
     * `null` — «на своём месте по стилям»: раскрыта целиком или как раз уезжает.
     */
    shift: number | null;
    /**
     * Тянут ли прямо сейчас. Отдельно от сдвига: сдвиг остаётся и после отпускания, если коробка
     * встала не на верхнюю точку, а вот переход снимается ровно на время движения пальца.
     */
    dragging: boolean;
    /**
     * Что повесить на ручку. Ручка обязана лежать прямо в той коробке, которую двигает:
     * ход меряется её ростом, а рост берётся с родителя ручки.
     */
    handlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
        onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
    };
}

/** Незаконченное движение: всё, что о нём нужно помнить между событиями указателя. */
interface Run {
    pointerId: number;
    /** Где палец взял ручку, px по вертикали окна. */
    startAt: number;
    /** Сколько коробки было видно в этот миг, px. */
    startOpen: number;
    /** Весь ход коробки, px: её собственный рост. */
    run: number;
    /** Точки остановки в пикселях открытости, по порядку. */
    points: number[];
    /** Сдвинулся ли палец хоть раз: без этого отпускание — просто нажатие по ручке. */
    moved: boolean;
    /** Куда увели коробку, px сдвига. */
    shift: number;
    fling: ReturnType<typeof trackFling>;
}

/**
 * Ход коробки — её собственный размер: она приезжает из-за кромки и раскрыта ровно тогда, когда
 * видна целиком. Меряется он на каждый свайп заново — по той самой коробке, в которой лежит
 * ручка: содержимое могло вырасти, а окно смениться.
 */
export const useSheetDrag = ({ open, onClose, magnet }: SheetDragSettings): SheetDrag => {
    const [shift, setShift] = useState<number | null>(null);
    const [dragging, setDragging] = useState(false);
    const runRef = useRef<Run | null>(null);

    /**
     * Закрытие отменяет свайп, чем бы тот ни кончился.
     *
     * Движение пальца обрывается чаще, чем кажется: указатель отпустили за краем окна, касание
     * забрал браузер, вкладку увели. После такого обрыва на коробке остаётся и сдвиг, и снятый
     * на время движения переход — и оба спорят с уходом. Сдвиг стоит в стиле самого блока
     * и оказывается сильнее ухода из класса, а без перехода уход не начинается вовсе; между тем
     * снимают шторку с экрана именно по концу этого перехода.
     */
    useEffect(() => {
        if (!open) {
            runRef.current = null;
            setDragging(false);
            setShift(null);
        }
    }, [open]);

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        // Вторичные кнопки мыши коробку не тянут: у правой своё дело — меню.
        if (event.button !== 0) {
            return;
        }
        const grip = event.currentTarget;
        const box = grip.parentElement ?? grip;
        const run = box.getBoundingClientRect().height;
        const points = normalizeMagnets(magnet?.points ?? [], run, magnet?.gap);
        runRef.current = {
            pointerId: event.pointerId,
            startAt: event.clientY,
            // Открытость на момент, когда коробку взяли: сколько её видно.
            startOpen: run - (shift ?? 0),
            run,
            points,
            moved: false,
            shift: shift ?? 0,
            // Чем кончилось движение пальца: по последним его отметкам и считается скорость
            // в момент отпускания. Мерка общая со всеми, кого тянут, — см. `trackFling`.
            fling: trackFling(),
        };
        // Захват указателя: дальше события приходят ручке, куда бы палец ни ушёл, — а первый же
        // шаг выносит его за её кромку. Отпускается захват сам, вместе с нажатием.
        grip.setPointerCapture(event.pointerId);
        setDragging(true);
    };

    const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
        const drag = runRef.current;
        if (drag?.pointerId !== event.pointerId) {
            return;
        }
        drag.moved = true;
        const way = event.clientY - drag.startAt;
        // Отмечаем то, куда палец увёл коробку, а не то, где он сам: скорость считается
        // в открытости, и упереться в предел она не должна — брошенная за нижнюю точку
        // коробка обязана долететь до конца, а не потерять на упоре весь разгон.
        drag.fling.mark(drag.startOpen - way, event.timeStamp);
        // За пределы своих точек коробка не выходит ни туда, ни сюда: выше верхней её
        // и так видно целиком, ниже нижней — не видно вовсе.
        const lowest = drag.points[0];
        const highest = drag.points[drag.points.length - 1];
        const opened = Math.min(Math.max(drag.startOpen - way, lowest), highest);
        drag.shift = drag.run - opened;
        setShift(drag.shift);
    };

    /**
     * Отпустили — коробка приезжает к своей точке. Сюда же приходит и обрыв: касание забрал
     * браузер, окно потеряло захват. Скорости в этом случае нет, и коробка встаёт на ближнюю
     * точку, а не отматывается назад — отматывать её человек не просил.
     */
    const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
        const drag = runRef.current;
        if (drag?.pointerId !== event.pointerId) {
            return;
        }
        runRef.current = null;
        setDragging(false);
        if (!drag.moved) {
            return;
        }
        const settled = settleMagnet({
            from: drag.startOpen,
            to: drag.run - drag.shift,
            velocity: drag.fling.speed(event.timeStamp),
            points: drag.points,
            pointsOnly: magnet?.pointsOnly,
        });
        // Закрытой коробки на месте не бывает: съехавшую в ноль убирают совсем, и уезжает
        // она обычным уходом — сдвиг с неё поэтому снимаем, иначе он спорил бы с ним.
        if (settled <= 0) {
            setShift(null);
            onClose();
            return;
        }
        setShift(settled >= drag.run ? null : drag.run - settled);
    };

    return {
        shift,
        dragging,
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            // Захват теряется и без отпускания — ручку сняли с экрана посреди движения.
            // Событие приходит и на обычном отпускании, но там движение уже закрыто,
            // и второй заход ничего не делает.
            onLostPointerCapture: onPointerUp,
        },
    };
};
