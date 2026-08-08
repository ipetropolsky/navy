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
    /** Глубина в сцене: 1 — ближний план, 0 — у горизонта (дальние корабли растворяются в дымке). */
    depth?: number;
    morseFeed?: MorseFeed | null;
}

const HULL_NEAR: [number, number, number] = [9, 19, 33];
const HULL_FAR: [number, number, number] = [40, 68, 98];
const DETAIL_TINT: [number, number, number] = [72, 106, 142];

function mixColor(from: [number, number, number], to: [number, number, number], amount: number): string {
    const channels = from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
    return `rgb(${channels.join(', ')})`;
}

/** Силуэт корабля с названием на борту, сигнальной лампой и ходовыми огнями. */
export default function Ship({ kind, name, facing = 'right', active = false, depth = 1, morseFeed = null }: ShipProps) {
    const shape = SHIP_SHAPES[kind];
    const { on, transmit } = useMorseLamp();

    useEffect(() => {
        if (morseFeed?.text) {
            transmit(morseFeed.text);
        }
    }, [morseFeed, transmit]);

    const flip = facing === 'left';
    const mirror = (x: number) => (flip ? SHIP_VIEWBOX.width - x : x);

    const haze = (1 - depth) * 0.85;
    const hullColor = mixColor(HULL_NEAR, HULL_FAR, haze);
    const detailColor = mixColor(HULL_NEAR, DETAIL_TINT, haze * 0.55 + 0.22);
    const nameSize = 15 + (1 - depth) * 7;

    return (
        <svg
            className={styles.ship}
            viewBox={`0 0 ${SHIP_VIEWBOX.width} ${SHIP_VIEWBOX.height}`}
            role="img"
            aria-label={`Корабль «${name}»`}
        >
            <g transform={flip ? `translate(${SHIP_VIEWBOX.width} 0) scale(-1 1)` : undefined}>
                <path d={shape.hull} style={{ fill: hullColor }} />
                {shape.details.map((d) => (
                    <path key={d} d={d} style={{ fill: detailColor }} />
                ))}
                {shape.strokes.map((d) => (
                    <path key={d} className={styles.rig} d={d} style={{ stroke: detailColor }} />
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
                style={{ fontSize: nameSize }}
            >
                {name}
            </text>
        </svg>
    );
}
