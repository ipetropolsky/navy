import {
    CSSProperties,
    MouseEvent,
    PointerEvent,
    memo,
    useEffect,
    useLayoutEffect,
    useReducer,
    useRef,
    useState,
} from 'react';

import arrowUrl from '@/assets/scene/arrow.png';
import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaUrl from '@/assets/scene/sea.png';
import skyUrl from '@/assets/scene/sky.png';
import { fleetLefts, restingDrift, restingLeft, restingYaw } from '@/backend';
import MemberName from '@/components/ships/MemberName';
import Ship from '@/components/ships/Ship';
import ShipShadow from '@/components/ships/ShipShadow';
import { paced } from '@/config/time';
import {
    Berth,
    CORRIDORS,
    Corridor,
    Member,
    MorseFeed,
    SLOT_COUNT,
    ShipKind,
    ShipPlacement,
    Side,
    hullCenter,
    isSameBerth,
    otherSide,
    projectLeft,
    shipSizeShare,
    shipWidthPercent,
    slotDepth,
    slotScale,
    slotShare,
} from '@shared/types/channel';

import {
    EdgeCourse,
    ENTER_GUARD,
    LEAVE_GUARD,
    RelocateCourse,
    Shift,
    berthWidthPercent,
    leaveCourse,
    nodAngle,
    pathToEdge,
    relocateCourse,
    sailSeconds,
    sailTrim,
    shiftAcross,
} from '@/components/SeaScene/shipMotion';
import { shipAt } from '@/components/SeaScene/shipPick';

import styles from './SeaScene.module.less';

// Качка живёт тем же циклом, что и вода: 10 секунд на полный круг, и за этот круг корабль
// проходит и подъём со спуском, и оба наклона, возвращаясь ровно в исходное положение.
// Сама длительность живёт в стилях (@wave-seconds), здесь она нужна как мерка для фазы.
const WAVE_SECONDS = 10;

// Насколько качка соседней линии отстаёт от дальней и соседнего коридора — от левого, с.
// Это и есть волна: она идёт по рейду, а не бьёт по всему морю разом. Приходит с горизонта
// и катится на наблюдателя — поэтому дальняя линия всходит на гребень первой, а ближняя
// повторяет за ней. Заодно фронт идёт наискось: у левого коридора свой сдвиг относительно
// центрального, у центрального — относительно правого, — иначе весь рейд вставал бы на волну
// одной ровной стенкой, чего на воде не бывает.
//
// Полсекунды на линию — это волна вдвое длиннее рейда: соседние линии идут почти в фазе,
// и видно именно, как гребень катится от дальних мест к ближним, поднимая и опуская точки
// одну за другой. Секунда на линию укладывала в рейд целый период, и соседи оказывались
// в противоходе: рейд не катился волной, а болтался вразнобой. Шаг коридора нарочно не кратен
// шагу линии: на кратном по кадру пошли бы заметные диагонали из кораблей, качающихся в такт.
const WAVE_SLOT_LAG = 0.5;
const WAVE_CORRIDOR_LAG = 0.7;

/**
 * Момент, с которого место на рейде начинает круг качки, с. Уходит в анимацию отрицательной
 * задержкой, то есть отсчитан в прошлом: корабль появляется уже качающимся, а не ждёт начала
 * цикла. Считается от места, а не от корабля: качает вода, а она про корабли не знает, —
 * и потому два соседа никогда не идут в такт, а ушедший не сбивает фазу оставшимся.
 */
const wavePhase = (place: Berth): number =>
    ((SLOT_COUNT - 1 - place.slot) * WAVE_SLOT_LAG + CORRIDORS.indexOf(place.corridor) * WAVE_CORRIDOR_LAG) %
    WAVE_SECONDS;

// Высота волны под кораблём, px, от горизонта к переднему плану. У горизонта перспектива
// сжимает вертикаль, поэтому там волна и мельче — иначе дальний корабль при своих мелких
// размерах ходил бы сильнее ближнего. Из этой высоты считается наклон.
const WAVE_FAR = 0.35;
const WAVE_NEAR = 1.9;

// Ход самого корпуса по вертикали, px. У переднего плана он вдвое меньше волны: большой
// близкий корабль сидит в воде глубоко и режет волну, а не повторяет её профиль целиком.
// На наклон это не влияет — уклон воды от осадки корабля не меняется.
const HEAVE_FAR = 0.35;
const HEAVE_NEAR = 0.95;

// Градусов наклона на каждый пиксель высоты волны. Угол и высота — не два независимых числа:
// корабль повторяет уклон воды, а у волны высота и крутизна связаны. Коэффициент отвечает
// длине волны примерно в полтора кадра, то есть пологой зыби, а не короткой толчее.
const PITCH_PER_PX = 0.32;

/** Высота волны под кораблём, px: линейно растёт от горизонта к переднему плану. */
const waveAmplitude = (depth: number) => WAVE_FAR + depth * (WAVE_NEAR - WAVE_FAR);

// Долевое положение месяца по горизонтали, % от левого края кадра — то же число, что
// и @moonlight в SeaScene.module.less: обе стороны считают наклон тени от одной и той же
// точки на кадре, и разъедься эти числа — тени накренились бы не туда, откуда светит месяц.
const MOON_LEFT_PERCENT = 35;

// На каком удалении от месяца по горизонтали, %, наклон тени набирает полную величину
// (см. MOON_LEAN_MAX_DEG). Дальше него наклон уже не растёт — упирается в предел.
const MOON_LEAN_SPAN = 40;

// Предел наклона тени в сторону от месяца, deg. Небольшой нарочно: тени должны разойтись
// заметно на глаз, а не разлететься в стороны, как от прожектора в упор. Поднят с 5 до 7 —
// не в сторону настоящей геометрии (реальный угол между месяцем и дальним краем рейда
// заметно больше), а тем же самым пропорциональным наклоном, только чуть заметнее на глаз.
const MOON_LEAN_MAX_DEG = 7;

/**
 * Наклон тени в сторону от месяца, готовым углом в deg: знак — куда крениться, величина —
 * насколько сильно, с пределом в MOON_LEAN_MAX_DEG. Переведён в градусы уже здесь, а не
 * в стилях: --slot-left на стороне CSS уже переведён в проценты от ширины самого элемента,
 * и достать из него угол через calc нельзя — там нет деления одной размерности
 * на другую с числом на выходе.
 *
 * Считается от того же положения, что и сама дорожка (place.left), а не от --slot-x.
 */
const moonLeanDeg = (left: number): string =>
    `${(Math.min(Math.max((left - MOON_LEFT_PERCENT) / MOON_LEAN_SPAN, -1), 1) * MOON_LEAN_MAX_DEG).toFixed(2)}deg`;

/** Ход корпуса по вертикали, px: та же прямая, но у переднего плана вдвое положе. */
const heaveAmplitude = (depth: number) => HEAVE_FAR + depth * (HEAVE_NEAR - HEAVE_FAR);

// Задники сцены. Пока они грузятся, показывать нечего: небо, вода и остров весят мегабайтами
// и приходят вразнобой, так что сцена собиралась бы на глазах — сперва пустая синева, потом
// небо, потом вода. Дожидаемся всех и проявляем разом.
//
// Кораблей в этом списке нет намеренно: их картинки лёгкие, а ждать их — значит держать
// пустое море дольше нужного. Появление одного корабля глаз почти не ловит.
const SCENE_IMAGES = [skyUrl, moonUrl, cloudFarUrl, cloudNearUrl, islandUrl, seaUrl];

// Сколько корабль пропадает из виду, перезаходя на другой слот. Пауза нужна, чтобы уход
// и заход читались как два разных манёвра, а не как рывок из одного края кадра в другой.
//
// Она часть манёвра, а не отсрочка перед ним, — поэтому идёт по той же скорости времени,
// что и сам ход (см. config/time). Иначе ускоренный перезаход состоял бы почти из одной паузы.
const RELOCATE_PAUSE_MS = paced(3000);

// Сколько длится кивок, с. Сама длительность живёт в стилях (@nod-seconds), здесь она нужна
// затем, чтобы вовремя снять класс: анимация запускается его появлением, и оставшийся класс
// не дал бы кораблю кивнуть во второй раз. Скорость времени делит обе одинаково.
const NOD_SECONDS = paced(3.5);

// Насколько кивок на остановке опережает конец хода. Клюёт носом корабль, пока гасит ход,
// а не после: к тому мгновению, когда он встал, он уже должен быть выровнен. Не весь кивок
// целиком — хвост его приходится на первые мгновения стоянки, и это правильно: вода
// под остановившимся корпусом успокаивается не сразу.
const NOD_LEAD = 0.8;

// Сколько гаснет слой выбора места, мс. Сама длительность живёт в стилях (@berth-fade),
// здесь она нужна затем, чтобы вовремя снять разметку: пока переход идёт, слой обязан
// оставаться в кадре, а после — исчезнуть, иначе он навсегда останется в разметке прозрачным.
const BERTH_FADE_MS = paced(200);

/** Ждёт загрузки картинки. Не сложилось — тоже ответ: сцену показываем в любом случае. */
const preload = (url: string): Promise<void> =>
    new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
    });

/** Класс с переходом под каждый вид движения. У стоящего корабля движения нет. */
const MOTION_CLASS: Record<string, string> = {
    leaving: styles.shipLeaving,
    entering: styles.shipEntering,
    shifting: styles.shipShifting,
};

/**
 * Сколько ждать конца хода сверх его длительности, прежде чем считать корабль пришедшим
 * без спросу. Ход заканчивается событием перехода, но события может и не быть: переходы
 * отключены у тех, кому движение мешает (prefers-reduced-motion), да и вкладка в фоне
 * их не отыгрывает. Без страховки такой корабль остался бы «идущим» навсегда — с ходовыми
 * огнями и без права сняться с места, — а уходящий навсегда остался бы в разметке.
 */
const MOTION_GRACE_MS = 1500;

/**
 * Сколько ждём тишины, прежде чем снять мерку с переменившегося кадра, мс. Больше длительности
 * кадра и меньше самого короткого движения, которое кадр меняет.
 */
const SETTLE_MS = 150;

