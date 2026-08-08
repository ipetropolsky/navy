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

// Орион (июльское «лежачее» положение): некрупные звёзды, без соединительных линий.
interface OrionStar {
    x: number;
    y: number;
    r: number;
    tone: 'warm' | 'cool' | 'plain';
}

const ORION_STARS: OrionStar[] = [
    { x: 20, y: 9, r: 1.3, tone: 'warm' }, // Бетельгейзе
    { x: 39, y: 5, r: 1, tone: 'plain' }, // Беллатрикс
    { x: 26, y: 21, r: 0.9, tone: 'plain' }, // Альнитак (пояс)
    { x: 31, y: 24, r: 0.95, tone: 'plain' }, // Альнилам (пояс)
    { x: 36, y: 27, r: 0.9, tone: 'plain' }, // Минтака (пояс)
    { x: 32, y: 33, r: 0.5, tone: 'plain' }, // меч
    { x: 24, y: 39, r: 1, tone: 'plain' }, // Саиф
    { x: 45, y: 36, r: 1.35, tone: 'cool' }, // Ригель
];

const ORION_TONE_CLASS: Record<OrionStar['tone'], string> = {
    warm: styles.orionWarm,
    cool: styles.orionCool,
    plain: styles.orionStar,
};

// Волны: катятся из-за горизонта к наблюдателю, вырастая по пути (см. keyframes wave-roll).
const WAVE_PERIOD_S = 18;
const WAVES = [0, 1, 2, 3, 4, 5].map((index, _, all) => ({
    delay: -(index * WAVE_PERIOD_S) / all.length,
    shift: (index % 3) * 17 - 17,
}));

function IslandSilhouette({ className }: { className: string }) {
    return (
        <svg className={className} viewBox="0 0 240 80" preserveAspectRatio="xMinYMax meet" aria-hidden="true">
            <path
                className={styles.islandBack}
                d="M0 80 L0 52 Q30 38 62 46 Q96 30 134 44 Q172 36 200 52 Q222 66 240 78 L240 80 Z"
            />
            <g className={styles.islandFront}>
                <path d="M0 80 L0 62 Q50 54 110 60 Q170 58 214 72 Q228 77 240 80 Z" />
                <path d="M12 62 L17 40 L22 62 Z" />
                <path d="M26 62 L32 34 L38 62 Z" />
                <path d="M44 61 L49 44 L54 61 Z" />
                <path d="M58 60 L64 38 L70 60 Z" />
                <path d="M80 60 L85 46 L90 60 Z" />
                <path d="M96 60 L101 48 L106 60 Z" />
            </g>
        </svg>
    );
}

interface SeaSceneProps {
    participants: Participant[];
    viewerId: string;
    morseFeeds: Partial<Record<string, MorseFeed>>;
}

/** Ночное море: звёзды с Орионом, месяц с дорожкой, остров с соснами, волны и корабли на рейде. */
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
                <svg className={styles.moon} viewBox="0 0 60 60" aria-hidden="true">
                    <mask id="moon-crescent">
                        <rect width="60" height="60" fill="#fff" />
                        <circle cx="41" cy="23" r="19" fill="#000" />
                    </mask>
                    <circle cx="30" cy="30" r="21" fill="#f5efd8" mask="url(#moon-crescent)" />
                </svg>
                <IslandSilhouette className={styles.island} />
            </div>
            <div className={styles.water}>
                <div className={styles.moonGlade} />
                <IslandSilhouette className={styles.islandReflection} />
            </div>
            <div className={styles.reflections}>
                {placed.map((item) => (
                    <div key={item.participant.id} className={styles.reflectionSlot} style={slotStyle(item)}>
                        <ShipReflection kind={item.participant.shipKind} facing={item.slot.facing} />
                    </div>
                ))}
            </div>
            <div className={styles.waves}>
                {WAVES.map((wave) => (
                    <i
                        key={wave.delay}
                        className={styles.wave}
                        style={{ animationDelay: `${wave.delay}s`, marginLeft: `${wave.shift}%` }}
                    />
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
        </div>
    );
}
