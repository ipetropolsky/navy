import { InputHTMLAttributes, ReactNode, Ref } from 'react';

import styles from './Input.module.less';

/**
 * Поле ввода. Одно на всё приложение: и строка сообщения в ленте, и поля форм — это оно.
 * Своих полей в компонентах не заводим, иначе через два экрана они разъезжаются по радиусам,
 * фонам и подсветке фокуса.
 */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    /** Набрано не то: рамка краснеет. Что именно не так — говорит снекбар или подпись поля. */
    invalid?: boolean;
    /** Поле под несколько знаков: бортовой номер. */
    compact?: boolean;
    /** Кнопка внутри поля справа — например, скопировать набранное. */
    action?: ReactNode;
    /** Нужен там, где фокус ставится руками: после отправки сообщения. */
    ref?: Ref<HTMLInputElement>;
}

export default function Input({ invalid = false, compact = false, action, type = 'text', ...rest }: InputProps) {
    const className = [invalid ? styles.inputInvalid : styles.input, compact ? styles.compact : '']
        .filter(Boolean)
        .join(' ');
    const input = <input {...rest} type={type} className={className} />;

    if (!action) {
        return input;
    }

    return (
        <span className={styles.withAction}>
            {input}
            <span className={styles.action}>{action}</span>
        </span>
    );
}
