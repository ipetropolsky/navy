import { CSSProperties, useRef } from 'react';

import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaFrameOneUrl from '@/assets/scene/sea-1.png';
import seaFrameTwoUrl from '@/assets/scene/sea-2.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { Member, MorseFeed } from '@/types/channel';

import { ShipPlacement, VIEWER_SLOT, placeShip, placeViewer, slotDepth } from '@/components/SeaScene/shipPlacement';

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
// два корабля пошли бы в такт. Слотов пять, больше кораблей в сцене не бывает.
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
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ members, myId, morseFeeds }: SeaSceneProps) {
    // Расстановка живёт в памяти вкладки: раз выбранное место корабль не меняет, пока
    // не выйдет из канала. Иначе он переезжал бы при каждой отрисовке — например, когда
    // кто-то просто отправил сообщение.
    const placements = useRef(new Map<string, ShipPlacement>());
    // Кто уже был в кадре. Заплывает только тот, кто вошёл при нас; те, что стояли на рейде
    // до нашего прихода, просто оказываются на месте — въезжать им неоткуда, мы пришли к ним.
    //
    // Отсчёт ведём не от первой отрисовки, а от первой, где корабли вообще появились: пока
    // канал грузится, их нет, и «первым кадром» оказался бы пустой экран — тогда заплывала бы
    // вся эскадра разом при каждом открытии страницы.
    const seenIds = useRef<Set<string> | null>(null);
    const baseline = seenIds.current === null && members.length > 0;
    if (baseline) {
        seenIds.current = new Set(members.map((member) => member.id));
    }

    const me = members.find((member) => member.id === myId);
    const others = members.filter((member) => member.id !== myId).sort((a, b) => a.joinedAt - b.joinedAt);

    // Ушедшие освобождают свои места: слот и коридор снова можно занять.
    const aboard = new Set(members.map((member) => member.id));
    placements.current.forEach((_, id) => {
        if (!aboard.has(id)) {
            placements.current.delete(id);
        }
    });

    if (me && !placements.current.has(me.id)) {
        placements.current.set(me.id, placeViewer());
    }
    others.forEach((member) => {
        if (placements.current.has(member.id)) {
            return;
        }
        const placement = placeShip([...placements.current.values()].filter((item) => item.slot < VIEWER_SLOT));
        if (placement) {
            placements.current.set(member.id, placement);
        }
    });

    const placed = [me, ...others]
        .filter((member): member is Member => Boolean(member))
        .map((member) => ({ member, place: placements.current.get(member.id) }))
        .filter((item): item is { member: Member; place: ShipPlacement } => Boolean(item.place));

    const slotStyle = ({ member, place }: (typeof placed)[number]): CSSProperties => {
        const shipScale = SHIP_SPRITES[member.shipKind].scale;
        const depth = slotDepth(place.slot);
        const width = (20 + depth * 30) * shipScale;
        return {
            // Ширину и кламп «не подходить к краям кадра» досчитывает CSS: там же живёт
            // масштаб для телефонов и отступ от краёв.
            '--slot-left': `${place.left.toFixed(2)}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2}%`,
            // Чем дальше корабль, тем выше он стоит в кадре — это и создаёт перспективу.
            // Ближний не прижимаем к самому низу: под ним нужна вода, иначе он «висит» на краю сцены.
            bottom: `${8 + (1 - depth) * 32}%`,
            maxWidth: (150 + depth * 200) * shipScale,
        } as CSSProperties;
    };

    return (
        <div className={styles.scene}>
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
            {placed.map((item, index) => {
                const depth = slotDepth(item.place.slot);
                const entering = !baseline && seenIds.current !== null && !seenIds.current.has(item.member.id);
                seenIds.current?.add(item.member.id);
                return (
                    <div
                        key={item.member.id}
                        className={entering ? `${styles.shipSlot} ${styles.shipEntering}` : styles.shipSlot}
                        style={
                            {
                                ...slotStyle(item),
                                // Ближний перекрывает дальнего: порядок наложения идёт от слота.
                                zIndex: item.place.slot + 1,
                                // Из-за какого края кадра заплывает. Ход задан в долях ширины экрана,
                                // поэтому старт всегда за кадром, какой бы ширины он ни был.
                                '--enter-from': item.place.enterFrom === 'right' ? '130vw' : '-130vw',
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
                                    '--wave-start': `-${WAVE_STARTS[index].toFixed(2)}s`,
                                    '--heave': `${heaveAmplitude(depth).toFixed(2)}px`,
                                    // Крутизна волны идёт от её высоты, поэтому угол считаем из неё,
                                    // а не из хода корпуса: осадка корабля уклон воды не меняет.
                                    // Знак зависит от того, куда смотрит корабль: положительный
                                    // поворот поднимает левый край, отрицательный — правый, а вверх
                                    // вместе с корпусом должен идти нос, а не корма.
                                    '--pitch-angle': `${(
                                        waveAmplitude(depth) *
                                        PITCH_PER_PX *
                                        (item.place.facing === 'left' ? 1 : -1)
                                    ).toFixed(2)}deg`,
                                } as CSSProperties
                            }
                        >
                            {/* Тень идёт перед кораблём в разметке, поэтому корпус её перекрывает. */}
                            <div className={styles.shipShadow} />
                            <Ship
                                kind={item.member.shipKind}
                                name={item.member.name}
                                hullNumber={item.member.hullNumber}
                                facing={item.place.facing}
                                active={item.member.id === myId}
                                depth={depth}
                                morseFeed={morseFeeds[item.member.id] ?? null}
                            />
                        </div>
                    </div>
                );
            })}
            <div className={styles.bottomFade} />
        </div>
    );
}
