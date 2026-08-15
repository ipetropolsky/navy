import { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useRef, useState } from 'react';

import { useSlide } from '@/hooks/useSlide';
import { isTextField } from '@/utils/keyboard';

import IconButton from '@/components/ui/IconButton';
import TopFade from '@/components/ui/TopFade';

import styles from './Shade.module.less';

/**
 * Сколько палец должен пройти, чтобы это считалось перетаскиванием, px. Меньше — нажатие:
 * попасть в шторку и не сдвинуть её на пиксель-другой невозможно, и без этого зазора каждое
 * нажатие оборачивалось бы рывком. Тем же зазором отделяется нажатие на кнопку внутри шторки
 * от потяга за то место, где она лежит.
 */
const DRAG_SLOP = 4;

/**
 * Какую долю своей высоты надо утянуть вниз, чтобы шторка закрылась. Меньше — вернётся
 * на место: короткий рывок вниз бывает и промахом.
 */
const DISMISS_SHARE = 0.35;

/** Мотается ли этот блок сам: и разрешено, и есть что мотать. */
const scrolls = (node: Element): boolean => {
    const overflow = getComputedStyle(node).overflowY;
    return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight;
};

/**
 * Есть ли под указателем своя прокрутка — где-то между ним и самой шторкой.
 *
 * Прокрутка главнее: тянуть шторку можно за любое место, но список и всё, что мотается само,
 * обязаны мотаться, а не превращать движение пальца в закрытие. Смотрим поэтому не на то, где
 * именно лежит ручка, а на то, есть ли под пальцем что мотать.
 *
 * Направление движения при этом не учитывается нарочно. «Домотал список до верха — дальше
 * тянется шторка» выглядит находчиво ровно до первого промаха: палец у нижнего края то листает,
 * то закрывает. Область с прокруткой прокручивается, и только.
 */
const hasOwnScroll = (target: EventTarget | null, root: HTMLElement): boolean => {
    for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
        if (scrolls(node)) {
            return true;
        }
    }
    return false;
};

interface ShadeProps {
    /** Открыта ли шторка. Закрытая ещё едет вниз и потому какое-то время остаётся на экране. */
    open: boolean;
    onClose: () => void;
    /** Чем шторка подписана тем, кто её не видит. */
    label: string;
    /**
     * Шторка внутри блока контента, а не поверх окна. Так она стоит, когда разговор убран
     * в боковую панель: поверх окна она накрыла бы собой рейд, ради которого разговор
     * туда и убирают. На узком окне боковой раскладки нет, и это не действует.
     */
    inside?: boolean;
    children: ReactNode;
}

/**
 * Шторка: список кораблей, приезжающий снизу поверх всего остального.
 *
 * Она одна на всё приложение, и устроена соответственно просто: открыта или закрыта, третьего
 * положения нет. Ростом шторка ровно по своему содержимому и не выше окна за вычетом шапки —
 * то есть короткий список показан коротким блоком, а длинный мотается внутри сам.
 *
 * Поверх, а не вместо: разговор под ней остаётся собранным, со своим местом прокрутки
 * и набранным в поле. Под шторкой всегда затемнение — под ней ничего не выбирают, а сцена
 * в этот момент только фон.
 *
 * Выходов три: крестик в верхнем углу, нажатие мимо и потяг вниз. Тянут за любое место,
 * у которого нет своей прокрутки и которое не текстовое поле, — попадать пальцем в полоску
 * шириной в палец занятие для тех, кому некуда спешить.
 *
 * Едет она сдвигом, а не высотой: высоту ей задаёт содержимое, и разводить её во времени
 * значило бы перекладывать содержимое на каждом кадре выезда.
 */
