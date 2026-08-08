import islandFarUrl from '@/assets/scene/island-far.png';
import islandMidUrl from '@/assets/scene/island-mid.png';
import islandNearUrl from '@/assets/scene/island-near.png';
import seaUrl from '@/assets/scene/sea.png';
import skyUrl from '@/assets/scene/sky.png';
import Ship from '@/components/ships/Ship';
import ShipReflection from '@/components/ships/ShipReflection';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
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

const VIEWER_SLOT: SceneSlot = { left: 56, depth: 1, facing: 'left' };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 18, depth: 0.48, facing: 'left' },
    { left: 86, depth: 0.56, facing: 'right' },
    { left: 40, depth: 0.28, facing: 'right' },
    { left: 66, depth: 0.13, facing: 'left' },
];

interface SeaSceneProps {
    participants: Participant[];
    viewerId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
}

/** Ночное море: слои неба и воды, острова и корабли-участники на рейде. */
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
        return {
            left: `${slot.left}%`,
            bottom: `${4 + (1 - slot.depth) * 36}%`,
            width: `${(20 + slot.depth * 30) * shipScale}%`,
            maxWidth: (150 + slot.depth * 200) * shipScale,
        };
    };

    return (
        <div className={styles.scene}>
            <img className={styles.sky} src={skyUrl} alt="" />
            <img className={styles.islandFar} src={islandFarUrl} alt="" />
            <img className={styles.islandMid} src={islandMidUrl} alt="" />
            <img className={styles.islandNear} src={islandNearUrl} alt="" />
            <img className={styles.sea} src={seaUrl} alt="" />
            <img className={styles.islandReflection} src={islandNearUrl} alt="" />
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