/**
 * Следить за размерами и мерить, когда движение утихло.
 *
 * Мерки, которые снимает сцена, — высота воды и запас моря по бокам от рейда — нужны ей
 * посчитанными, а не покадровыми: по ним ищут ближайшее к пальцу место и прокладывают путь
 * уходящему кораблю, и промежуточные значения перехода не значат ничего. А стоят они дорого:
 * кадр меняет высоту переходом, `ResizeObserver` отзывается на каждый кадр этого перехода,
 * и каждый его отклик — новое состояние, то есть новая отрисовка всей сцены. На одну смену
 * раскладки этих отрисовок набиралось под полсотни, по две на кадр, и на неспешной машине
 * переход от них заметно спотыкался.
 *
 * Отсюда отсрочка: каждый новый отклик отодвигает замер, и он случается один раз — когда
 * размеры устоялись. Первый замер при этом делают на месте, не дожидаясь ни отклика,
 * ни отсрочки: до него сцена не знает о себе вовсе.
 */
const observeSettled = (targets: Element[], measure: () => void): (() => void) => {
    let timer = 0;
    const observer = new ResizeObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(measure, SETTLE_MS);
    });
    targets.forEach((target) => observer.observe(target));
    return () => {
        window.clearTimeout(timer);
        observer.disconnect();
    };
};

/**
 * Как называется место на рейде вслух. Разметка различима глазом, но не голосом: тому, кто
 * слушает страницу читалкой, нужно словами — в какой стороне кадра место и какая это линия.
 */
const BERTH_LABELS: Record<Corridor, string> = {
    left: 'слева',
    center: 'по центру',
    right: 'справа',
};

/**
 * В какую сторону коридор расходится к наблюдателю: боковые — наружу, центральный никуда.
 * Три ряда мест на воде параллельны, и на картинке они обязаны сходиться к горизонту, как
 * рельсы; насколько именно — в стилях (@berth-spread-far и @berth-spread-near), здесь
 * только сторона.
 */
const CORRIDOR_SIDE: Record<Corridor, number> = { left: -1, center: 0, right: 1 };

/** Место на рейде одно на слот и коридор — этой пары хватает и для ключа, и для разметки. */
const berthKey = (berth: Berth): string => `${berth.slot}-${berth.corridor}`;

/**
 * Склеенная полоса воды: три плитки шириной с кадр, соседние зеркальны друг другу — поэтому
 * стыков не видно и полосу можно двигать в любую сторону, всегда есть чем закрыть кадр.
 * Одна и та же разметка идёт и в нижнюю полосу, и в верхнюю, перевёрнутую.
 */
const seaTiles = (
    <>
        <div className={styles.seaTileMirrored} style={{ backgroundImage: `url(${seaUrl})` }} />
        <div className={styles.seaTile} style={{ backgroundImage: `url(${seaUrl})` }} />
        <div className={styles.seaTileMirrored} style={{ backgroundImage: `url(${seaUrl})` }} />
    </>
);

/**
 * Выбор места на рейде: что показать на воде, что из этого выбрано и куда сообщать о нажатии.
 * Живёт, пока открыта форма корабля; в самом чате мест не показываем — там уже всё занято теми,
 * кто на связи.
 */
export interface BerthChoice {
    /** Свободные места: в каждом горит точка, а на выбранном она разворачивается в стрелку курса. */
    options: Berth[];
    picked: Berth | null;
    /**
     * Курс, выбранный в форме. Стрелка на выбранном месте смотрит туда же, куда встанет
     * корабль, — и она же этот курс переставляет: нажатие по уже выбранному месту разворачивает
     * его на обратный (см. onPick).
     */
    facing: Side;
    /**
     * Нажатие по месту. Первое — выбор места, повторное по тому же — разворот курса:
     * решает это не сцена, а тот, кто держит и место, и курс.
     */
    onPick: (berth: Berth) => void;
}

