import { ShipKind } from '@/types/chat';

import { SHIP_SPRITES } from '@/components/ships/shipSprites';

import styles from './Ship.module.less';

interface ShipReflectionProps {
    kind: ShipKind;
    facing?: 'left' | 'right';
}

/** Отражение корабля на воде: тот же спрайт, перевёрнутый и притушенный. */
export default function ShipReflection({ kind, facing = 'left' }: ShipReflectionProps) {
    const sprite = SHIP_SPRITES[kind];

    return (
        <img
            className={facing === 'right' ? styles.reflectionFlipped : styles.reflection}
            src={sprite.url}
            alt=""
            aria-hidden="true"
        />
    );
}
