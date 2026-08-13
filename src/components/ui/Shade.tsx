import { PointerEvent as ReactPointerEvent, ReactNode, useRef, useState } from 'react';

import { useIsMobile } from '@/utils/viewport';

import { ShadeStop, nearestStop, nextStop, shadeStops, stopHeight } from '@/components/ui/shadeStops';

import styles from './Shade.module.less';

/**
 * Сколько палец должен пройти, чтобы это считалось перетаскиванием, px. Меньше — нажатие:
 * попасть в ручку и не сдвинуть её на пиксель-другой невозможно, и без этого зазора каждое
 * нажатие оборачивалось бы броском на ту же ступень, с которой начали.
 */
const DRAG_SLOP = 4;

/** Класс ступени. Отдельной таблицей, а не именем, собранным из строк: имена классов в модуле
 *  всё равно перебиты сборкой, и собирать их по кускам значит терять проверку на опечатку. */
const STOP_CLASS: Record<ShadeStop, string> = {
    peek: styles.shadePeek,
    half: styles.shadeHalf,
    full: styles.shadeFull,
};

interface ShadeProps {
    stop: ShadeStop;
    onStop: (stop: ShadeStop) => void;
    /** Чем шторка подписана тем, кто её не видит. */
    label: string;
    children: ReactNode;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * Шторка: содержимое приложения, выезжающее снизу поверх сцены. На телефоне у неё три
 * положения — щёлка, половина, верх, — на десктопе два: сложена или раскрыта (см. shadeStops).
 * Путь между ними один и тот же, тянут её пальцем или нажимают на ручку.
 *
 * Ступени не переключаются по одной: отпущенная шторка встаёт на ближайшую к тому месту, где
 * её бросили (см. `nearestStop`). Отсюда сразу оба движения — коротким рывком уходишь на
 * соседнюю ступень, длинным дотягиваешь до верха за раз. Нажатие на ручку — тот же путь для
 * тех, кто не тянет: следующая ступень вверх, с верхней возврат в щёлку.
 *
 * Анимируется высота, а не сдвиг: содержимое внутри должно перекладываться под новый размер.
 * Сдвинутая шторка держала бы раскладку полной высоты, и в щёлке было бы видно её верхние
 * 132 px — то есть самые старые сообщения ленты — вместо последней строчки с полем ввода.
 *
 * Кто на какой ступени стоит, шторка не помнит: положение приходит снаружи. Иначе его не
 * отнять и не вернуть, а отнимать придётся — на время клавиатуры (см. App).
 */
export default function Shade({ stop, onStop, label, children }: ShadeProps) {
    const mobile = useIsMobile();
    const shadeRef = useRef<HTMLElement>(null);
    // Высота, пока шторку тянут. Она стоит inline-стилем и идёт за пальцем без перехода;
    // отпустили — стиль убираем, и высоту снова задаёт класс ступени, уже с анимацией.
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const dragRef = useRef<{ startY: number; startHeight: number; frame: number; moved: boolean } | null>(null);
    // Перетаскивание кончается тем же click, что и нажатие. Флаг отличает одно от другого:
    // без него бросок на ступень тут же догонялся бы шагом «нажали на ручку».
    const draggedRef = useRef(false);

    const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const shade = shadeRef.current;
        // Кадр, в котором шторка ходит, — её родитель: ступени считаются от высоты окна,
        // а не от длины содержимого.
        const frame = shade?.parentElement?.getBoundingClientRect().height ?? 0;
        if (!shade || !frame) {
            return;
        }
        dragRef.current = {
            startY: event.clientY,
            startHeight: shade.getBoundingClientRect().height,
            frame,
            moved: false,
        };
        // Палец может уйти с ручки и даже за край окна — движение всё равно наше.
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag) {
            return;
        }
        if (Math.abs(event.clientY - drag.startY) > DRAG_SLOP) {
            drag.moved = true;
        }
        // Вверх — растём: экранный y уменьшается, а высота прибавляется.
        const height = drag.startHeight + (drag.startY - event.clientY);
        setDragHeight(clamp(height, stopHeight('peek', drag.frame, mobile), stopHeight('full', drag.frame, mobile)));
    };

    const handlePointerUp = () => {
        const drag = dragRef.current;
        const height = dragHeight;
        dragRef.current = null;
        setDragHeight(null);
        if (!drag?.moved || height === null) {
            return;
        }
        draggedRef.current = true;
        onStop(nearestStop(height, drag.frame, mobile));
    };

    // Нажатие на ручку — с клавиатуры в том числе, поэтому click, а не pointerup.
    const handleClick = () => {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        onStop(nextStop(stop, mobile));
    };

    const drag = dragRef.current;
    // Затемнение набирается на последней ступени: от предпоследней к верху. Пока тянут, считаем
    // его по высоте, чтобы фон темнел вместе с движением, а не вспыхивал в конце.
    const stops = shadeStops(mobile);
    const below = stops[stops.length - 2];
    const dim =
        drag && dragHeight !== null
            ? clamp(
                  (dragHeight - stopHeight(below, drag.frame, mobile)) /
                      Math.max(stopHeight('full', drag.frame, mobile) - stopHeight(below, drag.frame, mobile), 1),
                  0,
                  1
              )
            : Number(stop === 'full');

    const look = [styles.shade, STOP_CLASS[stop], dragHeight === null ? '' : styles.shadeDragging]
        .filter(Boolean)
        .join(' ');

    return (
        <>
            {/* Затемнение, оно же «мимо шторки»: нажатие по нему опускает её в щёлку.
                Ловит оно только пока темнит, то есть на верхней ступени. Ниже кадр под ним
                живой — по воде выбирают место на рейде, и делают это как раз при открытой
                наполовину шторке с формой корабля, — поэтому там затемнение выключено вовсе,
                а не просто прозрачно.
                Шапка канала при этом нажимаема на любой ступени: она лежит выше затемнения
                (см. z-index в App.module.less), и кнопка «Свернуть сцену» из-под шторки
                достаётся по-прежнему. */}
            <button
                type="button"
                className={styles.backdrop}
                style={{ opacity: dim }}
                disabled={dim === 0}
                aria-label="Закрыть шторку"
                onClick={() => onStop('peek')}
            />
            <section
                className={look}
                style={dragHeight === null ? undefined : { height: `${dragHeight}px` }}
                aria-label={label}
                ref={shadeRef}
            >
                <button
                    type="button"
                    className={styles.handle}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    onClick={handleClick}
                    aria-label={stop === 'full' ? 'Опустить шторку' : 'Поднять шторку'}
                >
                    <span className={styles.grip} />
                </button>
                <div className={styles.body}>{children}</div>
            </section>
        </>
    );
}
