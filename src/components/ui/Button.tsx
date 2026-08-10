import { ButtonHTMLAttributes } from 'react';

import styles from './Button.module.less';

/**
 * Кнопка панелей: одна на все формы и шторки, чтобы «главное действие» выглядело одинаково
 * везде, где оно есть. Три вида и всё:
 *
 *   primary   — то, ради чего экран открыт: «Готово», «Создать канал»;
 *   secondary — рядом стоящее и менее важное: «Отмена», «Переоснастить корабль»;
 *   danger    — то, что убирает: «Выйти из канала».
 *
 * Реакция на нажатие есть у всех: на телефоне это единственный отклик, по которому понятно,
 * что нажатие засчитано. Подсветка под указателем — только там, где указатель есть.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    /** Во всю ширину родителя: для одинокого действия внизу формы. */
    wide?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
    primary: styles.primary,
    secondary: styles.secondary,
    danger: styles.danger,
};

export default function Button({ variant = 'primary', wide = false, type = 'button', ...rest }: ButtonProps) {
    const className = [styles.button, VARIANT_CLASS[variant], wide ? styles.wide : ''].filter(Boolean).join(' ');
    return <button {...rest} type={type} className={className} />;
}
