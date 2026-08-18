import { ShipKind, Side } from '@/types/channel';

import { SHIP_SPRITES } from '@/components/ships/shipSprites';

import styles from './Ship.module.less';

interface ShipShadowProps {
    kind: ShipKind;
    facing?: Side;
}

/**
 * Силуэт тени: тот же спрайт, что и у корпуса, курс — тот же класс, что и у него
 * (см. .sprite/.spriteFlipped в Ship.module.less). Зеркало по вертикали, наклон и обрезающая
 * маска стоят снаружи, на обёртке — см. .shipShadow в SeaScene.module.less и issue GH-60.
 *
 * Своей разметки у тени немного, потому что заимствовать нечего: подпись, номер и огни
 * кораблю не тень, а сам корпус, — здесь только силуэт.
 */
export default function ShipShadow({ kind, facing = 'left' }: ShipShadowProps) {
    const sprite = SHIP_SPRITES[kind];
    const flip = facing === 'right';

    return (
        <img
            className={flip ? styles.shadowSpriteFlipped : styles.shadowSprite}
            src={sprite.url}
            alt=""
            aria-hidden="true"
        />
    );
}
