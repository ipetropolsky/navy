import cloud1Url from '@/assets/scene/cloud-1.png';
import cloud2Url from '@/assets/scene/cloud-2.png';
import islandFarUrl from '@/assets/scene/island-far.png';
import islandMidUrl from '@/assets/scene/island-mid.png';
import islandNearUrl from '@/assets/scene/island-near.png';
import moonUrl from '@/assets/scene/moon.png';
import orionUrl from '@/assets/scene/orion.png';
import seaUrl from '@/assets/scene/sea.png';
import skyUrl from '@/assets/scene/sky.png';
import starsUrl from '@/assets/scene/stars.png';
import wave1Url from '@/assets/scene/wave-1.png';
import wave2Url from '@/assets/scene/wave-2.png';
import wave3Url from '@/assets/scene/wave-3.png';
import wave4Url from '@/assets/scene/wave-4.png';
import wave5Url from '@/assets/scene/wave-5.png';
import wave6Url from '@/assets/scene/wave-6.png';
import wave7Url from '@/assets/scene/wave-7.png';
import wave8Url from '@/assets/scene/wave-8.png';
import Ship from '@/components/ships/Ship';
import ShipReflection from '@/components/ships/ShipReflection';
import { SHIP_SHAPES } from '@/components/ships/shipShapes';
import { AUTHOR_COLORS } from '@/data/demo';
import { MorseFeed, Participant } from '@/types/chat';

import styles from './SeaScene.module.less';

interface SceneSlot {
    /** Горизонтальный центр корабля, % ширины сцены. */
    left: number;
    /** Глубина: 1 — ближний план, 0 — у горизонта. */
    depth: number;
    facing: 'left' | 'right';
}

const VIEWER_SLOT: SceneSlot = { left: 58, depth: 1, facing: 'right' };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 32, depth: 0.55, facing: 'right' },
    { left: 80, depth: 0.66, facing: 'left' },
    { left: 10, depth: 0.4, facing: 'right' },
    { left: 88, depth: 0.22, facing: 'left' },
];

const WAVE_URLS = [wave1Url, wave2Url, wave3Url, wave4Url, wave5Url, wave6Url, wave7Url, wave8Url];

// Статичная раскладка бликов-волн: позиции в % слоя моря, ниже — крупнее (перспектива).
interface WavePlacement {
    variant: number;
    left: number;
    top: number;
    width: number;
    flip?: boolean;
}

const WAVE_PLACEMENTS: WavePlacement[] = [
    { variant: 3, left: 8, top: 6, width: 120 },
    { variant: 7, left: 46, top: 4, width: 100, flip: true },
    { variant: 1, left: 74, top: 9, width: 140 },
    { variant: 6, left: 24, top: 16, width: 150 },
    { variant: 8, left: 60, top: 20, width: 170, flip: true },
    { variant: 2, left: 4, top: 28, width: 180 },
    { variant: 4, left: 42, top: 33, width: 200 },
    { variant: 5, left: 78, top: 38, width: 190 },
    { variant: 1, left: 14, top: 48, width: 230, flip: true },
    { variant: 3, left: 56, top: 55, width: 260 },
    { variant: 8, left: 6, top: 66, width: 280 },
    { variant: 4, left: 66, top: 72, width: 300, flip: true },
    { variant: 2, left: 30, top: 82, width: 340 },
    { variant: 7, left: 70, top: 90, width: 320, flip: true },
];

interface SeaSceneProps {
    participants: Participant[];
    viewerId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
}

/** Ночное море из отдельных слоёв-ассетов: небо, звёзды, месяц, облака, острова, волны, корабли. */
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

    const slotStyle = ({ participant, slot }: (typeof placed)[number]) => {
        const shipScale = SHIP_SHAPES[participant.shipKind].scale;
        const widthPct = (slot.depth === 1 ? 52 : 21 + slot.depth * 26) * shipScale;
        return {
            left: `${slot.left}%`,
            bottom: `${6 + (1 - slot.depth) * 36}%`,
            width: `${widthPct}%`,
            maxWidth: (170 + slot.depth * 170) * shipScale,
        };
    };

    return (
        <div className={styles.scene}>
            <img className={styles.sky} src={skyUrl} alt="" />
            <img className={styles.stars} src={starsUrl} alt="" />
            <img className={styles.orion} src={orionUrl} alt="" />
            <img className={styles.moon} src={moonUrl} alt="" />
            <img className={styles.cloudLeft} src={cloud1Url} alt="" />
            <img className={styles.cloudRight} src={cloud2Url} alt="" />
            <img className={styles.islandFar} src={islandFarUrl} alt="" />
            <img className={styles.islandMid} src={islandMidUrl} alt="" />
            <img className={styles.islandNear} src={islandNearUrl} alt="" />
            <img className={styles.sea} src={seaUrl} alt="" />
            <img className={styles.islandReflection} src={islandNearUrl} alt="" />
            <div className={styles.waves}>
                {WAVE_PLACEMENTS.map((wave) => (
                    <img
                        key={`${wave.variant}-${wave.left}-${wave.top}`}
                        className={styles.wave}
                        src={WAVE_URLS[wave.variant - 1]}
                        style={{
                            left: `${wave.left}%`,
                            top: `${wave.top}%`,
                            width: wave.width,
                            transform: wave.flip ? 'translateX(-50%) scaleX(-1)' : 'translateX(-50%)',
                        }}
                        alt=""
                    />
                ))}
            </div>
            <div className={styles.reflections}>
                {placed.map((item) => (
                    <div key={item.participant.id} className={styles.reflectionSlot} style={slotStyle(item)}>
                        <ShipReflection kind={item.participant.shipKind} facing={item.slot.facing} />
                    </div>
                ))}
            </div>
            {placed.map((item) => (
                <div
                    key={item.participant.id}
                    className={styles.shipSlot}
                    style={{ ...slotStyle(item), zIndex: Math.max(Math.round(item.slot.depth * 10), 1) }}
                >
                    <div className={styles.shipFloat} style={{ animationDelay: `${(item.slot.left % 4) * 1.1}s` }}>
                        <Ship
                            kind={item.participant.shipKind}
                            name={item.participant.name}
                            facing={item.slot.facing}
                            active={item.participant.id === viewerId}
                            depth={item.slot.depth}
                            nameColor={AUTHOR_COLORS[participants.indexOf(item.participant) % AUTHOR_COLORS.length]}
                            morseFeed={morseFeeds[item.participant.id] ?? null}
                        />
                    </div>
                </div>
            ))}
            <div className={styles.bottomFade} />
        </div>
    );
}
