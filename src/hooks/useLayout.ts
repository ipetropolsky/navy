import { useCallback, useEffect, useState } from 'react';

import { SCENE_MIN_WIDTH, SIDE_MIN_WIDTH, SIDE_MIN_WINDOW, SIDE_WIDTH } from '@/config/layout';
import { sessionStore } from '@/utils/storage';

/**
 * Раскладка приложения и то, что о ней помнит вкладка.
 *
 * Здесь одно место, где раскладка сверяется с окном, и несколько разных проверок в нём:
 * помещается ли боковая панель в это окно, не уже ли она своего минимума, не шире ли того,
 * что оставляет кадру его минимум. Раньше проверка была одна и жила в медиа-запросе, а ширина
 * была числом; с изменяемой шириной этого мало — окно меняется и без ведома человека
 * (повернули планшет, вытащили ноутбук из док-станции), и раскладка обязана сама съехать
 * на допустимое.
 *
 * Держится это разделением на два: **выбор** — то, что человек попросил, и **раскладка** —
 * то, что из этого выбора помещается в нынешнее окно. Выбор пишется в sessionStorage и меняется
 * только явными действиями: нажал кнопку, потянул за коридор. Окно, ставшее тесным, выбора
 * не трогает — оно лишь урезает то, что из него выходит, и стоит окну раздаться обратно,
 * панель возвращается к выбранной ширине. Иначе одно случайное сужение стирало бы выбор
 * насовсем, а восстановить его было бы неоткуда.
 */

/** Что человек выбрал: раскладка, положение блока контента и ширина боковой панели. */
export interface LayoutWish {
    /** Раскладка «больше сцены»: кадр забирает окно, блоку контента остаётся сжатая мерка. */
    expanded: boolean;
    /** Разговор сбоку от кадра, а не под ним. */
    side: boolean;
    /** Ширина боковой панели, px. */
    sideWidth: number;
}

/** Раскладка вместе с пределами, в которых её можно менять прямо сейчас. */
export interface Layout extends LayoutWish {
    /** Возможна ли боковая раскладка в этом окне вообще: кнопку переезда показывать по нему. */
    sideFits: boolean;
    /** Куда упирается потяг за коридор, px. */
    minWidth: number;
    maxWidth: number;
}

/** Ключ в sessionStorage. Именно session: раскладка — про эту вкладку, а не про человека. */
const STORAGE_KEY = 'navy:layout';

const DEFAULT_WISH: LayoutWish = { expanded: false, side: false, sideWidth: SIDE_WIDTH };

/** Самая широкая панель, при которой кадру рядом остаётся его минимум, px. */
export const maxSideWidth = (windowWidth: number): number => windowWidth - SCENE_MIN_WIDTH;

/**
 * Помещается ли боковая раскладка в окно такой ширины. Порог тут не отдельное число, а тот же
 * ответ, что и у остальных проверок: самая узкая панель рядом с самым узким кадром.
 */
export const sideFits = (windowWidth: number): boolean => windowWidth >= SIDE_MIN_WINDOW;

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * Что из выбранного помещается в окно такой ширины. Единственное место, где раскладка
 * встречается с геометрией, — и проверок в нём три:
 *
 *   1. сбоку блок стоит только в развёрнутой раскладке: сбоку он во всю высоту окна,
 *      и сжатому кадру рядом с ним не остаётся ничего;
 *   2. сбоку он стоит только там, где помещается вместе с кадром;
 *   3. ширина зажата между своим минимумом и тем, что оставляет кадру его минимум.
 *
 * Функция чистая: ни окна, ни хранилища она не знает — их знает хук ниже. Так её и проверяют.
 */
export const allowedLayout = (wish: LayoutWish, windowWidth: number): Layout => {
    const min = SIDE_MIN_WIDTH;
    // Тесное окно даёт потолок ниже пола. Порядок тут важен: пол сильнее — панель уже своего
    // минимума не бывает, а в таком окне её и не показывают (см. sideFits).
    const max = Math.max(min, maxSideWidth(windowWidth));
    return {
        expanded: wish.expanded,
        side: wish.side && wish.expanded && sideFits(windowWidth),
        sideWidth: clamp(wish.sideWidth, min, max),
        sideFits: sideFits(windowWidth),
        minWidth: min,
        maxWidth: max,
    };
};

