import { InputHTMLAttributes, ReactNode, Ref } from 'react';

import { overLimit } from '@/utils/limit';

import styles from './Input.module.less';

/**
 * Поле ввода. Одно на всё приложение: и строка сообщения в ленте, и поля форм — это оно.
 * Своих полей в компонентах не заводим, иначе через два экрана они разъезжаются по радиусам,
 * фонам и подсветке фокуса.
 *
 * `maxLength` здесь мягкий и до разметки не доходит: браузер по этому атрибуту молча
 * не пускает лишние знаки, а набранное сверх предела обрезать нельзя — вставленный текст
 * терялся бы хвостом, о котором никто не сказал. Вместо этого поле краснеет, а насколько
 * перебрали, говорит снекбар по нажатию на отправку (`@/utils/limit`). Правило одно на все
 * поля с пределом, и живёт оно здесь, а не переписывается в каждой форме.
 */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    /** Набрано не то: рамка краснеет. Что именно не так — говорит снекбар или подпись поля. */
    invalid?: boolean;
    /** Поле под несколько знаков: бортовой номер. */
    compact?: boolean;
    /** Поле на одно слово: половина ширины формы, но не уже 350px. */
    half?: boolean;
    /** Кнопка внутри поля справа — например, скопировать набранное. */
    action?: ReactNode;
    /** Нужен там, где фокус ставится руками: после отправки сообщения. */
    ref?: Ref<HTMLInputElement>;
}

export default function Input({
    invalid = false,
    compact = false,
    half = false,
    action,
    type = 'text',
    maxLength,
    value,
    ...rest
}: InputProps) {
    // Набрано лишнее — то же самое «не то», что и `invalid`: рамка краснеет одинаково,
    // разница только в том, кто это заметил — форма или общая мерка длины.
    const tooLong = maxLength !== undefined && typeof value === 'string' && overLimit(value, maxLength);
    // Ширину поля с кнопкой держит обёртка, а не само поле: кнопка стоит внутри поля у правого
    // края, и отмерять её от строки формы, а не от поля, значит увести её от кромки.
    const className = [
        invalid || tooLong ? styles.inputInvalid : styles.input,
        compact ? styles.compact : '',
        half && !action ? styles.half : '',
    ]
        .filter(Boolean)
        .join(' ');
    // Подсказок браузера полям в приложении не нужно ни одному: ни адресов с телефонами,
    // ни прежде набранного. На телефоне за подсказки платят экраном — над клавиатурой встаёт
    // ещё одна панель и съедает те строчки разговора, ради которых поле и открывали.
    //
    // Атрибутов три, потому что подсказок три разных. `autoComplete` — про список прежде
    // набранного, который браузер роняет из-под поля. `autoCorrect` со `spellCheck` — про
    // экранную клавиатуру: по ним она сама решает, показывать ли полосу с угадыванием слова
    // и править ли набранное за человека. Одного `autoComplete` для неё мало, и на Android
    // полоса оставалась стоять. Позывные, бортовые номера и морские словечки угадывать всё
    // равно нечем, а исправлять их за человека — тем более.
    //
    // Написано до `rest`: понадобится где-то настоящее автозаполнение — поле скажет своё,
    // и оно перебьёт это.
    const input = (
        <input
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            {...rest}
            value={value}
            type={type}
            className={className}
        />
    );

    if (!action) {
        return input;
    }

    return (
        <span className={[styles.withAction, half ? styles.half : ''].filter(Boolean).join(' ')}>
            {input}
            <span className={styles.action}>{action}</span>
        </span>
    );
}