interface SeaSceneProps {
    members: Member[];
    myId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
    berths?: BerthChoice;
    /** Щелчок по своему кораблю: открыть форму корабля, где меняется и место. */
    onEditShip?: () => void;
    /** Щелчок по чужому кораблю: показать его карточку. Своим на рейде распоряжаются, чужой смотрят. */
    onShowShip?: (memberId: string) => void;
    /**
     * Канал загружен и список кораблей окончательный. Нужен, чтобы отличить «пока пусто,
     * потому что ещё грузимся» от «пусто, потому что на рейде никого»: от этого зависит,
     * заплывёт ли следующий корабль в кадр или просто окажется на месте.
     */
    ready: boolean;
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
function SeaScene({ members, myId, morseFeeds, ready, berths, onEditShip, onShowShip }: SeaSceneProps) {
    // Кто уже был в кадре. Заплывает только тот, кто вошёл при нас; те, что стояли на рейде
    // до нашего прихода, просто оказываются на месте — въезжать им неоткуда, мы пришли к ним.
    //
    // Отсчёт ведём от первой отрисовки с загруженным каналом, а не от самой первой: пока канал
    // грузится, кораблей нет, и «первым кадром» оказался бы пустой экран. По списку кораблей
    // судить тоже нельзя — в только что созданном канале их ноль, и тогда свой собственный
    // корабль стал бы «стоявшим тут всегда» и не заплыл бы.
    const seenIds = useRef<Set<string> | null>(null);
    // Кто заплывает прямо сейчас. Список отдельный и живёт до конца анимации, потому что
    // решение «этот корабль въезжает» принимается один раз — в тот рендер, когда он появился.
    // Пересчитывать его на каждом рендере нельзя: сразу за появлением своего корабля приходит
    // второй рендер (myId), на нём корабль уже не новичок, класс бы снялся и анимация оборвалась.
    const enteringIds = useRef(new Set<string>());
    // Кто уходит. Из канала корабль уже вычеркнут, но из кадра ещё нет: держим его данные
    // у себя, пока он выбирается за край сцены. Уходить может кто угодно, в том числе ты сам.
    // Сюда же попадает корабль, который перезаходит, — со своим прежним местом и прежним
    // силуэтом: из кадра выходит тот самый корабль, который в нём стоял.
    const leavingById = useRef(new Map<string, Member>());
    // Кто сейчас перезаходит: ушёл со старого места и ещё не появился на новом. Пока он в этом
    // списке, живого участника не рисуем — в кадре только его уходящий двойник из leavingById.
    const relocatingIds = useRef(new Set<string>());
    // Весь манёвр перезаходящего: которой кромкой он уходит и которой вернётся. Считается
    // один раз, в тот рендер, когда место переменилось, — и обеими сторонами сразу, иначе
    // корабль уходит в одну сторону, а появляется с другой, и выходит круг вокруг всей сцены
    // (см. relocateCourse). Живёт до конца захода: обе половины манёвра берут стороны отсюда.
    //
    // Хранится у каждой вкладки своё, а не в самом месте, — и это не оплошность: расклад
    // на входе один и тот же во всех вкладках, а счёт не гадает. Так же считается и уход,
    // и в кадре они сходятся.
    const relocateCourses = useRef(new Map<string, RelocateCourse>());
    // Кто переходит по воде: сменил коридор, оставшись на своей дальности. Такой ход
    // отыгрывается целиком в кадре, без ухода за кромку, — см. shiftAcross. Здесь же
    // и весь его расчёт: он делается один раз, в тот рендер, когда место переменилось.
    const shiftingById = useRef(new Map<string, Shift>());
    // Что за корабль нарисован сейчас и где. Сравнение с каналом и говорит, что произошло:
    // сменился слот или сам корабль — перезаход, сменилась только точка — ход поперёк кадра.
    const shownById = useRef(new Map<string, { place: ShipPlacement; shipKind: ShipKind }>());
    // Списки живут в ref, а не в state: они меняются прямо во время отрисовки, до кадра.
    // Через state корабль на один кадр оказался бы на месте, и вход дёргался бы. Убрать
    // же отработавший корабль из разметки без перерисовки нельзя — за этим и счётчик.
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    // Отложенные заходы после перезахода: id → таймер паузы. Рядом — страховочные таймеры конца
    // хода, см. MOTION_GRACE_MS. И те и другие чистим при размонтировании.
    const pauseTimers = useRef(new Map<string, number>());
    const motionTimers = useRef(new Map<string, number>());
    // Кто прямо сейчас кивает, погасив ход, — и таймеры, снимающие с них этот класс.
    const noddingIds = useRef(new Set<string>());
    const nodTimers = useRef(new Map<string, number>());
    useEffect(
        () => () => {
            pauseTimers.current.forEach((timer) => window.clearTimeout(timer));
            motionTimers.current.forEach((timer) => window.clearTimeout(timer));
            nodTimers.current.forEach((timer) => window.clearTimeout(timer));
        },
        []
    );

    // Высота воды в кадре, px. Сама по себе она никуда не идёт — по ней сцена узнаёт, что
    // море переменилось: кадр сжался под клавиатуру, повернулся телефон. Точки мест стоят
    // в долях кадра, а искать ближайшую к указателю приходится в пикселях, и после такой
    // перемены их надо перемерить. Спрашиваем сам слой воды: он и есть море.
    //
    // Мерка целая, а не дробная: пересчитывать разметку от четверти пикселя незачем, а лишний
    // повод для этого дробная мерка даёт на каждом кадре перехода.
    const seaRef = useRef<HTMLDivElement>(null);
    const [seaHeight, setSeaHeight] = useState(0);
    useEffect(() => {
        const water = seaRef.current;
        if (!water) {
            return undefined;
        }
        const measure = (): void => setSeaHeight(water.clientHeight);
        measure();
        return observeSettled([water], measure);
    }, []);

    // Высота картинки неба в кадре, px. Нужна она кружку неба под месяцем: кружок рисует тот же
    // градиент, что залит в саму картинку (см. @sky-gradient), и совпасть они обязаны точно —
    // иначе вокруг месяца проступает круг посветлее или потемнее неба. Спрашиваем саму плитку,
    // а не считаем: высота её берётся по двум разным правилам (см. --sky-tile), и какое из них
    // сейчас в силе, зависит от того, что в кадре шире — окно или само небо.
    const skyTileRef = useRef<HTMLImageElement>(null);
    const [skyImageHeight, setSkyImageHeight] = useState(0);
    useEffect(() => {
        const tile = skyTileRef.current;
        if (!tile) {
            return undefined;
        }
        const observer = new ResizeObserver(([entry]) => setSkyImageHeight(entry.contentRect.height));
        observer.observe(tile);
        return () => observer.disconnect();
    }, []);

    // Задники готовы — сцену можно показывать.
    const [painted, setPainted] = useState(false);
    useEffect(() => {
        let alive = true;
        void Promise.all(SCENE_IMAGES.map(preload)).then(() => {
            if (alive) {
                setPainted(true);
            }
        });
        return () => {
            alive = false;
        };
    }, []);

    /** Что о корабле помнит кадр: этого хватает, чтобы отличить перестановку от переодевания. */
    const shownState = (member: Member) => ({ place: member.place, shipKind: member.shipKind });

    const known = useRef<Member[]>([]);
    if (ready && seenIds.current === null) {
        seenIds.current = new Set(members.map((member) => member.memberId));
        members.forEach((member) => shownById.current.set(member.memberId, shownState(member)));
    } else if (seenIds.current) {
        for (const member of members) {
            if (!seenIds.current.has(member.memberId)) {
                seenIds.current.add(member.memberId);
                enteringIds.current.add(member.memberId);
                shownById.current.set(member.memberId, shownState(member));
            }
        }
        // Пропал из канала — значит вышел. Только пока канал открыт: на переходе на главную
        // корабли исчезают все разом, и провожать всю эскадру за горизонт незачем.
        if (ready) {
            for (const member of known.current) {
                if (!members.some((item) => item.memberId === member.memberId)) {
                    leavingById.current.set(member.memberId, member);
                }
            }
        }
        // Сменилось место — значит корабль встал на другое. Сменился силуэт — значит человек
        // сменил корабль, а это тот же манёвр: прежний уходит с рейда, новый заходит. Сменился
        // курс — то же самое: развернуться на якоре корабль не может, а отзеркалить силуэт
        // на глазах — то же, что подменить его. Меняться на глазах, оставаясь на месте,
        // кораблю нельзя — на рейде так не бывает.
        //
        // Позывной и бортовой номер к этому не относятся: имя меняют на словах, номер
        // перекрашивают по борту, и сниматься ради этого с якоря незачем.
        //
        // На новое место корабль не переползает, а перезаходит: уходит со старого, пропадает
        // на паузу и заново заплывает на новое. Перезаходящих пропускаем: у них новое место
        // уже принято, они его отыгрывают.
        const relocated = members.filter((member) => {
            const shown = shownById.current.get(member.memberId);
            return (
                shown &&
                !relocatingIds.current.has(member.memberId) &&
                (!isSameBerth(shown.place, member.place) ||
                    shown.shipKind !== member.shipKind ||
                    shown.place.facing !== member.place.facing)
            );
        });
        for (const member of relocated) {
            // Прежний корабль в списке заведомо есть: по нему этот участник в список и попал.
            const shown = shownById.current.get(member.memberId)!;
            const next = shownState(member);
            shownById.current.set(member.memberId, next);
            // Соседняя точка той же линии — не перезаход, а переход по воде: корабль идёт
            // на неё прямо в кадре. Всё остальное — уход и заход заново.
            const shift = shiftAcross(shown, next);
            if (shift) {
                shiftingById.current.set(member.memberId, shift);
            } else {
                leavingById.current.set(member.memberId, { ...member, ...shown });
                relocateCourses.current.set(
                    member.memberId,
                    relocateCourse(
                        shown,
                        next,
                        // Помеха — те, кто остаётся стоять: сам себе корабль не помеха
                        // ни на старом месте, ни на новом.
                        members.filter((other) => other.memberId !== member.memberId).map((other) => other.place)
                    )
                );
                relocatingIds.current.add(member.memberId);
            }
        }
    }
    known.current = members;
    for (const member of members) {
        // Вернулся тем же id (например, пока шла его же анимация ухода) — уходить он передумал.
        // Перезаходящего это не касается: его двойник в кадре как раз и есть он сам.
        if (!relocatingIds.current.has(member.memberId)) {
            leavingById.current.delete(member.memberId);
        }
    }

    // Порядок отрисовки — от дальнего к ближнему: ближний перекрывает дальнего.
    // Уходящие рисуются вместе со всеми: пока корабль в кадре, он такой же корабль.
    // Перезаходящий участник не рисуется на новом месте, пока не отработает уход со старого.
    const placed = [
        ...members.filter((member) => !relocatingIds.current.has(member.memberId)),
        ...leavingById.current.values(),
    ].sort((a, b) => a.place.slot - b.place.slot);

    const sceneRef = useRef<HTMLDivElement>(null);

    /**
     * Две мерки кадра, нужные ходу корабля: сколько за рейдом моря и насколько поджат дальний
     * край рейда.
     *
     * `overhang` — на сколько кадр шире рейда с каждой стороны, % ширины рейда. Уходит корабль
     * не за край рейда, где его прекрасно видно, а за кромку сцены, и это лишнее море ему
     * приходится пройти. Отрицательной эта мерка не бывает: передний край рейда шире кадра —
     * значит проходить нечего, корабль скрывается раньше.
     *
     * `reachFar` — во сколько раз дальний край рейда уже переднего (`--raid-reach-far`).
     * Стоянку по нему проецирует CSS, а сцене он нужен, чтобы считать путь от настоящего
     * места корабля в кадре, а не от рейдовой доли: на дальней линии проекция уводит корабль
     * к середине, и до кромки ему дальше, чем значится в расстановке.
     *
     * Обе снимаются с вёрстки, а не считаются: рейд идёт за высотой кадра, кадр — за шторкой
     * и за окном, а размах едет вместе с шириной окна (`--wide`). Меряем оба блока сразу,
     * потому что меняться они умеют порознь: раздали окно в ширину — рейд упёрся в свою
     * пропорцию и остался прежним, а моря по бокам прибавилось. Снимается всё по затишью
     * (см. observeSettled): путь кораблю прокладывают в тот миг, когда он тронулся,
     * и посередине чужого перехода эти мерки всё равно ничего не значат.
     */
    const raidRef = useRef<HTMLDivElement>(null);
    const [aside, setAside] = useState(0);
    const [reachFar, setReachFar] = useState(1);
    useEffect(() => {
        const raid = raidRef.current;
        const scene = sceneRef.current;
        if (!raid || !scene) {
            return undefined;
        }
        const measure = (): void => {
            const raidWidth = raid.clientWidth;
            setAside(raidWidth > 0 ? ((scene.clientWidth - raidWidth) / 2 / raidWidth) * 100 : 0);
            setReachFar(Number.parseFloat(getComputedStyle(scene).getPropertyValue('--raid-reach-far')) || 1);
        };
        measure();
        return observeSettled([raid, scene], measure);
    }, []);
    const overhang = Math.max(0, aside);

    /**
     * Мерки, закреплённые за идущим кораблём: точка, к которой он идёт, и запас моря, по которому
     * ему проложен путь. Снимаются они в тот миг, когда корабль тронулся, и держатся до конца хода.
     *
     * Без этого ход обрывался на полпути. Обе мерки считаются от кадра, кадр меняется вместе
     * с раскладкой, и конец пути пересчитывался у корабля прямо под килем. А переход в CSS,
     * которому посреди хода поменяли конечное значение, начинается заново: с того места, где
     * корабль сейчас, и на всю длительность целиком. На глаз это выглядит остановкой — корабль
     * гаснет на входе в новую кривую, стоит долю секунды и трогается снова, — и приходит он
     * с опозданием на целый ход. Замер: переход на 2.9с, если посреди него сменить окно,
     * растягивается до 3.8с.
     *
     * Стоящих кораблей это не касается: их точку пересчитать можно когда угодно, они переедут
     * на неё дорожкой (см. .shipLane в стилях) и никакого хода этим не собьют. А идущий доходит
     * туда, куда шёл, и уже на месте, отпустив мерку, доезжает до новой точки той же дорожкой.
     */
    const motionHold = useRef(new Map<string, { left: number; overhang: number; reach: number }>());

    // Где корабли стоят в кадре: разброс внутри своей полосы да расхождение с тесным соседом.
    // Считается по кадру, а не по составу канала: пока уходящий корабль виден, он и давит
    // на соседа — резинка отпускает не тогда, когда сосед снялся с рейда, а когда он ушёл.
    // Иначе выходило так: крупный только тронулся, а мелкий уже пошёл обратно на свою точку —
    // прямо ему под корпус, и на полминуты хода они шли внахлёст. По той же причине уходящему
    // достаётся его отжатая точка, а не своя: с места он снимается оттуда, где стоял.
    // Кто из них в пути, расстановке важно знать: на линию, где стоят двое, третьим уходящий
    // уже не считается — см. fleetLefts.
    const lefts = fleetLefts(placed, new Set(leavingById.current.keys()));
    const leftOf = (member: Member): number =>
        motionHold.current.get(member.memberId)?.left ?? lefts[member.memberId] ?? restingLeft(member);

    // Пока вкладка в фоне, браузер не рисует кадров, и анимации в ней стоят. Само событие
    // доходит вовремя — useChannel применяет его сразу, — и разметка обновляется, а движение
    // ждёт возвращения на вкладку и начинается с нуля. Поэтому каждому начатому ходу
    // запоминаем момент старта и, вернувшись, подводим анимации по настоящему времени:
    // корабль, вошедший минуту назад, должен уже стоять на рейде, а не заходить на глазах.
    const motionStartedAt = useRef(new Map<string, { kind: string; at: number }>());

    /** Все идущие сейчас корабли: id движения и элемент слота. */
    const movingShips = (): { id: string; kind: string; element: HTMLElement }[] =>
        [...(sceneRef.current?.querySelectorAll<HTMLElement>('[data-motion]') ?? [])].map((element) => ({
            id: element.dataset.ship ?? '',
            kind: element.dataset.motion ?? '',
            element,
        }));

    /**
     * Кивок на остановке: корабль гасит ход и клюёт носом. Ставится он не по концу хода,
     * а раньше — см. NOD_LEAD, — и держится ровно на свою анимацию. Снять класс обязательно:
     * анимацию запускает его появление, и с оставшимся классом второй раз корабль уже не кивнёт.
     *
     * Таймер один на оба срока: сперва он ждёт своего мгновения в ходе, потом — конца анимации.
     */
    const startNod = (id: string): void => {
        window.clearTimeout(nodTimers.current.get(id));
        noddingIds.current.add(id);
        nodTimers.current.set(
            id,
            window.setTimeout(() => {
                nodTimers.current.delete(id);
                noddingIds.current.delete(id);
                redraw();
            }, NOD_SECONDS * 1000)
        );
        redraw();
    };

    /** Тот же кивок, но заранее: за NOD_LEAD до конца хода, чтобы к остановке корабль выровнялся. */
    const scheduleNod = (id: string, seconds: number): void => {
        window.clearTimeout(nodTimers.current.get(id));
        nodTimers.current.set(
            id,
            window.setTimeout(() => startNod(id), Math.max(seconds - NOD_SECONDS * NOD_LEAD, 0) * 1000)
        );
    };

    /**
     * Движение отработало. Класс снимаем всегда — иначе следующее движение того же корабля
     * не начнётся: переход запускается сменой значения, а у оставшегося класса оно уже своё.
     *
     * Уходящий на этом пропадает из кадра. А если он не вышел из канала, а перезаходит,
     * то ждёт паузу — уже вне разметки, за кромкой его всё равно не видно, — и появляется
     * на новом месте заново, заходом, как новичок.
     */
    const finishMotion = (id: string): void => {
        window.clearTimeout(motionTimers.current.get(id));
        motionTimers.current.delete(id);
        motionStartedAt.current.delete(id);
        // Ход кончился — и закреплённые за ним мерки кадра отпускаются: дальше корабль стоит
        // там, где ему велит нынешняя раскладка, и доедет он туда дорожкой.
        motionHold.current.delete(id);
        enteringIds.current.delete(id);
        // Перешедший по воде на этом и всё: он никуда не уходил и остаётся там же, где встал.
        shiftingById.current.delete(id);
        if (!leavingById.current.has(id)) {
            // Сюда же приходит и перезаходящий, отработавший вторую половину манёвра: он встал
            // на новое место, и стороны ему больше не нужны.
            relocateCourses.current.delete(id);
            redraw();
            return;
        }
        // Уходящий кивать на остановке не должен: гасит ход он уже за кромкой кадра, а его
        // отложенный кивок пришёлся бы на пустое место или, того хуже, на его же заход обратно.
        window.clearTimeout(nodTimers.current.get(id));
        nodTimers.current.delete(id);
        noddingIds.current.delete(id);
        leavingById.current.delete(id);
        if (!relocatingIds.current.has(id)) {
            redraw();
            return;
        }
        pauseTimers.current.set(
            id,
            window.setTimeout(() => {
                pauseTimers.current.delete(id);
                relocatingIds.current.delete(id);
                enteringIds.current.add(id);
                redraw();
            }, RELOCATE_PAUSE_MS)
        );
        redraw();
    };

    // Отметку ставим в layout-эффекте, до кадра: он выполняется и в фоновой вкладке, поэтому
    // момент старта запоминается настоящий, а не тот, в который на вкладку вернулись.
    // Тогда же заводим страховку на случай, что события конца перехода не будет вовсе:
    // длительность берём с самого элемента, чтобы не разойтись со стилями.
    //
    // И тогда же назначается кивок заходящего: он приходится на конец хода, а знать про этот
    // конец заранее можно только отсюда — по событию было бы уже поздно.
    useLayoutEffect(() => {
        const now = Date.now();
        movingShips().forEach(({ id, kind, element }) => {
            if (motionStartedAt.current.get(id)?.kind !== kind) {
                motionStartedAt.current.set(id, { kind, at: now });
                // Мерки кадра закрепляются за кораблём на весь ход — см. motionHold. Берутся они
                // с той же отрисовки, на которой корабль тронулся: конец пути уже посчитан,
                // и остаётся его удержать.
                const member = placed.find((one) => one.memberId === id);
                if (member) {
                    motionHold.current.set(id, { left: leftOf(member), overhang, reach: reachFar });
                }
                const seconds = Number.parseFloat(getComputedStyle(element).transitionDuration) || 0;
                window.clearTimeout(motionTimers.current.get(id));
                motionTimers.current.set(
                    id,
                    window.setTimeout(() => finishMotion(id), seconds * 1000 + MOTION_GRACE_MS)
                );
                // Кивок на остановке — тому, кто останавливается в кадре. Уходящий гасит ход
                // за кромкой, и клевать носом ему уже негде.
                if (kind !== 'leaving') {
                    scheduleNod(id, seconds);
                }
            }
        });
    });

    useEffect(() => {
        const resync = (): void => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            const now = Date.now();
            movingShips().forEach(({ id, kind, element }) => {
                const started = motionStartedAt.current.get(id);
                if (started?.kind === kind) {
                    element.getAnimations().forEach((animation) => {
                        animation.currentTime = now - started.at;
                    });
                }
            });
        };
        document.addEventListener('visibilitychange', resync);
        return () => document.removeEventListener('visibilitychange', resync);
        // Подписка одна на всю жизнь сцены: внутри только ссылки и разметка, свежее состояние
        // сторожу не нужно. Без списка он переподписывался бы на каждую отрисовку — а их
        // на сцене столько же, сколько у всего приложения.
    }, []);