/**
 * Что записано во вкладке. Испорченную запись молча заменяем умолчанием: раскладка — не те
 * данные, ради которых стоит показывать человеку ошибку, а чужая вкладка могла записать сюда
 * что угодно и в прошлой версии приложения.
 */
const readWish = (): LayoutWish => {
    try {
        const saved: unknown = JSON.parse(sessionStore.read(STORAGE_KEY) ?? 'null');
        if (!saved || typeof saved !== 'object') {
            return DEFAULT_WISH;
        }
        const { expanded, side, sideWidth } = saved as Partial<LayoutWish>;
        return {
            expanded: typeof expanded === 'boolean' ? expanded : DEFAULT_WISH.expanded,
            side: typeof side === 'boolean' ? side : DEFAULT_WISH.side,
            sideWidth: typeof sideWidth === 'number' && Number.isFinite(sideWidth) ? sideWidth : DEFAULT_WISH.sideWidth,
        };
    } catch {
        return DEFAULT_WISH;
    }
};

/** Записать выбор. Запрещённое хранилище — приватный режим, кончившаяся квота — молча пропускаем:
 *  за это отвечает сама дверь в хранилище (см. utils/storage). */
const writeWish = (wish: LayoutWish): void => sessionStore.write(STORAGE_KEY, JSON.stringify(wish));

/** Ширина окна. Меняется она и без ведома человека, и раскладка обязана это заметить. */
const useWindowWidth = (): number => {
    const [width, setWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        // Между первой отрисовкой и подпиской окно могло измениться — например, пока
        // догружались шрифты и появилась полоса прокрутки.
        onResize();
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return width;
};

export interface LayoutControls {
    /** Раскладка, в которой приложение стоит прямо сейчас. */
    layout: Layout;
    /** Выбор человека: применяется и запоминается. */
    choose: (patch: Partial<LayoutWish> | ((was: LayoutWish) => Partial<LayoutWish>)) => void;
    /**
     * Новая ширина панели: сразу зажатая по нынешнему окну. Записывать её на каждый шаг потяга
     * незачем — по умолчанию не записывается, и запоминает натянутое `keep` в конце.
     */
    resizeSide: (width: number, remember?: boolean) => void;
    /** Запомнить то, что натянули. */
    keep: () => void;
}

export function useLayout(): LayoutControls {
    const [wish, setWish] = useState(readWish);
    const windowWidth = useWindowWidth();

    const apply = useCallback(
        (patch: Partial<LayoutWish> | ((was: LayoutWish) => Partial<LayoutWish>), remember: boolean) =>
            setWish((was) => {
                const next = { ...was, ...(typeof patch === 'function' ? patch(was) : patch) };
                if (remember) {
                    writeWish(next);
                }
                return next;
            }),
        []
    );

    const choose = useCallback<LayoutControls['choose']>((patch) => apply(patch, true), [apply]);

    // Зажимается ширина прямо здесь, а не только при отрисовке: потяг за кромку иначе копил бы
    // ход за пределом — увёл указатель на две сотни дальше упора, и обратно панель тронулась бы
    // только через те же две сотни.
    const resizeSide = useCallback<LayoutControls['resizeSide']>(
        (width, remember = false) =>
            apply(
                { sideWidth: clamp(width, SIDE_MIN_WIDTH, Math.max(SIDE_MIN_WIDTH, maxSideWidth(windowWidth))) },
                remember
            ),
        [apply, windowWidth]
    );

    // Записывается сам выбор, а не то, во что его урезало окно: раздастся окно — панель
    // вернётся к выбранной ширине.
    const keep = useCallback(
        () =>
            setWish((was) => {
                writeWish(was);
                return was;
            }),
        []
    );

    return { layout: allowedLayout(wish, windowWidth), choose, resizeSide, keep };
}
