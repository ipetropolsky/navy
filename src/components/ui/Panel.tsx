import { ReactNode, SyntheticEvent } from 'react';

import Actions from '@/components/ui/Actions';

import styles from './Panel.module.less';

/**
 * Плашка под сценой: форма создания канала, форма корабля, сообщение о несуществующем канале.
 * Всё, что появляется на месте ленты, устроено ею одинаково — фон, отступы, заголовок,
 * подзаголовок, ряд кнопок внизу, — поэтому переход между экранами не выглядит переездом
 * в другое приложение.
 *
 * С `onSubmit` это форма, без него — просто блок: разметка та же, разница только в теге.
 */

interface PanelProps {
    /**
     * Заголовок. Необязателен: у закрытой формы корабля на плашке одна кнопка посреди пустого
     * места, и заголовок над ней говорил бы то же самое, что и она сама.
     */
    title?: string;
    /** Одна-две строки о том, что здесь происходит. */
    hint?: ReactNode;
    /** Поля формы. */
    children?: ReactNode;
    /** Кнопки внизу: одна занимает всю ширину, две делят её пополам. */
    actions?: ReactNode;
    /**
     * Длинная форма: кнопки прилипают к нижней кромке, пока окно достаточно высокое.
     * Короткой это не нужно — она и так видна целиком, — а с припиской под кнопками
     * и вредно: приписка уезжала бы под них.
     */
    pinActions?: boolean;
    /** Приписка под кнопками: ссылка в сторону, а не действие. */
    footer?: ReactNode;
    onSubmit?: () => void;
}

export default function Panel({ title, hint, children, actions, footer, pinActions, onSubmit }: PanelProps) {
    const content = (
        <>
            {title && <h1 className={styles.title}>{title}</h1>}
            {hint && <p className={styles.hint}>{hint}</p>}
            {children}
            {actions && (
                <Actions pinned={pinActions} aboveFooter={Boolean(footer)}>
                    {actions}
                </Actions>
            )}
            {footer && <p className={styles.footer}>{footer}</p>}
        </>
    );

    if (!onSubmit) {
        return <div className={styles.card}>{content}</div>;
    }

    const handleSubmit = (event: SyntheticEvent) => {
        event.preventDefault();
        onSubmit();
    };

    return (
        <form className={styles.card} onSubmit={handleSubmit}>
            {content}
        </form>
    );
}
