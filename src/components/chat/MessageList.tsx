import { KeyboardEvent, MouseEvent, PointerEvent, UIEvent, useLayoutEffect, useRef } from 'react';

import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import { Member, Message } from '@/types/channel';

import MessageBody from '@/components/chat/MessageBody';
import ReplyQuote from '@/components/chat/ReplyQuote';

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
    /**
     * Показать карточку корабля автора: тычок в аватарку — и видно, кто это говорит. В ленте
     * от чужого корабля видны только три цифры на аватарке, и связать их с силуэтом в кадре
     * иначе нечем.
     */
    onShowShip: (memberId: string) => void;
}

/**
 * Насколько близко к нижней кромке лента считается прицепленной, px. Ноль сюда не годится:
 * высоты в браузере дробные, и домотанная до упора лента то и дело оказывается в пикселе
 * от конца. Полутора строчками при этом не отделаешься в другую сторону — отцеп должен
 * случаться от настоящего движения вверх, а не от округления.
 */
const STICK_SLOP = 24;

/**
 * Насколько далеко можно увести курсор или палец между нажатием и отпусканием, чтобы это
 * всё ещё считалось тычком, px. Дальше — уже протяжка: человек выделяет текст, а не отвечает.
 *
 * Порог нужен, потому что одним выделением не обойтись: протянуть можно и по пустому месту
 * плашки, и тогда выделять окажется нечего, а ответ бы сработал. Восемь пикселей — обычный
 * запас на дрожь: палец на телефоне уезжает на два-три даже при честном тычке.
 */
const TAP_SLOP = 8;

