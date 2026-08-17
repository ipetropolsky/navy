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
     * с клавиатуры, ни менять курсор. Название приходит снаружи, хотя дело у аватарки сейчас
     * везде одно — окликнуть корабль: в подсказке стоит позывной, а он у каждой свой.
     */
    action?: { title: string; onClick: () => void };
}

/**
 * Аватарка участника: бортовой номер в кружке. Лицо у корабля одно — номер на борту.
 *
 * Нажимаемая аватарка — кнопка вокруг кружка, а не сам кружок: кружок маленький, а попадать
 * в него надо пальцем, и вокруг него оставлено невидимое поле (см. `.hail` в стилях). Оттого
 * и вложенность: будь кнопкой сам кружок, поле пришлось бы рисовать его фоном и рамкой.
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
        <button type="button" className={styles.hail} onClick={action.onClick} title={action.title}>
            <span className={look}>
                <HullBadge number={number} />
            </span>
        </button>
    );
}
