import { ButtonHTMLAttributes } from 'react';

import styles from './Button.module.less';

/**
 * Кнопка панелей: одна на все формы и шторки, чтобы «главное действие» выглядело одинаково
 * везде, где оно есть. Три вида и всё:
 *
 *   primary   — то, ради чего экран открыт: «Готово», «Создать канал»;
 *   secondary — рядом стоящее и менее важное: «Отмена», «Настроить корабль»;
 *   danger    — то, что убирает: «Уйти с рейда».
 *
 * Реакция на нажатие есть у всех: на телефоне это единственный отклик, по которому понятно,
 * что нажатие засчитано. Подсветка под указателем — только там, где указатель есть.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
    primary: styles.primary,
    secondary: styles.secondary,
    danger: styles.danger,
};

export default function Button({ variant = 'primary', type = 'button', ...rest }: ButtonProps) {
    return <button {...rest} type={type} className={`${styles.button} ${VARIANT_CLASS[variant]}`} />;
}
