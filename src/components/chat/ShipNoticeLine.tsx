import { Fragment, ReactNode } from 'react';

import { SHIP_KIND_LABELS, ShipField, ShipNotice, ShipTitle } from '@/types/channel';

/**
 * Строчка канала о корабле: вошёл, переоснастился, снялся с рейда.
 *
 * Фраза складывается здесь, а не на бэкенде: оттуда приходят только данные — каким корабль
 * был, каким стал и что именно в нём поменялось (см. `ShipNotice`). Зашитая в хранилище фраза
 * означала бы, что поправить формулировку можно только правкой уже записанного.
 */

/**
 * Как корабль зовут в строчке о входе и уходе: тип и позывной. Бортового номера здесь нет —
 * он стоит на аватарке рядом со строчкой и на борту в кадре, и третий раз подряд ему в ленте
 * делать нечего.
 */
const TITLE_ORDER: ShipField[] = ['shipKind', 'name'];

/** Название силуэта со строчной буквы: в середине фразы оно идёт не первым словом. */
const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** Позывной в кавычках, остальное как есть: кавычки — часть того, как корабль зовут. */
const part = (ship: ShipTitle, field: ShipField, sentenceStart: boolean): ReactNode => {
    if (field === 'shipKind') {
        const label = SHIP_KIND_LABELS[ship.shipKind];
        return sentenceStart ? label : lower(label);
    }
    return field === 'name' ? <>«{ship.name}»</> : ship.hullNumber;
};

/** Как корабль зовут: тип и позывной, с большой буквы — фраза с этого и начинается. */
function Title({ ship }: { ship: ShipTitle }) {
    return (
        <>
            {TITLE_ORDER.map((field, index) => (
                <Fragment key={field}>
                    {index > 0 && ' '}
                    {part(ship, field, index === 0)}
                </Fragment>
            ))}
        </>
    );
}

interface ShipNoticeLineProps {
    notice: ShipNotice;
}

/**
 * Переоснащение: одна перемена — одна строчка. Корабль тут не назван вовсе, потому что называть
 * его незачем: строчка стоит в его же цепочке, с его аватаркой и позывным над ней, — а полный
 * титул в каждой строчке делал бы ленту из трёх перемен тремя почти одинаковыми абзацами,
 * в которых разницу пришлось бы искать глазами.
 *
 * Номер — единственное, что показано парой: «042 теперь 782». Три цифры сами по себе ничего
 * не значат, и «теперь 782» осталось бы новостью без предмета; позывной же и силуэт говорят
 * за себя, и старое их значение стоит строчкой выше в той же ленте. Оба номера помечены:
 * в паре почти одинаковых чисел глазу нужно за что-то зацепиться.
 */
function RefitLine({ notice }: ShipNoticeLineProps): ReactNode {
    // Без `after` переоснащения не бывает, но тип этого не обещает, а показывать «было»
    // под видом «стало» нельзя.
    const { after, changed } = notice;
    if (!after || !changed) {
        return null;
    }
    if (changed === 'hullNumber') {
        return (
            <>
                <strong>{notice.before.hullNumber}</strong> теперь <strong>{after.hullNumber}</strong>
            </>
        );
    }
    return <>Теперь {part(after, changed, false)}</>;
}

export default function ShipNoticeLine({ notice }: ShipNoticeLineProps): ReactNode {
    const who = <Title ship={notice.before} />;
    switch (notice.event) {
        case 'refit':
            return <RefitLine notice={notice} />;
        case 'left':
            // «Сняться с рейда» — это и значит покинуть якорную стоянку: подняли якорь
            // и пошли. Ровно то, что происходит в кадре, и ровно так об этом и говорят.
            return <>{who} снялся с рейда</>;
        case 'kicked':
            return <>{who} выдворен с рейда</>;
        case 'joined':
        default:
            return <>{who} встал на рейд</>;
    }
}
