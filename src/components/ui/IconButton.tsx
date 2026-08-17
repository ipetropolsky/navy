import { ButtonHTMLAttributes } from 'react';

import styles from './IconButton.module.less';

/**
 * Кнопка со значком вместо подписи. Их в приложении четыре вида, и все они здесь:
 *
 *   plain   — прозрачная, значок в цвет текста: список участников, новый канал;
 *   muted   — она же вполголоса: отменить ответ, закрыть;
 *   accent  — залитая акцентом: отправить сообщение;
 *   inField — маленькая, внутри поля ввода: скопировать адрес.
 *
 * Подпись обязательна в `aria-label`: без неё кнопка немая для всего, кроме глаз.
 *
 * Размера у кнопки своего нет — он приходит от того, в чём она лежит (--icon-button-size
 * и --icon-button-icon, см. IconButton.module.less). Так все кнопки шапки над развёрнутым
 * кадром растут разом, и новой в этом ряду не нужно об этом просить.
 */

export type IconButtonVariant = 'plain' | 'muted' | 'accent' | 'inField';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: IconButtonVariant;
    /** Делать нечего: кнопка сжимается и гаснет, не перехватывая нажатий. */
    inactive?: boolean;
    'aria-label': string;
}

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
    plain: styles.plain,
    muted: styles.muted,
    accent: styles.accent,
    inField: styles.inField,
};

export default function IconButton({ variant = 'plain', inactive = false, type = 'button', ...rest }: IconButtonProps) {
    const className = [styles.iconButton, VARIANT_CLASS[variant], inactive ? styles.inactive : '']
        .filter(Boolean)
        .join(' ');
    return <button {...rest} type={type} className={className} />;
}
