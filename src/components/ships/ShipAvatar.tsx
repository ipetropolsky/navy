import { ShipKind } from '@/types/chat';

import { SHIP_SHAPES, SHIP_VIEWBOX } from '@/components/ships/shipShapes';

import styles from './Ship.module.less';

/** Маленький силуэт корабля для аватарок и списков (один цвет, без названия и огней). */
export default function ShipAvatar({ kind }: { kind: ShipKind }) {
    const shape = SHIP_SHAPES[kind];

    return (
        <svg className={styles.avatar} viewBox={`0 0 ${SHIP_VIEWBOX.width} ${SHIP_VIEWBOX.height}`} aria-hidden="true">
            {shape.strokes.map((d) => (
                <path key={d} className={styles.avatarRig} d={d} />
            ))}
            {shape.parts.map((part) => (
                <path key={part.d} className={styles.avatarBody} d={part.d} />
            ))}
        </svg>
    );
}
