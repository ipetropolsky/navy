import {
    MouseEvent as ReactMouseEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
    UIEvent as ReactUIEvent,
    WheelEvent as ReactWheelEvent,
    useEffect,
    useRef,
    useState,
} from 'react';

import { SHADE_FADE_HEIGHT } from '@/config/layout';
import { isTextField } from '@/utils/keyboard';
import { useIsMobile, useIsShortWindow } from '@/utils/viewport';

import IconButton from '@/components/ui/IconButton';
import {
    ShadeStop,
    WHEEL_STEP,
    nearestStop,
    nextStop,
    shadeStops,
    stepStop,
    stopHeight,
} from '@/components/ui/shadeStops';

import styles from './Shade.module.less';

/**
 * Сколько палец должен пройти, чтобы это считалось перетаскиванием, px. Меньше — нажатие:
 * попасть в ручку и не сдвинуть её на пиксель-другой невозможно, и без этого зазора каждое
 * нажатие оборачивалось бы броском на ту же ступень, с которой начали. Тем же зазором
 * отделяются друг от друга нажатие на кнопку внутри шторки и потяг за то место, где она лежит.
 */
const DRAG_SLOP = 4;

/**
 * Пауза, после которой накрученное забывается, мс. Без неё остаток одного движения дожидался
 * бы следующего и складывался с ним: шторка шагала бы через раз не пойми от чего.
 */
const WHEEL_REST_MS = 300;

/** Колесо считает не только в пикселях: в строках (1) и в экранах (2). Приводим к пикселям. */
const WHEEL_UNIT = [1, 16, 400];

/** Мотается ли этот блок сам: и разрешено, и есть что мотать. */
const scrolls = (node: Element): boolean => {
    const overflow = getComputedStyle(node).overflowY;
    return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight;
};

/**
 * Есть ли под указателем своя прокрутка — где-то между ним и самой шторкой.
 *
 * Прокрутка главнее: тянуть шторку можно за любое место, но лента, список и всё, что мотается
 * само, обязаны мотаться, а не превращать движение пальца в открытие и закрытие. Смотрим
 * поэтому не на то, где именно лежит ручка, а на то, есть ли под пальцем что мотать.
 *
 * Направление движения при этом не учитывается нарочно. «Домотал ленту до верха — дальше
 * тянется шторка» выглядит находчиво ровно до первого промаха: палец у нижнего края ленты
 * то листает её, то закрывает разговор, и предсказать это нельзя. Область с прокруткой
 * прокручивается, и только.
 */
const hasOwnScroll = (target: EventTarget | null, root: HTMLElement): boolean => {
    for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
        if (scrolls(node)) {
            return true;
        }
    }
    return false;
};

/**
 * Первое, что мотается внутри шторки: под полоску уходит именно оно. Ищем в порядке разметки —
 * верхнее и есть то, чей край подходит к полоске. Мотающихся блоков внутри бывает несколько
 * (лента внутри панели, у которой своя прокрутка), но верхний из них один.
 */
