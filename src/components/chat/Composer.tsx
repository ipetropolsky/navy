import { SyntheticEvent, useRef, useState } from 'react';

import IconButton from '@/components/ui/IconButton';
import Input from '@/components/ui/Input';
import { MAX_MESSAGE_LENGTH, Member, Message } from '@/types/channel';

import ReplyQuote from '@/components/chat/ReplyQuote';

import styles from './Composer.module.less';

interface ComposerProps {
    replyTo: Message | null;
    replyToAuthor: Member | null;
    onCancelReply: () => void;
    onSend: (text: string) => void;
    /** Набрано больше, чем можно отправить. Показать это — дело того, кто нас позвал. */
    onTooLong: (length: number) => void;
    /** Вызывается на каждое изменение текста: добавленные символы (или '\b' при удалении). */
    onTyped: (chars: string) => void;
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

/** Поле ввода в стиле Telegram: плашка ответа, кнопка отправки появляется при вводе. */
export default function Composer({ replyTo, replyToAuthor, onCancelReply, onSend, onTooLong, onTyped }: ComposerProps) {
    const [value, setValue] = useState('');
    const prevValueRef = useRef('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleChange = (nextValue: string) => {
        const prevValue = prevValueRef.current;
        prevValueRef.current = nextValue;
        setValue(nextValue);
        const typed = typedChars(prevValue, nextValue);
        if (typed) {
            onTyped(typed);
        }
    };

    const text = value.trim();
    // Длинное не обрезаем: обрезать чужой текст нельзя. Рамкой показываем, что отправить
    // это нельзя, а по нажатию говорим, насколько именно перебрали.
    const tooLong = text.length > MAX_MESSAGE_LENGTH;

    const handleSubmit = (event: SyntheticEvent) => {
        event.preventDefault();
        if (!text) {
            return;
        }
        if (tooLong) {
            onTooLong(text.length);
            return;
        }
        onSend(text);
        prevValueRef.current = '';
        setValue('');
        inputRef.current?.focus();
    };

    return (
        <form className={styles.composer} onSubmit={handleSubmit}>
            {replyTo && (
                <div className={styles.replyBar}>
                    <ReplyQuote author={replyToAuthor ?? undefined} text={replyTo.text} />
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
                    invalid={tooLong}
                    placeholder="Сообщение"
                    autoComplete="off"
                    onChange={(event) => handleChange(event.target.value)}
                />
                <IconButton variant="accent" type="submit" inactive={!value.trim()} aria-label="Отправить">
                    {/* Начало окна сдвинуто: у стрелки центр тяжести слева, и в круге она
                        смотрится съехавшей, если поставить её ровно по геометрии. */}
                    <svg viewBox="-1.5 0 24 24" width="22" height="22" aria-hidden="true">
                        <path d="M3 11.6 20.5 4.2c.8-.34 1.6.46 1.27 1.26L14.4 21c-.37.9-1.67.83-1.95-.1l-1.9-6.3-6.4-1.9c-.94-.28-1-1.58-.15-2.1z" />
                    </svg>
                </IconButton>
            </div>
        </form>
    );
}
