import { ReactNode } from 'react';

import styles from './Actions.module.less';

interface ActionsProps {
    children: ReactNode;
    /** Под кнопками есть приписка: тогда вырез экрана внизу достаётся ей, а не полосе. */
    aboveFooter?: boolean;
    /**
     * В ряду есть контрол, которого нельзя тянуть, — переключатель. Тогда ширину не делит
     * никто: все стоят по содержимому и прижаты влево.
     */
    ownWidth?: boolean;
}

/**
 * Ряд кнопок внизу формы, шторки, панели. Отдельный слот, а не разметка на месте: правила
 * у кнопок одни и те же везде — как они делят ширину и когда переносятся, — и живут они здесь,
 * в одном месте, а не переписываются в каждой форме.
 *
 * Стоит полоса строкой под телом хозяина, а не внутри него: мотается тело, полоса стоит.
 * Хозяин — колонка из этих двух частей, и он же объявляет единственное число слота,
 * `--actions-side`: поле по бокам, то же самое, каким отступает от краёв текст над кнопками.
 * Подробности — в стилях.
 */
export default function Actions({ children, aboveFooter = false, ownWidth = false }: ActionsProps) {
    const look = [styles.actions, aboveFooter && styles.actionsAboveFooter, ownWidth && styles.actionsOwnWidth]
        .filter(Boolean)
        .join(' ');
    return <div className={look}>{children}</div>;
}
