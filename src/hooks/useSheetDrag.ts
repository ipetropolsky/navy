import {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';

import { isTextField } from '@/utils/keyboard';
import { MagnetSettings, normalizeMagnets, settleMagnet, trackFling } from '@/utils/magnet';

/**
 * Потяг за коробку, которую двигают пальцем: сколько её видно, куда она приедет, когда её
 * отпустят, и что при этом достаётся прокрутке внутри.
 *
 * Механика одна на всех, кого в приложении тянут: на шторки (список кораблей, карточка корабля,
 * прощание с рейдом) и на форму своего корабля, которую приспускают, чтобы разглядеть рейд
 * под ней. Различаются они только настройками — точками магнита и осью, — а правила движения
 * у них общие, и общими они должны и остаться: разойдись они хоть чем, один и тот же бросок
 * пальца закрывал бы одно и не закрывал другое.
 *
 * Считается всё в открытости: сколько коробки видно над её кромкой. Наружу отдаётся обратное —
 * сдвиг от раскрытого положения: рисуют коробку именно им.
 */

/**
 * Сколько палец должен пройти, чтобы это считалось перетаскиванием, px. Меньше — нажатие:
 * попасть в шторку и не сдвинуть её на пиксель-другой невозможно, и без этого зазора каждое
 * нажатие оборачивалось бы рывком. Тем же зазором отделяется нажатие на кнопку внутри шторки
 * от потяга за то место, где она лежит.
 */
const DRAG_SLOP = 4;

/**
 * Вдоль какой оси коробка ходит: вниз или вбок.
 *
 * Шторки ходят вниз всегда — они приезжают снизу и уходят туда же. Форма корабля стоит в той же
 * коробке, что и разговор, а та в горизонтальном окне переезжает к правой кромке и меряется
 * шириной (см. hooks/useLayout): приспускают её там вбок, а не вниз.
 */
export type SheetAxis = 'y' | 'x';

/** Мотается ли этот блок сам вдоль нашей оси: и разрешено, и есть что мотать. */
const scrolls = (node: Element, axis: SheetAxis): boolean => {
    const style = getComputedStyle(node);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const room = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    return (overflow === 'auto' || overflow === 'scroll') && room > 0;
};

/** Насколько этот блок уже промотан вдоль нашей оси. */
const scrolled = (node: HTMLElement, axis: SheetAxis): number => (axis === 'x' ? node.scrollLeft : node.scrollTop);

/**
 * Ближайшая своя прокрутка под указателем — где-то между ним и самой коробкой.
 *
 * Тянуть коробку можно за любое место, но список и всё, что мотается само, должны мотаться,
 * а не превращать каждое движение пальца в закрытие. Смотрим поэтому не на то, где именно
 * лежит ручка, а на то, есть ли под пальцем что мотать, — и кому достанется движение, решаем
 * уже по нему (см. `move` ниже).
 */
const ownScroller = (target: EventTarget | null, root: HTMLElement, axis: SheetAxis): HTMLElement | null => {
    for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
        if (node instanceof HTMLElement && scrolls(node, axis)) {
            return node;
        }
    }
    return null;
};

export interface SheetDragSettings {
    /**
     * Открыта ли коробка. Закрытая потяга под собой не помнит: незаконченное движение
     * обрывается, сдвиг снимается.
     */
    open: boolean;
    /** Что делать, когда коробку утянули до конца. */
    onClose: () => void;
    /** Где ей позволено останавливаться (см. `@/utils/magnet`). */
    magnet: MagnetSettings;
    /** Вдоль какой оси её тянут. По умолчанию вниз — так ходят все шторки. */
    axis?: SheetAxis;
}

export interface SheetDrag {
    /**
     * Сдвиг от раскрытого положения, px: вниз по своей оси. Пока тянут — идёт за пальцем без
     * перехода; отпустили — остаётся тем, на чём коробка встала, и она приезжает туда переходом.
     * `null` — «на своём месте по стилям»: раскрыта целиком или как раз уезжает.
     */
    shift: number | null;
    /**
     * Тянут ли прямо сейчас. Отдельно от сдвига: сдвиг остаётся и после отпускания, если коробка
     * встала не на верхнюю точку, а вот переход снимается ровно на время движения пальца.
     */
    dragging: boolean;
    /** Что повесить на саму коробку. */
    handlers: {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
        onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
    };
}

