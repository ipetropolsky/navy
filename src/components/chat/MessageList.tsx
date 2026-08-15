import { ReactNode, UIEvent, useLayoutEffect, useRef } from 'react';

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
 * знаком, что и markdown, — а лента превращает пометку в `strong`, который в служебной строчке
 * набран не жирным, а плотным (см. .systemNote в стилях). Разметка нарочно сведена к одному
 * приёму: полноценный markdown в служебной строке не нужен, а текст без разбора всё равно
 * читается.
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
    /** Окликнуть корабль автора: тычок в аватарку — и тот отвечает лампой. */
    onHail: (memberId: string) => void;
}

/**
 * Насколько близко к нижней кромке лента считается прицепленной, px. Ноль сюда не годится:
 * высоты в браузере дробные, и домотанная до упора лента то и дело оказывается в пикселе
 * от конца. Полутора строчками при этом не отделаешься в другую сторону — отцеп должен
 * случаться от настоящего движения вверх, а не от округления.
 */
const STICK_SLOP = 24;

/** Лента сообщений в стиле Telegram: группировка по автору, ответы, тап по сообщению — ответить. */
export default function MessageList({ messages, members, myId, onReply, onHail }: MessageListProps) {
    const listRef = useRef<HTMLDivElement>(null);

    /**
     * Прицеплена ли лента к низу. Прицеплена — низ держится у панели ввода, и новые сообщения
     * появляются на виду; отцеплена — на виду остаётся то место, куда человек отмотал, и ни
     * новое сообщение, ни поехавшая шторка его не сдвигают.
     *
     * Отцепляет и прицепляет обратно только сама прокрутка: домотал до низа — прицепили,
     * тронул вверх — отпустили. Никакой другой причины перемотать ленту вниз нет, и это
     * ровно то, чего от чата ждут: читаешь старое — читай, пока не вернёшься сам.
     *
     * Ref, а не состояние: перерисовывать ленту от смены прицепа нечего — она от него
     * не меняется ни на пиксель.
     */
    const stuckRef = useRef(true);

    /** Последняя своя реплика: по ней видно, что человек сам дописал разговор до конца. */
    const lastMessage = messages.at(-1);
    const lastOwnId =
        lastMessage && lastMessage.kind !== 'system' && lastMessage.author.memberId === myId
            ? lastMessage.messageId
            : null;
    const lastOwnRef = useRef(lastOwnId);

    const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
        const list = event.currentTarget;
        stuckRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_SLOP;
    };

    /**
     * Держим низ. Без зависимостей нарочно: прицепленную ленту надо доводить до конца после
     * каждой перерисовки — пришло сообщение, выросло своё же, развернулась цитата.
     *
     * Layout, а не обычный эффект: прокрутка обязана встать до того, как кадр покажут, иначе
     * новое сообщение успевает мелькнуть снизу и только потом лента к нему доезжает.
     */
    useLayoutEffect(() => {
        const list = listRef.current;
        // Своя реплика прицепляет ленту обратно. Отправить сообщение и не увидеть его —
        // единственный случай, когда «не мотать» читается поломкой: человек только что сам
        // дописал разговор до конца, значит и смотреть хочет на конец.
        if (lastOwnId && lastOwnId !== lastOwnRef.current) {
            stuckRef.current = true;
        }
        lastOwnRef.current = lastOwnId;
        if (list && stuckRef.current) {
            list.scrollTop = list.scrollHeight;
        }
    });

    /**
     * То же самое, но когда меняется не лента, а её окошко: шторка ходит по ступеням, и высота
     * ленты едет вместе с ней все свои 280 мс. Перерисовки на это нет — высоту меняет переход
     * в стилях, — а низ уезжал бы из виду ровно на разницу высот. Поэтому смотрим за самим
     * блоком: пока лента прицеплена, каждый её новый размер снова доводится до конца.
     */
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) {
            return undefined;
        }
        const observer = new ResizeObserver(() => {
            if (stuckRef.current) {
                list.scrollTop = list.scrollHeight;
            }
        });
        observer.observe(list);
        return () => observer.disconnect();
    }, []);

    const byId = new Map(members.map((member) => [member.memberId, member]));
    // По кому группировать подряд идущие сообщения — по автору, и системная запись тут ничем
    // не выделена: она тоже про конкретный корабль и встаёт в его же цепочку, с его аватаркой.
    // Подписи она у соседей не отнимает: корабль в ней назван целиком, типом и номером.
    const groupKey = (message: Message): string => message.author.memberId;

    return (
        <div ref={listRef} className={styles.list} onScroll={handleScroll}>
            {messages.length > 0 && <div className={styles.dateChip}>{formatDate(messages[0].sentAt)}</div>}
            {messages.map((message, index) => {
                const system = message.kind === 'system';
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
                                {lastOfGroup && author && (
                                    <Avatar
                                        number={author.hullNumber}
                                        name={author.name}
                                        onHail={() => onHail(author.memberId)}
                                    />
                                )}
                            </div>
                        )}
                        {/*
                         * Системная запись стоит на месте пузыря и в той же строке — с аватаркой
                         * автора и по его сторону ленты, — но пузырём не притворяется: она мельче,
                         * приглушена и помечена косой полоской. Отвечать на неё не на что, поэтому
                         * это блок, а не кнопка: канал сообщает о корабле, а не говорит за него.
                         */}
                        {system ? (
                            <div className={styles.systemNote}>{emphasise(message.text)}</div>
                        ) : (
                            <button
                                type="button"
                                className={own ? styles.bubbleOwn : styles.bubble}
                                onClick={() => onReply(message)}
                                title="Ответить"
                            >
                                {!own && firstOfGroup && author && (
                                    <MemberName name={author.name} color={author.color} />
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
                        )}
                    </div>
                );
            })}
        </div>
    );
}
