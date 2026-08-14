import {
    CSSProperties,
    MouseEvent,
    PointerEvent,
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
import { fleetLefts, restingLeft } from '@/backend';
import MemberName from '@/components/ships/MemberName';
import Ship from '@/components/ships/Ship';
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
    isSameBerth,
    otherSide,
    shipWidthPercent,
    slotDepth,
    slotScale,
    slotShare,
} from '@/types/channel';

import {
    ENTER_GUARD,
    LEAVE_GUARD,
    Shift,
    berthWidthPercent,
    leaveCourse,
    nodAngle,
    pathToEdge,
    sailSeconds,
    sailTrim,
    shiftAcross,
} from '@/components/SeaScene/shipMotion';

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
const RELOCATE_PAUSE_MS = 3000;

// Сколько длится кивок, с. Сама длительность живёт в стилях (@nod-seconds), здесь она нужна
// затем, чтобы вовремя снять класс: анимация запускается его появлением, и оставшийся класс
// не дал бы кораблю кивнуть во второй раз.
const NOD_SECONDS = 3.5;

// Насколько кивок на остановке опережает конец хода. Клюёт носом корабль, пока гасит ход,
// а не после: к тому мгновению, когда он встал, он уже должен быть выровнен. Не весь кивок
// целиком — хвост его приходится на первые мгновения стоянки, и это правильно: вода
// под остановившимся корпусом успокаивается не сразу.
const NOD_LEAD = 0.8;

