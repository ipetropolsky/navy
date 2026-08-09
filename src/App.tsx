import { useState } from 'react';

import { ChannelDraft, MemberDraft, backend } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import MemberForm from '@/components/channel/MemberForm';
import MembersSheet from '@/components/channel/MembersSheet';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import { useChannel } from '@/hooks/useChannel';
import { useRoute } from '@/routing';
import { Message, MorseFeed } from '@/types/channel';

import styles from './App.module.less';

/**
 * Три состояния сервиса, и выбираются они по адресу и по тому, кто эта вкладка:
 *   нет channelId              — главная: пустое море и создание канала;
 *   channelId без memberId     — канал открыт, но корабль ещё не в строю: ставим его;
 *   channelId и memberId       — сам чат.
 *
 * Раскладка у всех трёх одна: сцена в шапке, панель под ней. Меняется только содержимое
 * панели, поэтому море не прыгает при переходах, а корабли видно ещё до входа в канал.
 *
 * Данные приходят из useChannel, а тот берёт их у ChannelBackend. Ни localStorage,
 * ни соседних вкладок здесь не видно: всё это дело бэкенда.
 */
export default function App() {
    const route = useRoute();
    const channelState = useChannel(route.channel, route.memberId);
    const { channel, myId, typing, loading } = channelState;
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [editing, setEditing] = useState(false);

    const members = channel?.members ?? [];
    const me = members.find((member) => member.id === myId) ?? null;
    const inChat = Boolean(channel && me && !editing);

    const handleCreate = async (draft: ChannelDraft) => {
        const created = await backend.createChannel(draft);
        route.openChannel(created.slug);
    };

    const handleMemberSubmit = async (draft: MemberDraft) => {
        if (editing) {
            await channelState.updateMe(draft);
            setEditing(false);
        } else {
            await channelState.join(draft);
        }
    };

    const typingMember =
        typing && typing.memberId !== myId ? members.find((member) => member.id === typing.memberId) : null;
    const replyToAuthor = replyTo ? (members.find((member) => member.id === replyTo.memberId) ?? null) : null;

    // Лампа мигает у того, кто печатает, — и у своего корабля тоже: событие о печати
    // приходит от бэкенда одинаково, своё оно или чужое.
    const morseFeeds: Partial<Record<string, MorseFeed>> = {};
    if (typing) {
        morseFeeds[typing.memberId] = typing.feed;
    }

    const handleSend = (text: string) => {
        void channelState.sendMessage({ text, threadId: replyTo?.id });
        setReplyTo(null);
    };

    const status = (): string => {
        if (!channel) {
            return route.channel ? 'канал не найден' : 'канал не выбран';
        }
        if (typingMember) {
            return `«${typingMember.name}» передаёт…`;
        }
        if (me) {
            return `${members.length} на связи · ты — «${me.name}»`;
        }
        return members.length ? `${members.length} на связи` : 'на связи пока никого';
    };

    return (
        <div className={styles.app}>
            <header className={styles.header}>
                <div className={styles.scene}>
                    <SeaScene
                        members={members}
                        myId={myId ?? ''}
                        morseFeeds={morseFeeds}
                        ready={!loading && Boolean(channel)}
                    />
                </div>
                <div className={styles.headerBar}>
                    <div className={styles.headerInfo}>
                        <div className={styles.chatTitle}>{channel?.title ?? 'Кильватер'}</div>
                        <div className={styles.chatStatus}>{loading ? 'связь…' : status()}</div>
                    </div>
                    {inChat && (
                        <button
                            type="button"
                            className={styles.headerButton}
                            onClick={() => setSheetOpen(true)}
                            aria-label="Корабли на связи"
                        >
                            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                <path
                                    d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                    fill="currentColor"
                                />
                            </svg>
                        </button>
                    )}
                    {/* Плюс уводит на главную: там и создаётся следующий канал связи. */}
                    {channel && (
                        <button
                            type="button"
                            className={styles.headerButton}
                            onClick={route.openHome}
                            aria-label="Новый канал связи"
                        >
                            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                <path
                                    d="M12 5v14M5 12h14"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </button>
                    )}
                </div>
            </header>
            <main className={styles.panel}>
                {loading && <div className={styles.waiting}>Выходим на связь…</div>}
                {/* Адрес в ссылке есть, а канала по нему нет: ссылка устарела или в ней опечатка.
                    Показывать здесь форму создания нельзя — человек шёл не создавать, а войти. */}
                {!loading && route.channel && !channel && (
                    <div className={styles.notFound}>
                        <p>Канала по адресу «{route.channel}» нет.</p>
                        <button type="button" className={styles.notFoundAction} onClick={route.openHome}>
                            Создать свой канал
                        </button>
                    </div>
                )}
                {!loading && !route.channel && (
                    <CreateChannel onCreate={handleCreate} demoHref={`?channel=${DEMO_CHANNEL_SLUG}`} />
                )}
                {!loading && channel && !inChat && (
                    <MemberForm
                        mode={editing ? 'edit' : 'join'}
                        crew={members.map((member) => member.name)}
                        takenColors={members.filter((member) => member.id !== myId).map((member) => member.color)}
                        initial={me ?? undefined}
                        onSubmit={handleMemberSubmit}
                        onCancel={editing ? () => setEditing(false) : undefined}
                    />
                )}
                {inChat && channel && me && (
                    <>
                        <MessageList messages={channel.messages} members={members} myId={me.id} onReply={setReplyTo} />
                        <Composer
                            replyTo={replyTo}
                            replyToAuthor={replyToAuthor}
                            onCancelReply={() => setReplyTo(null)}
                            onSend={handleSend}
                            onTyped={channelState.reportTyping}
                        />
                    </>
                )}
            </main>
            <MembersSheet
                open={sheetOpen}
                members={members}
                myId={myId}
                onEditMe={() => {
                    setSheetOpen(false);
                    setEditing(true);
                }}
                onLeave={() => {
                    setSheetOpen(false);
                    void channelState.leave();
                }}
                onClose={() => setSheetOpen(false)}
            />
        </div>
    );
}
