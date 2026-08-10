import { CSSProperties, useEffect, useReducer, useRef, useState } from 'react';

import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaFrameOneUrl from '@/assets/scene/sea-1.png';
import seaFrameTwoUrl from '@/assets/scene/sea-2.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { Member, MorseFeed, slotDepth } from '@/types/channel';

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

// Снимки воды: одно и то же море с разной рябью. Показываются по кругу в этом порядке.
const SEA_FRAMES = [seaFrameOneUrl, seaFrameTwoUrl];

// Задники сцены. Пока они грузятся, показывать нечего: небо, вода и остров весят мегабайтами
// и приходят вразнобой, так что сцена собиралась бы на глазах — сперва пустая синева, потом
// небо, потом вода. Дожидаемся всех и проявляем разом.
//
// Кораблей в этом списке нет намеренно: их картинки лёгкие, а ждать их — значит держать
// пустое море дольше нужного. Появление одного корабля глаз почти не ловит.
const SCENE_IMAGES = [skyUrl, moonUrl, cloudFarUrl, cloudNearUrl, islandUrl, ...SEA_FRAMES];

/** Ждёт загрузки картинки. Не сложилось — тоже ответ: сцену показываем в любом случае. */
const preload = (url: string): Promise<void> =>
    new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = url;
    });

/**
 * Плитка воды: снимки ряби линейно перетекают друг в друга по кругу, сама сцена
 * при этом стоит на месте. Слоёв на один больше, чем снимков: последний повторяет
 * первый, поэтому к концу круга сверху лежит ровно то же, что в его начале, —
 * и общий сброс анимации на стыке не виден.
 */
function SeaTile({ mirrored = false }: { mirrored?: boolean }) {
    return (
        <div
            className={mirrored ? styles.seaTileMirrored : styles.seaTile}
            style={{ '--frames': SEA_FRAMES.length } as CSSProperties}
        >
            {[...SEA_FRAMES, SEA_FRAMES[0]].map((url, index) => (
                <div
                    key={`${url}-${index}`}
                    className={styles.seaFrame}
                    style={{ backgroundImage: `url(${url})`, '--frame-index': index } as CSSProperties}
                />
            ))}
        </div>
    );
}

