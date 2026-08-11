import { CSSProperties, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';

import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaUrl from '@/assets/scene/sea.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { MOBILE_SHIP_ZOOM } from '@/config/layout';
import { Member, MorseFeed, ShipPlacement, slotDepth } from '@/types/channel';
import { useIsMobile } from '@/utils/viewport';

import { leaveCourse, lengthsToEdge, sailSeconds, shipWidthPercent } from '@/components/SeaScene/shipMotion';

import styles from './SeaScene.module.less';

// Качка живёт тем же циклом, что и вода: 10 секунд на полный круг, и за этот круг корабль
// проходит и подъём со спуском, и оба наклона, возвращаясь ровно в исходное положение.
// Сама длительность живёт в стилях (@wave-seconds) — здесь она нужна только как мерка
// для моментов старта ниже.
//
// Моменты, с которых корабли начинают качку, — секунды внутри цикла. Все они уходят в анимацию
// отрицательной задержкой, то есть отсчитаны в прошлом: корабль появляется уже качающимся,
// а не ждёт начала цикла. Числа выбраны произвольно, но с оглядкой на два условия:
// соседние по времени старты разведены не меньше чем на 1.5с (минимум здесь 1.75с), и это
// расстояние считается по кругу — между последним и первым тоже, иначе на стыке цикла
// два корабля пошли бы в такт. Значений столько же, сколько мест в канале (MAX_MEMBERS),
// и раздаются они по одному на корабль — кто как их получает, описано ниже.
const WAVE_STARTS = [6.15, 0.25, 8.05, 3.85, 2.1];

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

// Промежуток между заходами в показе выхода эскадры. Полторы секунды: корабли идут по одному,
// но зритель не успевает заскучать между ними.
const INTRO_STEP_SECONDS = 1.5;

/** Ждёт загрузки картинки. Не сложилось — тоже ответ: сцену показываем в любом случае. */
const preload = (url: string): Promise<void> =>
    new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
    });

/** Класс с анимацией под каждый вид движения. У стоящего корабля движения нет. */
const MOTION_CLASS: Record<string, string> = {
    leaving: styles.shipLeaving,
    entering: styles.shipEntering,
    shifting: styles.shipShifting,
};

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

