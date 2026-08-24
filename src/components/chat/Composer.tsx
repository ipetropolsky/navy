import { Ref, SyntheticEvent, useEffect, useRef, useState } from 'react';

import IconButton from '@/components/ui/IconButton';
import Input from '@/components/ui/Input';
import { paced } from '@/config/time';
import { limitMessage, overLimit } from '@/utils/limit';
import { AuthorLook, MAX_MESSAGE_LENGTH, Message } from '@shared/types/channel';

import MessageBody from '@/components/chat/MessageBody';
import ReplyQuote from '@/components/chat/ReplyQuote';

import styles from './Composer.module.less';

interface ComposerProps {
    replyTo: Message | null;
    /** Каким автор цитируемой реплики стоит в ленте. Его самого на рейде может уже не быть. */
    replyToAuthor: AuthorLook | null;
    onCancelReply: () => void;
    onSend: (text: string) => void;
    /**
     * Набрано больше, чем можно отправить: готовая фраза о том, насколько именно.
     * Показать её — дело того, кто нас позвал: снекбар живёт снаружи.
     */
    onTooLong: (message: string) => void;
    /** Вызывается на каждое изменение текста: добавленные символы (или '\b' при удалении). */
    onTyped: (chars: string) => void;
    /**
     * Ссылка на саму плашку. Нужна она снаружи затем, что высотой плашки меряется пол
     * разговора — то, во что он сворачивается свайпом (см. `floor` в App): постоянным числом
     * её не запишешь, плашка растёт от ответа над полем и от выреза экрана снизу.
     */
    ref?: Ref<HTMLFormElement>;
}

/**
 * Что человек набрал этим изменением: добавленные символы, а если ничего не добавилось,
 * но что-то исчезло — '\b'. Считается разностью двух строк с обоих концов, а не длиной:
 * править текст можно не только с конца.
 *
 * Ровно на этом и наступали. Сравнение по длине и по началу строки видело только дописанное
 * в конец: набранное поверх выделения не передавалось вовсе (текст стал короче — значит
 * стёрли), замена одной буквы на другую не давала даже этого (длина не изменилась), а буква,
 * вставленная в середину, терялась молча. Разность концов ловит все эти случаи одинаково:
 * общее начало и общий конец — это то, чего человек не трогал, а между ними и есть его правка.
 */
const typedChars = (prev: string, next: string): string => {
    let head = 0;
    while (head < prev.length && head < next.length && prev[head] === next[head]) {
        head += 1;
    }
    let tail = 0;
    while (
        tail < prev.length - head &&
        tail < next.length - head &&
        prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
    ) {
        tail += 1;
    }
    const added = next.slice(head, next.length - tail);
    if (added) {
        return added;
    }
    return next.length < prev.length ? '\b' : '';
};

/**
 * Как часто набранное уходит наружу, мс.
 *
 * Каждая буква — это новый повод передавать для лампы своего корабля, а лампа живёт в кадре:
 * буква перерисовывает всё приложение целиком. При беглом наборе это десяток полных отрисовок
 * в секунду на пустом месте.
 *
 * Копится набранное куском и уходит раз в треть секунды. На глаз ничего не меняется: лампа
 * и так проигрывает очередь посегментно и своей скоростью (см. useMorseLamp) — знак в ней
 * идёт около секунды, и треть секунды на его фоне не видна.
 *
 * Треть секунды — примерно два-три знака беглого набора: короче не даёт выигрыша, длиннее
 * начинает читаться задержкой отклика лампы на первую букву.
 */
const TYPING_SEND_MS = 300;

