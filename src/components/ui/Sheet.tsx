import { ReactNode, SyntheticEvent } from 'react';

import Actions from '@/components/ui/Actions';

import styles from './Sheet.module.less';

/**
 * Лист: то, чем устроено содержимое всего, что выезжает поверх, — шторки (`ui/Shade`) и слоя
 * в блоке разговора. Список кораблей, карточка чужого корабля, прощание с рейдом устроены
 * одинаково: заголовок вровень с крестиком, тело со своей прокруткой, полоса кнопок под ним.
 *
 * Раскладку эту задаёт лист, а не содержимое. Иначе каждое списывает её себе: где стоит
 * крестик, на сколько поднято тело под ручку, какое у хозяина поле, — и однажды они
 * расходятся. Содержимое говорит только, что показать.
 *
 * Числа лист берёт от хозяина переменными (--sheet-pad, --close-top, --close-size,
 * --sheet-grow), потому что они у хозяев разные: у шторки поле в двадцать пикселей и ручка
 * над содержимым, у слоя в панели шириной в треть окна — двенадцать и никакой ручки.
 * Правила при этом одни.
 *
 * С `onSubmit` это форма, без него — просто блок: разметка та же, разница только в теге.
 * Так же устроен и `ui/Panel` — плашка на месте ленты.
 */

interface SheetProps {
    /**
     * Название. Стоит вровень с крестиком и в его сторону не залезает; чем набрано — дело
     * содержимого. Нет названия — нет и строки под него.
     */
    title?: ReactNode;
    /** Полоса кнопок под телом. */
    actions?: ReactNode;
    /**
     * В полосе есть контрол, которого нельзя тянуть, — переключатель. Тогда ширину не делит
     * никто (см. ui/Actions). Знает об этом содержимое: оно эту полосу и наполняет.
     */
    ownWidth?: boolean;
    /**
     * Лист не впритык к кромкам хозяина: нужно там, где внутри картинка во всю ширину —
     * портрет корабля иначе упирался бы в края шторки.
     */
    inset?: boolean;
    onSubmit?: () => void;
    children: ReactNode;
}

export default function Sheet({ title, actions, ownWidth = false, inset = false, onSubmit, children }: SheetProps) {
    const content = (
        <>
            <div className={styles.body}>
                {title && <div className={styles.title}>{title}</div>}
                {children}
            </div>
            {actions && <Actions ownWidth={ownWidth}>{actions}</Actions>}
        </>
    );
    const look = [styles.sheet, inset ? styles.sheetInset : ''].filter(Boolean).join(' ');

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
