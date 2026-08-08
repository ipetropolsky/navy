import styles from './Sea.module.less';

export default function Sea() {
    return (
        <div className={styles.sea} role="img" aria-label="Спокойное ночное море">
            <div className={`${styles.layer} ${styles.back}`} />
            <div className={`${styles.layer} ${styles.front}`} />
        </div>
    );
}
