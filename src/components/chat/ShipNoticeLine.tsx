import { Fragment, ReactNode } from 'react';

import { SHIP_KIND_LABELS, ShipField, ShipNotice, ShipTitle } from '@/types/channel';

/**
 * Строчка канала о корабле: вошёл, переоснастился, снялся с рейда.
 *
 * Фраза складывается здесь, а не на бэкенде: оттуда приходят только данные — каким корабль
 * был, каким стал и что в нём поменялось (см. `ShipNotice`). Зашитая в хранилище фраза
 * означала бы, что поправить формулировку можно только правкой уже записанного.
 */

/** Как корабль зовут целиком: тип, позывной, бортовой номер. */
const TITLE_ORDER: ShipField[] = ['shipKind', 'name', 'hullNumber'];

/**
 * То же без номера. Номер стоит на аватарке рядом со строчкой, и во фразе он повторялся бы
 * третий раз подряд — на аватарке, в строчке и на борту в кадре.
 *
 * У переоснащения номер во фразе всё же остаётся: там он может быть ровно тем, что поменялось,
 * и выбрасывать его значило бы прятать саму новость.
 */
const SHORT_TITLE: ShipField[] = ['shipKind', 'name'];

/** Название силуэта со строчной буквы: в середине фразы оно идёт не первым словом. */
const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

const part = (ship: ShipTitle, field: ShipField, sentenceStart: boolean): string => {
    if (field === 'shipKind') {
        const label = SHIP_KIND_LABELS[ship.shipKind];
        return sentenceStart ? label : lower(label);
    }
    return ship[field];
};

interface TitleProps {
    ship: ShipTitle;
    /** Какие поля пометить. Пусто — фраза идёт ровным текстом. */
    changed?: ShipField[];
    /** Стоит ли титул в начале фразы: от этого зависит только буква в названии типа. */
    sentenceStart?: boolean;
    /** Из чего складывать титул. По умолчанию — целиком, с номером. */
    fields?: ShipField[];
}

/**
 * Корабль назван целиком всегда, даже если поменялся один бортовой номер: перечислять
 * одно изменившееся («теперь 517») короче, но читается это обрывком — строчка о корабле
 * должна называть корабль, а не разницу между двумя его состояниями.
 *
 * Изменившееся при этом помечено: глазу нужно за что-то зацепиться, а искать отличие между
 * двумя почти одинаковыми строчками он не должен. Кавычки в пометку не входят — выделенными
 * они выглядят кляксами по краям позывного.
 */
function Title({ ship, changed = [], sentenceStart = false, fields = TITLE_ORDER }: TitleProps) {
    return (
        <>
            {fields.map((field, index) => {
                const text = part(ship, field, sentenceStart && index === 0);
                const marked = changed.includes(field) ? <strong>{text}</strong> : text;
                return (
                    <Fragment key={field}>
                        {index > 0 && ' '}
                        {field === 'name' ? <>«{marked}»</> : marked}
                    </Fragment>
                );
            })}
        </>
    );
}

interface ShipNoticeLineProps {
    notice: ShipNotice;
}

export default function ShipNoticeLine({ notice }: ShipNoticeLineProps): ReactNode {
    const who = <Title ship={notice.before} fields={SHORT_TITLE} sentenceStart />;
    switch (notice.event) {
        case 'refit':
            // Только «стало», без «было» и без «теперь»: обе половины фразы отличались
            // одним-двумя словами, и строчка выходила вдвое длиннее без нового смысла.
            // Что именно поменялось, видно по пометке, а каким корабль был — по строчкам
            // выше в той же ленте. Без `after` переоснащения не бывает, но тип этого
            // не обещает, а показывать одно «было» под видом «стало» нельзя.
            //
            // Стрелка занимает место выброшенного «теперь»: без неё строчка читается
            // не переменой, а ещё одним кораблём, вставшим на рейд.
            return notice.after ? (
                <>
                    →&nbsp;
                    <Title ship={notice.after} changed={notice.changed} sentenceStart />
                </>
            ) : null;
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
