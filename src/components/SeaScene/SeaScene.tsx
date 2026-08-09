import { CSSProperties } from 'react';

import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaFrameOneUrl from '@/assets/scene/sea-1.png';
import seaFrameTwoUrl from '@/assets/scene/sea-2.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import { MorseFeed, Participant } from '@/types/chat';

import styles from './SeaScene.module.less';

interface SceneSlot {
    /** Горизонтальный центр корабля, % ширины сцены. */
    left: number;
    /** Глубина: 1 — ближний план, 0 — у горизонта. */
    depth: number;
    facing: 'left' | 'right';
}

const VIEWER_SLOT: SceneSlot = { left: 56, depth: 1, facing: 'left' };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 18, depth: 0.48, facing: 'left' },
    { left: 86, depth: 0.56, facing: 'right' },
    { left: 40, depth: 0.28, facing: 'right' },
    { left: 66, depth: 0.13, facing: 'left' },
];

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
const waveAmplitude = (slot: SceneSlot) => WAVE_FAR + slot.depth * (WAVE_NEAR - WAVE_FAR);

/** Ход корпуса по вертикали, px: та же прямая, но у переднего плана вдвое положе. */
const heaveAmplitude = (slot: SceneSlot) => HEAVE_FAR + slot.depth * (HEAVE_NEAR - HEAVE_FAR);

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
    participants: Participant[];
    viewerId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
}

/** Ночное море: слои неба, месяца, облаков, острова и воды с кораблями-участниками. */
export default function SeaScene({ participants, viewerId, morseFeeds }: SeaSceneProps) {
    const viewer = participants.find((participant) => participant.id === viewerId);
    const others = participants
        .filter((participant) => participant.id !== viewerId)
        .sort((a, b) => a.joinedAt - b.joinedAt);

    const placed: { participant: Participant; slot: SceneSlot }[] = [];
    if (viewer) {
        placed.push({ participant: viewer, slot: VIEWER_SLOT });
    }
    others.forEach((participant, index) => {
        const slot = OTHER_SLOTS[index];
        if (slot) {
            placed.push({ participant, slot });
        }
    });

    const slotStyle = ({ participant, slot }: (typeof placed)[number]): CSSProperties => {
        const shipScale = SHIP_SPRITES[participant.shipKind].scale;
        const width = (20 + slot.depth * 30) * shipScale;
        return {
            // Ширину и кламп «не выходить за кадр» досчитывает CSS: там же живёт масштаб для телефонов.
            '--slot-left': `${slot.left}%`,
            '--slot-width': `${width}%`,
            '--slot-half': `${width / 2 + 1}%`,
            // Чем дальше корабль, тем выше он стоит в кадре — это и создаёт перспективу.
            // Ближний не прижимаем к самому низу: под ним нужна вода, иначе он «висит» на краю сцены.
            bottom: `${8 + (1 - slot.depth) * 32}%`,
            maxWidth: (150 + slot.depth * 200) * shipScale,
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
            {placed.map((item, index) => (
                <div
                    key={item.participant.id}
                    className={styles.shipSlot}
                    style={{ ...slotStyle(item), zIndex: Math.max(Math.round(item.slot.depth * 10), 1) }}
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
                                '--heave': `${heaveAmplitude(item.slot).toFixed(2)}px`,
                                // Крутизна волны идёт от её высоты, поэтому угол считаем из неё,
                                // а не из хода корпуса: осадка корабля уклон воды не меняет.
                                // Знак зависит от того, куда смотрит корабль: положительный
                                // поворот поднимает левый край, отрицательный — правый, а вверх
                                // вместе с корпусом должен идти нос, а не корма.
                                '--pitch-angle': `${(
                                    waveAmplitude(item.slot) *
                                    PITCH_PER_PX *
                                    (item.slot.facing === 'left' ? 1 : -1)
                                ).toFixed(2)}deg`,
                            } as CSSProperties
                        }
                    >
                        {/* Тень идёт перед кораблём в разметке, поэтому корпус её перекрывает. */}
                        <div className={styles.shipShadow} />
                        <Ship
                            kind={item.participant.shipKind}
                            name={item.participant.name}
                            hullNumber={item.participant.hullNumber}
                            facing={item.slot.facing}
                            active={item.participant.id === viewerId}
                            depth={item.slot.depth}
                            morseFeed={morseFeeds[item.participant.id] ?? null}
                        />
                    </div>
                </div>
            ))}
            <div className={styles.bottomFade} />
        </div>
    );
}
