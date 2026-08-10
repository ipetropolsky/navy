import { ReactNode } from 'react';

import styles from './Field.module.less';

/**
 * Поле формы: название сверху, само поле под ним. Один вид на все формы — иначе подписи
 * начинают разъезжаться по кеглям и отступам от экрана к экрану.
 */

interface FieldProps {
    label: string;
    /**
     * Внутри не одно поле, а несколько нажимаемых — цвета, силуэты кораблей. Тогда обёртка
     * не <label>: клик по названию должен попадать в конкретный элемент, а не в первый попавшийся.
     */
    group?: boolean;
    children: ReactNode;
}

export default function Field({ label, group = false, children }: FieldProps) {
    const Tag = group ? 'div' : 'label';
    return (
        <Tag className={styles.field}>
            <span className={styles.label}>{label}</span>
            {children}
        </Tag>
    );
}
