import { CSSProperties, useEffect } from 'react';

import useMorseLamp from '@/hooks/useMorseLamp';
import { MorseFeed, Side, ShipKind } from '@/types/channel';

import { SHIP_SPRITES, SpritePoint, hasTwoLights } from '@/components/ships/shipSprites';

import styles from './Ship.module.less';

/**
 * Что делает корабль прямо сейчас. От этого зависят огни, и подменить одно другим нельзя:
 * ходовые и якорные — разные фонари, а не один и тот же в разных режимах.
 */
export type ShipMode = 'underway' | 'anchored';

interface ShipProps {
    kind: ShipKind;
    /** Название корабля — для подписи в разметке, на борту рисуется номер. */
    name: string;
    hullNumber: string;
    facing?: Side;
    /** На ходу или на якоре. */
    mode?: ShipMode;
    /** Глубина в сцене: 1 — ближний план, 0 — у горизонта. Влияет на размер номера. */
    depth?: number;
    morseFeed?: MorseFeed | null;
}

/**
 * Корабль-спрайт с бортовым номером, сигнальной лампой и огнями по МППСС.
 *
 * На ходу: красный на левом борту, зелёный на правом, белый топовый вперёд и белый кормовой
 * назад; от 50 м — второй топовый, позади и выше первого. На якоре ходовые гаснут и вместо
 * них горят круговые белые: один до 50 м, два (носовой выше кормового) от 50 м.
 *
 * Мы смотрим на корабль сбоку, поэтому бортовой огонь виден ровно один. Идущий влево показывает
 * нам левый борт — значит красный; идущий вправо — правый, зелёный.
 */
export default function Ship({
    kind,
    name,
    hullNumber,
    facing = 'left',
    mode = 'anchored',
    depth = 1,
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
    // Отметки сняты со спрайта, нарисованного носом влево. Если корабль развёрнут, отражаем
    // их так же, как саму картинку.
    const at = (point: SpritePoint): CSSProperties => {
        const x = (point.x / sprite.size.width) * 100;
        return { left: `${flip ? 100 - x : x}%`, top: `${(point.y / sprite.size.height) * 100}%` };
    };
    // Дальние корабли мельче, поэтому номер для них крупнее в долях спрайта.
    const numberSize = `max(7px, ${3.4 + (1 - depth) * 2.4}cqw)`;
    // Чем дальше корабль, тем сильнее он тонет в ночной дымке.
    const haze = { filter: `brightness(${(0.62 + depth * 0.26).toFixed(2)})` };

    const lights = sprite.lights;
    const underway = mode === 'underway';
    const twoLights = hasTwoLights(kind);
    // Куда светят направленные огни на экране: вперёд — туда же, куда смотрит нос.
    const foreGlow = flip ? styles.glowRight : styles.glowLeft;
    const aftGlow = flip ? styles.glowLeft : styles.glowRight;

    return (
        <div className={styles.ship}>
            <img
                className={flip ? styles.spriteFlipped : styles.sprite}
                style={haze}
                src={sprite.url}
                alt={`Корабль «${name}»`}
            />
            <span className={styles.hullNumber} style={{ ...at(sprite.hullNumber), fontSize: numberSize }}>
                {hullNumber}
            </span>
            <i className={`${styles.lamp} ${on ? styles.lampOn : ''}`} style={at(lights.signal)} />
            {/* data-light — чтобы огни можно было пересчитать со стороны: правило «от 50 метров
                второй огонь, и носовой якорный выше кормового» иначе проверяется только глазом. */}
            {underway ? (
                <>
                    <i data-light="masthead" className={`${styles.white} ${foreGlow}`} style={at(lights.masthead)} />
                    {twoLights && (
                        <i
                            data-light="masthead-aft"
                            className={`${styles.white} ${foreGlow}`}
                            style={at(lights.mastheadAft)}
                        />
                    )}
                    <i
                        data-light={flip ? 'starboard' : 'port'}
                        className={flip ? styles.green : styles.red}
                        style={at(lights.side)}
                    />
                    <i data-light="stern" className={`${styles.white} ${aftGlow}`} style={at(lights.stern)} />
                </>
            ) : (
                <>
                    <i data-light="anchor-fore" className={styles.white} style={at(lights.anchorFore)} />
                    {twoLights && <i data-light="anchor-aft" className={styles.white} style={at(lights.anchorAft)} />}
                </>
            )}
        </div>
    );
}
