import { ReactNode, SyntheticEvent } from 'react';

import Actions from '@/components/ui/Actions';
import CloseButton from '@/components/ui/CloseButton';

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
    /** Приписка под кнопками: ссылка в сторону, а не действие. */
    footer?: ReactNode;
    onSubmit?: () => void;
    /**
     * Крестик у заголовка: закрыть панель без ответа, тем же жестом, каким закрывают лист
     * и шторку (ui/Sheet, ui/Shade). Стоит он не у всякой панели — у входа и у отказов
     * («Канала нет», код закрытой частоты) кнопка внизу и так одна, и крестик рядом с ней
     * повторял бы её же. Нужен он там, где панель можно оставить без ответа и вернуться,
     * откуда пришли: создание канала, переоснащение корабля.
     */
    onClose?: () => void;
}

export default function Panel({ title, hint, children, actions, footer, onSubmit, onClose }: PanelProps) {
    const content = (
        <>
            {onClose && <CloseButton onClick={onClose} />}
            {/* Мотается только тело: кнопки под ним стоят своей строкой и с места не уходят
                (см. ui/Actions). Поэтому и прокрутка кончается там же, где кончается текст. */}
            <div className={styles.body}>
                {title && <h1 className={styles.title}>{title}</h1>}
                {hint && <p className={styles.hint}>{hint}</p>}
                {/* Поля стоят колонкой с просветом между ними, и просвет этот — её, а не полей
                    (см. .fields). Своим нижним отступом поле уносило бы его и под последнее. */}
                <div className={styles.fields}>{children}</div>
            </div>
            {actions && <Actions aboveFooter={Boolean(footer)}>{actions}</Actions>}
            {footer && <p className={styles.footer}>{footer}</p>}
        </>
    );

    const look = [styles.card, onClose ? styles.cardWithClose : ''].filter(Boolean).join(' ');

    if (!onSubmit) {
        return <div className={look}>{content}</div>;
    }

    const handleSubmit = (event: SyntheticEvent) => {
        event.preventDefault();
        onSubmit();
    };

    return (
        <form className={look} onSubmit={handleSubmit}>
            {content}
        </form>
    );
}