    /**
     * Одни часы на всю качку. Отрицательная задержка в стилях отсчитана от появления элемента,
     * и этого мало: качка обязана идти всегда и не начинаться заново оттого, что корабль
     * тронулся с места. А перезаходящий именно появляется заново — уходит со старого места,
     * пропадает на паузу и заплывает на новое, — и цикл у него пошёл бы с нуля, вразрез
     * с водой и с соседями по рейду.
     *
     * Чинится это одним движением: после каждой отрисовки началу цикла назначается не момент
     * появления, а точка на общих часах страницы. Фаза места известна (data-wave), и от неё
     * до этих часов один шаг — сдвинуть начало назад на фазу. Тогда любой корабль, откуда бы
     * он ни взялся, попадает ровно в ту волну, которая уже идёт по рейду.
     *
     * Задержка в стилях при этом остаётся: до первого кадра подводить ещё нечего, и корабль
     * должен появиться уже качающимся, а не ждать своей очереди.
     *
     * Спрашивать у элемента его анимации на каждой отрисовке нельзя: `getAnimations` заставляет
     * браузер досчитать стили, а при открытом поле выбора мест качающихся элементов набирается
     * три десятка. Поэтому анимации запоминаем: у элемента они заводятся вместе с ним и живут,
     * пока он жив. Спросить их надо ровно раз — на той отрисовке, где элемент появился; дальше
     * остаётся поставить начало, и то если оно разошлось с нужным (сменилось место — сменилась
     * и фаза). Сторожем стоит `playState`: отменённая анимация — примета того, что стили
     * пересобрали её заново, и запомненное больше не про этот элемент.
     */
    const waveAnimations = useRef(new WeakMap<Element, Animation[]>());
    useLayoutEffect(() => {
        for (const element of sceneRef.current?.querySelectorAll<HTMLElement>('[data-wave]') ?? []) {
            let animations = waveAnimations.current.get(element);
            if (!animations || animations.some((animation) => animation.playState === 'idle')) {
                animations = element.getAnimations();
                waveAnimations.current.set(element, animations);
            }
            const phase = Number(element.dataset.wave);
            for (const animation of animations) {
                // Тангаж опережает качку на четверть цикла — то же правило, что и в стилях.
                const lead = (animation as CSSAnimation).animationName?.includes('pitch') ? WAVE_SECONDS / 4 : 0;
                const startTime = -(phase + lead) * 1000;
                if (animation.startTime !== startTime) {
                    animation.startTime = startTime;
                }
            }
        }
    });

    /**
     * Дорожка: где она стоит по кадру и какой ширины то, что по ней ездит. Одна и та же
     * и для корабля, и для овала свободного места, только встают они по ней по-разному:
     * отметка — на оси своего коридора, корабль — там, где ему насчитала расстановка
     * (см. fleetLefts), то есть с разбросом внутри полосы и с оглядкой на тесного соседа.
     *
     * `drift` — тот же разброс, но по дальности: корабль отходит от своей линии на долю
     * промежутка до соседней (restingDrift). Достаётся он одному кораблю: отметка места
     * и подпись под ним остаются на самой линии — разметка про выбор, и стройность ей нужна.
     */
    const laneStyle = (place: Berth, width: number, left = place.left, drift = 0): CSSProperties => {
        // Доля пути от дальней линии к ближней. Считается от концов рейда, а не от глубины:
        // сами концы приколочены к горизонту и к нижней кромке кадра, а перспектива
        // распределяет линии между ними. Отход от линии идёт в слотах, а не в долях: доли
        // между линиями разной величины, и в слотах перспектива распределит его сама.
        const share = slotShare(place.slot + drift);
        return {
            // Ширину досчитывает CSS: там же живёт масштаб для телефонов.
            '--slot-left': `${left.toFixed(2)}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2}%`,
            // Перспектива нужна и стилям — двумя мерками сразу. Доля отмеряет то, у чего
            // заданы оба конца: размер точки и сплющенность круга света. Множитель — то,
            // что уходит в даль наравне с кораблём: ширина этого самого круга.
            '--slot-share': share.toFixed(4),
            '--slot-scale': slotScale(place.slot).toFixed(4),
            // В какую сторону от своего коридора отходит отметка места, см. --berth-shift.
            '--corridor-side': CORRIDOR_SIDE[place.corridor],
            // Наклон тени в сторону от месяца, см. .shipShadow ниже и moonLeanDeg выше.
            // Значение не про сам корабль, а про его отметку на воде — но считать его
            // только для тех, кому он нужен, смысла нет: переменная, которую никто
            // не читает, ничего не стоит.
            '--moon-lean': moonLeanDeg(left),
            // Чем дальше корабль, тем выше он стоит в кадре — это и есть перспектива. Рейд
            // натянут между двумя отметками: дальняя линия стоит на --berth-far ниже горизонта,
            // ближняя — на --berth-near выше нижней кромки кадра, а между ними линии расходятся
            // по доле, то есть по той же смягчённой перспективе, что и всё остальное в сцене.
            //
            // Концы приколочены отступами, а не долями, потому что упереть их некуда: у самого
            // горизонта корабль наезжает на линию воды, у самой кромки кадра — уходит под неё.
            // Сами отступы отмерены от нормы воды и ужимаются вместе с ней в тесном кадре —
            // см. --sea-fit в стилях.
            bottom: `calc(var(--berth-near)
                + (100% - var(--horizon) - var(--berth-far) - var(--berth-near)) * ${(1 - share).toFixed(4)})`,
        } as CSSProperties;
    };

