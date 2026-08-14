import { ReactNode } from 'react';

import styles from './Actions.module.less';

interface ActionsProps {
    children: ReactNode;
    /**
     * Кнопки прилипают к нижней кромке того, что их прокручивает. Нужно длинному: форме,
     * которую листают. Короткому и так ничего не мешает, а с припиской под кнопками
     * прилипание и вредно: приписка уезжала бы под них.
     */
    pinned?: boolean;
    /** Под кнопками есть приписка: тогда полоса не уносит нижнее поле хозяина. */
    aboveFooter?: boolean;
}

/**
 * Ряд кнопок внизу формы. Отдельный слот, а не разметка на месте: правила у кнопок одни
 * и те же везде — как они делят ширину, когда переносятся и когда липнут к нижней кромке, —
 * и живут они здесь, в одном месте, а не переписываются в каждой форме.
 *
 * Хозяин слота задаёт только свои поля: `--actions-side` (боковые, которые полоса гасит,
 * чтобы дойти фоном до краёв) и `--actions-pad` (нижнее, которое прилипшие кнопки уносят
 * с собой).
 */
export default function Actions({ children, pinned = false, aboveFooter = false }: ActionsProps) {
    const look = [styles.actions, pinned && styles.actionsPinned, aboveFooter && styles.actionsAboveFooter]
        .filter(Boolean)
        .join(' ');
    return <div className={look}>{children}</div>;
}
