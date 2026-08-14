import { PointerEvent as ReactPointerEvent, ReactNode, useRef, useState } from 'react';

import { useIsMobile, useIsShortWindow } from '@/utils/viewport';

import IconButton from '@/components/ui/IconButton';
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
    /**
     * Шторка поверх другой шторки: второй этаж. Такая считает ступени от окна, а не от кадра,
     * в котором лежит, и остаётся шторкой даже там, где нижняя ложится неподвижным блоком
     * (короткое окно). Нижняя при этом остаётся на месте со всем, что в ней набрано.
     */
    over?: boolean;
    /**
     * Закрыть шторку совсем. Пока обработчик задан, у шторки есть крестик в верхнем углу,
     * а нажатие мимо неё закрывает, а не складывает в щёлку: у второго этажа нижней ступени
     * нет — сложить его значит оставить на экране полоску ни с чем.
     */
    onClose?: () => void;
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
 *
 * Шторок бывает две, одна поверх другой (`over`): список кораблей приезжает вторым этажом
 * над разговором, а не подменяет его собой. Подмена стоила дорого — вместе с разговором
 * уезжали и место прокрутки, и набранное в поле, — а второй этаж не трогает ничего.
 *
 * В коротком окне шторки нет вовсе: ступени в нём не из чего сделать — сложенная шторка
 * занимает больше, чем остаётся сцене (см. SHORT_WINDOW_MAX_HEIGHT). Там она ложится под
 * кадром неподвижным блоком, и всё, что ниже, — ручка, затемнение, ступени — не рисуется
 * и не считается. На второй этаж это не распространяется: ему негде лечь под кадром.
 */
export default function Shade({ stop, onStop, label, over = false, onClose, children }: ShadeProps) {
    const mobile = useIsMobile();
    const shortWindow = useIsShortWindow();
    const shadeRef = useRef<HTMLElement>(null);
    // Высота, пока шторку тянут. Она стоит inline-стилем и идёт за пальцем без перехода;
    // отпустили — стиль убираем, и высоту снова задаёт класс ступени, уже с анимацией.
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const dragRef = useRef<{ startY: number; startHeight: number; frame: number; moved: boolean } | null>(null);
    // Перетаскивание кончается тем же click, что и нажатие. Флаг отличает одно от другого:
    // без него бросок на ступень тут же догонялся бы шагом «нажали на ручку».
    const draggedRef = useRef(false);

    // Неподвижная шторка: тот же блок с тем же содержимым, но без ручки и без затемнения.
    // Уходит она отсюда сразу, до всего счёта ступеней, — считать в ней нечего.
    //
    // Риска на ней остаётся, и на обычном своём месте — полоской по верхнему краю. Тянуть
    // за неё нечего: страница прокручивается целиком, свайпом по чему угодно, включая саму
    // сцену, и снап доводит её до ближайшего экрана. Риска показывает, что снизу не обрезанный
    // край страницы, а её вторая половина.
    if (shortWindow && !over) {
        return (
            <section className={[styles.shade, styles.shadeStill].join(' ')} aria-label={label}>
                <div className={styles.stillHandle} aria-hidden="true">
                    <span className={styles.grip} />
                </div>
                <div className={styles.body}>{children}</div>
            </section>
        );
    }

    /**
     * Кадр, в котором шторка ходит: от него считаются все ступени. Для обычной это её родитель
     * — приложение ростом в окно, — а для второго этажа само окно: лежать он может и в
     * прокручиваемой странице короткого окна, и высота родителя там уже не про экран.
     */
    const frameHeight = (shade: HTMLElement): number =>
        over ? window.innerHeight : (shade.parentElement?.getBoundingClientRect().height ?? 0);

    const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const shade = shadeRef.current;
        const frame = shade ? frameHeight(shade) : 0;
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

    const look = [
        styles.shade,
        over ? styles.shadeOver : '',
        STOP_CLASS[stop],
        dragHeight === null ? '' : styles.shadeDragging,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <>
            {/* Затемнение, оно же «мимо шторки»: нажатие по нему опускает её в щёлку, а шторку
                с крестиком — закрывает совсем. Ловит оно только пока темнит, то есть на верхней
                ступени. Ниже кадр под ним живой — по воде выбирают место на рейде, и делают это
                как раз при открытой наполовину шторке с формой корабля, — поэтому там затемнение
                выключено вовсе, а не просто прозрачно.
                У закрываемой шторки оно ловит на любой ступени: за ней лежит не живой кадр,
                а другая шторка, и нажатие мимо второго этажа означает «убери его».
                Шапка канала при этом нажимаема на любой ступени: она лежит выше затемнения
                (см. z-index в App.module.less), и кнопка «Свернуть сцену» из-под шторки
                достаётся по-прежнему. */}
            <button
                type="button"
                className={[styles.backdrop, over ? styles.backdropOver : ''].filter(Boolean).join(' ')}
                style={{ opacity: dim }}
                disabled={!onClose && dim === 0}
                aria-label="Закрыть шторку"
                onClick={() => (onClose ? onClose() : onStop('peek'))}
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
                {/* Крестик в верхнем углу — справа от заголовка, который рисует само содержимое.
                    Он нужен там, где шторку закрывают, а не складывают: складывать второй этаж
                    некуда, и без крестика единственным выходом остаётся нажатие мимо — а по нему
                    ещё надо догадаться. */}
                {onClose && (
                    <div className={styles.close}>
                        <IconButton variant="muted" onClick={onClose} aria-label="Закрыть">
                            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                                <path
                                    d="M7 7l10 10M17 7L7 17"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            </svg>
                        </IconButton>
                    </div>
                )}
                <div className={styles.body}>{children}</div>
            </section>
        </>
    );
}
