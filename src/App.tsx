import { useEffect, useRef, useState } from 'react';

import SeaScene from '@/components/SeaScene/SeaScene';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import ParticipantsSheet from '@/components/chat/ParticipantsSheet';
import { DEMO_CHAT_TITLE, DEMO_MESSAGES, DEMO_PARTICIPANTS, DEMO_TYPING_PHRASES } from '@/data/demo';
import { Message, MorseFeed } from '@/types/chat';

import styles from './App.module.less';

const SCENE_FADE_MS = 180;
const DEMO_TYPING_INTERVAL_MS = 9000;
const DEMO_TYPING_DURATION_MS = 4500;

interface TypingState {
    participantId: string;
    feed: MorseFeed;
}

/**
 * Шаг 1 (дизайн): сцена ночного моря + макет чата на демо-данных.
 * Сервера нет, сообщения живут в памяти до перезагрузки.
 */
export default function App() {
    const [viewerId, setViewerId] = useState(DEMO_PARTICIPANTS[0].id);
    const [sceneExiting, setSceneExiting] = useState(false);
    const [messages, setMessages] = useState(DEMO_MESSAGES);
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [typing, setTyping] = useState<TypingState | null>(null);
    const [myFeed, setMyFeed] = useState<MorseFeed | null>(null);
    const viewerIdRef = useRef(viewerId);
    viewerIdRef.current = viewerId;

    useEffect(() => {
        let hideTimer: number | undefined;
        const showTimer = window.setInterval(() => {
            const others = DEMO_PARTICIPANTS.filter((participant) => participant.id !== viewerIdRef.current);
            const participant = others[Math.floor(Math.random() * others.length)];
            const phrase = DEMO_TYPING_PHRASES[Math.floor(Math.random() * DEMO_TYPING_PHRASES.length)];
            setTyping({ participantId: participant.id, feed: { seq: Date.now(), text: phrase } });
            hideTimer = window.setTimeout(() => setTyping(null), DEMO_TYPING_DURATION_MS);
        }, DEMO_TYPING_INTERVAL_MS);
        return () => {
            window.clearInterval(showTimer);
            window.clearTimeout(hideTimer);
        };
    }, []);

    const switchViewer = (participantId: string) => {
        setSheetOpen(false);
        if (participantId === viewerId) {
            return;
        }
        setSceneExiting(true);
        window.setTimeout(() => {
            setViewerId(participantId);
            setReplyTo(null);
            setSceneExiting(false);
        }, SCENE_FADE_MS);
    };

    const sendMessage = (text: string) => {
        const sentAt = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        setMessages((current) => [
            ...current,
            {
                id: `local-${Date.now()}`,
                authorId: viewerId,
                text,
                replyToId: replyTo?.id,
                sentAt,
            },
        ]);
        setReplyTo(null);
    };

    const participants = DEMO_PARTICIPANTS;
    const viewer = participants.find((participant) => participant.id === viewerId) ?? participants[0];
    const typingParticipant = typing
        ? participants.find((participant) => participant.id === typing.participantId)
        : null;
    const replyToAuthor = replyTo
        ? (participants.find((participant) => participant.id === replyTo.authorId) ?? null)
        : null;

    const morseFeeds: Partial<Record<string, MorseFeed>> = {};
    if (typing) {
        morseFeeds[typing.participantId] = typing.feed;
    }
    if (myFeed) {
        morseFeeds[viewerId] = myFeed;
    }

    return (
        <div className={styles.app}>
            <header className={styles.header}>
                <div key={viewerId} className={sceneExiting ? `${styles.scene} ${styles.sceneExiting}` : styles.scene}>
                    <SeaScene participants={participants} viewerId={viewerId} morseFeeds={morseFeeds} />
                </div>
                <div className={styles.headerBar}>
                    <div className={styles.headerInfo}>
                        <div className={styles.chatTitle}>{DEMO_CHAT_TITLE}</div>
                        <div className={styles.chatStatus}>
                            {typingParticipant && typingParticipant.id !== viewerId
                                ? `«${typingParticipant.name}» передаёт…`
                                : `${participants.length} на связи · ты — «${viewer.name}»`}
                        </div>
                    </div>
                    <button
                        type="button"
                        className={styles.crewButton}
                        onClick={() => setSheetOpen(true)}
                        aria-label="Участники"
                    >
                        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                            <path
                                d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                fill="currentColor"
                            />
                        </svg>
                    </button>
                </div>
            </header>
            <main className={styles.chat}>
                <MessageList messages={messages} participants={participants} viewerId={viewerId} onReply={setReplyTo} />
                <Composer
                    replyTo={replyTo}
                    replyToAuthor={replyToAuthor}
                    onCancelReply={() => setReplyTo(null)}
                    onSend={sendMessage}
                    onTyped={(chars) => setMyFeed({ seq: Date.now(), text: chars })}
                />
            </main>
            <ParticipantsSheet
                open={sheetOpen}
                participants={participants}
                activeId={viewerId}
                onSwitch={switchViewer}
                onClose={() => setSheetOpen(false)}
            />
        </div>
    );
}