/** Поле ввода в стиле Telegram: плашка ответа, кнопка отправки появляется при вводе. */
export default function Composer({
    replyTo,
    replyToAuthor,
    onCancelReply,
    onSend,
    onTooLong,
    onTyped,
    ref,
}: ComposerProps) {
    const [value, setValue] = useState('');
    const prevValueRef = useRef('');
    const inputRef = useRef<HTMLInputElement>(null);

    /**
     * Ответили на сообщение — курсор сразу в поле. Ответ и есть намерение писать, и второй
     * тычок по полю тут лишний; на телефоне вместе с фокусом поднимается клавиатура.
     *
     * Смотрим на номер сообщения, а не на сам объект: ответить можно и не закрывая панель,
     * перескочив на соседнюю реплику, — тогда фокус нужен снова. А вот перерисовка ленты
     * с тем же ответом фокус не трогает, иначе поле дёргало бы курсор посреди набора.
     */
    const replyId = replyTo?.messageId ?? null;
    useEffect(() => {
        if (replyId) {
            inputRef.current?.focus();
        }
    }, [replyId]);

    /**
     * Набранное, которое ещё не ушло, и таймер его отправки. Первая буква уходит сразу —
     * иначе лампа отзывалась бы на набор с задержкой в треть секунды, — а следующие за ней
     * копятся до конца срока и уходят одним куском.
     *
     * Отправляет всегда таймер, а не сама правка: правка приходит когда угодно, и решение
     * «пора» должно быть в одном месте, иначе хвост набора — последние буквы перед паузой —
     * оставался бы неотправленным.
     */
    const pendingRef = useRef('');
    const sendTimerRef = useRef(0);
    const onTypedRef = useRef(onTyped);
    onTypedRef.current = onTyped;

    const flushTyped = () => {
        sendTimerRef.current = 0;
        const typed = pendingRef.current;
        pendingRef.current = '';
        if (typed) {
            onTypedRef.current(typed);
            // Ушло не пусто — значит набор идёт, и следующий срок отсчитываем от этого мига.
            // Пустой заход отсчёт не продлевает: набор кончился, и ждать больше нечего.
            sendTimerRef.current = window.setTimeout(flushTyped, paced(TYPING_SEND_MS));
        }
    };

    useEffect(() => () => window.clearTimeout(sendTimerRef.current), []);

    const handleChange = (nextValue: string) => {
        const prevValue = prevValueRef.current;
        prevValueRef.current = nextValue;
        setValue(nextValue);
        const typed = typedChars(prevValue, nextValue);
        if (!typed) {
            return;
        }
        pendingRef.current += typed;
        if (!sendTimerRef.current) {
            flushTyped();
        }
    };

    const text = value.trim();
    // Длинное не обрезаем: обрезать чужой текст нельзя. Рамку красит само поле по тому же
    // пределу (см. maxLength ниже и ui/Input), а по нажатию говорим, насколько перебрали.
    const tooLong = overLimit(text, MAX_MESSAGE_LENGTH);

    const handleSubmit = (event: SyntheticEvent) => {
        event.preventDefault();
        if (!text) {
            return;
        }
        if (tooLong) {
            onTooLong(limitMessage(text, MAX_MESSAGE_LENGTH));
            return;
        }
        onSend(text);
        prevValueRef.current = '';
        setValue('');
        inputRef.current?.focus();
    };

    return (
        <form className={styles.composer} ref={ref} onSubmit={handleSubmit} autoComplete="off">
            {replyTo && (
                <div className={styles.replyBar}>
                    <ReplyQuote author={replyToAuthor ?? undefined} text={<MessageBody message={replyTo} />} />
                    <IconButton variant="muted" onClick={onCancelReply} aria-label="Отменить ответ">
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <path
                                d="M6 6 L18 18 M18 6 L6 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </IconButton>
                </div>
            )}
            <div className={styles.inputRow}>
                <Input
                    ref={inputRef}
                    value={value}
                    maxLength={MAX_MESSAGE_LENGTH}
                    placeholder="Сообщение"
                    autoComplete="off"
                    onChange={(event) => handleChange(event.target.value)}
                />
                <IconButton variant="accent" type="submit" inactive={!value.trim()} aria-label="Отправить">
                    {/* Стрелка с вырезом: сплошное левое крыло и обведённое правое — то же
                        перо, сложенное вдвое. Обе кромки идут одним контуром с чётным
                        правилом заливки, так что вырез и есть дырка в фигуре, а не белая
                        накладка поверх: на любой заливке кнопки он остаётся её цветом.
                        Скругления даёт обводка по тому же контуру (round), а не радиусы
                        в самих углах.

                        Фигура вписана в окно по своей габаритной рамке: у стрелки центр
                        тяжести смещён к пятке, и по геометрии она встала бы в круге криво. */}
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                        <path
                            d="M21.65 2.55 15.25 21.45 10.35 13.25 2.35 7.95Z M20.55 4.39 15.34 19.77 11.35 13.1Z"
                            fillRule="evenodd"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinejoin="round"
                        />
                    </svg>
                </IconButton>
            </div>
        </form>
    );
}