/**
 * Тянут коробку за любое место, кроме текстового поля, — попадать пальцем в полоску шириной
 * в палец занятие для тех, кому некуда спешить. Своя прокрутка внутри забирает движение себе,
 * пока ей есть куда мотаться: домотанный до верха список вниз больше не едет, и потяг с него
 * достаётся коробке.
 *
 * Ход коробки — её собственный размер: она приезжает из-за кромки, и раскрыта ровно тогда, когда
 * видна целиком. Меряется он на каждый потяг заново — по тому самому блоку, за который взялись:
 * содержимое могло вырасти, а окно смениться.
 */
export const useSheetDrag = ({ open, onClose, magnet, axis = 'y' }: SheetDragSettings): SheetDrag => {
    const [shift, setShift] = useState<number | null>(null);
    const [dragging, setDragging] = useState(false);
    // Перетаскивание кончается тем же click, что и нажатие, — и кончается им где угодно,
    // хоть на кнопке внутри коробки. Флаг гасит этот click: без него потяг за строку списка
    // заодно нажимал бы то, с чего начали.
    const draggedRef = useRef(false);
    // Чем оборвать незаконченный потяг снаружи. Пишется на время движения, зовётся при закрытии.
    const dropDragRef = useRef<() => void>(() => undefined);

    /** Бросить всё: оборвать незаконченное движение и поставить коробку на её место по стилям. */
    const drop = useCallback(() => {
        dropDragRef.current();
        dropDragRef.current = () => undefined;
        setDragging(false);
        setShift(null);
    }, []);

    /**
     * Закрытие отменяет потяг, чем бы тот ни кончился.
     *
     * Движение пальца обрывается чаще, чем кажется: указатель отпустили за краем окна, касание
     * забрал браузер, вкладку увели. После такого обрыва на коробке остаётся и сдвиг, и снятый
     * на время движения переход — и оба спорят с уходом. Сдвиг стоит в стиле самого блока
     * и оказывается сильнее ухода из класса, а без перехода уход не начинается вовсе; между тем
     * снимают шторку с экрана именно по концу этого перехода. Выходило, что затемнение гасло,
     * а шторка оставалась висеть навсегда — и на следующем открытии молча подменяла корабль
     * в себе на другой.
     */
    useEffect(() => {
        if (!open) {
            drop();
        }
    }, [open, drop]);

    /**
     * Сменилась ось — сдвиг больше ничего не значит: мерян он по высоте, а коробка отныне
     * меряется шириной. Случается это при смене раскладки, то есть при повороте телефона,
     * и приспущенная форма обязана встать на своё место в новом окне, а не уехать вбок
     * ровно на столько, на сколько её опустили в старом.
     */
    useEffect(() => drop(), [axis, drop]);

    const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        // Блок, за который взялись. Запоминаем его сразу: обработчики ниже зовутся уже после
        // того, как React прибрал за собой событие, и `currentTarget` в них пуст.
        const box = event.currentTarget;
        // Вторичные кнопки мыши коробку не тянут: у правой своё дело — меню. Текстовое поле
        // тоже не тянет: движение по нему ставит курсор и выделяет набранное.
        if (event.button !== 0 || isTextField(event.target)) {
            return;
        }
        // Что мотается под пальцем, если мотается вообще. Само по себе оно потяг не отменяет:
        // кому достанется движение, видно только по его направлению и по тому, домотано ли
        // содержимое до верха, — а этого в момент нажатия ещё не знает никто. Решение поэтому
        // отложено до первого шага (см. `move`).
        const scroller = ownScroller(event.target, box, axis);
        // Где палец вдоль той оси, по которой коробка и ходит. Дальше числа одни и те же:
        // «дальше по оси» значит «коробки видно меньше» в обеих раскладках.
        const along = (point: { clientX: number; clientY: number }) => (axis === 'x' ? point.clientX : point.clientY);
        const startAt = along(event);
        const rect = box.getBoundingClientRect();
        const run = axis === 'x' ? rect.width : rect.height;
        const points = normalizeMagnets(magnet.points ?? [], run, magnet.gap);
        const lowest = points.length ? points[0] : 0;
        const highest = points.length ? points[points.length - 1] : run;
        // Открытость на момент, когда коробку взяли: сколько её видно.
        const startOpen = run - (shift ?? 0);
        const drag = { moved: false, shift: shift ?? 0 };
        // Чем кончилось движение пальца: по последним его отметкам и считается скорость
        // в момент отпускания. Мерка общая со всеми, кого тянут, — см. `trackFling`.
        const fling = trackFling();

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }
            if (!drag.moved) {
                const way = along(moveEvent) - startAt;
                if (Math.abs(way) <= DRAG_SLOP) {
                    return;
                }
                // Прокрутка главнее ровно до тех пор, пока ей есть куда мотаться: назад она
                // забирает движение, пока коробка стоит на своём месте, вперёд — пока
                // не домотана до начала. Домотанный список вниз больше не едет, и движение
                // по нему остаётся ничьим — а человек в этот момент тянет шторку и ждёт,
                // что она закроется.
                //
                // Заметнее всего это на карточке корабля: стоит содержимому перерасти короткое
                // окно, как своя прокрутка появляется у всей карточки — то есть у всего, что
                // в шторке видно. Потяг вниз доставался ей отовсюду, и закрыть шторку выходило
                // только за рисочку ручки или крестиком.
                //
                // Сдвинутая коробка забирает себе движение обратно, чего бы там ни мотала
                // прокрутка: сперва коробка встаёт на место, и только потом мотается содержимое.
                // Иначе приспущенную форму нечем было бы вернуть — прокрутка у неё своя и есть
                // почти всегда, и всякий потяг вверх доставался бы ей. Шторок это правило
                // не касается вовсе: они стоят на верхней точке всегда, кроме как под пальцем.
                //
                // Направление и место прокрутки смотрим один раз, на первом шаге: перехватывать
                // движение посреди пути нельзя — палец у нижнего края то листал бы, то закрывал.
                if (scroller && (way < 0 ? startOpen >= highest : scrolled(scroller, axis) > 0)) {
                    // eslint-disable-next-line @typescript-eslint/no-use-before-define -- отписка объявлена ниже, а зовётся отсюда уже после
                    stopListening();
                    return;
                }
                drag.moved = true;
                setDragging(true);
                // Выделение, начатое этим же движением, снимаем: тянут коробку, а не выделяют
                // текст. Дальше его не даёт набрать `user-select` (см. .shadeDragging).
                window.getSelection()?.removeAllRanges();
            }
            // Отмечаем то, куда палец увёл коробку, а не то, где он сам: скорость считается
            // в открытости, и упереться в предел она не должна — брошенная за нижнюю точку
            // коробка обязана долететь до конца, а не потерять на упоре весь разгон.
            fling.mark(startOpen - (along(moveEvent) - startAt), moveEvent.timeStamp);
            // За пределы своих точек коробка не выходит ни туда, ни сюда: выше верхней её
            // и так видно целиком, ниже нижней — не видно вовсе.
            const opened = Math.min(Math.max(startOpen - (along(moveEvent) - startAt), lowest), highest);
            drag.shift = run - opened;
            setShift(drag.shift);
        };

        // Отписка объявлена раньше самих обработчиков: она им и нужна — движение кончается тем,
        // что мы перестаём его слушать.
        const stopListening = () => {
            window.removeEventListener('pointermove', move);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- взаимная ссылка: отписка снимает обработчик, обработчик её зовёт
            window.removeEventListener('pointerup', up);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- то же самое
            window.removeEventListener('pointercancel', up);
        };

        const up = (upEvent: PointerEvent) => {
            stopListening();
            setDragging(false);
            if (!drag.moved) {
                return;
            }
            draggedRef.current = true;
            const settled = settleMagnet({
                from: startOpen,
                to: run - drag.shift,
                velocity: fling.speed(upEvent.timeStamp),
                points,
                free: magnet.free,
                pull: magnet.pull,
            });
            // Закрытой коробки на месте не бывает: съехавшую в ноль убирают совсем, и уезжает
            // она обычным уходом — сдвиг с неё поэтому снимаем, иначе он спорил бы с ним.
            if (settled <= 0) {
                setShift(null);
                onClose();
                return;
            }
            setShift(settled >= run ? null : run - settled);
        };

        // Слушаем окно, а не саму коробку: первый же шаг выносит палец за её кромку,
        // и обработчик на ней не увидел бы дальше ничего. Захват указателя
        // (setPointerCapture) вместо этого не годится — он уводит к коробке и нажатия,
        // и ни одна кнопка внутри неё больше не нажималась бы.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        dropDragRef.current = stopListening;
    };

    /**
     * Нажатие, которым кончилось перетаскивание, до содержимого не доходит: тянут коробку
     * за любое место, в том числе за кнопку. Ловится оно на погружении — до всех обработчиков
     * внутри.
     */
    const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
        if (draggedRef.current) {
            draggedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
        }
    };

    return { shift, dragging, handlers: { onPointerDown, onClickCapture } };
};
