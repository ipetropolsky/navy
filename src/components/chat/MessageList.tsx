import { ReactNode, useEffect, useRef } from 'react';

import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import { Member, Message } from '@/types/channel';

import ReplyQuote from '@/components/chat/ReplyQuote';

import styles from './MessageList.module.less';

// Хранилище держит время числом, а как его показать — дело интерфейса.
const formatTime = (at: number): string =>
    new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const formatDate = (at: number): string => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

/**
 * Выделение в системной строчке. Бэкенд помечает изменившееся двумя звёздочками — тем же
 * знаком, что и markdown, — а лента превращает пометку в жирное. Разметка нарочно сведена
 * к одному приёму: полноценный markdown в служебной строке не нужен, а текст без разбора
 * всё равно читается.
 */
const emphasise = (text: string): ReactNode[] =>
    text.split('**').map((part, index) =>
        // Ключ по порядку тут и есть тождество: куски различаются только местом в строке.
        index % 2 ? <strong key={index}>{part}</strong> : part
    );

interface MessageListProps {
    messages: Message[];
    members: Member[];
    /** Чьи сообщения показывать своими — справа и без подписи. */
    myId: string;
    onReply: (message: Message) => void;
}

/** Лента сообщений в стиле Telegram: группировка по автору, ответы, тап по сообщению — ответить. */
export default function MessageList({ messages, members, myId, onReply }: MessageListProps) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const list = listRef.current;
        if (list) {
            list.scrollTop = list.scrollHeight;
        }
    }, [messages.length]);

    const byId = new Map(members.map((member) => [member.memberId, member]));
    // По кому группировать подряд идущие сообщения. Системная запись не группируется ни с чем:
    // иначе реплика вошедшего прилипла бы к строчке о его входе и осталась без подписи.
    const groupKey = (message: Message): string =>
        message.kind === 'system' ? message.messageId : message.author.memberId;

    return (
        <div ref={listRef} className={styles.list}>
            {messages.length > 0 && <div className={styles.dateChip}>{formatDate(messages[0].sentAt)}</div>}
            {messages.map((message, index) => {
                if (message.kind === 'system') {
                    return (
                        <div key={message.messageId} className={styles.systemChip}>
                            {emphasise(message.text)}
                        </div>
                    );
                }

                const own = message.author.memberId === myId;
                const author = byId.get(message.author.memberId);
                const prev = messages[index - 1];
                const next = messages[index + 1];
                const firstOfGroup = !prev || groupKey(prev) !== groupKey(message);
                const lastOfGroup = !next || groupKey(next) !== groupKey(message);
                const thread = message.thread;
                const replyTo = thread
                    ? messages.find((candidate) => candidate.messageId === thread.messageId)
                    : undefined;

                return (
                    <div key={message.messageId} className={own ? styles.rowOwn : styles.row}>
                        {!own && (
                            <div className={styles.avatarCell}>
                                {lastOfGroup && author && <Avatar number={author.hullNumber} name={author.name} />}
                            </div>
                        )}
                        <button
                            type="button"
                            className={own ? styles.bubbleOwn : styles.bubble}
                            onClick={() => onReply(message)}
                            title="Ответить"
                        >
                            {!own && firstOfGroup && author && (
                                <span className={styles.author}>
                                    <MemberName name={author.name} color={author.color} />
                                </span>
                            )}
                            {replyTo && (
                                <span className={styles.replyCell}>
                                    <ReplyQuote author={byId.get(replyTo.author.memberId)} text={replyTo.text} />
                                </span>
                            )}
                            <span className={styles.text}>
                                {message.text}
                                <span className={styles.time}>{formatTime(message.sentAt)}</span>
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
