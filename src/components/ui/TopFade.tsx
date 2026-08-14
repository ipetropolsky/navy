import { ReactNode, UIEvent as ReactUIEvent, useEffect, useRef, useState } from 'react';

import { FADE_HEIGHT } from '@/config/layout';

import styles from './TopFade.module.less';

/** Мотается ли этот блок сам: и разрешено, и есть что мотать. */
const scrolls = (node: Element): boolean => {
    const overflow = getComputedStyle(node).overflowY;
    return (overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight;
};

/**
 * Первое, что мотается внутри блока: под полоску уходит именно оно. Ищем в порядке разметки —
 * верхнее и есть то, чей край подходит к полоске. Мотающихся блоков внутри бывает несколько
 * (лента внутри панели, у которой своя прокрутка), но верхний из них один.
 */
const topScroller = (root: HTMLElement): HTMLElement | null => {
    for (const node of root.querySelectorAll<HTMLElement>('*')) {
        if (scrolls(node)) {
            return node;
        }
    }
    return null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

interface TopFadeProps {
    /** Раскладку и фон задаёт хозяин: полоска знает только, что она у верхней кромки. */
    className?: string;
    children: ReactNode;
}

/**
 * Блок с полоской у верхней кромки, под которую уходит прокручиваемое содержимое.
 *
 * Прокручиваемое иначе обрывается по кромке ровной линией: реплика или строчка формы срезана
 * пополам, и срез читается краем разметки, а не продолжением списка. Градиент от цвета фона
 * к прозрачному растворяет уходящее в этом же фоне: видно, что там ещё что-то есть.
 *
 * Полоска набирается на первых пикселях прокрутки (FADE_HEIGHT) и пропадает, когда домотали
 * до верха: над первой строкой ей висеть незачем. Своего перехода у неё поэтому нет — она идёт
 * за пальцем, и любой переход тут отставал бы.
 *
 * Цвет берётся из `--fade-from`: блоков с полоской в приложении три — шторка, чат и форма
 * поверх него, — и фон у них разный, а правило одно.
 *
 * Чей край подходит к полоске, ищем не на каждое событие прокрутки, а на смену содержимого:
 * обход разметки в обработчике, который зовут по разу на кадр, — самое верное место, чтобы
 * лента начала запинаться. Смены размеров это не ловит нарочно: перестав мотаться, блок
 * присылает прокрутку в ноль сам, и полоска гаснет вместе с ней.
 */
export default function TopFade({ className, children }: TopFadeProps) {
    const [fade, setFade] = useState(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const fadeFor = (scroller: HTMLElement | null): number =>
        scroller ? clamp(scroller.scrollTop / FADE_HEIGHT, 0, 1) : 0;

    useEffect(() => {
        scrollerRef.current = bodyRef.current && topScroller(bodyRef.current);
        setFade(fadeFor(scrollerRef.current));
    }, [children]);

    /**
     * Прокрутка внутри блока. Ловим на погружении: событие прокрутки не всплывает, и на самом
     * блоке его иначе не увидеть. Считаем только по верхнему — нижние (лента внутри панели
     * со своей прокруткой) до полоски не достают.
     */
    const handleScrollCapture = (event: ReactUIEvent<HTMLElement>) => {
        if (event.target === scrollerRef.current) {
            setFade(fadeFor(scrollerRef.current));
        }
    };

    return (
        <div
            className={[styles.body, className].filter(Boolean).join(' ')}
            ref={bodyRef}
            onScrollCapture={handleScrollCapture}
        >
            {/* Полоска лежит поверх содержимого и ничего под собой не ловит: и нажатие,
                и потяг за шторку проходят сквозь неё насквозь. */}
            <div className={styles.fade} style={{ opacity: fade }} aria-hidden="true" />
            {children}
        </div>
    );
}
