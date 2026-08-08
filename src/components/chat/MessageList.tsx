import { useEffect, useRef } from 'react';

import ShipAvatar from '@/components/ships/ShipAvatar';
import { AUTHOR_COLORS } from '@/data/demo';
import { Message, Participant } from '@/types/chat';

import styles from './MessageList.module.less';

interface MessageListProps {
    messages: Message[];
    participants: Participant[];
    viewerId: string;
    onReply: (message: Message) => void;
}

/** Лента сообщений в стиле Telegram: группировка по автору, ответы, тап по сообщению — ответить. */
export default function MessageList({ messages, participants, viewerId, onReply }: MessageListProps) {
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const list = listRef.current;
        if (list) {
            list.scrollTop = list.scrollHeight;
        }
    }, [messages.length]);

    const byId = new Map(participants.map((participant) => [participant.id, participant]));
    const colorOf = (authorId: string) => {
        const index = participants.findIndex((participant) => participant.id === authorId);
        return AUTHOR_COLORS[Math.max(index, 0) % AUTHOR_COLORS.length];
    };

    return (
        <div ref={listRef} className={styles.list}>
            <div className={styles.dateChip}>8 августа</div>
            {messages.map((message, index) => {
                const own = message.authorId === viewerId;
                const author = byId.get(message.authorId);
                const prev = messages[index - 1];
                const next = messages[index + 1];
                const firstOfGroup = prev?.authorId !== message.authorId;
                const lastOfGroup = next?.authorId !== message.authorId;
                const replyTo = message.replyToId
                    ? messages.find((candidate) => candidate.id === message.replyToId)
                    : undefined;

                return (
                    <div key={message.id} className={own ? styles.rowOwn : styles.row}>
                        {!own && (
                            <div className={styles.avatarCell}>
                                {lastOfGroup && author && (
                                    <div className={styles.avatar} title={author.name}>
                                        <ShipAvatar kind={author.shipKind} />
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
                                <span className={styles.replyQuote} style={{ borderColor: colorOf(replyTo.authorId) }}>
                                    <span className={styles.replyAuthor} style={{ color: colorOf(replyTo.authorId) }}>
                                        {byId.get(replyTo.authorId)?.name}
                                    </span>
                                    <span className={styles.replyText}>{replyTo.text}</span>
                                </span>
                            )}
                            <span className={styles.text}>
                                {message.text}
                                <span className={styles.time}>{message.sentAt}</span>
                            </span>
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
