import { ShipKind } from '@/types/chat';

import { SHIP_SPRITES } from '@/components/ships/shipSprites';

import styles from './Ship.module.less';

/** Кружок с корабликом для аватарок в чате и списке участников. */
export default function ShipAvatar({ kind }: { kind: ShipKind }) {
    return <img className={styles.avatar} src={SHIP_SPRITES[kind].url} alt="" aria-hidden="true" />;
}
