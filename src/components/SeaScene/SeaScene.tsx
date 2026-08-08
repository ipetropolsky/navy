import cloudFarUrl from '@/assets/scene/cloud-1.png';
import cloudNearUrl from '@/assets/scene/cloud-2.png';
import islandUrl from '@/assets/scene/island.png';
import moonUrl from '@/assets/scene/moon.png';
import seaUrl from '@/assets/scene/sea.png';
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
    /** Период качки, с. У всех разный, чтобы корабли не сходились в такт. */
    bob: number;
}

const VIEWER_SLOT: SceneSlot = { left: 56, depth: 1, facing: 'left', bob: 7.3 };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 18, depth: 0.48, facing: 'left', bob: 6.1 },
    { left: 86, depth: 0.56, facing: 'right', bob: 8.7 },
    { left: 40, depth: 0.28, facing: 'right', bob: 5.4 },
    { left: 66, depth: 0.13, facing: 'left', bob: 9.8 },
];

// Стартовые сдвиги фаз качки: даже при близких периодах корабли расходятся сразу.
const BOB_PHASE_STEP = 1.7;

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

    const slotStyle = ({ participant, slot }: (typeof placed)[number]) => {
        const shipScale = SHIP_SPRITES[participant.shipKind].scale;
        const width = (20 + slot.depth * 30) * shipScale;
        // Корабль не должен выходить за края сцены, поэтому центр держим на полширины от кромки.
        const margin = width / 2 + 1;
        return {
            left: `${Math.min(Math.max(slot.left, margin), 100 - margin)}%`,
            bottom: `${4 + (1 - slot.depth) * 36}%`,
            width: `${width}%`,
            maxWidth: (150 + slot.depth * 200) * shipScale,
        };
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
                    <img className={styles.seaTileMirrored} src={seaUrl} alt="" />
                    <img className={styles.seaTile} src={seaUrl} alt="" />
                    <img className={styles.seaTileMirrored} src={seaUrl} alt="" />
                </div>
            </div>
            {/* Остров стоит на воде ниже горизонта, за ним видно море; под ним — размытое отражение. */}
            <div className={styles.islandGroup}>
                <img className={styles.island} src={islandUrl} alt="" />
                <img className={styles.islandReflection} src={islandUrl} alt="" />
            </div>
            {placed.map((item, index) => (
                <div
                    key={item.participant.id}
                    className={styles.shipSlot}
                    style={{ ...slotStyle(item), zIndex: Math.max(Math.round(item.slot.depth * 10), 1) }}
                >
                    {/* Тень на воде остаётся на месте, пока корабль качается. */}
                    <div className={styles.shipShadow} />
                    {/* Корабль вместе с номером, лампой и огнями качается как единое целое. */}
                    <div
                        className={styles.shipFloat}
                        style={{
                            animationDuration: `${item.slot.bob}s`,
                            animationDelay: `-${(index * BOB_PHASE_STEP).toFixed(2)}s`,
                        }}
                    >
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
