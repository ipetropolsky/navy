import styles from './MemberName.module.less';

/**
 * Позывной участника — везде одинаковый: в подписи реплики, в цитате ответа, в списке
 * на связи, в форме корабля. Цвет участник выбирает сам, поэтому он приходит из данных,
 * а не из стилей: цвет и есть содержимое, как и сам позывной.
 */

interface MemberNameProps {
    name: string;
    /** Цвет участника. Без него позывной пишется вполголоса — так показан ещё не набранный. */
    color?: string;
    children?: never;
}

export default function MemberName({ name, color }: MemberNameProps) {
    if (!color) {
        return <span className={styles.placeholder}>{name}</span>;
    }
    return (
        <span className={styles.name} style={{ color }}>
            {name}
        </span>
    );
}
