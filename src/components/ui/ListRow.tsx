import { KeyboardEvent, MouseEvent, PointerEvent, ReactNode, useRef } from 'react';

import { Press, isTap, startPress } from '@/utils/tap';

import styles from './ListRow.module.less';

/**
 * Нажимаемая строчка списка: значок слева, заголовок с подзаголовком, метка словами и значок
 * действия справа. Одна на два списка — кораблей на рейде (components/channel/MembersList)
 * и своих каналов на главной (components/channel/ChannelsList): выглядят они одинаково
 * нарочно, и повторять разметку с разбором нажатия дважды значило бы однажды поправить
 * только одну из них.
 *
 * Строчка — не `button`, а `div` с ролью кнопки, и на то две причины сразу. Из настоящей
 * кнопки не выделишь текст, а выделять есть что: позывной переписывают в разговор, адрес
 * канала — в письмо. И кнопку нельзя вложить в кнопку, а внутри строчки их до трёх: значок
 * слева, отметка у заголовка, действие справа. Значит, клавиатуру строчка отрабатывает
 * сама — вводом и пробелом, как кнопка.
 */

interface ListRowProps {
    /**
     * Как строчка называется при чтении с экрана. Своё, а не собранное из содержимого:
     * собранное вышло бы из заголовка, подзаголовка, метки и подписей всех вложенных кнопок
     * разом — читать такое невозможно.
     */
    label: string;
    /** Слева: аватарка, значок — то, по чему строчку узнают, не читая. */
    icon?: ReactNode;
    /** Первая строка: название. С ним в строку встаёт и всё, что к нему относится. */
    title: ReactNode;
    /** Вторая строка, помельче и потусклее: что это за предмет. */
    subtitle?: ReactNode;
    /** Метка у правого края словами. Прячется сама, когда список становится узок. */
    badge?: ReactNode;
    /** Значок действия справа: по нему видно, что случится, ещё до нажатия. */
    action?: ReactNode;
    /** Строчка отмечена — своя, нынешняя, открытая. Подсвечена всегда. */
    active?: boolean;
    /** Тычок или ввод по самой строчке (не по вложенной кнопке). */
    onOpen: () => void;
}

export default function ListRow({ label, icon, title, subtitle, badge, action, active, onOpen }: ListRowProps) {
    /** С чего началось нажатие: откуда и при каком выделении (см. `@/utils/tap`). */
    const pressRef = useRef<Press | null>(null);

    /**
     * Тычок по строчке — открыть. Но строчка состоит из текста, и протяжка по нему значит
     * «выделить и скопировать». Отличаем одно от другого общим правилом (`isTap`).
     */
    const handleTap = (event: MouseEvent<HTMLDivElement>): void => {
        const press = pressRef.current;
        pressRef.current = null;
        // Внутри строчки есть свои кнопки, и их нажатия всплывают сюда же. У каждой своё дело,
        // и строчкино поверх него делать не надо. Спрашиваем один раз про все, а не глушим
        // всплытие в каждой: кнопки эти разные и приходят из разных мест.
        if ((event.target as Element).closest('button')) {
            return;
        }
        if (!isTap(press, event)) {
            return;
        }
        onOpen();
    };

    const handleKey = (event: KeyboardEvent<HTMLDivElement>): void => {
        // Нажатия вложенных кнопок сюда всплывают тоже, и без этого ввод по отметке у заголовка
        // открывал бы заодно и строчку. Своё нажатие у строчки то, что пришло прямо в неё.
        if (event.target !== event.currentTarget) {
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen();
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={label}
            className={active ? styles.rowActive : styles.row}
            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                pressRef.current = startPress(event);
            }}
            onClick={handleTap}
            onKeyDown={handleKey}
        >
            {icon}
            <span className={styles.info}>
                <span className={styles.headline}>{title}</span>
                {subtitle !== undefined && <span className={styles.caption}>{subtitle}</span>}
            </span>
            {/* Прячет метку не разметка, а сам список: хватает ли ей места — вопрос его ширины,
                и отвечает на него @container в стилях. */}
            {badge !== undefined && <span className={styles.badge}>{badge}</span>}
            {action}
        </div>
    );
}
