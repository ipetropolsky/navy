import styles from './Sea.module.less';

/**
 * Как кадр возвращается к исходному масштабу в конце цикла:
 * wave — мягкой полосой сверху вниз, ebb — ровным растворением за последние
 * пару секунд, roll — быстрым затуханием целиком, dissolve — перекрёстным
 * затуханием на весь цикл.
 */
export type SeaMode = 'wave' | 'ebb' | 'roll' | 'dissolve';

interface SeaProps {
    mode?: SeaMode;
}

export default function Sea({ mode = 'wave' }: SeaProps) {
    return (
        <div className={`${styles.sea} ${styles[mode]}`} role="img" aria-label="Спокойное ночное море">
            <div className={`${styles.layer} ${styles.back}`} />
            <div className={styles.curtain}>
                <div className={`${styles.layer} ${styles.front}`} />
            </div>
        </div>
    );
}
