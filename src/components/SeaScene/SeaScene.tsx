import Ship from '@/components/ships/Ship';
import { MorseFeed, Participant } from '@/types/chat';

import styles from './SeaScene.module.less';

interface SceneSlot {
    /** Горизонтальный центр корабля, % ширины сцены. */
    left: number;
    /** Глубина: 1 — ближний план, 0 — у горизонта. */
    depth: number;
    facing: 'left' | 'right';
}

const VIEWER_SLOT: SceneSlot = { left: 34, depth: 1, facing: 'right' };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 76, depth: 0.55, facing: 'left' },
    { left: 16, depth: 0.4, facing: 'right' },
    { left: 50, depth: 0.24, facing: 'left' },
    { left: 85, depth: 0.16, facing: 'right' },
];

const STARS = [
    { x: 4, y: 12, s: 2, d: 0 },
    { x: 9, y: 34, s: 1, d: 1.2 },
    { x: 14, y: 8, s: 1, d: 2.1 },
    { x: 19, y: 26, s: 2, d: 0.6 },
    { x: 24, y: 15, s: 1, d: 2.8 },
    { x: 29, y: 38, s: 1, d: 1.7 },
    { x: 33, y: 6, s: 2, d: 0.3 },
    { x: 38, y: 22, s: 1, d: 2.4 },
    { x: 43, y: 33, s: 1, d: 1.1 },
    { x: 47, y: 11, s: 2, d: 3.2 },
    { x: 52, y: 28, s: 1, d: 0.9 },
    { x: 57, y: 7, s: 1, d: 2.0 },
    { x: 61, y: 19, s: 2, d: 1.5 },
    { x: 76, y: 30, s: 1, d: 0.4 },
    { x: 81, y: 9, s: 1, d: 2.6 },
    { x: 86, y: 24, s: 2, d: 1.9 },
    { x: 91, y: 14, s: 1, d: 0.8 },
    { x: 95, y: 36, s: 1, d: 3.0 },
    { x: 98, y: 5, s: 2, d: 1.4 },
];

interface SeaSceneProps {
    participants: Participant[];
    viewerId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
}

/** Ночное море: небо со звёздами, луна с лунной дорожкой, остров и корабли-участники. */
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

    return (
        <div className={styles.scene}>
            <div className={styles.sky}>
                {STARS.map((star) => (
                    <i
                        key={`${star.x}-${star.y}`}
                        className={styles.star}
                        style={{
                            left: `${star.x}%`,
                            top: `${star.y}%`,
                            width: star.s,
                            height: star.s,
                            animationDelay: `${star.d}s`,
                        }}
                    />
                ))}
                <div className={styles.cloud} />
                <div className={styles.moon} />
                <svg className={styles.island} viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M0 40 L0 37 Q10 33 22 34 Q34 22 56 27 Q70 16 92 24 Q114 20 130 29 Q146 33 160 36 L160 40 Z" />
                </svg>
            </div>
            <div className={styles.water}>
                <div className={styles.moonGlade} />
                <div className={styles.ripples} />
            </div>
            {placed.map(({ participant, slot }, index) => (
                <div
                    key={participant.id}
                    className={styles.shipSlot}
                    style={{
                        left: `${slot.left}%`,
                        bottom: `${5 + (1 - slot.depth) * 40}%`,
                        zIndex: Math.round(slot.depth * 10),
                        width: slot.depth === 1 ? '50%' : `${24 + slot.depth * 24}%`,
                        maxWidth: slot.depth === 1 ? 330 : 160 + slot.depth * 120,
                    }}
                >
                    <div className={styles.shipFloat} style={{ animationDelay: `${index * 1.3}s` }}>
                        <Ship
                            kind={participant.shipKind}
                            name={participant.name}
                            facing={slot.facing}
                            active={participant.id === viewerId}
                            depth={slot.depth}
                            morseFeed={morseFeeds[participant.id] ?? null}
                        />
                        <div className={participant.id === viewerId ? styles.reflectionActive : styles.reflection} />
                    </div>
                </div>
            ))}
        </div>
    );
}
