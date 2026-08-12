import HullBadge from '@/components/ships/HullBadge';

import styles from './Avatar.module.less';

interface AvatarProps {
    number: string;
    name?: string;
    large?: boolean;
    /** Оклик: по нажатию корабль отзывается лампой. Без него аватарка — просто картинка. */
    onHail?: () => void;
}

/**
 * Аватарка участника: бортовой номер в кружке. Лицо у корабля одно — номер на борту.
 *
 * Если оклик задан, аватарка становится кнопкой: тычок в неё — способ спросить «который
 * из них твой?», и корабль отвечает лампой со своего места на рейде. Кнопкой она при этом
 * становится только тогда, когда есть кого окликать: аватарка без отклика не должна ни
 * попадать в обход с клавиатуры, ни менять курсор.
 */
export default function Avatar({ number, name, large = false, onHail }: AvatarProps) {
    const look = large ? styles.avatarLarge : styles.avatar;
    if (!onHail) {
        return (
            <span className={look} title={name}>
                <HullBadge number={number} />
            </span>
        );
    }
    return (
        <button
            type="button"
            className={`${look} ${styles.hail}`}
            onClick={onHail}
            title={name ? `Окликнуть «${name}»` : 'Окликнуть'}
        >
            <HullBadge number={number} />
        </button>
    );
}