// Сколько гаснет слой выбора места, мс. Сама длительность живёт в стилях (@berth-fade),
// здесь она нужна затем, чтобы вовремя снять разметку: пока переход идёт, слой обязан
// оставаться в кадре, а после — исчезнуть, иначе он навсегда останется в разметке прозрачным.
const BERTH_FADE_MS = 200;

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
    /**
     * Канал загружен и список кораблей окончательный. Нужен, чтобы отличить «пока пусто,
     * потому что ещё грузимся» от «пусто, потому что на рейде никого»: от этого зависит,
     * заплывёт ли следующий корабль в кадр или просто окажется на месте.
     */
    ready: boolean;
    /**
     * Кадр развёрнут во весь экран. Сцене от этого меняются только те мерки, что были
     * пиксельными: доля воды в кадре и высота месяца — см. .sceneFull в стилях. Вся остальная
     * геометрия рейда отмерена долями кадра и разъезжается сама.
     */
    full?: boolean;
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ members, myId, morseFeeds, ready, berths, onEditShip, full }: SeaSceneProps) {
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
    // Куда перезаходящий вернётся: сторона захода на новом месте. Нужна ему, пока он ещё
    // уходит со старого, — уход и заход считаются одним счётом, иначе корабль уходит в одну
    // сторону, а появляется с другой, и выходит круг вокруг всей сцены (см. leaveCourse).
    const returningTo = useRef(new Map<string, Side>());
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
    const seaRef = useRef<HTMLDivElement>(null);
    const [seaHeight, setSeaHeight] = useState(0);
    useEffect(() => {
        const water = seaRef.current;
        if (!water) {
            return undefined;
        }
        const observer = new ResizeObserver(([entry]) => setSeaHeight(entry.contentRect.height));
        observer.observe(water);
        return () => observer.disconnect();
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
        // сменил корабль, а это тот же манёвр: прежний уходит с рейда, новый заходит. Меняться
        // на глазах, оставаясь на месте, кораблю нельзя — на рейде так не бывает.
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
                (!isSameBerth(shown.place, member.place) || shown.shipKind !== member.shipKind)
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
                returningTo.current.set(member.memberId, member.place.enterFrom);
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

    // Где корабли стоят в кадре: разброс внутри своей полосы да расхождение с тесным соседом.
    // Считается по каналу, а не по кадру: уходящий корабль в кадре ещё виден, но давить
    // на соседа уже перестал — тот отпускает резинку и идёт обратно на свою точку, не дожидаясь,
    // пока ушедший скроется за кромкой. Уходящему расхождения не достаётся по той же причине:
    // в списке канала его уже нет, и он снимается со своей точки, а не с отжатой.
    const lefts = fleetLefts(members);
    const leftOf = (member: Member): number => lefts[member.memberId] ?? restingLeft(member);

    // Пока вкладка в фоне, браузер не рисует кадров, и анимации в ней стоят. Само событие
    // доходит вовремя — useChannel применяет его сразу, — и разметка обновляется, а движение
    // ждёт возвращения на вкладку и начинается с нуля. Поэтому каждому начатому ходу
    // запоминаем момент старта и, вернувшись, подводим анимации по настоящему времени:
    // корабль, вошедший минуту назад, должен уже стоять на рейде, а не заходить на глазах.
    const sceneRef = useRef<HTMLDivElement>(null);

    /**
     * Насколько сцена шире рейда с каждой стороны, % ширины рейда.
     *
     * Рейд бывает уже кадра (см. .raid в стилях), и по бокам от него остаётся просто море.
     * Кораблю это море надо пройти: уходит он не за край рейда, где его прекрасно видно,
     * а за кромку сцены. Путь считается в долях рейда — в них же меряются и корабль,
     * и расстановка, — поэтому и запас переводим в них же.
     *
     * Мерка нужна живая: рейд идёт за высотой кадра, кадр — за шторкой и за окном. Меряем
     * оба блока сразу, потому что меняться они умеют порознь: раздали окно в ширину — рейд
     * упёрся в свою пропорцию и остался прежним, а моря по бокам прибавилось.
     */
    const raidRef = useRef<HTMLDivElement>(null);
    const [overhang, setOverhang] = useState(0);
    useEffect(() => {
        const raid = raidRef.current;
        const scene = sceneRef.current;
        if (!raid || !scene) {
            return undefined;
        }
        const measure = (): void => {
            const raidWidth = raid.clientWidth;
            setOverhang(raidWidth > 0 ? Math.max(0, ((scene.clientWidth - raidWidth) / 2 / raidWidth) * 100) : 0);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(raid);
        observer.observe(scene);
        return () => observer.disconnect();
    }, []);
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
        enteringIds.current.delete(id);
        // Перешедший по воде на этом и всё: он никуда не уходил и остаётся там же, где встал.
        shiftingById.current.delete(id);
        if (!leavingById.current.has(id)) {
            redraw();
            return;
        }
        // Уходящий кивать на остановке не должен: гасит ход он уже за кромкой кадра, а его
        // отложенный кивок пришёлся бы на пустое место или, того хуже, на его же заход обратно.
        window.clearTimeout(nodTimers.current.get(id));
        nodTimers.current.delete(id);
        noddingIds.current.delete(id);
        leavingById.current.delete(id);
        returningTo.current.delete(id);
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
    });

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
     */
    useLayoutEffect(() => {
        for (const element of sceneRef.current?.querySelectorAll<HTMLElement>('[data-wave]') ?? []) {
            const phase = Number(element.dataset.wave);
            element.getAnimations().forEach((animation) => {
                // Тангаж опережает качку на четверть цикла — то же правило, что и в стилях.
                const lead = (animation as CSSAnimation).animationName?.includes('pitch') ? WAVE_SECONDS / 4 : 0;
                animation.startTime = -(phase + lead) * 1000;
            });
        }
    });

    /**
     * Дорожка: где она стоит по кадру и какой ширины то, что по ней ездит. Одна и та же
     * и для корабля, и для овала свободного места, только встают они по ней по-разному:
     * отметка — на оси своего коридора, корабль — там, где ему насчитала расстановка
     * (см. fleetLefts), то есть с разбросом внутри полосы и с оглядкой на тесного соседа.
     */
    const laneStyle = (place: Berth, width: number, left = place.left): CSSProperties => {
        // Доля пути от дальней линии к ближней. Считается от концов рейда, а не от глубины:
        // сами концы приколочены к горизонту и к нижней кромке кадра, а перспектива
        // распределяет линии между ними.
        const share = slotShare(place.slot);
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
     * Место, до чьей точки ближе всего от этого места в кадре. Считается только по воде:
     * выше горизонта рейда нет, и указатель, гуляющий по небу, ничего не выбирает и ничего
     * не подсвечивает — иначе разметка проступала бы от движения мыши над месяцем.
     */
    const berthNearest = (clientX: number, clientY: number): Berth | null => {
        const frame = sceneRef.current?.getBoundingClientRect();
        const water = seaRef.current?.getBoundingClientRect();
        if (!frame || !water || clientY < water.top) {
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
            className={[styles.scene, painted ? styles.scenePainted : '', full ? styles.sceneFull : '']
                .filter(Boolean)
                .join(' ')}
            style={{ '--sky-img-px': `${skyImageHeight}px` } as CSSProperties}
            ref={sceneRef}
        >
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
                    const enterPath = pathToEdge(shown, width, member.place.enterFrom, ENTER_GUARD, overhang);
                    // Уход: обычно вперёд, но счёт общий с заходом — см. leaveCourse. Задним ходом
                    // корабль уходит, если впереди остров или сосед, а ещё если вперёд означает
                    // круг вокруг всей сцены: перезаходящий возвращается с той стороны, куда ушёл.
                    const leave = leaveCourse(
                        member.place,
                        member.shipKind,
                        // Дорогу загораживают те, кто остаётся: сам себе корабль не помеха,
                        // и уходящий сосед тоже — он уже трогается с места.
                        placed
                            .filter(
                                (other) =>
                                    other.memberId !== member.memberId && !leavingById.current.has(other.memberId)
                            )
                            .map((other) => other.place),
                        returningTo.current.get(member.memberId)
                    );
                    const leavePath = pathToEdge(shown, width, leave.side, LEAVE_GUARD, overhang);
                    // Заход обычно носом вперёд, но не всегда: на дальних слотах слева остров,
                    // и корабль, которому назначен курс на остров, подходит справа задним ходом.
                    // Видно это по месту: нос смотрит туда же, откуда корабль пришёл.
                    const enterAstern = member.place.facing === member.place.enterFrom;
                    const enterSeconds = sailSeconds(enterPath, member.place.slot, member.shipKind, enterAstern);
                    // Задний ход отличается только длительностью: кривая та же, а скорость ниже.
                    const leaveSeconds = sailSeconds(leavePath, member.place.slot, member.shipKind, leave.astern);
                    // Куда корабль идёт: уходящий — в свою сторону, переходящий по воде — в свою,
                    // остальные — той же, которой заходили на рейд. Стоящему это не пустое значение,
                    // а память о последнем ходе: кивок на остановке отыгрывается уже без движения,
                    // а клюнуть носом корабль должен в ту сторону, в которую шёл.
                    const course = leaving ? leave.side : (shift?.toward ?? otherSide(member.place.enterFrom));
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
                                    ...laneStyle(member.place, width, shown),
                                    // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                    zIndex: member.place.slot + 1,
                                    // Ход в процентах ширины кадра: столько корабль смещён от своего
                                    // места, когда только появляется из-за кромки. Знак — сторона,
                                    // с которой он приходит.
                                    '--enter-from': `${member.place.enterFrom === 'right' ? '' : '-'}${enterPath.toFixed(1)}%`,
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
                                } as CSSProperties
                            }
                        >
                            <div
                                className={[styles.shipSlot, canEdit ? styles.shipMine : ''].filter(Boolean).join(' ')}
                                // Чужие корабли не трогаем: рейд общий, но распоряжаться там можно
                                // только собой.
                                onClick={canEdit ? onEditShip : undefined}
                                title={canEdit ? 'Изменить корабль и место на рейде' : undefined}
                            >
                                {/* Кивок живёт своим блоком: он тоже поворот, а поворот на слоте уже занят
                            дифферентом, и на качающемся блоке — тангажом. Свойство одно на элемент,
                            поэтому и слоёв столько же, сколько поворотов. */}
                                <div className={styles.shipNod}>
                                    {/* Корабль, номер, огни и тень на воде качаются как единое целое: обе анимации
                            висят на одном блоке, потому что двигают разные свойства — translate и rotate. */}
                                    <div
                                        className={styles.shipRock}
                                        // Фаза места на общих часах качки: по ней сцена подводит анимации
                                        // после каждой отрисовки, чтобы корабль не начинал круг заново.
                                        data-wave={wavePhase(member.place).toFixed(2)}
                                        style={
                                            {
                                                // Минус — момент старта в прошлом: корабль появляется уже качающимся.
                                                // Отсюда же CSS считает задержку тангажа, отняв четверть цикла.
                                                '--wave-start': `-${wavePhase(member.place).toFixed(2)}s`,
                                                '--heave': `${heaveAmplitude(depth).toFixed(2)}px`,
                                                // Крутизна волны идёт от её высоты, поэтому угол считаем из неё,
                                                // а не из хода корпуса: осадка корабля уклон воды не меняет.
                                                // Знак зависит от того, куда смотрит корабль: положительный
                                                // поворот поднимает левый край, отрицательный — правый, а вверх
                                                // вместе с корпусом должен идти нос, а не корма.
                                                '--pitch-angle': `${(
                                                    waveAmplitude(depth) *
                                                    PITCH_PER_PX *
                                                    (member.place.facing === 'left' ? 1 : -1)
                                                ).toFixed(2)}deg`,
                                            } as CSSProperties
                                        }
                                    >
                                        {/* Тень идёт перед кораблём в разметке, поэтому корпус её перекрывает. */}
                                        <div className={styles.shipShadow} />
                                        {/* Пока выбирают место, весь флот отходит на второй план: речь
                                        сейчас про рейд, и вода должна читаться сквозь любой корпус.
                                        Свой корабль тут не исключение — его как раз и разбирают,
                                        и место под ним закрыто им же.
                                        Высветляется при этом только корпус. Тень на воде осталась
                                        снаружи нарочно: она тёмная, и то же осветление вывернуло бы
                                        её в светлое пятно под кораблём — вместо «отошёл на второй
                                        план» вышло бы «подсвечен снизу». */}
                                        <div
                                            className={[styles.shipBody, berths ? styles.shipAside : '']
                                                .join(' ')
                                                .trim()}
                                        >
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
                                                morseFeed={morseFeeds[member.memberId] ?? null}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
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
                                            data-lit={key}
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
