import {
    CSSProperties,
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
    useEffect,
    useRef,
    useState,
} from 'react';

import { useSlide } from '@/hooks/useSlide';
import { isTextField } from '@/utils/keyboard';
import { MagnetSettings, normalizeMagnets, settleMagnet } from '@/utils/magnet';

import IconButton from '@/components/ui/IconButton';
import { useShadeFloor } from '@/components/ui/ShadeStack';
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
 * Магнит по умолчанию: два положения, закрыто и раскрыто по содержимому, и ничего между ними.
 *
 * Так живут все шторки, кроме разговора: список кораблей, карточка чужого корабля, прощание
 * с рейдом. Показывать их наполовину незачем — в них читают и нажимают, а не подглядывают, —
 * и «произвольное положение» им поэтому не разрешено (`free` по умолчанию выключено).
 *
 * Сотая доля от полной высоты и есть «по содержимому»: ход шторки меряется её же ростом,
 * а рост ей задаёт содержимое.
 */
const DEFAULT_MAGNET: MagnetSettings = { points: [0, '100%'] };

/**
 * За какое время до отпускания меряется скорость, мс.
 *
 * Не за весь путь пальца: медленно подведённая и в последний миг брошенная шторка обязана
 * улететь, а долго тянутая и остановленная перед отпусканием — остаться. Считает поэтому
 * только последний отрезок, и если палец простоял на месте дольше него, скорости нет вовсе.
 */
const FLING_MS = 80;

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
     * Шторка на сцене, а не поверх окна. Так она стоит, когда разговор убран в боковую панель:
     * и список кораблей, и карточка — про рейд, и место им там, где рейд и виден. На узком окне
     * боковой раскладки нет, и это не действует.
     *
     * Это про место самой шторки, и только: затемнение под ней в обеих раскладках лежит
     * по всему окну, разговор сбоку тоже гаснет и тоже ничего не ждёт. Пока шторка на экране,
     * разговор идёт только про неё.
     */
    onScene?: boolean;
    /**
     * Лечь поверх уже открытых шторок, а не закрывать их за собой.
     *
     * Так открывают продолжение: карточку корабля из строчки списка. Закрыв её, человек ждёт
     * увидеть список, из которого её и открыл, а не пустой рейд. Затемнение верхней шторки
     * накрывает при этом и нижнюю: под верхней ничего не выбирают, чем бы это ни было.
     *
     * По умолчанию шторка соседей под собой не терпит: список кораблей открывают из шапки,
     * и накрывать им карточку одного корабля незачем — разговор про этот корабль кончился.
     * Подробности — в `ShadeStack`.
     */
    cover?: boolean;
    /**
     * Где шторке позволено останавливаться (см. `@/utils/magnet`). По умолчанию — только
     * закрытой или раскрытой по содержимому.
     *
     * Настройка приходит снаружи, а не считается внутри, потому что это свойство разговора
     * между людьми, а не свойство блока: список кораблей показывают целиком, а разговор
     * человек сам решает, насколько ему открыть.
     */
    magnet?: MagnetSettings;
    children: ReactNode;
}

