import { useEffect, useRef } from 'react';

import HullBadge from '@/components/ships/HullBadge';
import { Member, Message } from '@/types/channel';

import styles from './MessageList.module.less';

// Хранилище держит время числом, а как его показать — дело интерфейса.
const formatTime = (at: number): string =>
    new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const formatDate = (at: number): string => new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

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

    const byId = new Map(members.map((member) => [member.id, member]));
    // По кому группировать подряд идущие сообщения. Системная запись не группируется ни с чем:
    // иначе реплика вошедшего прилипла бы к строчке о его входе и осталась без подписи.
    const groupKey = (message: Message): string => (message.kind === 'system' ? message.id : message.memberId);
    // Цвет позывного выбирает сам участник, поэтому он лежит в его данных, а не считается здесь.
    const colorOf = (memberId: string): string => byId.get(memberId)?.color ?? 'var(--color-text-muted)';

    return (
        <div ref={listRef} className={styles.list}>
            {messages.length > 0 && <div className={styles.dateChip}>{formatDate(messages[0].sentAt)}</div>}
            {messages.map((message, index) => {
                if (message.kind === 'system') {
                    return (
                        <div key={message.id} className={styles.systemChip}>
                            {message.text}
                        </div>
                    );
                }

                const own = message.memberId === myId;
                const author = byId.get(message.memberId);
                const prev = messages[index - 1];
                const next = messages[index + 1];
                const firstOfGroup = !prev || groupKey(prev) !== groupKey(message);
                const lastOfGroup = !next || groupKey(next) !== groupKey(message);
                const replyTo = message.threadId
                    ? messages.find((candidate) => candidate.id === message.threadId)
                    : undefined;

                return (
                    <div key={message.id} className={own ? styles.rowOwn : styles.row}>
                        {!own && (
                            <div className={styles.avatarCell}>
                                {lastOfGroup && author && (
                                    <div className={styles.avatar} title={author.name}>
                                        <HullBadge number={author.hullNumber} />
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            type="button"
                            className={own ? styles.bubbleOwn : styles.bubble}
                            onClick={() => onReply(message)}
                            title="Ответить"
                        >
                            {!own && firstOfGroup && author && (
                                <span className={styles.author} style={{ color: colorOf(author.id) }}>
                                    {author.name}
                                </span>
                            )}
                            {replyTo && (
                                <span className={styles.replyQuote} style={{ borderColor: colorOf(replyTo.memberId) }}>
                                    <span className={styles.replyAuthor} style={{ color: colorOf(replyTo.memberId) }}>
                                        {byId.get(replyTo.memberId)?.name}
                                    </span>
                                    <span className={styles.replyText}>{replyTo.text}</span>
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
