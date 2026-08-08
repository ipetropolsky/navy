import { ShipKind } from '@/types/chat';

import { SHIP_SHAPES, SHIP_VIEWBOX } from '@/components/ships/shipShapes';

import styles from './Ship.module.less';

interface ShipReflectionProps {
    kind: ShipKind;
    facing?: 'left' | 'right';
}

/** Тёмное зеркальное отражение силуэта на воде (переворачивается контейнером). */
export default function ShipReflection({ kind, facing = 'right' }: ShipReflectionProps) {
    const shape = SHIP_SHAPES[kind];
    const flip = facing === 'left';

    return (
        <svg className={styles.ship} viewBox={`0 0 ${SHIP_VIEWBOX.width} ${SHIP_VIEWBOX.height}`} aria-hidden="true">
            <g transform={flip ? `translate(${SHIP_VIEWBOX.width} 0) scale(-1 1)` : undefined}>
                {shape.parts.map((part) => (
                    <path key={part.d} className={styles.reflectionBody} d={part.d} />
                ))}
                {shape.strokes.map((d) => (
                    <path key={d} className={styles.reflectionRig} d={d} />
                ))}
            </g>
        </svg>
    );
}
