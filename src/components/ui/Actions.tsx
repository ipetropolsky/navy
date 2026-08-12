import { ReactNode } from 'react';

import styles from './Actions.module.less';

interface ActionsProps {
    children: ReactNode;
    /**
     * Кнопки прилипают к нижней кромке, пока окно достаточно высокое. Нужно длинному:
     * форме, которую листают, и списку, который не влезает целиком. Короткому и так
     * ничего не мешает, а с припиской под кнопками прилипание и вредно: приписка
     * уезжала бы под них.
     */
    pinned?: boolean;
    /** Своя отбивка сверху: черта в шторке, отступ от поля в карточке. */
    className?: string;
}

/**
 * Ряд кнопок внизу формы или шторки. Отдельный слот, а не разметка на месте: правила
 * у кнопок одни и те же везде — как они делят ширину, когда переносятся и когда липнут
 * к нижней кромке, — и живут они здесь, в одном месте, а не переписываются в каждой форме.
 *
 * Хозяин слота задаёт только свои поля: `--actions-top` (отбивка сверху) и `--actions-pad`
 * (нижнее поле, которое прилипшие кнопки уносят с собой).
 */
export default function Actions({ children, pinned = false, className }: ActionsProps) {
    const look = pinned ? `${styles.actions} ${styles.actionsPinned}` : styles.actions;
    return <div className={className ? `${look} ${className}` : look}>{children}</div>;
}
