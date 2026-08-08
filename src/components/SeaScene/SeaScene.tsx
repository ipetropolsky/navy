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

// Рассеянные фоновые звёзды.
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

// Блики на воде: короткие горизонтальные штрихи, каждый мерцает в своей фазе,
// поэтому вместе они «переливаются», не повторяясь. Гуще у лунной дорожки (~69%).
interface Glint {
    left: number;
    top: number;
    w: number;
    dur: number;
    delay: number;
    tone: 'light' | 'dark';
}

const GLINTS: Glint[] = [
    { left: 66, top: 8, w: 34, dur: 3.1, delay: 0, tone: 'light' },
    { left: 71, top: 15, w: 26, dur: 4.2, delay: 1.4, tone: 'light' },
    { left: 64, top: 23, w: 40, dur: 3.6, delay: 0.6, tone: 'light' },
    { left: 73, top: 34, w: 30, dur: 5.0, delay: 2.1, tone: 'light' },
    { left: 68, top: 46, w: 46, dur: 4.4, delay: 0.9, tone: 'light' },
    { left: 70, top: 60, w: 34, dur: 5.6, delay: 3.0, tone: 'light' },
    { left: 12, top: 18, w: 22, dur: 4.8, delay: 2.6, tone: 'light' },
    { left: 20, top: 40, w: 30, dur: 3.9, delay: 1.1, tone: 'light' },
    { left: 30, top: 58, w: 26, dur: 5.3, delay: 0.4, tone: 'light' },
    { left: 44, top: 30, w: 24, dur: 4.1, delay: 2.9, tone: 'light' },
    { left: 86, top: 26, w: 24, dur: 4.6, delay: 1.8, tone: 'light' },
    { left: 90, top: 50, w: 30, dur: 3.4, delay: 0.7, tone: 'light' },
    { left: 55, top: 12, w: 20, dur: 5.1, delay: 3.4, tone: 'light' },
    { left: 62, top: 38, w: 22, dur: 4.0, delay: 1.5, tone: 'dark' },
    { left: 24, top: 28, w: 26, dur: 4.7, delay: 0.2, tone: 'dark' },
    { left: 78, top: 44, w: 24, dur: 5.4, delay: 2.3, tone: 'dark' },
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
                <svg
                    className={styles.island}
                    viewBox="0 0 170 60"
                    preserveAspectRatio="xMinYMax meet"
                    aria-hidden="true"
                >
                    <path d="M0 60 L0 46 Q26 30 64 38 Q108 47 170 52 L170 60 Z" />
                    <path d="M18 44 L24 24 L30 44 Z" />
                    <path d="M34 46 L41 20 L48 46 Z" />
                    <path d="M52 47 L57 31 L62 47 Z" />
                    <path d="M8 47 L12 35 L16 47 Z" />
                </svg>
            </div>
            <div className={styles.water}>
                <div className={styles.moonGlade} />
                {GLINTS.map((glint) => (
                    <i
                        key={`${glint.left}-${glint.top}`}
                        className={glint.tone === 'dark' ? styles.glintDark : styles.glint}
                        style={{
                            left: `${glint.left}%`,
                            top: `${glint.top}%`,
                            width: glint.w,
                            animationDuration: `${glint.dur}s`,
                            animationDelay: `${glint.delay}s`,
                        }}
                    />
                ))}
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
