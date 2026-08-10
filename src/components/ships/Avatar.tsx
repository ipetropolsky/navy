import HullBadge from '@/components/ships/HullBadge';

import styles from './Avatar.module.less';

/** Аватарка участника: бортовой номер в кружке. Лицо у корабля одно — номер на борту. */
export default function Avatar({ number, name, large = false }: { number: string; name?: string; large?: boolean }) {
    return (
        <span className={large ? styles.avatarLarge : styles.avatar} title={name}>
            <HullBadge number={number} />
        </span>
    );
}