export default function Shade({ open, onClose, label, inside = false, children }: ShadeProps) {
    const shadeRef = useRef<HTMLElement>(null);
    const { mounted, onTransitionEnd } = useSlide(open);
    // Сдвиг вниз, пока шторку тянут, px. Стоит inline-стилем и идёт за пальцем без перехода;
    // отпустили — стиль убираем, и шторка сама возвращается на место или уезжает совсем.
    const [shift, setShift] = useState<number | null>(null);
    // Перетаскивание кончается тем же click, что и нажатие, — и кончается им где угодно,
    // хоть на кнопке внутри шторки. Флаг гасит этот click: без него потяг за строку списка
    // заодно нажимал бы то, с чего начали.
    const draggedRef = useRef(false);

    const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        const shade = shadeRef.current;
        // Вторичные кнопки мыши шторку не тянут: у правой своё дело — меню. Текстовое поле
        // тоже не тянет: движение по нему ставит курсор и выделяет набранное.
        if (!shade || event.button !== 0 || isTextField(event.target) || hasOwnScroll(event.target, shade)) {
            return;
        }
        const startY = event.clientY;
        const height = shade.getBoundingClientRect().height;
        const drag = { moved: false, shift: 0 };

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }
            if (!drag.moved) {
                if (Math.abs(moveEvent.clientY - startY) <= DRAG_SLOP) {
                    return;
                }
                drag.moved = true;
                // Выделение, начатое этим же движением, снимаем: тянут шторку, а не выделяют
                // текст. Дальше его не даёт набрать `user-select` (см. .shadeDragging).
                window.getSelection()?.removeAllRanges();
            }
            // Вверх шторке некуда: выше она и так стоит вплотную к своему пределу.
            drag.shift = Math.max(moveEvent.clientY - startY, 0);
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

        const up = () => {
            stopListening();
            setShift(null);
            if (!drag.moved) {
                return;
            }
            draggedRef.current = true;
            if (drag.shift > height * DISMISS_SHARE) {
                onClose();
            }
        };

        // Слушаем окно, а не саму шторку: первый же шаг вниз выносит палец за её кромку,
        // и обработчик на шторке не увидел бы дальше ничего. Захват указателя
        // (setPointerCapture) вместо этого не годится — он уводит к шторке и нажатия,
        // и ни одна кнопка внутри неё больше не нажималась бы.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    /**
     * Нажатие, которым кончилось перетаскивание, до содержимого не доходит: тянут шторку
     * за любое место, в том числе за кнопку. Ловится оно на погружении — до всех обработчиков
     * внутри.
     */
    const handleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
        if (draggedRef.current) {
            draggedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
        }
    };

    if (!mounted) {
        return null;
    }

    const leaving = !open;
    const look = [
        styles.shade,
        inside ? styles.shadeInside : '',
        leaving ? styles.shadeLeaving : '',
        shift === null ? '' : styles.shadeDragging,
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <>
            {/* Затемнение, оно же «мимо шторки». Пока её тянут, оно светлеет вместе с уходом:
                затемнение и шторка — одно движение, и гасить его в конце значило бы разводить
                их надвое. Шапка канала при этом остаётся нажимаемой: она лежит выше
                (см. z-index в App.module.less), и кнопками из неё шторка и закрывается. */}
            <button
                type="button"
                className={[styles.backdrop, inside ? styles.backdropInside : '', leaving ? styles.backdropLeaving : '']
                    .filter(Boolean)
                    .join(' ')}
                style={shift === null ? undefined : { opacity: Math.max(1 - shift / 200, 0) }}
                aria-label="Закрыть шторку"
                onClick={onClose}
            />
            <section
                className={look}
                style={shift === null ? undefined : { transform: `translateY(${shift}px)` }}
                aria-label={label}
                ref={shadeRef}
                onPointerDown={handlePointerDown}
                onClickCapture={handleClickCapture}
                onTransitionEnd={onTransitionEnd}
            >
                {/* Ручка — рисунок, а не кнопка: она говорит «меня можно тянуть», и только.
                    Нажимать её незачем и нечем — тому, у кого нет пальца, шторку закрывают
                    крестик и нажатие мимо, а третья кнопка «закрыть» рядом с ними прибавила бы
                    только третью одинаковую подпись в озвучке. */}
                <span className={styles.handle} aria-hidden="true">
                    <span className={styles.grip} />
                </span>
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
                <TopFade>{children}</TopFade>
            </section>
        </>
    );
}
