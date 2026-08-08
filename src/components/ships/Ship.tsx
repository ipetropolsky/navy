import { useEffect } from 'react';

import useMorseLamp from '@/hooks/useMorseLamp';
import { MorseFeed, ShipKind } from '@/types/chat';

import { SHIP_SHAPES, SHIP_VIEWBOX } from '@/components/ships/shipShapes';

import styles from './Ship.module.less';

interface ShipProps {
    kind: ShipKind;
    name: string;
    facing?: 'left' | 'right';
    active?: boolean;
    /** Глубина в сцене: 1 — ближний план, 0 — у горизонта. Влияет только на размер названия. */
    depth?: number;
    /** Цвет названия на борту (цвет автора, как имя в чате). */
    nameColor?: string;
    morseFeed?: MorseFeed | null;
}

/** Тёмный однотонный силуэт корабля с названием на борту, сигнальной лампой и ходовыми огнями. */
export default function Ship({
    kind,
    name,
    facing = 'right',
    active = false,
    depth = 1,
    nameColor = 'var(--color-text)',
    morseFeed = null,
}: ShipProps) {
    const shape = SHIP_SHAPES[kind];
    const { on, transmit } = useMorseLamp();

    useEffect(() => {
        if (morseFeed?.text) {
            transmit(morseFeed.text);
        }
    }, [morseFeed, transmit]);

    const flip = facing === 'left';
    const mirror = (x: number) => (flip ? SHIP_VIEWBOX.width - x : x);

    // Мельче на ближнем плане, чуть крупнее у горизонта — компенсирует уменьшение силуэта.
    const nameSize = 12 + (1 - depth) * 5;

    return (
        <svg
            className={styles.ship}
            viewBox={`0 0 ${SHIP_VIEWBOX.width} ${SHIP_VIEWBOX.height}`}
            role="img"
            aria-label={`Корабль «${name}»`}
        >
            <g transform={flip ? `translate(${SHIP_VIEWBOX.width} 0) scale(-1 1)` : undefined}>
                <path className={styles.body} d={shape.hull} />
                {shape.details.map((d) => (
                    <path key={d} className={styles.body} d={d} />
                ))}
                {shape.strokes.map((d) => (
                    <path key={d} className={styles.rig} d={d} />
                ))}
            </g>
            <circle
                className={`${styles.lampGlow} ${on ? styles.lampGlowOn : ''}`}
                cx={mirror(shape.lamp.x)}
                cy={shape.lamp.y}
                r={9}
            />
            <circle
                className={`${styles.lamp} ${on ? styles.lampOn : ''}`}
                cx={mirror(shape.lamp.x)}
                cy={shape.lamp.y}
                r={3}
            />
            <circle
                className={`${styles.bowLight} ${active ? styles.lightOn : ''}`}
                cx={mirror(shape.bowLight.x)}
                cy={shape.bowLight.y}
                r={2.4}
            />
            <circle
                className={`${styles.sternLight} ${active ? styles.lightOn : ''}`}
                cx={mirror(shape.sternLight.x)}
                cy={shape.sternLight.y}
                r={2.4}
            />
            <text
                className={styles.name}
                x={SHIP_VIEWBOX.width / 2}
                y={shape.nameY}
                textAnchor="middle"
                style={{ fontSize: nameSize, fill: nameColor }}
            >
                {name}
            </text>
        </svg>
    );
}
