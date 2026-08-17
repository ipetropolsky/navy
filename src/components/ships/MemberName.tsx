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
    /**
     * Позывной крупнее обычного. Единственное на всё приложение исключение из «одна мерка
     * на все места» — карточка корабля: там позывной не подпись к чему-то, а само то, ради
     * чего карточку открыли, и общей мелкой меркой он в ней теряется.
     */
    large?: boolean;
    children?: never;
}

export default function MemberName({ name, color, large = false }: MemberNameProps) {
    const size = large ? styles.large : '';
    if (!color) {
        return <span className={`${styles.placeholder} ${size}`.trim()}>{name}</span>;
    }
    return (
        <span className={`${styles.name} ${size}`.trim()} style={{ color }}>
            {name}
        </span>
    );
}
