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

import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaUrl from '@/assets/scene/sea.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { MOBILE_SHIP_ZOOM } from '@/config/layout';
import {
    Berth,
    CORRIDORS,
    Corridor,
    Member,
    MorseFeed,
    SLOT_COUNT,
    ShipPlacement,
    isSameBerth,
    otherSide,
    slotDepth,
} from '@/types/channel';
import { useIsMobile } from '@/utils/viewport';

import {
    ENTER_GUARD,
    LEAVE_GUARD,
    berthWidthPercent,
    leaveCourse,
    pathToEdge,
    sailSeconds,
    sailTrim,
    shipWidthPercent,
    shownLeft,
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
// Секунда на линию — это волна длиной ровно в рейд: десять линий как раз укладываются
// в круг. Шаг коридора нарочно не кратен шагу линии: на кратном по кадру пошли бы
// заметные диагонали из кораблей, качающихся в такт.
const WAVE_SLOT_LAG = 1;
const WAVE_CORRIDOR_LAG = 1.4;

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
 * Во сколько раз камера отодвинута от кадра дальше, чем высока в нём вода. Это и есть
 * перспектива сцены — та, по которой овалы мест ложатся на воду плашмя (см. стили).
 *
 * Считается число от воды, а не от сцены и не в пикселях, потому что перспектива обязана
 * следовать за морем: на телефоне воды в кадре 58% высоты сцены, на десктопе 44%, и корабли
 * на телефоне разведены по всей её высоте. Возьми мы одно число в пикселях — на телефоне
 * овалы раскрылись бы заметно сильнее десктопных, а при сжатой сцене (вылезла клавиатура)
 * сплющились бы в линию. От воды же выходит одинаково: у ближнего места овал вшестеро шире,
 * чем выше, у дальнего — раз в тридцать, и так на обоих раскладках.
 *
 * Само значение — про то, откуда мы смотрим на рейд: чем оно больше, тем ниже наблюдатель
 * и тем площе разметка. Наблюдатель здесь стоит низко, и это не вкусовщина: корабли в сцене
 * нарисованы строго сбоку, то есть с высоты собственной ватерлинии, — а раскрытый овал говорит,
 * что смотрят на рейд сверху. Разойдись эти две высоты сильно — и сцена разваливается на вид
 * сбоку и вид с вертолёта разом. Совсем в ноль высоту не свести (тогда весь рейд сложился бы
 * в одну линию у горизонта), поэтому берём столько, сколько нужно рейду, чтобы разойтись
 * по кадру, и ни каплей больше.
 */
const BERTH_PERSPECTIVE = 5.5;

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
 * Выбор места на рейде: что показать овалами, что из этого выбрано и куда сообщать о нажатии.
 * Живёт, пока открыта форма корабля; в самом чате мест не показываем — там уже всё занято теми,
 * кто на связи.
 */
export interface BerthChoice {
    /** Свободные места: в каждом горит точка, у выбранного — ещё и овал вокруг неё. */
    options: Berth[];
    picked: Berth | null;
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
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ members, myId, morseFeeds, ready, berths, onEditShip }: SeaSceneProps) {
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
    // Сюда же попадает корабль, который перезаходит на другой слот, — со своим прежним местом.
    const leavingById = useRef(new Map<string, Member>());
    // Кто сейчас перезаходит: ушёл со старого места и ещё не появился на новом. Пока он в этом
    // списке, живого участника не рисуем — в кадре только его уходящий двойник из leavingById.
    const relocatingIds = useRef(new Set<string>());
    // Где корабль нарисован сейчас. Сравнение с местом из канала и говорит, что произошло:
    // сменился слот — перезаход, сменилась только точка — ход поперёк кадра.
    const shownById = useRef(new Map<string, ShipPlacement>());
    // Списки живут в ref, а не в state: они меняются прямо во время отрисовки, до кадра.
    // Через state корабль на один кадр оказался бы на месте, и вход дёргался бы. Убрать
    // же отработавший корабль из разметки без перерисовки нельзя — за этим и счётчик.
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    // Отложенные заходы после перезахода: id → таймер паузы. Рядом — страховочные таймеры конца
    // хода, см. MOTION_GRACE_MS. И те и другие чистим при размонтировании.
    const pauseTimers = useRef(new Map<string, number>());
    const motionTimers = useRef(new Map<string, number>());
    useEffect(
        () => () => {
            pauseTimers.current.forEach((timer) => window.clearTimeout(timer));
            motionTimers.current.forEach((timer) => window.clearTimeout(timer));
        },
        []
    );

    // На телефоне корабли растянуты, и путь у них в метрах длиннее — длительность хода
    // это учитывает, иначе на узком экране флот ходил бы быстрее, чем на широком.
    const zoom = useIsMobile() ? MOBILE_SHIP_ZOOM : 1;

    // Высота воды в кадре, px. Нужна перспективе: та считается от моря, а не от сцены,
    // и меняется вместе с ним — сцена сжимается под клавиатуру, а на телефоне ещё и доля
    // воды другая. Замер идёт по самому слою воды: он и есть море, спрашивать его надёжнее,
    // чем повторять в коде долю из стилей.
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

    const known = useRef<Member[]>([]);
    if (ready && seenIds.current === null) {
        seenIds.current = new Set(members.map((member) => member.memberId));
        members.forEach((member) => shownById.current.set(member.memberId, member.place));
    } else if (seenIds.current) {
        for (const member of members) {
            if (!seenIds.current.has(member.memberId)) {
                seenIds.current.add(member.memberId);
                enteringIds.current.add(member.memberId);
                shownById.current.set(member.memberId, member.place);
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
        // Место сменилось — значит корабль встал на другое. На новое место он не переползает,
        // а перезаходит: уходит со старого, пропадает на паузу и заново заплывает на новое.
        // Перезаходящих пропускаем: у них новое место уже принято, они его отыгрывают.
        const relocated = members.filter((member) => {
            const shown = shownById.current.get(member.memberId);
            return shown && !relocatingIds.current.has(member.memberId) && !isSameBerth(shown, member.place);
        });
        for (const member of relocated) {
            // Место в списке заведомо есть: по нему этот корабль в список и попал.
            const shown = shownById.current.get(member.memberId)!;
            shownById.current.set(member.memberId, member.place);
            leavingById.current.set(member.memberId, { ...member, place: shown });
            relocatingIds.current.add(member.memberId);
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

    // Пока вкладка в фоне, браузер не рисует кадров, и анимации в ней стоят. Само событие
    // доходит вовремя — useChannel применяет его сразу, — и разметка обновляется, а движение
    // ждёт возвращения на вкладку и начинается с нуля. Поэтому каждому начатому ходу
    // запоминаем момент старта и, вернувшись, подводим анимации по настоящему времени:
    // корабль, вошедший минуту назад, должен уже стоять на рейде, а не заходить на глазах.
    const sceneRef = useRef<HTMLDivElement>(null);
    const motionStartedAt = useRef(new Map<string, { kind: string; at: number }>());

    /** Все идущие сейчас корабли: id движения и элемент слота. */
    const movingShips = (): { id: string; kind: string; element: HTMLElement }[] =>
        [...(sceneRef.current?.querySelectorAll<HTMLElement>('[data-motion]') ?? [])].map((element) => ({
            id: element.dataset.ship ?? '',
            kind: element.dataset.motion ?? '',
            element,
        }));

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
        if (!leavingById.current.has(id)) {
            redraw();
            return;
        }
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
     * Дорожка: где она стоит по кадру и какой ширины то, что по ней ездит. Одна и та же
     * и для корабля, и для овала свободного места — оттого место и оказывается ровно там,
     * где потом встанет корабль, включая отступ от края кадра.
     */
    const laneStyle = (place: Berth, width: number): CSSProperties => {
        const depth = slotDepth(place.slot);
        return {
            // Ширину и кламп «не подходить к краям кадра» досчитывает CSS: там же живёт
            // масштаб для телефонов и отступ от краёв.
            '--slot-left': `${place.left.toFixed(2)}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2}%`,
            // Дальность нужна и стилям: от неё идёт размер точки, отмечающей место на рейде.
            '--slot-depth': depth.toFixed(4),
            // Чем дальше корабль, тем выше он стоит в кадре — это и есть перспектива, и считается
            // она прямо: место поднято над ближним краем рейда на свою глубину, то есть на 1/D,
            // а на нуле — у горизонта — оказывается бесконечная дальность. Отсчёт идёт от воды,
            // а не от низа сцены: воды на телефоне 58% высоты сцены, а на десктопе 44%, и от низа
            // сцены корабли жались бы к нижнему краю, оставляя у горизонта пустую полосу.
            //
            // Сверху на это ложится подъём в пикселях (см. @berth-lift в стилях): доля воды
            // на телефоне и на десктопе отмеряет разное число пикселей, а нижней кромке кадра
            // до долей дела нет — ближняя линия там просто упирается в край воды. Общий подъём
            // двигает весь рейд, ближний добавляется по глубине и достаётся в основном
            // первой линии.
            bottom: `calc((100% - var(--horizon)) * (1 - ${depth.toFixed(4)} * (1 - var(--sea-near-edge)))
                + var(--berth-lift) + var(--berth-lift-near) * ${depth.toFixed(4)})`,
        } as CSSProperties;
    };

    /**
     * Предел ширины корабля, px. Нужен на широком экране: доли кадра там оборачиваются
     * такими пикселями, что ближний корабль занимает половину рейда. У дальнего предел ниже —
     * перспектива, — и у мелкого корабля тоже: его доля от предела та же, что и в кадре.
     */
    const maxShipWidth = (member: Member): number =>
        (60 + slotDepth(member.place.slot) * 290) * SHIP_SPRITES[member.shipKind].scale;

    // Выбор места на рейде. Целиться в саму разметку не нужно: указатель ловит вся вода,
    // а выбирается место, до чьей точки ближе всего. Иначе на дальних слотах пришлось бы
    // попадать в трёхпиксельный кружок, а на телефоне — ещё и пальцем.
    //
    // Расстояние тут экранное, в пикселях, и меряется по самим точкам: считать его по долям
    // кадра нельзя — место в кадре проходит ещё и через clamp у краёв, — а по-настоящему
    // близко то, что близко на глаз.
    const berthOptions = berths?.options;
    const berthDots = useRef(new Map<string, HTMLElement>());
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
                  const spot = berthDots.current.get(berthKey(berth))?.getBoundingClientRect();
                  return spot
                      ? [
                            {
                                berth,
                                x: spot.left + spot.width / 2 - frame.left,
                                y: spot.top + spot.height / 2 - frame.top,
                            },
                        ]
                      : [];
              });
        // Выбор закрылся или рейд перебрали заново — подсветка предыдущего указателя
        // к новому набору мест отношения не имеет.
        setNearBerth(null);
    }, [berthOptions, seaHeight, zoom]);

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
            className={painted ? `${styles.scene} ${styles.scenePainted}` : styles.scene}
            ref={sceneRef}
            // Перспектива сцены: камера отодвинута от кадра на столько же высот воды,
            // сколько задано BERTH_PERSPECTIVE. До первого замера значение остаётся
            // из стилей — показывать в этот момент всё равно нечего.
            style={
                seaHeight
                    ? ({ '--berth-perspective': `${(seaHeight * BERTH_PERSPECTIVE).toFixed(0)}px` } as CSSProperties)
                    : undefined
            }
        >
            <div className={styles.sky}>
                {/* Небо-текстура: соседние плитки зеркальны друг другу, поэтому стыки незаметны. */}
                <div className={styles.skyStrip}>
                    <img className={styles.skyTileMirrored} src={skyUrl} alt="" />
                    <img className={styles.skyTile} src={skyUrl} alt="" />
                    <img className={styles.skyTileMirrored} src={skyUrl} alt="" />
                </div>
            </div>
            <img className={styles.moon} src={moonUrl} alt="" />
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
            {/* Разметка мест на рейде — пятна света, лежащие прямо на воде.
                Показываются, только пока человек выбирает, куда встать. Идут перед кораблями
                и с тем же zIndex: при равном порядке наложения решает разметка, поэтому ближний
                корабль накрывает собой разметку своей дальности, а не наоборот — она на воде,
                он на ней стоит. */}
            {berths?.options.map((berth) => {
                const picked = Boolean(berths.picked && isSameBerth(berth, berths.picked));
                const near = Boolean(nearBerth && isSameBerth(berth, nearBerth));
                return (
                    <div
                        key={berthKey(berth)}
                        className={styles.berthLane}
                        style={{ ...laneStyle(berth, berthWidthPercent(berth.slot)), zIndex: berth.slot + 1 }}
                    >
                        {/* Пятно света есть у выбранного места и у того, что под указателем, —
                            больше ни у кого: весь рейд в пятнах разом читается узором, а не
                            выбором. Стоят они в разметке всегда, даже невидимые: так они
                            проступают и гаснут переходом, а не появляются рывком. */}
                        <div
                            className={[
                                styles.berthMark,
                                near ? styles.berthMarkNear : '',
                                picked ? styles.berthMarkPicked : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                        />
                    </div>
                );
            })}
            {placed.map((member) => {
                const depth = slotDepth(member.place.slot);
                const width = shipWidthPercent(member.place.slot, member.shipKind);
                const leaving = leavingById.current.has(member.memberId);
                const entering = !leaving && enteringIds.current.has(member.memberId);
                // Вид движения нужен и сам по себе, а не только как класс: по нему сцена
                // помечает идущий корабль и понимает, что ход сменился на другой.
                const motionKind = (leaving && 'leaving') || (entering && 'entering') || '';
                const motion = motionKind ? MOTION_CLASS[motionKind] : '';
                // Заход: с той стороны, откуда пришёл, ровно до кромки кадра и ни шагом дальше.
                // Считаем от того места, где корабль на самом деле стоит: стили не дают ему
                // подойти к краю кадра вплотную, и от выбранной точки настоящая отличается.
                const shown = shownLeft(member.place.left, width, zoom);
                const enterPath = pathToEdge(shown, width, zoom, member.place.enterFrom, ENTER_GUARD);
                // Уход: вперёд, а если нос смотрит в остров — задним ходом в другую сторону.
                const leave = leaveCourse(
                    member.place,
                    // Дорогу загораживают те, кто остаётся: сам себе корабль не помеха,
                    // и уходящий сосед тоже — он уже трогается с места.
                    placed
                        .filter(
                            (other) => other.memberId !== member.memberId && !leavingById.current.has(other.memberId)
                        )
                        .map((other) => other.place)
                );
                const leavePath = pathToEdge(shown, width, zoom, leave.side, LEAVE_GUARD);
                const enterSeconds = sailSeconds(enterPath, member.place.slot, member.shipKind, false, zoom);
                // Задний ход отличается только длительностью: кривая та же, а скорость ниже.
                const leaveSeconds = sailSeconds(leavePath, member.place.slot, member.shipKind, leave.astern, zoom);
                // Куда корабль идёт прямо сейчас: заходящий — от своей кромки внутрь кадра,
                // уходящий — к своей.
                const heading = (leaving && leave.side) || (entering && otherSide(member.place.enterFrom)) || '';
                // Дифферент: приподнята та оконечность, которой корабль идёт вперёд. Положительный
                // угол поднимает левый край, поэтому идущему влево он и достаётся.
                const trim =
                    sailTrim(
                        leaving ? leavePath : enterPath,
                        leaving ? leaveSeconds : enterSeconds,
                        member.place.slot,
                        zoom
                    ) * (heading === 'left' ? 1 : -1);
                // Свой корабль открывает форму: там меняются и корабль, и место на рейде.
                // Идущий не открывает: он ещё не пришёл туда, откуда его будут переставлять.
                // Пока форма и так открыта, корабль ничего не открывает и указателем
                // не притворяется: щелчок по воде в этот момент занят выбором места.
                const canEdit = Boolean(onEditShip) && !berths && member.memberId === myId && !leaving && !motion;
                return (
                    // Дорожка во всю ширину кадра: она и возит корабль. Ход и место на рейде
                    // считаются в долях кадра, поэтому и блок нужен шириной с кадр — см. стили.
                    <div
                        key={member.memberId}
                        className={[styles.shipLane, motion].filter(Boolean).join(' ') || undefined}
                        // Конец хода. Событие приходит и от дифферента на вложенном блоке, поэтому
                        // спрашиваем и свойство, и элемент: чужой конец за свой принимать нельзя.
                        onTransitionEnd={
                            motion
                                ? (event) => {
                                      if (event.propertyName === 'translate' && event.target === event.currentTarget) {
                                          finishMotion(member.memberId);
                                      }
                                  }
                                : undefined
                        }
                        data-ship={motionKind ? member.memberId : undefined}
                        data-motion={motionKind || undefined}
                        style={
                            {
                                ...laneStyle(member.place, width),
                                // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                zIndex: member.place.slot + 1,
                                // Ход в процентах ширины кадра: столько корабль смещён от своего
                                // места, когда только появляется из-за кромки. Знак — сторона,
                                // с которой он приходит.
                                '--enter-from': `${member.place.enterFrom === 'right' ? '' : '-'}${enterPath.toFixed(1)}%`,
                                '--enter-seconds': `${enterSeconds.toFixed(1)}s`,
                                '--leave-to': `${leave.side === 'right' ? '' : '-'}${leavePath.toFixed(1)}%`,
                                '--leave-seconds': `${leaveSeconds.toFixed(1)}s`,
                                '--sail-trim': `${trim.toFixed(2)}deg`,
                            } as CSSProperties
                        }
                    >
                        <div
                            className={[styles.shipSlot, canEdit ? styles.shipMine : ''].filter(Boolean).join(' ')}
                            // Чужие корабли не трогаем: рейд общий, но распоряжаться там можно
                            // только собой.
                            onClick={canEdit ? onEditShip : undefined}
                            title={canEdit ? 'Изменить корабль и место на рейде' : undefined}
                            style={{ maxWidth: maxShipWidth(member) }}
                        >
                            {/* Пока выбирают место, занятые подписаны: рейд должен читаться целиком —
                                где свободно, а где уже стоит «Альбатрос». Подпись держится над кораблём
                                и вне качающегося блока: ходить вместе с корпусом ей незачем. */}
                            {berths && <div className={styles.shipName}>{member.name}</div>}
                            {/* Корабль, номер, огни и тень на воде качаются как единое целое: обе анимации
                            висят на одном блоке, потому что двигают разные свойства — translate и rotate. */}
                            <div
                                className={styles.shipRock}
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
                );
            })}
            {/* Слой выбора места: он поверх кораблей, потому что точки должны быть видны
                и сквозь корпус — иначе занятая половина рейда выглядит так, будто мест там нет.
                Указатель ловит вся вода, а достаётся нажатие ближайшей точке. */}
            {berths && (
                <div
                    className={styles.berthField}
                    onPointerMove={trackBerth}
                    onPointerLeave={() => setNearBerth(null)}
                    onClick={pickNearestBerth}
                >
                    <div className={styles.berthWater} />
                    {berths.options.map((berth) => {
                        const picked = Boolean(berths.picked && isSameBerth(berth, berths.picked));
                        const near = Boolean(nearBerth && isSameBerth(berth, nearBerth));
                        const key = berthKey(berth);
                        return (
                            <div
                                key={key}
                                className={styles.berthLane}
                                style={laneStyle(berth, berthWidthPercent(berth.slot))}
                            >
                                <button
                                    type="button"
                                    ref={(element) => {
                                        if (element) {
                                            berthDots.current.set(key, element);
                                        } else {
                                            berthDots.current.delete(key);
                                        }
                                    }}
                                    className={styles.berthDot}
                                    data-berth={key}
                                    aria-pressed={picked}
                                    aria-label={`Место на рейде: ${BERTH_LABELS[berth.corridor]}, ${berth.slot + 1}-я линия`}
                                    // Своя обработка нужна ради клавиатуры: у нажатия с неё нет
                                    // координат, а без них ближайшее место не найти.
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        berths.onPick(berth);
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
                                        className={[
                                            styles.berthDotLight,
                                            near ? styles.berthDotNear : '',
                                            picked ? styles.berthDotPicked : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className={styles.bottomFade} />
        </div>
    );
}