/**
 * Шторка: блок, приезжающий снизу поверх всего остального. Ей показывают список кораблей
 * и карточку чужого корабля.
 *
 * Открытых разом бывает несколько: карточку открывают из строчки списка и кладут поверх него
 * (`cover`), а закрывают в обратном порядке — сверху вниз. Кто над кем лежит, считает
 * не разметка, а `ShadeStack`: в разметке шторки написаны одна за другой, и порядок этот —
 * тот, в котором о них рассказано, а не тот, в котором их открывали.
 *
 * Где ей позволено останавливаться, решает магнит (`@/utils/magnet`): по умолчанию положений
 * два — закрыта или раскрыта по содержимому, — и все нынешние шторки живут так. Шторка
 * с другими точками останавливается на них, а если ей разрешено произвольное положение,
 * то и между ними; отпущенная, она приезжает к своей точке обычным переходом, а не рывком.
 *
 * Ростом шторка ровно по своему содержимому и не выше окна за вычетом шапки — то есть короткий
 * список показан коротким блоком, а длинный мотается внутри сам. Ход у неё меряется этим же
 * ростом: раскрыта она тогда, когда видна целиком.
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
export default function Shade({
    open,
    onClose,
    label,
    onScene = false,
    cover = false,
    magnet = DEFAULT_MAGNET,
    children,
}: ShadeProps) {
    const shadeRef = useRef<HTMLElement>(null);
    const { mounted, onTransitionEnd } = useSlide(open);
    // Этаж в стопке: открытая позже лежит выше открытой раньше, а не так, как их написали
    // в разметке. Считает его ShadeStack, он же и закрывает нижние, если эта не `cover`.
    const floor = useShadeFloor(mounted, onClose, cover);
    // Сдвиг вниз от раскрытого положения, px. Пока тянут — идёт за пальцем без перехода;
    // отпустили — остаётся тем, на чём шторка встала, и она приезжает туда переходом.
    // `null` — «на своём месте по стилям»: раскрыта целиком или как раз уезжает.
    const [shift, setShift] = useState<number | null>(null);
    // Тянут ли прямо сейчас. Отдельно от сдвига: сдвиг остаётся и после отпускания, если шторка
    // встала не на верхнюю точку, а вот переход снимается ровно на время движения пальца.
    const [dragging, setDragging] = useState(false);
    // Перетаскивание кончается тем же click, что и нажатие, — и кончается им где угодно,
    // хоть на кнопке внутри шторки. Флаг гасит этот click: без него потяг за строку списка
    // заодно нажимал бы то, с чего начали.
    const draggedRef = useRef(false);
    // Чем оборвать незаконченный потяг снаружи. Пишется на время движения, зовётся при закрытии.
    const dropDragRef = useRef<() => void>(() => undefined);

    /**
     * Закрытие отменяет потяг, чем бы тот ни кончился.
     *
     * Движение пальца обрывается чаще, чем кажется: указатель отпустили за краем окна, касание
     * забрал браузер, вкладку увели. После такого обрыва на шторке остаётся и сдвиг, и снятый
     * на время движения переход — и оба спорят с уходом. Сдвиг стоит в стиле самого блока
     * и оказывается сильнее `translateY(100%)` из класса, а без перехода уход не начинается
     * вовсе; между тем снимают шторку с экрана именно по концу этого перехода. Выходило, что
     * затемнение гасло, а шторка оставалась висеть навсегда — и на следующем открытии молча
     * подменяла корабль в себе на другой.
     */
    useEffect(() => {
        if (open) {
            return;
        }
        dropDragRef.current();
        dropDragRef.current = () => undefined;
        setDragging(false);
        setShift(null);
    }, [open]);

    const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        const shade = shadeRef.current;
        // Вторичные кнопки мыши шторку не тянут: у правой своё дело — меню. Текстовое поле
        // тоже не тянет: движение по нему ставит курсор и выделяет набранное.
        if (!shade || event.button !== 0 || isTextField(event.target) || hasOwnScroll(event.target, shade)) {
            return;
        }
        const startY = event.clientY;
        // Ход шторки — её собственный рост: она приезжает снизу, и раскрыта ровно тогда, когда
        // видна целиком. Точки считаются от него же — и заново на каждый потяг: содержимое
        // могло вырасти, а окно смениться.
        const height = shade.getBoundingClientRect().height;
        const points = normalizeMagnets(magnet.points ?? [], height, magnet.gap);
        const lowest = points.length ? points[0] : 0;
        const highest = points.length ? points[points.length - 1] : height;
        // Открытость на момент, когда шторку взяли: сколько её видно над нижней кромкой.
        const startOpen = height - (shift ?? 0);
        const drag = { moved: false, shift: shift ?? 0 };
        // Последние отметки пальца — по ним и считается скорость в момент отпускания.
        const marks: { y: number; at: number }[] = [];

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) {
                return;
            }
            if (!drag.moved) {
                if (Math.abs(moveEvent.clientY - startY) <= DRAG_SLOP) {
                    return;
                }
                drag.moved = true;
                setDragging(true);
                // Выделение, начатое этим же движением, снимаем: тянут шторку, а не выделяют
                // текст. Дальше его не даёт набрать `user-select` (см. .shadeDragging).
                window.getSelection()?.removeAllRanges();
            }
            marks.push({ y: moveEvent.clientY, at: moveEvent.timeStamp });
            if (marks.length > 5) {
                marks.shift();
            }
            // За пределы своих точек шторка не выходит ни вверх, ни вниз: выше верхней её
            // и так не видно целиком, ниже нижней — не видно вовсе.
            const opened = Math.min(Math.max(startOpen - (moveEvent.clientY - startY), lowest), highest);
            drag.shift = height - opened;
            setShift(drag.shift);
        };

        /**
         * Скорость в момент отпускания, px/мс открытости: положительная — шторка раскрывалась.
         *
         * Меряется по последнему отрезку пути, а не по всему: важно, чем движение кончилось.
         * Палец, простоявший на месте дольше отрезка, скорости не оставляет вовсе — шторку
         * подвели и поставили, а не бросили.
         */
        const speed = (at: number): number => {
            const last = marks[marks.length - 1];
            if (!last || at - last.at > FLING_MS) {
                return 0;
            }
            const first = marks.find((mark) => last.at - mark.at <= FLING_MS) ?? marks[0];
            const spent = last.at - first.at;
            return spent > 0 ? (first.y - last.y) / spent : 0;
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
                to: height - drag.shift,
                velocity: speed(upEvent.timeStamp),
                points,
                free: magnet.free,
                pull: magnet.pull,
            });
            // Закрытой шторки на экране не бывает: съехавшую в ноль убирают совсем, и уезжает
            // она обычным уходом — сдвиг с неё поэтому снимаем, иначе он спорил бы с ним.
            if (settled <= 0) {
                setShift(null);
                onClose();
                return;
            }
            setShift(settled >= height ? null : height - settled);
        };

        // Слушаем окно, а не саму шторку: первый же шаг вниз выносит палец за её кромку,
        // и обработчик на шторке не увидел бы дальше ничего. Захват указателя
        // (setPointerCapture) вместо этого не годится — он уводит к шторке и нажатия,
        // и ни одна кнопка внутри неё больше не нажималась бы.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        dropDragRef.current = stopListening;
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
    // Уходящая шторка потяга под собой не помнит — и помнить не должна ни кадра. Отменяет его
    // и эффект выше, но тот случается после отрисовки, а тут нужен тот самый первый кадр,
    // в котором появился класс ухода: не будь на нём ни сдвига, ни снятого перехода, уход
    // и начинается с него.
    const held = leaving ? null : shift;
    const heldDragging = dragging && !leaving;
    const look = [
        styles.shade,
        onScene ? styles.shadeOnScene : '',
        leaving ? styles.shadeLeaving : '',
        heldDragging ? styles.shadeDragging : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <>
            {/* Затемнение, оно же «мимо шторки». Лежит по всему окну, и шапка канала под ним:
                пока шторка на экране, разговор идёт только про неё. Пока её тянут, затемнение
                светлеет вместе с уходом: затемнение и шторка — одно движение, и гасить его
                в конце значило бы разводить их надвое. */}
            <button
                type="button"
                className={[styles.backdrop, leaving ? styles.backdropLeaving : ''].filter(Boolean).join(' ')}
                style={
                    {
                        // Этаж уходит в стили переменной: и шторка, и её затемнение считают
                        // из неё свой z-index, а числа остаются в одном месте — в стилях.
                        '--shade-floor': floor,
                        ...(heldDragging && held !== null ? { opacity: Math.max(1 - held / 200, 0) } : {}),
                    } as CSSProperties
                }
                aria-label="Закрыть шторку"
                onClick={onClose}
            />
            <section
                className={look}
                style={
                    {
                        '--shade-floor': floor,
                        ...(held === null ? {} : { transform: `translateY(${held}px)` }),
                    } as CSSProperties
                }
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