/** Лента сообщений в стиле Telegram: группировка по автору, ответы, тап по сообщению — ответить. */
export default function MessageList({ messages, members, myId, onReply, onShowShip }: MessageListProps) {
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

    /** Что выделено в окне прямо сейчас. Пусто — не выделено ничего. */
    const selectedText = (): string => window.getSelection()?.toString().trim() ?? '';

    /**
     * С чего началось нажатие: откуда и при каком выделении. У самого `click` этого не спросишь —
     * он приходит уже по отпусканию и про дорогу между ними молчит.
     */
    const pressRef = useRef<{ x: number; y: number; selected: string } | null>(null);

    const handlePress = (event: PointerEvent<HTMLDivElement>): void => {
        pressRef.current = { x: event.clientX, y: event.clientY, selected: selectedText() };
    };

    /**
     * Тычок по плашке — ответить. Но не всякое нажатие тычок: текст в ленте можно и нужно
     * выделять — протяжкой на десктопе, долгим нажатием на телефоне, — и ответ на выделение
     * срабатывать не должен. Человек тянул курсор через реплику, чтобы её скопировать,
     * а получал панель ответа и сбитое выделение.
     *
     * Отличаем по двум приметам разом. Первая — дорога: увели дальше `TAP_SLOP` — это протяжка,
     * даже если выделять на этом месте было нечего. Вторая — выделение, которого до нажатия
     * не было: долгое нажатие на телефоне никуда курсор не ведёт, а выделение оставляет.
     *
     * Сравниваем именно с тем, что было выделено в начале нажатия, а не просто смотрим, есть ли
     * выделение вообще. Нажатие внутрь уже выделенного браузер схлопывает не сразу, и правило
     * «есть выделение — не отвечать» отняло бы ответ у следующего же тычка по той самой реплике,
     * которую человек только что выделял.
     */
    const handleTap = (event: MouseEvent<HTMLDivElement>, message: Message): void => {
        const press = pressRef.current;
        pressRef.current = null;
        const moved = press !== null && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP;
        const selected = selectedText();
        if (moved || (selected !== '' && selected !== press?.selected)) {
            return;
        }
        onReply(message);
    };

    // Плашка — не `button`, а `div` с ролью кнопки: из настоящей кнопки браузер не даёт
    // выделить текст вовсе, даже при `user-select: text`. Значит, клавиатуру плашка должна
    // отработать сама — пробелом и вводом, как отработала бы кнопка.
    const handleKey = (event: KeyboardEvent<HTMLDivElement>, message: Message): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onReply(message);
        }
    };

    const byId = new Map(members.map((member) => [member.memberId, member]));

    /**
     * По кому группировать подряд идущие сообщения. По автору — и системная запись тут ничем
     * не выделена: она тоже про конкретный корабль и встаёт в его же цепочку, с его аватаркой
     * и его позывным над первой строкой.
     *
     * Но не только по автору: переоснащение обрывает цепочку. Корабль сменил позывной или
     * бортовой номер — дальше он в ленте другой, и представиться должен заново, позывным
     * и аватаркой. Сама запись о переоснащении остаётся в прежней цепочке: она про то,
     * что случилось с тем кораблём, а новый начинается после неё.
     */
    const eras = new Map<string, number>();
    const groupKeys = messages.map((message) => {
        const { memberId } = message.author;
        const era = eras.get(memberId) ?? 0;
        if (message.kind === 'system' && message.notice.event === 'refit') {
            // Смена силуэта цепочку не рвёт: в ленте от неё ничего не меняется — ни позывной,
            // ни номер на аватарке, — а корабль в кадре человек и так видит.
            const { changed } = message.notice;
            if (changed === 'name' || changed === 'hullNumber') {
                eras.set(memberId, era + 1);
            }
        }
        return `${memberId}#${era}`;
    });

    return (
        <div ref={listRef} className={styles.list} onScroll={handleScroll}>
            {messages.length > 0 && <div className={styles.dateChip}>{formatDate(messages[0].sentAt)}</div>}
            {messages.map((message, index) => {
                const own = message.author.memberId === myId;
                const author = byId.get(message.author.memberId);
                const firstOfGroup = index === 0 || groupKeys[index - 1] !== groupKeys[index];
                const lastOfGroup = index === messages.length - 1 || groupKeys[index + 1] !== groupKeys[index];
                // Место под аватарку держим у всякой чужой строки, системной в том числе:
                // системная запись стоит в цепочке своего корабля и с его аватаркой.
                const avatar = !own && (
                    <div className={styles.avatarCell}>
                        {lastOfGroup && author && (
                            <Avatar
                                number={author.hullNumber}
                                name={author.name}
                                action={{
                                    title: `Корабль «${author.name}»`,
                                    onClick: () => onShowShip(author.memberId),
                                }}
                            />
                        )}
                    </div>
                );

                /*
                 * Системная запись стоит на месте пузыря и живёт по тем же правилам: своя
                 * плашка, время в углу, ответ по нажатию. Отличается она видом — мельче,
                 * приглушена и помечена полоской, — но не устройством: это такое же
                 * сообщение канала, и отвечать на «042 теперь 782» человек должен уметь
                 * ровно так же, как на любую реплику.
                 */
                const plaque =
                    message.kind === 'system'
                        ? { own: styles.systemNoteOwn, other: styles.systemNote }
                        : { own: styles.bubbleOwn, other: styles.bubble };

                const thread = message.kind === 'system' ? undefined : message.thread;
                const replyTo = thread
                    ? messages.find((candidate) => candidate.messageId === thread.messageId)
                    : undefined;

                return (
                    <div key={message.messageId} className={own ? styles.rowOwn : styles.row}>
                        {avatar}
                        <div
                            role="button"
                            tabIndex={0}
                            className={own ? plaque.own : plaque.other}
                            onPointerDown={handlePress}
                            onClick={(event) => handleTap(event, message)}
                            onKeyDown={(event) => handleKey(event, message)}
                            title="Ответить"
                        >
                            {!own && firstOfGroup && author && <MemberName name={author.name} color={author.color} />}
                            {replyTo && (
                                <span className={styles.replyCell}>
                                    <ReplyQuote
                                        author={byId.get(replyTo.author.memberId)}
                                        text={<MessageBody message={replyTo} />}
                                    />
                                </span>
                            )}
                            {/*
                             * Фраза обёрнута в один блок нарочно: плашка выкладывает содержимое
                             * колонкой, и без обёртки каждый кусок строчки — текст, помеченное
                             * слово — вставал бы на свою строку.
                             */}
                            <span className={styles.text}>
                                <MessageBody message={message} />
                                <span className={styles.time}>{formatTime(message.sentAt)}</span>
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
