import type { CSSProperties } from 'react';

import styles from './Sea.module.less';

/**
 * Как кадр возвращается к исходному масштабу в конце цикла:
 * wave — мягкой полосой сверху вниз, ebb — ровным растворением за последние
 * пару секунд, roll — быстрым затуханием целиком, dissolve — перекрёстным
 * затуханием на весь цикл.
 *
 * Три варианта обходятся без возврата вовсе: frames перебирает по кругу снимки
 * sea_1…4.png, glints двигает по усреднённому фону только волны-блики, mirror
 * перетекает между картинкой и её зеркальным отражением — гребни двух кадров
 * не совпадают, и двоиться нечему.
 */
export type SeaMode = 'wave' | 'ebb' | 'roll' | 'dissolve' | 'glints' | 'mirror' | 'frames';

interface SeaProps {
    mode?: SeaMode;
    /** Номера снимков для режима frames: показываются по кругу в этом порядке. */
    frames?: number[];
    /**
     * Какой снимок отражать в режиме mirror. У sea.png лунная дорожка почти по
     * центру и при отражении стоит на месте; у sea_fixed она правее на 6%
     * ширины, и свет заметно переезжает через кадр.
     */
    mirrorImage?: 'sea' | 'fixed';
}

interface Glint {
    variant: number;
    x: number;
    width: number;
    opacity: number;
    duration: number;
    delay: number;
    flip: number;
}

const GLINT_COUNT = 28;

/**
 * Раскладка бликов. Детерминированный LCG вместо Math.random: поле должно быть
 * одинаковым при каждой отрисовке и совпадать с демо-артефактом.
 */
const GLINTS: Glint[] = (() => {
    const modulus = 4294967296;
    let seed = 20260809;
    const random = () => {
        // eslint-disable-next-line no-bitwise -- LCG обязан считать по модулю 2^32
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / modulus;
    };
    return Array.from({ length: GLINT_COUNT }, (_, index) => {
        const variant = 1 + Math.floor(random() * 8);
        const x = 3 + random() * 94;
        const width = 13 + random() * 18;
        const duration = 13 + random() * 9;
        // Стратифицированная задержка: по блику на каждую долю цикла, иначе
        // случайные значения оставляют в поле дыры.
        const delay = -((index + random()) / GLINT_COUNT) * duration;
        const flip = random() < 0.5 ? -1 : 1;
        return {
            variant,
            x: +x.toFixed(1),
            width: +width.toFixed(1),
            // Ближе к лунной дорожке блики ярче — она по центру кадра.
            opacity: +(0.4 + 0.6 * Math.pow(1 - Math.abs(x - 50) / 50, 0.8)).toFixed(2),
            duration: +duration.toFixed(1),
            delay: +delay.toFixed(1),
            flip,
        };
    });
})();

export default function Sea({ mode = 'wave', frames = [1, 2, 3, 4], mirrorImage = 'sea' }: SeaProps) {
    const classes = [styles.sea, styles[mode]];
    if (mode === 'mirror' && mirrorImage === 'fixed') {
        classes.push(styles.mirrorFixed);
    }

    return (
        <div className={classes.join(' ')} role="img" aria-label="Спокойное ночное море">
            <div className={`${styles.layer} ${styles.back}`} />
            <div className={styles.curtain}>
                <div className={`${styles.layer} ${styles.front}`} />
            </div>
            {mode === 'frames' && frames.length > 0 && (
                <div className={styles.stack} style={{ '--n': frames.length } as CSSProperties}>
                    {/* Кадром больше: последний повторяет первый, поэтому к концу
                        цикла видно его же и общий сброс на стыке не виден. */}
                    {[...frames, frames[0]].map((frame, index) => (
                        <div
                            key={`${frame}-${index}`}
                            className={`${styles.frame} ${styles[`f${frame}`]}`}
                            style={{ '--i': index } as CSSProperties}
                        />
                    ))}
                </div>
            )}
            {mode === 'glints' && (
                <div className={styles.field}>
                    <div className={styles.grain} />
                    {GLINTS.map((glint) => (
                        <div
                            key={`${glint.variant}-${glint.x}-${glint.delay}`}
                            className={styles.track}
                            style={{ '--dur': `${glint.duration}s`, '--delay': `${glint.delay}s` } as CSSProperties}
                        >
                            <div
                                className={`${styles.spot} ${styles[`v${glint.variant}`]}`}
                                style={
                                    {
                                        '--x': `${glint.x}%`,
                                        '--w': `${glint.width}%`,
                                        '--o': glint.opacity,
                                        '--flip': glint.flip,
                                    } as CSSProperties
                                }
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