const topScroller = (root: HTMLElement): HTMLElement | null => {
    for (const node of root.querySelectorAll<HTMLElement>('*')) {
        if (scrolls(node)) {
            return node;
        }
    }
    return null;
};

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
 * Тянут её за любое место, а не за одну ручку: попадать пальцем в полоску шириной в палец —
 * занятие для тех, кому некуда спешить. Не тянут только те места, у которых есть своя
 * прокрутка (лента, список) и текстовые поля: там движение уже занято делом. Колесо над
 * теми же местами шагает по ступеням — мышью цеплять и волочить неудобно.
 *
 * Анимируется высота, а не сдвиг: содержимое внутри должно перекладываться под новый размер.
 * Сдвинутая шторка держала бы раскладку полной высоты, и в щёлке был бы виден её верх —
 * то есть самые старые сообщения ленты — вместо последних реплик с полем ввода.
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
    const dragRef = useRef<{
        pointerId: number;
        startY: number;
        startHeight: number;
        frame: number;
        moved: boolean;
        height: number | null;
    } | null>(null);
    // Чем отписаться от окна, пока шторку тянут. Держим снаружи, чтобы снять слушателей и тогда,
    // когда шторка ушла с экрана посреди движения: закрыть её можно и не отпуская пальца.
    const listeningRef = useRef<(() => void) | null>(null);
    useEffect(() => () => listeningRef.current?.(), []);
    // Перетаскивание кончается тем же click, что и нажатие, — и кончается им где угодно,
    // хоть на кнопке внутри шторки. Флаг гасит этот click: без него потяг за полосу кнопок
    // заодно нажимал бы ту, с которой начали.
    const draggedRef = useRef(false);
    // Сколько накручено колесом и когда: одно движение колеса приходит десятком событий,
    // и ступень должна идти за движение, а не за событие.
    const wheelRef = useRef({ turned: 0, at: 0 });

    // Полоска у верхней кромки: в полную силу, когда содержимое под неё уехало, и ничего,
    // когда оно домотано до верха. Держим её силой от 0 до 1, а не «есть или нет»: набирается
    // она на первых пикселях прокрутки, и содержимое подходит под неё, а не подскакивает.
    const [fade, setFade] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    // Чей край подходит к полоске. Ищем его не на каждое событие прокрутки, а на смену
    // содержимого: обход разметки в обработчике, который зовут по разу на кадр, — самое
    // верное место, чтобы лента начала запинаться.
    const scrollerRef = useRef<HTMLElement | null>(null);
    const fadeFor = (scroller: HTMLElement | null): number =>
        scroller ? clamp(scroller.scrollTop / SHADE_FADE_HEIGHT, 0, 1) : 0;

    // Содержимое сменилось или шторка встала на другую ступень — мотающийся блок мог смениться,
    // а мог и перестать мотаться вовсе (форма влезла в раскрытую шторку целиком). Ступень
    // при этом ещё едет, и настоящий размер будет к концу перехода — там пересчитаем ещё раз
    // (см. onTransitionEnd).
    useEffect(() => {
        scrollerRef.current = bodyRef.current && topScroller(bodyRef.current);
        setFade(fadeFor(scrollerRef.current));
    }, [stop, children]);

    /**
     * Прокрутка внутри шторки. Ловим на погружении: событие прокрутки не всплывает, и на самой
     * шторке его иначе не увидеть. Считаем только по верхнему блоку — нижние (лента внутри
     * панели со своей прокруткой) до полоски не достают.
     */
    const handleScrollCapture = (event: ReactUIEvent<HTMLElement>) => {
        if (event.target === scrollerRef.current) {
            setFade(fadeFor(scrollerRef.current));
        }
    };

    /** Полоска: лежит поверх содержимого у верхней кромки и ничего под собой не ловит. */
    const fadeStrip = <div className={styles.fade} style={{ opacity: fade }} aria-hidden="true" />;

    // Неподвижная шторка: тот же блок с тем же содержимым, но без ручки и без затемнения.
    // Уходит она отсюда сразу, до всего счёта ступеней, — считать в ней нечего.
    //
    // Риска на ней остаётся, и на обычном своём месте — полоской по верхнему краю. Тянуть
    // за неё нечего: страница прокручивается целиком, свайпом по чему угодно, включая саму
    // сцену, и снап доводит её до ближайшего экрана. Риска показывает, что снизу не обрезанный
    // край страницы, а её вторая половина.
    if (shortWindow && !over) {
        return (
            <section
                className={[styles.shade, styles.shadeStill].join(' ')}
                aria-label={label}
                onScrollCapture={handleScrollCapture}
            >
                <div className={styles.stillHandle} aria-hidden="true">
                    <span className={styles.grip} />
                </div>
                <div className={styles.body} ref={bodyRef}>
                    {fadeStrip}
                    {children}
                </div>
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

    /**
     * Докуда шторка сжимается пальцем. Обычную ниже нижней ступени не пускаем — там ничего нет;
     * у закрываемой ниже щёлки лежит «убрать совсем», и дотянуть туда надо дать.
     */
    const lowestHeight = (frame: number): number => (onClose ? 0 : stopHeight('peek', frame));

    const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
        const shade = shadeRef.current;
        const frame = shade ? frameHeight(shade) : 0;
        // Вторичные кнопки мыши шторку не тянут: у правой своё дело — меню. Текстовое поле
        // тоже не тянет: движение по нему ставит курсор и выделяет набранное.
        if (!shade || !frame || event.button !== 0 || isTextField(event.target) || hasOwnScroll(event.target, shade)) {
            return;
        }
        const drag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: shade.getBoundingClientRect().height,
            frame,
            moved: false,
            height: null as number | null,
        };
        dragRef.current = drag;

        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== drag.pointerId) {
                return;
            }
            if (!drag.moved) {
                if (Math.abs(moveEvent.clientY - drag.startY) <= DRAG_SLOP) {
                    return;
                }
                drag.moved = true;
                // Выделение, начатое этим же движением, снимаем: тянут шторку, а не выделяют
                // текст. Дальше его не даёт набрать `user-select` (см. .shadeDragging).
                window.getSelection()?.removeAllRanges();
            }
            // Вверх — растём: экранный y уменьшается, а высота прибавляется.
            const height = drag.startHeight + (drag.startY - moveEvent.clientY);
            drag.height = clamp(height, lowestHeight(drag.frame), stopHeight('full', drag.frame));
            setDragHeight(drag.height);
        };

        // Отписка объявлена раньше самих обработчиков: она им и нужна — движение кончается тем,
        // что мы перестаём его слушать.
        const stopListening = () => {
            window.removeEventListener('pointermove', move);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- взаимная ссылка: отписка снимает обработчик, обработчик её зовёт
            window.removeEventListener('pointerup', up);
            // eslint-disable-next-line @typescript-eslint/no-use-before-define -- то же самое
            window.removeEventListener('pointercancel', up);
            listeningRef.current = null;
        };

        const up = () => {
            stopListening();
            dragRef.current = null;
            setDragHeight(null);
            if (!drag.moved || drag.height === null) {
                return;
            }
            draggedRef.current = true;
            // Утянутая ниже половины щёлки закрываемая шторка закрывается: «ниже нижней ступени»
            // у неё означает не ступень, а то, что её убрали.
            if (onClose && drag.height < stopHeight('peek', drag.frame) / 2) {
                onClose();
                return;
            }
            onStop(nearestStop(drag.height, drag.frame, mobile));
        };

        // Слушаем окно, а не саму шторку. Движение уходит с неё сразу же: первый шаг вверх
        // выносит палец за её верхнюю кромку, и обработчик на шторке не увидел бы дальше ничего.
        // Захват указателя (setPointerCapture) вместо этого не годится — он уводит к шторке
        // и нажатия, и ни одна кнопка внутри неё больше не нажималась бы.
        listeningRef.current = stopListening;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
    };

    /**
     * Колесо над тем же местом, за которое тянут. Мышью цеплять и волочить неудобно — колесо
     * делает то же самое привычным движением. Ступень идёт за движение, а не за событие:
     * одно движение колеса приходит десятком, и шторка иначе улетала бы с нижней ступени
     * на верхнюю за один щелчок.
     */
    const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
        const shade = shadeRef.current;
        if (!shade || hasOwnScroll(event.target, shade)) {
            return;
        }
        const wheel = wheelRef.current;
        if (event.timeStamp - wheel.at > WHEEL_REST_MS) {
            wheel.turned = 0;
        }
        wheel.at = event.timeStamp;
        wheel.turned += event.deltaY * (WHEEL_UNIT[event.deltaMode] ?? 1);
        if (Math.abs(wheel.turned) < WHEEL_STEP) {
            return;
        }
        const up = wheel.turned < 0;
        wheel.turned = 0;
        // Вниз с нижней ступени — то же, что дотянуть туда пальцем: закрываемая закрывается.
        if (!up && onClose && stop === shadeStops(mobile)[0]) {
            onClose();
            return;
        }
        onStop(stepStop(stop, mobile, up ? 1 : -1));
    };

    /**
     * Нажатие, которым кончилось перетаскивание, до содержимого не доходит: тянут шторку
     * за любое место, в том числе за кнопку, и без этого бросок на ступень заодно нажимал бы
     * то, с чего начался. Ловится оно на погружении — до всех обработчиков внутри.
     */
    const handleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
        if (draggedRef.current) {
            draggedRef.current = false;
            event.preventDefault();
            event.stopPropagation();
        }
    };

    // Нажатие на ручку — с клавиатуры в том числе, поэтому click, а не pointerup.
    const handleClick = () => onStop(nextStop(stop, mobile));

    const drag = dragRef.current;
    // Затемнение набирается на последней ступени: от предпоследней к верху. Пока тянут, считаем
    // его по высоте, чтобы фон темнел вместе с движением, а не вспыхивал в конце.
    const stops = shadeStops(mobile);
    const below = stops[stops.length - 2];
    const dim =
        drag && dragHeight !== null
            ? clamp(
                  (dragHeight - stopHeight(below, drag.frame)) /
                      Math.max(stopHeight('full', drag.frame) - stopHeight(below, drag.frame), 1),
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
            {/* Тянут шторку за неё саму, а не за одну ручку: за любое место, у которого нет
                своей прокрутки (см. hasOwnScroll). Ручка при этом остаётся — она показывает,
                что шторку вообще можно двигать, и отвечает на нажатие с клавиатуры. */}
            <section
                className={look}
                style={dragHeight === null ? undefined : { height: `${dragHeight}px` }}
                aria-label={label}
                ref={shadeRef}
                onPointerDown={handlePointerDown}
                onWheel={handleWheel}
                onClickCapture={handleClickCapture}
                onScrollCapture={handleScrollCapture}
                // Ступень доехала — размеры внутри стали настоящими: то, что в пути ещё моталось,
                // могло уже и поместиться целиком.
                onTransitionEnd={() => {
                    scrollerRef.current = bodyRef.current && topScroller(bodyRef.current);
                    setFade(fadeFor(scrollerRef.current));
                }}
            >
                <button
                    type="button"
                    className={styles.handle}
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
                <div className={styles.body} ref={bodyRef}>
                    {fadeStrip}
                    {children}
                </div>
            </section>
        </>
    );
}