interface SeaSceneProps {
    members: Member[];
    myId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
    /** Щелчок по своему кораблю: попросить бэкенд переставить его. */
    onMoveShip?: () => void;
    /**
     * Канал загружен и список кораблей окончательный. Нужен, чтобы отличить «пока пусто,
     * потому что ещё грузимся» от «пусто, потому что на рейде никого»: от этого зависит,
     * заплывёт ли следующий корабль в кадр или просто окажется на месте.
     */
    ready: boolean;
    /**
     * Показать выход эскадры на рейд: корабли, которые уже стоят в канале, заплывают в кадр
     * по очереди, а не оказываются на местах. Так открывается демо-канал — там иначе не увидеть
     * ни захода, ни того, как корабль подходит к месту.
     */
    playIntro?: boolean;
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ members, myId, morseFeeds, ready, playIntro = false, onMoveShip }: SeaSceneProps) {
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
    // Кто переставляется внутри своего слота, и на сколько своих длин ему идти. Знак — сторона.
    const shiftById = useRef(new Map<string, number>());
    // Где корабль нарисован сейчас. Сравнение с местом из канала и говорит, что произошло:
    // сменился слот — перезаход, сменилась только точка — ход поперёк кадра.
    const shownById = useRef(new Map<string, ShipPlacement>());
    // Списки живут в ref, а не в state: они меняются прямо во время отрисовки, до кадра.
    // Через state корабль на один кадр оказался бы на месте, и вход дёргался бы. Убрать
    // же отработавший корабль из разметки без перерисовки нельзя — за этим и счётчик.
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    // Какой момент старта качки закреплён за каким кораблём: индекс в WAVE_STARTS.
    const waveStartById = useRef(new Map<string, number>());
    // На сколько секунд задержан заход корабля в показе выхода эскадры. Пусто во всех
    // остальных случаях: обычный заход начинается сразу.
    const introDelay = useRef(new Map<string, number>());
    // Отложенные заходы после перезахода: id → таймер паузы. Чистим их при размонтировании.
    const pauseTimers = useRef(new Map<string, number>());
    useEffect(
        () => () => {
            pauseTimers.current.forEach((timer) => window.clearTimeout(timer));
        },
        []
    );

    // На телефоне корабли растянуты, и путь у них в метрах длиннее — длительность хода
    // это учитывает, иначе на узком экране флот ходил бы быстрее, чем на широком.
    const zoom = useIsMobile() ? MOBILE_SHIP_ZOOM : 1;

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
        if (playIntro) {
            // Показ: те же корабли, но заплывают. Очередь — от дальнего к ближнему, как будто
            // эскадра подходит к рейду строем, и с промежутком, чтобы заходы не слились в один.
            [...members]
                .sort((a, b) => a.place.slot - b.place.slot)
                .forEach((member, index) => {
                    enteringIds.current.add(member.memberId);
                    introDelay.current.set(member.memberId, index * INTRO_STEP_SECONDS);
                });
        }
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
        // Место сменилось — значит корабль попросили переставить. Перезаходящих пропускаем:
        // у них новое место уже принято, они его отыгрывают.
        const relocated = members.filter((member) => {
            const shown = shownById.current.get(member.memberId);
            return shown && !relocatingIds.current.has(member.memberId) && shown.left !== member.place.left;
        });
        for (const member of relocated) {
            // Место в списке заведомо есть: по нему этот корабль в список и попал.
            const shown = shownById.current.get(member.memberId)!;
            shownById.current.set(member.memberId, member.place);
            if (shown.slot === member.place.slot) {
                // Свой слот, другой коридор: короткий ход поперёк кадра. Запоминаем, откуда
                // корабль пошёл, — дальше стили доведут его до нынешней точки.
                shiftById.current.set(member.memberId, shown.left);
            } else {
                // Другой слот: туда не переползают, туда перезаходят — уход, пауза, вход.
                leavingById.current.set(member.memberId, { ...member, place: shown });
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

    // Момент старта качки закреплён за кораблём, а не за его местом в списке: иначе ушедший
    // сосед сдвигал бы фазу всем, кто стоял за ним, и они дёргались бы на ровном месте.
    // Каждому новому достаётся первый свободный момент, освободившиеся возвращаются в оборот, —
    // так корабли и не совпадают по фазе, и не зависят друг от друга.
    const waveStarts = waveStartById.current;
    const aboard = new Set(placed.map((member) => member.memberId));
    for (const id of [...waveStarts.keys()]) {
        if (!aboard.has(id)) {
            waveStarts.delete(id);
        }
    }
    const takenStarts = new Set(waveStarts.values());
    for (const member of placed) {
        if (!waveStarts.has(member.memberId)) {
            // Если кораблей вдруг больше, чем моментов, последний момент достаётся всем
            // оставшимся: два корабля пойдут в такт, что некрасиво, но не сломано.
            const free = WAVE_STARTS.findIndex((_, index) => !takenStarts.has(index));
            const start = free === -1 ? WAVE_STARTS.length - 1 : free;
            waveStarts.set(member.memberId, start);
            takenStarts.add(start);
        }
    }

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

    // Отметку ставим в layout-эффекте, до кадра: он выполняется и в фоновой вкладке, поэтому
    // момент старта запоминается настоящий, а не тот, в который на вкладку вернулись.
    useLayoutEffect(() => {
        const now = Date.now();
        movingShips().forEach(({ id, kind }) => {
            if (motionStartedAt.current.get(id)?.kind !== kind) {
                motionStartedAt.current.set(id, { kind, at: now });
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
     * Движение отработало. Класс снимаем всегда — иначе следующее движение того же корабля
     * не запустится: одна и та же анимация повторно не стартует, пока класс висит на месте.
     *
     * Уходящий на этом пропадает из кадра. А если он не вышел из канала, а перезаходит,
     * то ждёт за кромкой паузу и появляется на новом месте — заходом, как новичок.
     */
    const finishMotion = (id: string): void => {
        motionStartedAt.current.delete(id);
        enteringIds.current.delete(id);
        shiftById.current.delete(id);
        if (!leavingById.current.has(id)) {
            redraw();
            return;
        }
        if (!relocatingIds.current.has(id)) {
            leavingById.current.delete(id);
            redraw();
            return;
        }
        pauseTimers.current.set(
            id,
            window.setTimeout(() => {
                pauseTimers.current.delete(id);
                leavingById.current.delete(id);
                relocatingIds.current.delete(id);
                enteringIds.current.add(id);
                redraw();
            }, RELOCATE_PAUSE_MS)
        );
    };

    const slotStyle = (member: Member, width: number): CSSProperties => {
        const shipScale = SHIP_SPRITES[member.shipKind].scale;
        const depth = slotDepth(member.place.slot);
        return {
            // Ширину и кламп «не подходить к краям кадра» досчитывает CSS: там же живёт
            // масштаб для телефонов и отступ от краёв.
            '--slot-left': `${member.place.left.toFixed(2)}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2}%`,
            // Чем дальше корабль, тем выше он стоит в кадре — это и создаёт перспективу.
            // Отсчёт идёт от воды, а не от низа сцены: воды на телефоне 58% высоты сцены,
            // а на десктопе 44%, и от низа сцены корабли жались бы к нижнему краю, оставляя
            // у горизонта пустую полосу. Сами доли живут в стилях (--sea-near-edge,
            // --sea-depth-span) и на телефоне шире: там воды больше, и флоту надо разойтись
            // по всей её высоте, а не толпиться в середине.
            bottom: `calc((100% - var(--horizon)) * (var(--sea-near-edge) + ${(1 - depth).toFixed(4)} * var(--sea-depth-span)))`,
            maxWidth: (150 + depth * 200) * shipScale,
        } as CSSProperties;
    };

    return (
        <div className={painted ? `${styles.scene} ${styles.scenePainted}` : styles.scene} ref={sceneRef}>
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
            <div className={styles.sea}>
                <div className={styles.seaStrip}>{seaTiles}</div>
                <div className={styles.seaStripMirrored}>{seaTiles}</div>
            </div>
            {/* Остров стоит на воде ниже горизонта, за ним видно море. Отражение уже есть в картинке. */}
            <img className={styles.island} src={islandUrl} alt="" />
            {placed.map((member) => {
                const depth = slotDepth(member.place.slot);
                const width = shipWidthPercent(member.place.slot, member.shipKind);
                const leaving = leavingById.current.has(member.memberId);
                const entering = !leaving && enteringIds.current.has(member.memberId);
                // Откуда корабль пошёл, если он сейчас переходит в соседний коридор.
                const shiftFrom = leaving ? undefined : shiftById.current.get(member.memberId);
                // Вид движения нужен и сам по себе, а не только как класс: по нему сцена
                // помечает идущий корабль и понимает, что ход сменился на другой.
                const motionKind =
                    (leaving && 'leaving') || (entering && 'entering') || (shiftFrom !== undefined && 'shifting') || '';
                const motion = motionKind ? MOTION_CLASS[motionKind] : '';
                // Заход: с той стороны, откуда пришёл, ровно до кромки кадра и ни шагом дальше.
                const enterLengths = lengthsToEdge(member.place.left, width, member.place.enterFrom);
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
                const leaveLengths = lengthsToEdge(member.place.left, width, leave.side);
                // Ход поперёк кадра: вперёд, если идти туда же, куда смотрит нос, иначе задним.
                // Старт правее нынешнего места — корабль идёт влево.
                const shiftLengths = shiftFrom === undefined ? 0 : Math.abs(shiftFrom - member.place.left) / width;
                const shiftAstern =
                    shiftFrom !== undefined && shiftFrom > member.place.left !== (member.place.facing === 'left');
                // Корабль на ходу приказов не принимает: щелчок посреди манёвра сорвал бы анимацию
                // и швырнул корабль в конечную точку, откуда тот пошёл бы заново.
                const canMove = member.memberId === myId && !leaving && !motion;
                return (
                    <div
                        key={member.memberId}
                        className={
                            [styles.shipSlot, motion, canMove ? styles.shipMine : ''].filter(Boolean).join(' ') ||
                            undefined
                        }
                        // Свой корабль по щелчку снимается с места. Чужие не трогаем: рейд общий,
                        // но распоряжаться там можно только собой.
                        onClick={canMove ? onMoveShip : undefined}
                        title={canMove ? 'Сменить место на рейде' : undefined}
                        onAnimationEnd={motion ? () => finishMotion(member.memberId) : undefined}
                        data-ship={motionKind ? member.memberId : undefined}
                        data-motion={motionKind || undefined}
                        style={
                            {
                                ...slotStyle(member, width),
                                // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                zIndex: member.place.slot + 1,
                                // Ход в процентах — это доли собственной ширины корабля, то есть
                                // прямо длины корпуса: «180%» значит «полторы длины и ещё немного».
                                // Считаем ровно до кромки кадра, чтобы корабль не проводил половину
                                // прогона за экраном и чтобы длительность отвечала пройденному пути.
                                '--enter-from': `${member.place.enterFrom === 'right' ? '' : '-'}${(
                                    enterLengths * 100
                                ).toFixed(0)}%`,
                                '--enter-seconds': `${sailSeconds(enterLengths, member.place.slot, member.shipKind, false, zoom).toFixed(1)}s`,
                                '--enter-delay': `${introDelay.current.get(member.memberId) ?? 0}s`,
                                '--leave-to': `${leave.side === 'right' ? '' : '-'}${(leaveLengths * 100).toFixed(0)}%`,
                                // Задний ход отличается только длительностью: кривая та же,
                                // а скорость ниже — иначе замер пиковой скорости под неё не подходит.
                                '--leave-seconds': `${sailSeconds(leaveLengths, member.place.slot, member.shipKind, leave.astern, zoom).toFixed(1)}s`,
                                // Ход поперёк кадра: откуда корабль пошёл и сколько ему идти.
                                // Здесь именно положение в кадре, а не сдвиг: стили доводят
                                // корабль до нынешнего --slot-left, и промежуточные значения
                                // проходят через тот же кламп, что и конечное. Сдвигом это
                                // не выразить — translate считается от ширины самого корабля,
                                // а её ограничивает max-width, отчего в начале хода корабль
                                // прыгал на десяток пикселей.
                                '--shift-from': `${(shiftFrom ?? member.place.left).toFixed(2)}%`,
                                '--shift-seconds': `${sailSeconds(shiftLengths, member.place.slot, member.shipKind, shiftAstern, zoom).toFixed(1)}s`,
                            } as CSSProperties
                        }
                    >
                        {/* Корабль, номер, огни и тень на воде качаются как единое целое: обе анимации
                        висят на одном блоке, потому что двигают разные свойства — translate и rotate. */}
                        <div
                            className={styles.shipRock}
                            style={
                                {
                                    // Минус — момент старта в прошлом: корабль появляется уже качающимся.
                                    // Отсюда же CSS считает задержку тангажа, отняв четверть цикла.
                                    '--wave-start': `-${WAVE_STARTS[waveStarts.get(member.memberId) ?? 0].toFixed(2)}s`,
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
                );
            })}
            <div className={styles.bottomFade} />
        </div>
    );
}
