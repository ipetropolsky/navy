import { ShipKind, Side } from '@shared/types/channel';

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
 * Перед самой тенью — подложка под цвет воды (.shadowWater), обрезанная тем же спрайтом
 * через альфа-канал маски: тень блендится с ней через mix-blend-mode, а не с настоящим
 * морем позади сцены — до него не дотянуться, см. комментарий у .shadowSprite
 * в Ship.module.less. Адрес картинки для маски известен только здесь, где известен
 * корабль, — потому и стоит строчным стилем, а не в css.
 *
 * Своей разметки у тени немного, потому что заимствовать нечего: подпись, номер и огни
 * кораблю не тень, а сам корпус, — здесь только силуэт и подложка под ним.
 */
export default function ShipShadow({ kind, facing = 'left' }: ShipShadowProps) {
    const sprite = SHIP_SPRITES[kind];
    const flip = facing === 'right';
    const maskStyle = { maskImage: `url(${sprite.url})`, WebkitMaskImage: `url(${sprite.url})` };

    return (
        <>
            <i className={flip ? styles.shadowWaterFlipped : styles.shadowWater} style={maskStyle} />
            <img
                className={flip ? styles.shadowSpriteFlipped : styles.shadowSprite}
                src={sprite.url}
                alt=""
                aria-hidden="true"
            />
        </>
    );
}
