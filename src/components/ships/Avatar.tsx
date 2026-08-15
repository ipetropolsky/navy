import HullBadge from '@/components/ships/HullBadge';

import styles from './Avatar.module.less';

interface AvatarProps {
    number: string;
    /** Позывной: подсказка под курсором у аватарки, которая ничего не делает. */
    name?: string;
    large?: boolean;
    /**
     * Что делает тычок и как это назвать. Без него аватарка — просто картинка: кнопкой она
     * становится только тогда, когда есть что нажимать, и иначе не должна ни попадать в обход
     * с клавиатуры, ни менять курсор. Название приходит снаружи, потому что дело у аватарки
     * разное: в ленте она открывает карточку корабля, в списке — окликает.
     */
    action?: { title: string; onClick: () => void };
}

/**
 * Аватарка участника: бортовой номер в кружке. Лицо у корабля одно — номер на борту.
 */
export default function Avatar({ number, name, large = false, action }: AvatarProps) {
    const look = large ? styles.avatarLarge : styles.avatar;
    if (!action) {
        return (
            <span className={look} title={name}>
                <HullBadge number={number} />
            </span>
        );
    }
    return (
        <button type="button" className={`${look} ${styles.hail}`} onClick={action.onClick} title={action.title}>
            <HullBadge number={number} />
        </button>
    );
}
