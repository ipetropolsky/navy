import styles from './Ship.module.less';

/** Бортовой номер в кружке — используется вместо аватарки участника. */
export default function HullBadge({ number }: { number: string }) {
    return <span className={styles.badge}>{number}</span>;
}