    // Выбор места на рейде. Целиться в саму разметку не нужно: указатель ловит вся вода,
    // а выбирается ближайшее место. Иначе на дальних слотах пришлось бы попадать
    // в трёхпиксельный кружок, а на телефоне — ещё и пальцем.
    //
    // Расстояние тут экранное, в пикселях, и меряется до коридора, а не до самой отметки:
    // отметки разведены перспективой (--berth-shift), и по ним ближним к указателю
    // оказывался бы то и дело не тот коридор — у центрального область бы разрослась
    // за счёт боковых, и попасть в боковое место стало бы заметно труднее.
    //
    // Считать по долям кадра нельзя — место в кадре проходит ещё и через clamp у краёв, —
    // поэтому меряем сами дорожки: где они встали, там коридор и есть.
    // Последний состав мест: из пропа он уходит тем же кадром, каким закрылась форма,
    // а слою нужно ещё догореть.
    const lastBerths = useRef<BerthChoice | null>(null);
    if (berths) {
        lastBerths.current = berths;
    }
    const [berthsClosing, setBerthsClosing] = useState(false);
    useEffect(() => {
        if (berths) {
            setBerthsClosing(false);
            return undefined;
        }
        if (!lastBerths.current) {
            return undefined;
        }
        setBerthsClosing(true);
        const timer = window.setTimeout(() => {
            lastBerths.current = null;
            setBerthsClosing(false);
        }, BERTH_FADE_MS);
        return () => window.clearTimeout(timer);
    }, [berths]);

    // Разметка, которую сейчас видно. Это не всегда то же, что berths: закрывшись, слой ещё
    // держится в кадре, пока догорает переход, — потому и состав мест хранится у себя. React
    // снял бы разметку тем же кадром, а гаснуть должно то, что в кадре есть.
    //
    // Флота это не касается: корабли возвращаются из призрака сразу по berths, и оба перехода
    // идут вместе. Порознь они и выглядели неправильно.
    const shownBerths = berths ?? (berthsClosing ? lastBerths.current : null);
    const berthOptions = shownBerths?.options;
    // Места, под которыми стоит корабль: точку там не зажигаем. Занятые места рейд и так
    // не предлагает, но корабль в кадре живёт дольше своего места в списке — уходящий ещё
    // виден, а место под ним уже свободно, — и точка загоралась бы у него под килем.
    //
    // Своё место — особый случай: рейд предлагает его всегда, иначе переехать и передумать
    // было бы некуда, — и занятым оно не считается никогда. Прежде под своим килем разметку
    // прятали: круг света сообщал только «сюда переедет корабль», а под кораблём, который
    // и так тут стоит, сообщать было нечего. Теперь на выбранном месте лежит стрелка курса,
    // и ей есть что сказать в любом случае: она показывает, куда корабль будет смотреть,
    // и ею же курс разворачивают. Прятать её под своим кораблём — значит отобрать разворот
    // ровно у того, кто ничего в форме не двигал.
    const berthTaken = new Set(
        placed.filter((member) => member.memberId !== myId).map((member) => berthKey(member.place))
    );
    const takenKeys = [...berthTaken].sort().join(' ');
    const berthLanes = useRef(new Map<string, HTMLElement>());
    const berthSpots = useRef<{ berth: Berth; x: number; y: number }[]>([]);
    // Место под указателем: по нему проступает разметка остальных мест и подсвечивается то,
    // которое достанется нажатию. Мера тут одна — расстояние до точки, поэтому и хранится
    // не «где указатель», а «какое место оказалось ближайшим».
    const [nearBerth, setNearBerth] = useState<Berth | null>(null);

    // Замер идёт после отрисовки и повторяется, когда сцена меняет размер: точки стоят
    // в долях кадра, и в пикселях они переезжают вместе с ним.
    useLayoutEffect(() => {
        const frame = sceneRef.current?.getBoundingClientRect();
        berthSpots.current = !frame
            ? []
            : (berthOptions ?? []).flatMap((berth) => {
                  // Дорожка — полоса во весь кадр, сдвинутая на свой коридор, и высотой она
                  // ровно в ноль: её левая кромка и есть коридор, а нижняя — линия рейда.
                  const spot = berthLanes.current.get(berthKey(berth))?.getBoundingClientRect();
                  return spot ? [{ berth, x: spot.left - frame.left, y: spot.bottom - frame.top }] : [];
              });
        // Выбор закрылся или рейд перебрали заново — подсветка предыдущего указателя
        // к новому набору мест отношения не имеет.
        setNearBerth(null);
    }, [berthOptions, takenKeys, seaHeight]);

    /**
     * Место, до чьей точки ближе всего от этого места в кадре.
     *
     * Считается только по воде — выше горизонта рейда нет, и указатель, гуляющий по небу,
     * ничего не выбирает и ничего не подсвечивает, — но отсекает небо не счёт, а сама разметка:
     * ловит указатель `.berthWater`, а она начинается от горизонта, и над водой событий
     * попросту нет (у `.berthField` поверх неба `pointer-events: none`, а точка места
     * своё нажатие никуда дальше не пускает).
     *
     * Отсекать сверх того нельзя, и по той же причине, что и у кораблей (см. `shipUnder`):
     * `clientY` приходит обрезанным до целого пикселя, и полоска в полпикселя вдоль горизонта
     * попадает на воду с координатой выше её кромки.
     */
    const berthNearest = (clientX: number, clientY: number): Berth | null => {
        const frame = sceneRef.current?.getBoundingClientRect();
        if (!frame) {
            return null;
        }
        const x = clientX - frame.left;
        const y = clientY - frame.top;
        let nearest: Berth | null = null;
        let shortest = Infinity;
        for (const spot of berthSpots.current) {
            const gap = (spot.x - x) ** 2 + (spot.y - y) ** 2;
            if (gap < shortest) {
                shortest = gap;
                nearest = spot.berth;
            }
        }
        return nearest;
    };

    /**
     * Коробки силуэтов, по которым разбираются нажатия, — по одной на корабль, с которым есть
     * что делать. Идущие сюда не попадают: пока корабль в пути, распоряжаться им нечего, и мерить
     * по коробке, которая как раз едет, тоже не с руки.
     *
     * Держим само место, а не посчитанную заранее коробку: силуэтов в кадре десяток, а нажатие
     * одно, и сведённый в список набор пришлось бы вести через все переезды кадра и все смены
     * раскладки. Коробку берём у `.shipSlot`: качка, рыскание и кивок живут на вложенных слоях,
     * и от кадра к кадру она стоит на месте.
     */
    const shipSlots = useRef(new Map<string, { slot: HTMLElement; kind: ShipKind }>());

    /**
     * Корабль, которому достаётся нажатие в этой точке кадра, или `null`, если нажатие мимо всех.
     *
     * Кто именно — решает `shipAt`: область по силуэту с наименьшей меркой и спор по расстоянию
     * до середины корпуса. Здесь только собирается то, с чем ему работать: у каждого силуэта
     * своя коробка в координатах окна и своя середина корпуса из справочника.
     *
     * Считается по занятым местам, а свободные не в счёт: их выбирают в форме, а не в разговоре.
     *
     * Небо тут не отсекается, в отличие от выбора места (`berthNearest`): слой, с которого
     * приходят эти события, сам начинается от горизонта (`.shipWater`), и точка выше воды
     * до него просто не доходит — там небо и ничей не слой.
     *
     * А отсекать сверх того — вредно. Попадание браузер считает по округлённой точке, а в событие
     * кладёт `clientY`, обрезанный до целого: полоска в полпикселя вдоль горизонта достаётся воде
     * по попаданию, а координата у неё выходит на пиксель выше кромки. Отсев по такой координате
     * съедает каждый пятый щелчок по кораблю у дальней кромки рейда — молча, при том что вода
     * под указателем в этот миг подписана «Изменить корабль и место на рейде».
     */
    const shipUnder = (clientX: number, clientY: number): string | null =>
        shipAt(
            [...shipSlots.current].map(([memberId, { slot, kind }]) => ({
                memberId,
                box: slot.getBoundingClientRect(),
                hull: hullCenter(kind),
            })),
            clientX,
            clientY
        );

    // Корабль под указателем: по нему подписывается вода — «изменить свой» или «корабль такой-то».
    // Подпись эта единственная подсказка о том, что нажатие вообще что-то откроет, и меняться
    // она обязана вместе с тем, кому нажатие достанется. Над пустой водой её нет — как нет
    // и самого нажатия.
    const [nearShip, setNearShip] = useState<string | null>(null);
    const trackShip = (event: PointerEvent<HTMLElement>): void => setNearShip(shipUnder(event.clientX, event.clientY));
    const pickShip = (event: MouseEvent<HTMLElement>): void => {
        const picked = shipUnder(event.clientX, event.clientY);
        if (!picked) {
            return;
        }
        if (picked === myId) {
            onEditShip?.();
        } else {
            onShowShip?.(picked);
        }
    };

    // Чем подписана вода под указателем: тем же, чем подписан бы корпус, которому достанется
    // нажатие. Другой подсказки тут нет — рисовать на воде «нажми сюда» негде.
    const nearShipMember = nearShip ? placed.find((member) => member.memberId === nearShip) : null;
    const nearShipTitle =
        nearShipMember &&
        (nearShipMember.memberId === myId ? 'Изменить корабль и место на рейде' : `Корабль «${nearShipMember.name}»`);
    // Ловит ли вода нажатия по кораблям. Пока открыта форма, не ловит: там по той же воде
    // выбирают место, и два выбора на одном нажатии не разойдутся.
    const picksShip = !berths && Boolean(onEditShip ?? onShowShip) && placed.length > 0;

    // Указатель ведут по воде — показываем, какое место ему достанется. Палец сюда попадает
    // тоже: пока он прижат, события приходят те же, а на отрыве браузер сам присылает уход
    // указателя, и подсветка гаснет.
    const trackBerth = (event: PointerEvent<HTMLElement>): void => {
        const nearest = berthNearest(event.clientX, event.clientY);
        setNearBerth((previous) => (previous && nearest && isSameBerth(previous, nearest) ? previous : nearest));
    };

