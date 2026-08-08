import { useEffect } from 'react';

import useMorseLamp from '@/hooks/useMorseLamp';
import { MorseFeed, ShipKind } from '@/types/chat';

import { SHIP_SPRITES } from '@/components/ships/shipSprites';

import styles from './Ship.module.less';

interface ShipProps {
    kind: ShipKind;
    name: string;
    facing?: 'left' | 'right';
    active?: boolean;
    /** Глубина в сцене: 1 — ближний план, 0 — у горизонта. Влияет на размер названия. */
    depth?: number;
    /** Цвет названия на борту (цвет автора, как имя в чате). */
    nameColor?: string;
    morseFeed?: MorseFeed | null;
}

/** Корабль-спрайт с названием на борту, сигнальной лампой и ходовыми огнями. */
export default function Ship({
    kind,
    name,
    facing = 'left',
    active = false,
    depth = 1,
    nameColor = 'var(--color-text)',
    morseFeed = null,
}: ShipProps) {
    const sprite = SHIP_SPRITES[kind];
    const { on, transmit } = useMorseLamp();

    useEffect(() => {
        if (morseFeed?.text) {
            transmit(morseFeed.text);
        }
    }, [morseFeed, transmit]);

    const flip = facing === 'right';
    const mirror = (x: number) => (flip ? 100 - x : x);
    // Дальние корабли мельче, поэтому шрифт названия для них чуть крупнее в долях спрайта.
    const nameSize = `max(7px, ${3.2 + (1 - depth) * 2.6}cqw)`;

    return (
        <div className={styles.ship} style={{ aspectRatio: sprite.ratio }}>
            <img className={flip ? styles.spriteFlipped : styles.sprite} src={sprite.url} alt={`Корабль «${name}»`} />
            <span
                className={styles.name}
                style={{
                    left: `${mirror(sprite.name.x)}%`,
                    top: `${sprite.name.y}%`,
                    color: nameColor,
                    fontSize: nameSize,
                }}
            >
                {name}
            </span>
            <i
                className={`${styles.lamp} ${on ? styles.lampOn : ''}`}
                style={{ left: `${mirror(sprite.lamp.x)}%`, top: `${sprite.lamp.y}%` }}
            />
            <i
                className={`${styles.bowLight} ${active ? styles.lightOn : ''}`}
                style={{ left: `${mirror(sprite.bowLight.x)}%`, top: `${sprite.bowLight.y}%` }}
            />
            <i
                className={`${styles.sternLight} ${active ? styles.lightOn : ''}`}
                style={{ left: `${mirror(sprite.sternLight.x)}%`, top: `${sprite.sternLight.y}%` }}
            />
        </div>
    );
}