interface SeaSceneProps {
    members: Member[];
    myId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
    /**
     * Канал загружен и список кораблей окончательный. Нужен, чтобы отличить «пока пусто,
     * потому что ещё грузимся» от «пусто, потому что на рейде никого»: от этого зависит,
     * заплывёт ли следующий корабль в кадр или просто окажется на месте.
     */
    ready: boolean;
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ members, myId, morseFeeds, ready }: SeaSceneProps) {
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
    const leavingById = useRef(new Map<string, Member>());
    // Списки живут в ref, а не в state: они меняются прямо во время отрисовки, до кадра.
    // Через state корабль на один кадр оказался бы на месте, и вход дёргался бы. Убрать
    // же отработавший корабль из разметки без перерисовки нельзя — за этим и счётчик.
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    // Какой момент старта качки закреплён за каким кораблём: индекс в WAVE_STARTS.
    const waveStartById = useRef(new Map<string, number>());

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
        seenIds.current = new Set(members.map((member) => member.id));
    } else if (seenIds.current) {
        for (const member of members) {
            if (!seenIds.current.has(member.id)) {
                seenIds.current.add(member.id);
                enteringIds.current.add(member.id);
            }
        }
        // Пропал из канала — значит вышел. Только пока канал открыт: на переходе на главную
        // корабли исчезают все разом, и провожать всю эскадру за горизонт незачем.
        if (ready) {
            for (const member of known.current) {
                if (!members.some((item) => item.id === member.id)) {
                    leavingById.current.set(member.id, member);
                }
            }
        }
    }
    known.current = members;
    for (const member of members) {
        // Вернулся тем же id (например, пока шла его же анимация ухода) — уходить он передумал.
        leavingById.current.delete(member.id);
    }

    // Порядок отрисовки — от дальнего к ближнему: ближний перекрывает дальнего.
    // Уходящие рисуются вместе со всеми: пока корабль в кадре, он такой же корабль.
    const placed = [...members, ...leavingById.current.values()].sort((a, b) => a.place.slot - b.place.slot);

    // Момент старта качки закреплён за кораблём, а не за его местом в списке: иначе ушедший
    // сосед сдвигал бы фазу всем, кто стоял за ним, и они дёргались бы на ровном месте.
    // Каждому новому достаётся первый свободный момент, освободившиеся возвращаются в оборот, —
    // так корабли и не совпадают по фазе, и не зависят друг от друга.
    const waveStarts = waveStartById.current;
    const aboard = new Set(placed.map((member) => member.id));
    for (const id of [...waveStarts.keys()]) {
        if (!aboard.has(id)) {
            waveStarts.delete(id);
        }
    }
    const takenStarts = new Set(waveStarts.values());
    for (const member of placed) {
        if (!waveStarts.has(member.id)) {
            // Если кораблей вдруг больше, чем моментов, последний момент достаётся всем
            // оставшимся: два корабля пойдут в такт, что некрасиво, но не сломано.
            const free = WAVE_STARTS.findIndex((_, index) => !takenStarts.has(index));
            const start = free === -1 ? WAVE_STARTS.length - 1 : free;
            waveStarts.set(member.id, start);
            takenStarts.add(start);
        }
    }

    const slotStyle = (member: Member): CSSProperties => {
        const shipScale = SHIP_SPRITES[member.shipKind].scale;
        const depth = slotDepth(member.place.slot);
        const width = (20 + depth * 30) * shipScale;
        return {
            // Ширину и кламп «не подходить к краям кадра» досчитывает CSS: там же живёт
            // масштаб для телефонов и отступ от краёв.
            '--slot-left': `${member.place.left.toFixed(2)}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2}%`,
            // Чем дальше корабль, тем выше он стоит в кадре — это и создаёт перспективу.
            // Ближний не прижимаем к самому низу: под ним нужна вода, иначе он «висит» на краю сцены.
            bottom: `${8 + (1 - depth) * 32}%`,
            maxWidth: (150 + depth * 200) * shipScale,
        } as CSSProperties;
    };

    return (
        <div className={painted ? `${styles.scene} ${styles.scenePainted}` : styles.scene}>
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
            <div className={styles.sea}>
                {/* Вода собрана так же, как небо: полосу можно двигать по горизонтали. */}
                <div className={styles.seaStrip}>
                    <SeaTile mirrored />
                    <SeaTile />
                    <SeaTile mirrored />
                </div>
            </div>
            {/* Остров стоит на воде ниже горизонта, за ним видно море. Отражение уже есть в картинке. */}
            <img className={styles.island} src={islandUrl} alt="" />
            {placed.map((member) => {
                const depth = slotDepth(member.place.slot);
                const leaving = leavingById.current.has(member.id);
                const entering = !leaving && enteringIds.current.has(member.id);
                const motion = (leaving && styles.shipLeaving) || (entering && styles.shipEntering) || '';
                return (
                    <div
                        key={member.id}
                        className={motion ? `${styles.shipSlot} ${motion}` : styles.shipSlot}
                        // Пришёл или ушёл — вычёркиваем: перерисовки больше не должны считать
                        // его ни новичком, ни уходящим. Ушедший на этом и пропадает из кадра,
                        // для чего и нужна перерисовка; вошедший просто теряет класс.
                        onAnimationEnd={
                            motion
                                ? () => {
                                      enteringIds.current.delete(member.id);
                                      if (leavingById.current.delete(member.id)) {
                                          redraw();
                                      }
                                  }
                                : undefined
                        }
                        style={
                            {
                                ...slotStyle(member),
                                // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                zIndex: member.place.slot + 1,
                                // Из-за какого края кадра заплывает. Ход задан в долях ширины экрана,
                                // поэтому старт всегда за кадром, какой бы ширины он ни был.
                                '--enter-from': member.place.enterFrom === 'right' ? '130vw' : '-130vw',
                                // Уходит в ту сторону, куда смотрит нос: разворачиваться незачем.
                                '--leave-to': member.place.facing === 'right' ? '130vw' : '-130vw',
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
                                    '--wave-start': `-${WAVE_STARTS[waveStarts.get(member.id) ?? 0].toFixed(2)}s`,
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
                                active={member.id === myId}
                                depth={depth}
                                morseFeed={morseFeeds[member.id] ?? null}
                            />
                        </div>
                    </div>
                );
            })}
            <div className={styles.bottomFade} />
        </div>
    );
}