    const pickNearestBerth = (event: MouseEvent<HTMLElement>): void => {
        const nearest = berthNearest(event.clientX, event.clientY);
        if (nearest) {
            berths?.onPick(nearest);
        }
    };

    return (
        <div
            className={[styles.scene, painted ? styles.scenePainted : ''].filter(Boolean).join(' ')}
            // То же самое, что и класс рядом, но именем, которое не меняется: имена классов
            // хеширует сборка, и цепляться за них снаружи — в проверках — можно только
            // подстрокой. Атрибут говорит прямо: задники догрузились, кадр проступил.
            data-scene-painted={painted ? '' : undefined}
            // Канал на связи: флот пришёл и стоит на местах, разметка свободных мест посчитана.
            // Это не то же, что готовность картинок рядом: задники грузятся из сборки, а флот —
            // из «сервера», и приходят они порознь. Проверкам нужны оба признака: пока
            // канал не пришёл, в кадре пустая вода, и целиться в ней не во что.
            data-scene-ready={ready ? '' : undefined}
            style={{ '--sky-img-px': `${skyImageHeight}px` } as CSSProperties}
            ref={sceneRef}
        >
            {/* Размытие тени задано в долях её собственной ширины, а не в пикселях: у корабля
                вблизи и у корабля у горизонта один и тот же силуэт, разного размера, и размытие
                должно расти вместе с ним. CSS-юниты вроде cqw для этого не годятся — размерные
                query-юниты для Firefox совсем свежие, а нам нужно то, что работает везде и давно.
                SVG-фильтр с primitiveUnits="objectBoundingBox" — как раз это: stdDeviation ниже
                читается не в пикселях, а в долях собственного бокса того элемента, что фильтр
                на себя навесил (см. .shipShadow в SeaScene.module.less), и работает так уже
                двадцать лет. Сам блок пустой и невидимый — тут только определение фильтра.

                Область фильтра расширена явно (x/y/width/height): дефолтные -10%/120% размытию
                впритык, и у широких кораблей его подрезает по бокам, — видно в GH-61. Запас взят
                с той же головой, что и stdDeviation, — долей бокса, а не пикселями, — иначе
                дальний корабль получил бы пиксельный запас в размер себя самого. Держать эту
                пропорцию обязательно: у SVG-фильтра область — это не подсказка, а жёсткая
                обрезка, и хвост гауссианы, которому за ней не хватило места, обрывается
                не размытием, а готовым куском альфы, — тем же жёстким швом, только его край
                теперь на границе области, а не на кромке корпуса.

                Размытие поднято с 0.025 до 0.06: тень — это не силуэт, а собственный спрайт
                корабля (см. ShipShadow.tsx), смешанный с водой через mix-blend-mode: multiply,
                и на исходном размытии сквозь него проступали жёсткие цветные пятна — палуба,
                надстройки — с резкой границей. Заодно добавлена feColorMatrix: multiply берёт
                цвета корабля как есть, и без приглушения насыщенности пятна читались чужеродным
                цветным контуром на воде, а не тенью. Область фильтра растянута следом за
                stdDeviation — с 25% до 60%, — иначе хвост нового, куда более широкого размытия
                срезался бы о старую, слишком тесную границу. См. GH-61. */}
            <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
                <filter
                    id="ship-shadow-blur"
                    primitiveUnits="objectBoundingBox"
                    x="-60%"
                    y="-60%"
                    width="220%"
                    height="220%"
                >
                    <feGaussianBlur stdDeviation="0.06" />
                    <feColorMatrix type="saturate" values="0.35" />
                </filter>
            </svg>
            <div className={styles.sky}>
                {/* Небо-текстура: картинка стыкуется сама с собой, поэтому плитки одинаковы
                    и просто лежат в ряд. Орион — в средней: см. .skyStrip в стилях. */}
                <div className={styles.skyStrip}>
                    <img className={styles.skyTile} src={skyUrl} alt="" ref={skyTileRef} />
                    <img className={styles.skyTile} src={skyUrl} alt="" />
                    <img className={styles.skyTile} src={skyUrl} alt="" />
                </div>
            </div>
            {/* Месяц лежит на кружке неба: луна круглая, и сквозь её невидимую половину не должны
                просвечивать звёзды. Кружок этот — сам блок, а картинка внутри: диск месяца
                и картинка не одно и то же, у картинки вокруг диска пустые поля. */}
            <div className={styles.moon}>
                <img className={styles.moonImage} src={moonUrl} alt="" />
            </div>
            <img className={styles.cloudFar} src={cloudFarUrl} alt="" />
            <img className={styles.cloudNear} src={cloudNearUrl} alt="" />
            {/* Дымка над водой. Идёт после облаков и месяца, а не внутри неба: воздух у горизонта
                затягивает всё, что стоит вдали, — и звёзды, и облако, лежащее на самой линии воды.
                Небом её накрыть было бы нечем: месяц с облаками лежат отдельными слоями поверх. */}
            <div className={styles.haze} />
            {/* Вода: та же склеенная полоса, что и небо, а поверх — она же, перевёрнутая ещё раз.
                Верхняя проступает и гаснет, отчего рябь перетекает в собственное отражение. */}
            <div className={styles.sea} ref={seaRef}>
                <div className={styles.seaStrip}>{seaTiles}</div>
                <div className={styles.seaStripMirrored}>{seaTiles}</div>
            </div>
            {/* Остров стоит на воде ниже горизонта, за ним видно море. Отражение уже есть в картинке. */}
            <img className={styles.island} src={islandUrl} alt="" />
            {/* Рейд: он бывает уже кадра, и всё, что считается в его долях, живёт внутри —
                см. .raid в стилях. Замеряется он же: по его ширине сцена узнаёт, сколько
                лишнего моря по бокам придётся пройти уходящему кораблю. */}
            <div className={styles.raid} ref={raidRef}>
                {placed.map((member) => {
                    const depth = slotDepth(member.place.slot);
                    const width = shipWidthPercent(member.place.slot, member.shipKind);
                    // Крутизна волны идёт от её высоты, поэтому угол считаем из неё, а не из хода
                    // корпуса: осадка корабля уклон воды не меняет. Знак зависит от того, куда
                    // смотрит корабль: положительный поворот поднимает левый край, отрицательный —
                    // правый, а вверх вместе с корпусом должен идти нос, а не корма. Общий для
                    // корпуса и тени: у тени тот же угол берёт обратный знак прямо в CSS
                    // (см. @keyframes shadow-pitch).
                    const pitchAngle = `${(
                        waveAmplitude(depth) *
                        PITCH_PER_PX *
                        (member.place.facing === 'left' ? 1 : -1)
                    ).toFixed(2)}deg`;
                    // Отход от своей линии и разворот корпуса: и то и другое — про стоянку,
                    // а не про место, и потому считается тут же, где и разброс поперёк.
                    // Размер корабля от отхода не меняется: доля линии — это единицы пикселей
                    // на глаз, а вот разойдись ширина корпуса с той, по которой расстановка
                    // разводила соседей бортами, — и двое на линии встали бы внахлёст.
                    const drift = restingDrift(member);
                    const yaw = restingYaw(member);
                    const leaving = leavingById.current.has(member.memberId);
                    const entering = !leaving && enteringIds.current.has(member.memberId);
                    // Переход по воде на соседнюю точку своей же линии. Уходящему и заходящему
                    // он не достаётся: те идут через кромку кадра, и ход у них свой.
                    const shift = leaving || entering ? undefined : shiftingById.current.get(member.memberId);
                    // Вид движения нужен и сам по себе, а не только как класс: по нему сцена
                    // помечает идущий корабль и понимает, что ход сменился на другой.
                    const motionKind =
                        (leaving && 'leaving') || (entering && 'entering') || (shift && 'shifting') || '';
                    const motion = motionKind ? MOTION_CLASS[motionKind] : '';
                    // Заход: с той стороны, откуда пришёл, ровно до кромки кадра и ни шагом дальше.
                    // Считаем от того места, где корабль на самом деле стоит: на оси своего коридора
                    // он не стоит — там стоит отметка места, а корабль разбросан внутри полосы
                    // и мог ещё и отойти от тесного соседа.
                    const shown = leftOf(member);
                    // Запас моря идущему достаётся тот же, каким был на старте: путь до кромки
                    // пересчитывать под килём нельзя — см. motionHold. Поджатие дальнего края
                    // держится за корабль по той же причине: оно едет вместе с шириной окна.
                    const held = motionHold.current.get(member.memberId);
                    const sea = held?.overhang ?? overhang;
                    // Откуда корабль трогается на самом деле: рейдовую долю проекция уводит
                    // от середины на ближних линиях и к середине на дальних, а идти ему
                    // до настоящей кромки кадра.
                    const onScreen = projectLeft(shown, slotShare(member.place.slot + drift), held?.reach ?? reachFar);
                    // Перезаходящему обе стороны уже посчитаны разом, ещё на перемене места,
                    // — см. relocateCourse. Новичку заход достался от бэкенда вместе с местом,
                    // а уход считается здесь: обычно вперёд, но задним ходом, если впереди
                    // остров или сосед.
                    const relocating = relocateCourses.current.get(member.memberId);
                    const enter: EdgeCourse = relocating?.enter ?? {
                        side: member.place.enterFrom,
                        // Заход обычно носом вперёд, но не всегда: на дальних слотах слева
                        // остров, и корабль, которому назначен курс на остров, подходит справа
                        // задним ходом. Видно это по месту: нос смотрит туда же, откуда пришёл.
                        astern: member.place.facing === member.place.enterFrom,
                    };
                    const enterPath = pathToEdge(onScreen, width, enter.side, ENTER_GUARD, sea);
                    const leave =
                        relocating?.leave ??
                        leaveCourse(
                            member.place,
                            member.shipKind,
                            // Дорогу загораживают те, кто остаётся: сам себе корабль не помеха,
                            // и уходящий сосед тоже — он уже трогается с места.
                            placed
                                .filter(
                                    (other) =>
                                        other.memberId !== member.memberId && !leavingById.current.has(other.memberId)
                                )
                                .map((other) => other.place)
                        );
                    const leavePath = pathToEdge(onScreen, width, leave.side, LEAVE_GUARD, sea);
                    const enterAstern = enter.astern;
                    const enterSeconds = sailSeconds(enterPath, member.place.slot, member.shipKind, enterAstern);
                    // Задний ход отличается только длительностью: кривая та же, а скорость ниже.
                    const leaveSeconds = sailSeconds(leavePath, member.place.slot, member.shipKind, leave.astern);
                    // Куда корабль идёт: уходящий — в свою сторону, переходящий по воде — в свою,
                    // остальные — той же, которой заходили на рейд. Стоящему это не пустое значение,
                    // а память о последнем ходе: кивок на остановке отыгрывается уже без движения,
                    // а клюнуть носом корабль должен в ту сторону, в которую шёл.
                    const course = leaving ? leave.side : (shift?.toward ?? otherSide(enter.side));
                    // Положительный угол поднимает левый край, поэтому идущему влево он и достаётся.
                    const bowUp = course === 'left' ? 1 : -1;
                    // Дифферент: приподнята та оконечность, которой корабль идёт вперёд.
                    //
                    // Стоящему кораблю угол не полагается вовсе: дифферент — это про ход. Раньше он
                    // считался и на якоре, и знак ему доставался от пустого курса, — стоящий флот
                    // от этого держал заметный крен, а в конце хода корабль на глазах переваливался
                    // с одного на другой.
                    // Ход, который корабль отыгрывает сейчас: по нему считается дифферент.
                    const movePath = leaving ? leavePath : (shift?.path ?? enterPath);
                    const moveSeconds = leaving ? leaveSeconds : (shift?.seconds ?? enterSeconds);
                    const trim = motionKind
                        ? sailTrim(movePath, moveSeconds, member.place.slot, member.shipKind) * bowUp
                        : 0;
                    // Кивок — короткое движение по краям манёвра, поверх дифферента: трогаясь,
                    // корабль приподнимает нос, а гася ход, клюёт им. Угол один на оба случая,
                    // знак второму меняют стили.
                    const nod = nodAngle(member.shipKind) * bowUp;
                    const nodding = noddingIds.current.has(member.memberId);
                    // Свой корабль открывает форму: там меняются и корабль, и место на рейде.
                    // Идущий не открывает: он ещё не пришёл туда, откуда его будут переставлять.
                    // Пока форма и так открыта, корабль ничего не открывает и указателем
                    // не притворяется: щелчок по воде в этот момент занят выбором места.
                    const canEdit = Boolean(onEditShip) && !berths && member.memberId === myId && !motionKind;
                    // Чужой корабль открывает свою карточку — тем же тычком и по тем же
                    // условиям: идущий и тут ничего не открывает, а пока выбирают место,
                    // щелчок по воде занят выбором.
                    const canShow = Boolean(onShowShip) && !berths && member.memberId !== myId && !motionKind;
                    // Своим кораблём распоряжаются, чужой смотрят: рейд общий, но переставлять
                    // на нём можно только себя. Действие у корпуса одно, и что оно делает,
                    // написано на нём же.
                    //
                    // Само нажатие при этом достаётся не корпусу, а воде под ним: щёлкают
                    // по морю, а вода разбирает, кому нажатие (см. `shipUnder` и `.shipWater`).
                    // На корпусе действие всё же оставлено — тем, чьи мачты поднимаются выше
                    // горизонта, где воды под указателем уже нет.
                    const action =
                        (canEdit && onEditShip
                            ? { onClick: onEditShip, title: 'Изменить корабль и место на рейде' }
                            : null) ??
                        (canShow && onShowShip
                            ? { onClick: () => onShowShip(member.memberId), title: `Корабль «${member.name}»` }
                            : null);
                    return (
                        // Дорожка во всю ширину кадра: она и возит корабль. Ход и место на рейде
                        // считаются в долях кадра, поэтому и блок нужен шириной с кадр — см. стили.
                        <div
                            key={member.memberId}
                            className={
                                [styles.shipLane, motion, nodding ? styles.shipNodding : '']
                                    .filter(Boolean)
                                    .join(' ') || undefined
                            }
                            // Конец хода. Событие приходит и от дифферента на вложенном блоке, поэтому
                            // спрашиваем и свойство, и элемент: чужой конец за свой принимать нельзя.
                            onTransitionEnd={
                                motion
                                    ? (event) => {
                                          if (
                                              event.propertyName === 'translate' &&
                                              event.target === event.currentTarget
                                          ) {
                                              finishMotion(member.memberId);
                                          }
                                      }
                                    : undefined
                            }
                            data-ship={motionKind ? member.memberId : undefined}
                            data-motion={motionKind || undefined}
                            style={
                                {
                                    ...laneStyle(member.place, width, shown, drift),
                                    // Идущему проекция замирает такой, какой была на старте.
                                    // Не замри — смена окна сдвинула бы точку, к которой корабль
                                    // наведён, а с ней и перешла бы заново вся дорога: на глаз
                                    // это остановка на полпути (см. motionHold).
                                    ...(held ? { '--raid-reach-far': held.reach.toFixed(4) } : {}),
                                    // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                    // Отход от линии его не меняет — он меньше половины промежутка,
                                    // и порядок линий от него не переворачивается (см. DEPTH_SCATTER).
                                    zIndex: member.place.slot + 1,
                                    // Ход в процентах ширины кадра: столько корабль смещён от своего
                                    // места, когда только появляется из-за кромки. Знак — сторона,
                                    // с которой он приходит.
                                    '--enter-from': `${enter.side === 'right' ? '' : '-'}${enterPath.toFixed(1)}%`,
                                    '--enter-seconds': `${enterSeconds.toFixed(1)}s`,
                                    '--leave-to': `${leave.side === 'right' ? '' : '-'}${leavePath.toFixed(1)}%`,
                                    '--leave-seconds': `${leaveSeconds.toFixed(1)}s`,
                                    // Переход по воде: сам путь считать не нужно — корабль просто
                                    // едет на новое место дорожкой, — а вот сколько на него секунд,
                                    // знает только компонент: это расстояние между точками
                                    // и размер корабля.
                                    '--shift-seconds': `${(shift?.seconds ?? 0).toFixed(1)}s`,
                                    '--sail-trim': `${trim.toFixed(2)}deg`,
                                    '--nod-angle': `${nod.toFixed(2)}deg`,
                                    // Разворот корпуса на стоянке: постоянный угол, не движение.
                                    // Живёт на дорожке рядом с прочими углами, а достаётся
                                    // одному силуэту — см. .shipYaw в стилях.
                                    '--yaw-angle': `${yaw.toFixed(2)}deg`,
                                } as CSSProperties
                            }
                        >
                            <div
                                className={[
                                    styles.shipSlot,
                                    canEdit ? styles.shipMine : '',
                                    canShow ? styles.shipShown : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                // На каком месте стоит этот корпус. Нужно проверке: подпись знает
                                // своё место (data-berth-name), и только по общему ключу их можно
                                // свести в пару — по порядку в кадре нельзя, корабль бывает отведён
                                // от края кадра и обгоняет соседа по оси.
                                data-berth-ship={berthKey(member.place)}
                                onClick={action?.onClick}
                                title={action?.title}
                                // Коробка силуэта: ровно то место в кадре, куда вписан корабль.
                                // По ней разбираются нажатия по воде (см. `shipUnder`). Записываем
                                // только тех, с кем есть что делать: идущему мимо нажатие ни к чему.
                                ref={(element) => {
                                    if (element && action) {
                                        shipSlots.current.set(member.memberId, {
                                            slot: element,
                                            kind: member.shipKind,
                                        });
                                    } else {
                                        shipSlots.current.delete(member.memberId);
                                    }
                                }}
                            >
                                {/* Кивок живёт своим блоком: он тоже поворот, а поворот на слоте уже занят
                            дифферентом, и на качающемся блоке — тангажом. Свойство одно на элемент,
                            поэтому и слоёв столько же, сколько поворотов. */}
                                <div className={styles.shipNod}>
                                    {/* Качка — общая для корпуса и тени: обе стоят на одной волне. Наклон сюда
                            не входит: у корпуса и тени он расходится в разные стороны (см. --pitch-angle
                            ниже, на .shipRock и .shipShadow порознь). */}
                                    <div
                                        className={styles.shipWave}
                                        // Фаза места на общих часах качки: по ней сцена подводит анимации
                                        // после каждой отрисовки, чтобы корабль не начинал круг заново.
                                        data-wave={wavePhase(member.place).toFixed(2)}
                                        style={
                                            {
                                                // Минус — момент старта в прошлом: корабль появляется уже качающимся.
                                                // Отсюда же CSS считает задержку тангажа, отняв четверть цикла.
                                                '--wave-start': `-${wavePhase(member.place).toFixed(2)}s`,
                                                '--heave': `${heaveAmplitude(depth).toFixed(2)}px`,
                                            } as CSSProperties
                                        }
                                    >
                                        {/* Тень идёт перед кораблём в разметке, поэтому корпус её перекрывает.
                                    Наклон свой, зеркальный корпусу (см. @keyframes shadow-pitch), — общий
                                    предок с наклоном корпуса тут был бы лишним.

                                    --ship-size — та же доля места, что и в расстановке (shipSizeShare):
                                    у крупного корабля отражение просто крупнее в пикселях, и без поправки
                                    на размер густота у него читалась сплошным пятном там, где у катера —
                                    тающим силуэтом (GH-61). Доля от 0.5 до 1 — и по ней же .shipShadow
                                    поджимает густоту для крупных, оставляя мелким прежний, уже верный вид. */}
                                        <div
                                            className={styles.shipShadow}
                                            style={
                                                {
                                                    '--pitch-angle': pitchAngle,
                                                    '--ship-size': shipSizeShare(member.shipKind),
                                                } as CSSProperties
                                            }
                                        >
                                            {/* Короб под маску густоты — отдельный, и не для порядка:
                                        маску и размытие нельзя вешать на один элемент. Фильтр
                                        отрабатывает раньше маски, а маска красит только в своём
                                        коробе (mask-clip по умолчанию border-box) — и срезает
                                        всё, что размытие вынесло наружу, ровным прямоугольником.
                                        Здесь маска режет неразмытый спрайт, а размывает уже
                                        обрезанное внешний блок. Подробности — у .shipShadowShape
                                        в SeaScene.module.less. */}
                                            <div className={styles.shipShadowShape}>
                                                <ShipShadow kind={member.shipKind} facing={member.place.facing} />
                                            </div>
                                        </div>
                                        {/* Тангаж — свой блок на своё свойство, тем же приёмом, что и кивок:
                                    rotate на элементе один, а поворотов у корабля несколько разом. */}
                                        <div
                                            className={styles.shipRock}
                                            style={{ '--pitch-angle': pitchAngle } as CSSProperties}
                                        >
                                            {/* Разворот на стоянке: ещё один поворот, и по тому же правилу,
                                    что кивок с тангажом, — свой блок на своё свойство. Внутри него
                                    один силуэт: тень осталась снаружи и лежит на воде ровно, как
                                    ей и положено. */}
                                            <div className={styles.shipYaw}>
                                                <Ship
                                                    kind={member.shipKind}
                                                    name={member.name}
                                                    hullNumber={member.hullNumber}
                                                    facing={member.place.facing}
                                                    // Идёт — ходовые огни, стоит на рейде — якорные. Это про всех
                                                    // в кадре, а не только про свой корабль: огни у корабля не зависят
                                                    // от того, из чьей вкладки на него смотрят.
                                                    mode={motionKind ? 'underway' : 'anchored'}
                                                    depth={depth}
                                                    // Пока выбирают место, весь флот отходит на второй план: речь
                                                    // сейчас про рейд, и вода должна читаться сквозь любой корпус.
                                                    // Свой корабль тут не исключение — его как раз и разбирают,
                                                    // и место под ним закрыто им же.
                                                    //
                                                    // Высветляется при этом один корпус: огни горят по-прежнему,
                                                    // и тень на воде остаётся тёмной. Разбирается с этим сам
                                                    // корабль — снаружи не отделить одно от другого, — а почему
                                                    // именно так, написано у GHOST в Ship.
                                                    aside={Boolean(berths)}
                                                    morseFeed={morseFeeds[member.memberId] ?? null}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {/* Вода, которой нажимают на корабли. Лежит она поверх всего флота, и это главное:
                коробка корабля — прямоугольник во всю его ширину и высоту, ближний накрывает
                им дальнего целиком, и, пока нажатия ловили корпуса, до дальнего корабля было
                не дотянуться вовсе — в кадре видно оба, а открывается всегда ближний. Теперь
                нажатие достаётся воде, а она разбирает, чьё оно (см. `shipUnder` и `shipPick`):
                область у каждого своя, а спор о наложении решается расстоянием до корпуса.
                Целиться в корпус больше не нужно нигде, и на телефоне это особенно заметно:
                дальний корабль там в палец шириной.
                Слой этот — двойник того, которым выбирают место, и правило у них одно на двоих.
                Разом их не бывает: пока открыта форма, вода занята выбором места. */}
            {picksShip && (
                <div
                    className={[styles.shipWater, nearShip ? styles.shipWaterHit : ''].filter(Boolean).join(' ')}
                    onPointerMove={trackShip}
                    onPointerLeave={() => setNearShip(null)}
                    onClick={pickShip}
                    title={nearShipTitle || undefined}
                />
            )}
            {/* Слой выбора места: он поверх кораблей, потому что точки должны быть видны
                и сквозь корпус — иначе занятая половина рейда выглядит так, будто мест там нет.
                Указатель ловит вся вода, а достаётся нажатие ближайшей точке. */}
            {shownBerths && (
                <div
                    className={[styles.berthField, berths ? '' : styles.berthFieldGone].filter(Boolean).join(' ')}
                    // Картинка стрелки приходит из сборки, а не из стилей: пути к ней в .less
                    // взяться неоткуда — все картинки сцены живут импортами, см. верх файла.
                    style={{ '--berth-arrow': `url(${arrowUrl})` } as CSSProperties}
                    onPointerMove={trackBerth}
                    onPointerLeave={() => setNearBerth(null)}
                    onClick={pickNearestBerth}
                >
                    {/* Вода ловит указатель по всей сцене, а не по одному рейду: щёлкают
                        по морю где угодно, а достаётся нажатие ближайшему месту — и лишним
                        морем по бокам рейда это правило не отменяется. Поэтому она и осталась
                        снаружи .raid, в отличие от всего остального в этом слое. */}
                    <div className={styles.berthWater} />
                    <div className={styles.raid}>
                        {/* Подписи занятых мест. Живут они здесь, в слое разметки, а не на дорожке
                        корабля: слой лежит поверх всего флота, и подпись дальнего корабля
                        не пропадает за ближним корпусом. Стоит она там же, где у свободного
                        места горит точка, — на самой отметке стоянки, — и качается той же
                        волной и в той же фазе, что и корабль над ней: имя написано на воде,
                        а вода одна на всех.
                        Мерки дорожке достаются те же, что и точке (berthWidthPercent), и без
                        расхождения: подпись стоит на самой стоянке, которую собой закрывает,
                        а корабль над ней может быть отведён в сторону — отступом от края кадра
                        или уступая тесному соседу. Займи подпись ширину корпуса, у края кадра
                        она отъехала бы вместе с ним и повисла между двумя точками.
                        На выбранном месте подписи нет: там лежит стрелка курса, и имя прошло бы
                        ровно через неё. Место это всегда своё — чужие рейд не предлагает, — а под
                        своим кораблём подпись и не нужна: она отвечает на вопрос «кто здесь стоит»,
                        и под собственным килем ответ известен. Отошли на другое место, и подпись
                        на покинутом возвращается вместе с точкой. */}
                        {placed
                            .filter((member) => !shownBerths.picked || !isSameBerth(member.place, shownBerths.picked))
                            .map((member) => (
                                <div
                                    key={member.memberId}
                                    className={styles.shipNameLane}
                                    // Чьё это место — нужно проверке: подпись обязана встать на ту же
                                    // ось, что и точка свободного места, и сверять их иначе не с чем.
                                    // Метка своя, не data-berth: тем помечены сами точки, и общая
                                    // сбивала бы счёт разметки под кораблём.
                                    data-berth-name={berthKey(member.place)}
                                    style={laneStyle(member.place, berthWidthPercent(member.place.slot))}
                                >
                                    <span
                                        className={styles.shipName}
                                        data-wave={wavePhase(member.place).toFixed(2)}
                                        style={
                                            {
                                                '--heave': `${waveAmplitude(slotDepth(member.place.slot)).toFixed(2)}px`,
                                                '--wave-start': `-${wavePhase(member.place).toFixed(2)}s`,
                                            } as CSSProperties
                                        }
                                    >
                                        <MemberName name={member.name} color={member.color} />
                                    </span>
                                </div>
                            ))}
                        {shownBerths.options.map((berth) => {
                            const picked = Boolean(shownBerths.picked && isSameBerth(berth, shownBerths.picked));
                            const near = Boolean(nearBerth && isSameBerth(berth, nearBerth));
                            const key = berthKey(berth);
                            // Под чужим кораблём разметки не рисуем — см. berthTaken. Заодно место
                            // пропадает и из замера: ближайшим к указателю оно уже не считается,
                            // иначе щелчок по воде доставался бы месту, которого в кадре не видно.
                            // Своего корабля это не касается: под ним лежит стрелка курса.
                            if (berthTaken.has(key)) {
                                return null;
                            }
                            return (
                                <div
                                    key={key}
                                    className={styles.berthLane}
                                    // Замер идёт по дорожке, а не по самой отметке: дорожка стоит
                                    // на коридоре, отметка от него отведена перспективой.
                                    ref={(element) => {
                                        if (element) {
                                            berthLanes.current.set(key, element);
                                        } else {
                                            berthLanes.current.delete(key);
                                        }
                                    }}
                                    style={laneStyle(berth, berthWidthPercent(berth.slot))}
                                >
                                    <button
                                        type="button"
                                        className={styles.berthDot}
                                        data-berth={key}
                                        aria-pressed={picked}
                                        // У выбранного места нажатие означает уже не выбор,
                                        // а разворот — подпись обязана говорить то же самое.
                                        aria-label={
                                            picked
                                                ? `Выбрано место: ${BERTH_LABELS[berth.corridor]}, ${berth.slot + 1}-я линия. Развернуть корабль`
                                                : `Место на рейде: ${BERTH_LABELS[berth.corridor]}, ${berth.slot + 1}-я линия`
                                        }
                                        // Своя обработка нужна ради клавиатуры: у нажатия с неё нет
                                        // координат, а без них ближайшее место не найти.
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            berths?.onPick(berth);
                                        }}
                                        style={
                                            {
                                                // Точка нарисована на самой воде, поэтому качается
                                                // с полным размахом волны: это корабль режет её вполовину.
                                                '--heave': `${waveAmplitude(slotDepth(berth.slot)).toFixed(2)}px`,
                                                // Огонёк ходит той же волной и в той же фазе, что
                                                // и корабль, который сюда встанет: качает их одна вода.
                                                '--wave-start': `-${wavePhase(berth).toFixed(2)}s`,
                                            } as CSSProperties
                                        }
                                    >
                                        <span
                                            // Огонёк качается той же волной, что и корабль, который
                                            // сюда встанет, — и по тем же общим часам.
                                            data-wave={wavePhase(berth).toFixed(2)}
                                            // Метка из семьи data-berth-*: это огонёк места,
                                            // а не огонь корабля (у тех своя, data-lit).
                                            data-berth-light={key}
                                            className={[
                                                styles.berthDotLight,
                                                near ? styles.berthDotNear : '',
                                                picked ? styles.berthDotPicked : '',
                                                // Стрелка нарисована вправо, влево смотрит
                                                // отражением — рисовать вторую незачем.
                                                picked && shownBerths.facing === 'left'
                                                    ? styles.berthDotPickedLeft
                                                    : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' ')}
                                        />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            <div className={styles.bottomFade} />
        </div>
    );
}

/**
 * Кадр перерисовывается только по своим входным данным.
 *
 * Он самый тяжёлый на экране — десятки кораблей со своей качкой, огнями и разметкой, — а живёт
 * рядом с разговором, который перерисовывает приложение на каждом шаге пальца по кромке.
 * До кадра эти шаги не доходят вовсе: он стоит в коробке, размер которой ему задают стилями,
 * и от того, насколько вытянут разговор, ни один корабль не сдвинется.
 */
export default memo(SeaScene);
