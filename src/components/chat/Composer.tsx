import { SyntheticEvent, useRef, useState } from 'react';

import { Member, Message } from '@/types/channel';

import styles from './Composer.module.less';

interface ComposerProps {
    replyTo: Message | null;
    replyToAuthor: Member | null;
    onCancelReply: () => void;
    onSend: (text: string) => void;
    /** Вызывается на каждое изменение текста: добавленные символы (или '\b' при удалении). */
    onTyped: (chars: string) => void;
}

/** Поле ввода в стиле Telegram: плашка ответа, кнопка отправки появляется при вводе. */
export default function Composer({ replyTo, replyToAuthor, onCancelReply, onSend, onTyped }: ComposerProps) {
    const [value, setValue] = useState('');
    const prevValueRef = useRef('');
    const inputRef = useRef<HTMLInputElement>(null);

    const handleChange = (nextValue: string) => {
        const prevValue = prevValueRef.current;
        prevValueRef.current = nextValue;
        setValue(nextValue);
        if (nextValue.length > prevValue.length && nextValue.startsWith(prevValue)) {
            onTyped(nextValue.slice(prevValue.length));
        } else if (nextValue.length < prevValue.length) {
            onTyped('\b');
        }
    };

    const handleSubmit = (event: SyntheticEvent) => {
        event.preventDefault();
        const text = value.trim();
        if (!text) {
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
                    <div className={styles.replyInfo}>
                        <span className={styles.replyAuthor}>Ответ: {replyToAuthor?.name}</span>
                        <span className={styles.replyText}>{replyTo.text}</span>
                    </div>
                    <button
                        type="button"
                        className={styles.cancelReply}
                        onClick={onCancelReply}
                        aria-label="Отменить ответ"
                    >
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                            <path
                                d="M6 6 L18 18 M18 6 L6 18"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </div>
            )}
            <div className={styles.inputRow}>
                <input
                    ref={inputRef}
                    className={styles.input}
                    type="text"
                    value={value}
                    placeholder="Сообщение"
                    autoComplete="off"
                    onChange={(event) => handleChange(event.target.value)}
                />
                <button type="submit" className={value.trim() ? styles.send : styles.sendHidden} aria-label="Отправить">
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                        <path d="M3 11.6 20.5 4.2c.8-.34 1.6.46 1.27 1.26L14.4 21c-.37.9-1.67.83-1.95-.1l-1.9-6.3-6.4-1.9c-.94-.28-1-1.58-.15-2.1z" />
                    </svg>
                </button>
            </div>
        </form>
    );
}
