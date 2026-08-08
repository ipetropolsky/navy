import Ship from '@/components/ships/Ship';
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

const VIEWER_SLOT: SceneSlot = { left: 34, depth: 1, facing: 'right' };

const OTHER_SLOTS: SceneSlot[] = [
    { left: 76, depth: 0.55, facing: 'left' },
    { left: 16, depth: 0.4, facing: 'right' },
    { left: 50, depth: 0.24, facing: 'left' },
    { left: 85, depth: 0.16, facing: 'right' },
];

// Рассеянные фоновые звёзды (чистое небо, как над Каспием летней ночью).
const STARS = [
    { x: 4, y: 12, s: 2, d: 0 },
    { x: 9, y: 34, s: 1, d: 1.2 },
    { x: 14, y: 8, s: 1, d: 2.1 },
    { x: 7, y: 22, s: 1, d: 0.6 },
    { x: 12, y: 44, s: 1, d: 2.8 },
    { x: 18, y: 16, s: 1, d: 1.7 },
    { x: 21, y: 40, s: 1, d: 0.3 },
    { x: 46, y: 40, s: 1, d: 2.4 },
    { x: 49, y: 18, s: 1, d: 1.1 },
    { x: 54, y: 34, s: 1, d: 3.2 },
    { x: 52, y: 9, s: 2, d: 0.9 },
    { x: 58, y: 24, s: 1, d: 2.0 },
    { x: 62, y: 13, s: 1, d: 1.5 },
    { x: 66, y: 32, s: 1, d: 0.4 },
    { x: 72, y: 20, s: 1, d: 2.6 },
    { x: 78, y: 10, s: 2, d: 1.9 },
    { x: 83, y: 28, s: 1, d: 0.8 },
    { x: 88, y: 16, s: 1, d: 3.0 },
    { x: 92, y: 38, s: 1, d: 1.4 },
    { x: 96, y: 22, s: 1, d: 2.3 },
    { x: 89, y: 44, s: 1, d: 0.5 },
];

// Орион в положении «лёжа», как он виден над Каспием в июле перед рассветом (низко, боком).
// Координаты в системе SVG-слоя (0..100 × 0..60), яркость r — по звёздной величине.
interface OrionStar {
    x: number;
    y: number;
    r: number;
    tone: 'warm' | 'cool' | 'plain';
}

const ORION_STARS: OrionStar[] = [
    { x: 20, y: 9, r: 2.3, tone: 'warm' }, // Бетельгейзе
    { x: 39, y: 5, r: 1.9, tone: 'plain' }, // Беллатрикс
    { x: 26, y: 21, r: 1.7, tone: 'plain' }, // Альнитак (пояс)
    { x: 31, y: 24, r: 1.8, tone: 'plain' }, // Альнилам (пояс)
    { x: 36, y: 27, r: 1.7, tone: 'plain' }, // Минтака (пояс)
    { x: 32, y: 33, r: 0.9, tone: 'plain' }, // меч
    { x: 24, y: 39, r: 1.9, tone: 'plain' }, // Саиф
    { x: 45, y: 36, r: 2.4, tone: 'cool' }, // Ригель
];

const ORION_TONE_CLASS: Record<OrionStar['tone'], string> = {
    warm: styles.orionWarm,
    cool: styles.orionCool,
    plain: styles.orionStar,
};

const ORION_BELT = ORION_STARS.slice(2, 5);

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
                <svg
                    className={styles.orion}
                    viewBox="0 0 100 60"
                    preserveAspectRatio="xMidYMid meet"
                    aria-hidden="true"
                >
                    <polyline
                        className={styles.orionBelt}
                        points={ORION_BELT.map((star) => `${star.x},${star.y}`).join(' ')}
                    />
                    {ORION_STARS.map((star) => (
                        <circle
                            key={`${star.x}-${star.y}`}
                            className={ORION_TONE_CLASS[star.tone]}
                            cx={star.x}
                            cy={star.y}
                            r={star.r}
                        />
                    ))}
                </svg>
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
                            nameColor={AUTHOR_COLORS[participants.indexOf(participant) % AUTHOR_COLORS.length]}
                            morseFeed={morseFeeds[participant.id] ?? null}
                        />
                        <div className={participant.id === viewerId ? styles.reflectionActive : styles.reflection} />
                    </div>
                </div>
            ))}
        </div>
    );
}
