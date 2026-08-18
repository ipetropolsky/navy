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
    /**
     * Корабль отошёл на второй план: пока на рейде выбирают место, корпус высветляется
     * в призрак, чтобы сквозь него читалась вода. Огни при этом горят по-прежнему —
     * см. GHOST ниже.
     */
    aside?: boolean;
    morseFeed?: MorseFeed | null;
}

/**
 * Во что превращается корпус, когда корабль отошёл на второй план: яркость вверх, цвет почти
 * в ноль, контраст вниз — бледный силуэт на воде.
 *
 * Высветление, а не приглушение, и это проверено глазом: корпуса тёмные, вода под ними тоже,
 * и приглушённый корабль на ней попросту пропадал — вместо «стоит, но не про него сейчас
 * речь» получалось «его нет». Ореола по контуру (drop-shadow) у призрака тоже нет: свечение
 * вокруг светлого силуэта складывается с ним самим, край не тает, а наливается, — и корабль
 * читается не отошедшим, а подсвеченным, будто это его сейчас выбирают.
 *
 * Идёт высветление по корпусу и номеру на борту, а не по всему кораблю, — и это важнее, чем
 * кажется: огни на призраке и есть единственное, по чему в этот момент видно, что на месте
 * кто-то стоит. Высветли их вместе с корпусом — и рейд, на котором как раз выбирают место,
 * останется без единого признака жизни. По той же причине высветление живёт здесь, а не
 * в сцене: снаружи корабля огни от корпуса не отделить, а прозрачность на общей обёртке
 * гасит всё, что под ней, включая их.
 */
const GHOST = 'brightness(3.4) contrast(0.8) saturate(0.2)';
const GHOST_OPACITY = 0.5;

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
    aside = false,
    morseFeed = null,
}: ShipProps) {
    const sprite = SHIP_SPRITES[kind];
    const { on, transmit } = useMorseLamp();

    useEffect(() => {
        if (morseFeed?.text) {
            transmit(morseFeed.text, morseFeed.restart);
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
    // Чем дальше корабль, тем сильнее он тонет в ночной дымке. Призрак приписывается сюда же,
    // а не отдельным классом: дымка задана стилем на элементе, и класс с фильтром её всё равно
    // не перебил бы — свойство одно, а строчный стиль сильнее.
    const haze: CSSProperties = {
        filter: `brightness(${(0.62 + depth * 0.26).toFixed(2)})${aside ? ` ${GHOST}` : ''}`,
        opacity: aside ? GHOST_OPACITY : undefined,
    };
    // То же самое для номера на борту: он написан на корпусе и уходит в призрак вместе с ним.
    // Дымки на нём нет — цифры и так белые, темнить их незачем.
    const hullHaze: CSSProperties = aside ? { filter: GHOST, opacity: GHOST_OPACITY } : {};

    const lights = sprite.lights;
    const underway = mode === 'underway';
    const twoLights = hasTwoLights(kind);
    // Куда светят направленные огни на экране: вперёд — туда же, куда смотрит нос.
    const foreGlow = flip ? styles.glowRight : styles.glowLeft;
    const aftGlow = flip ? styles.glowLeft : styles.glowRight;

    return (
        // data-facing — по той же причине, что и data-light ниже: курс виден только по тому,
        // в какую сторону отражена картинка, и со стороны его иначе не спросить.
        <div className={styles.ship} data-facing={facing}>
            <img
                className={flip ? styles.spriteFlipped : styles.sprite}
                style={haze}
                src={sprite.url}
                alt={`Корабль «${name}»`}
            />
            <span className={styles.hullNumber} style={{ ...at(sprite.hullNumber), fontSize: numberSize, ...hullHaze }}>
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
