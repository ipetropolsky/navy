import { useState } from 'react';

import { ChannelDraft, ChannelError, MemberDraft, backend } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import MemberForm from '@/components/channel/MemberForm';
import MembersSheet from '@/components/channel/MembersSheet';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import { useChannel } from '@/hooks/useChannel';
import { channelLink, useRoute } from '@/routing';
import { MAX_MESSAGE_LENGTH, Message, MorseFeed } from '@/types/channel';
import { copyText } from '@/utils/clipboard';

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
    const notify = useSnackbar();

    const members = channel?.members ?? [];
    const me = members.find((member) => member.memberId === myId) ?? null;
    const inChat = Boolean(channel && me && !editing);

    const handleCreate = async (draft: ChannelDraft) => {
        const { channel: created } = await backend.createChannel({ channel: draft });
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
        typing && typing.memberId !== myId ? members.find((member) => member.memberId === typing.memberId) : null;
    const replyToAuthor = replyTo
        ? (members.find((member) => member.memberId === replyTo.author.memberId) ?? null)
        : null;

    // Лампа мигает у того, кто печатает, — и у своего корабля тоже: событие о печати
    // приходит от бэкенда одинаково, своё оно или чужое.
    const morseFeeds: Partial<Record<string, MorseFeed>> = {};
    if (typing) {
        morseFeeds[typing.memberId] = typing.feed;
    }

    const handleSend = (text: string) => {
        // Отказ показываем снекбаром: у бэкенда для него уже есть человеческий текст,
        // а молча проглотить его нельзя — человек решит, что сообщение ушло.
        void channelState
            .sendMessage({ text, thread: replyTo ? { messageId: replyTo.messageId } : undefined })
            .then(() => setReplyTo(null))
            .catch((failure: unknown) =>
                notify(failure instanceof ChannelError ? failure.message : 'Не вышло отправить')
            );
    };

    const handleCopyLink = () => {
        if (channel) {
            void copyText(channelLink(channel.channel.slug)).then((done) =>
                notify(done ? 'Ссылка на канал скопирована' : 'Не вышло скопировать ссылку')
            );
        }
    };

    const status = (): string => {
        if (!channel) {
            // На главной канала нет и статусу неоткуда взяться — там строчка работает
            // подзаголовком сервиса.
            return route.channel ? 'канал не найден' : 'Ночной морской чат';
        }
        if (typingMember) {
            return `«${typingMember.name}» передаёт…`;
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
                        onMoveShip={() => void channelState.moveShip()}
                        ready={!loading && Boolean(channel)}
                    />
                </div>
                <div className={styles.headerBar}>
                    <div className={styles.headerInfo}>
                        {/* Название канала — это и кнопка «позвать остальных»: по нажатию
                            ссылка уходит в буфер. Показывать сам адрес негде, он длинный. */}
                        {channel ? (
                            <button
                                type="button"
                                className={styles.chatTitleButton}
                                onClick={handleCopyLink}
                                title="Скопировать ссылку на канал"
                            >
                                {channel.channel.title}
                            </button>
                        ) : (
                            <div className={styles.chatTitle}>Кильватер</div>
                        )}
                        <div className={styles.chatStatus}>{loading ? 'связь…' : status()}</div>
                    </div>
                    {/* Кнопки идут вплотную: это один блок действий, а не два разных. */}
                    <div className={styles.headerActions}>
                        {inChat && (
                            <IconButton onClick={() => setSheetOpen(true)} aria-label="Корабли на связи">
                                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                    <path
                                        d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                        fill="currentColor"
                                    />
                                </svg>
                            </IconButton>
                        )}
                        {/* Плюс уводит на главную: там и создаётся следующий канал связи. */}
                        {channel && (
                            <IconButton onClick={route.openHome} aria-label="Новый канал связи">
                                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                    <path
                                        d="M12 5v14M5 12h14"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </IconButton>
                        )}
                    </div>
                </div>
            </header>
            <main className={styles.panel}>
                {loading && <div className={styles.waiting}>Выходим на связь…</div>}
                {/* Адрес в ссылке есть, а канала по нему нет: ссылка устарела или в ней опечатка.
                    Показывать здесь форму создания нельзя — человек шёл не создавать, а войти. */}
                {!loading && route.channel && !channel && (
                    <Panel
                        title="Канала нет"
                        hint={`Канала по адресу «${route.channel}» нет: ссылка устарела или в ней опечатка.`}
                        actions={<Button onClick={route.openHome}>Создать свой канал</Button>}
                    />
                )}
                {!loading && !route.channel && (
                    <CreateChannel
                        onCreate={handleCreate}
                        demoHref={`?channel=${DEMO_CHANNEL_SLUG}`}
                        onOpenDemo={() => route.openChannel(DEMO_CHANNEL_SLUG)}
                    />
                )}
                {!loading && channel && !inChat && (
                    <MemberForm
                        mode={editing ? 'edit' : 'join'}
                        crew={members}
                        myId={myId}
                        initial={me ?? undefined}
                        onSubmit={handleMemberSubmit}
                        onCancel={editing ? () => setEditing(false) : undefined}
                    />
                )}
                {inChat && channel && me && (
                    <>
                        <MessageList
                            messages={channel.messages}
                            members={members}
                            myId={me.memberId}
                            onReply={setReplyTo}
                        />
                        <Composer
                            replyTo={replyTo}
                            replyToAuthor={replyToAuthor}
                            onCancelReply={() => setReplyTo(null)}
                            onSend={handleSend}
                            onTooLong={(length) => notify(`Максимум ${MAX_MESSAGE_LENGTH} символов, у вас ${length}`)}
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
