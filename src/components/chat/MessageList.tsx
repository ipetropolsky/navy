import { KeyboardEvent, MouseEvent, PointerEvent, memo, useEffect, useLayoutEffect, useRef } from 'react';

import Avatar from '@/components/ships/Avatar';
import CodePennant from '@/components/ships/CodePennant';
import MemberName from '@/components/ships/MemberName';
import { useSnackbar } from '@/components/ui/Snackbar';
import { AuthorLook, Member, MemberRef, Message, authorLook } from '@/types/channel';
import { Press, drifted, isTap, selectedSince, startPress } from '@/utils/tap';

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
     * Окликнуть корабль автора: тычок в аватарку — и тот отзывается лампой со своего места
     * на рейде. Это и есть ответ на вопрос «кто это говорит»: в ленте от чужого корабля видны
     * только три цифры на аватарке, а какой из десятка силуэтов в кадре за ними стоит, иначе
     * и не понять. Карточка на этот вопрос отвечает хуже: она сама накрывает собой кадр,
     * в котором корабль и надо было увидеть, — и открывают её из списка на связи.
     */
    onHail: (memberId: string) => void;
}

/**
 * Насколько близко к нижней кромке лента считается прицепленной, px. Ноль сюда не годится:
 * высоты в браузере дробные, и домотанная до упора лента то и дело оказывается в пикселе
 * от конца.
 */
const STICK_SLOP = 24;

/** Что означает ответный вымпел у позывного. Слово одно на все служебные строчки. */
const NOTICE_TITLE = 'Техническое сообщение';

/** Лента сообщений в стиле Telegram: группировка по автору, ответы, тап по сообщению — ответить. */
function MessageList({ messages, members, myId, onReply, onHail }: MessageListProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const notify = useSnackbar();

    /** Последняя своя реплика: по ней видно, что человек сам дописал разговор до конца. */
    const lastMessage = messages.at(-1);
    const lastOwnId =
        lastMessage && lastMessage.kind !== 'system' && lastMessage.author.memberId === myId
            ? lastMessage.messageId
            : null;

    /**
     * Своя реплика возвращает ленту вниз. Отправить сообщение и не увидеть его — единственный
     * случай, когда «не мотать» читается поломкой: человек только что сам дописал разговор
     * до конца, значит и смотреть хочет на конец.
     *
     * Всё остальное — держать низ при чужих сообщениях и при съехавшем окошке — делает
     * раскладка (см. `.bottomAnchor` в стилях). Layout, а не обычный эффект: прокрутка должна
     * встать до кадра, иначе своя же реплика успевает мелькнуть снизу.
     */
    useLayoutEffect(() => {
        const list = listRef.current;
        if (list && lastOwnId) {
            list.scrollTo({ top: list.scrollHeight });
        }
    }, [lastOwnId]);

    /** Довели ли ленту до конца на открытии. Разовая отметка на всю жизнь ленты. */
    const openedRef = useRef(false);

    /**
     * Открытый разговор показывает свой конец, а не начало времён.
     *
     * Это единственное, чего якорь сделать не может: он бережёт то место, на котором лента
     * уже стоит, а свежий блок прокрутки стоит на нуле. Притяжение к низу тут тоже не поможет —
     * оно ловит только близкие точки, а конец длинной переписки за тысячу пикселей отсюда.
     *
     * Дальше довозить не нужно: у низа якорь ленту и подхватывает — полоска попадает на виду
     * и с этого мгновения держит место сама.
     */
    useLayoutEffect(() => {
        const list = listRef.current;
        if (list && !openedRef.current && messages.length > 0) {
            openedRef.current = true;
            list.scrollTop = list.scrollHeight;
        }
    }, [messages.length]);

    /**
     * Единственное, чего якорь не умеет: переменившееся окошко ленты.
     *
     * Якорь держит своё место, считая от верхней кромки окошка, — и когда окошко ужимается
     * снизу (шторка поехала по ступеням, выехала клавиатура, поднялась панель ответа), место
     * якоря не двигается, а нижняя кромка приходит к нему сама. Содержимое от этого не едет,
     * поэтому якорю и нечего исправлять: с его точки зрения ничего не случилось. А низ ленты
     * при этом уезжает из виду ровно на разницу высот.
     *
     * Так что размер доводим скриптом. Перерисовки на него нет вовсе — высоту меняет переход
     * в стилях, — и узнать о нём можно только у наблюдателя.
     */
    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) {
            return undefined;
        }
        // Прицеплена ли лента к низу. Отцепляет только движение вверх: ужавшееся окошко
        // не двигает `scrollTop` ни на пиксель, зато отодвигает от него конец списка,
        // и правило «далеко от низа — значит отцеплена» отпускало бы ленту навсегда.
        let stuck = true;
        let top = list.scrollTop;
        const toBottom = (): void => {
            list.scrollTop = list.scrollHeight;
            top = list.scrollTop;
        };
        const watchScroll = (): void => {
            const bottomGap = list.scrollHeight - list.scrollTop - list.clientHeight;
            const wentUp = list.scrollTop < top;
            top = list.scrollTop;
            // Низ проверяем первым: подросшее окошко браузер поджимает `scrollTop` сам,
            // и это движение вверх ленту отцеплять не должно.
            if (bottomGap <= STICK_SLOP) {
                stuck = true;
            } else if (wentUp) {
                stuck = false;
            }
        };
        const observer = new ResizeObserver(() => {
            if (stuck) {
                toBottom();
            }
        });
        list.addEventListener('scroll', watchScroll, { passive: true });
        observer.observe(list);
        return () => {
            list.removeEventListener('scroll', watchScroll);
            observer.disconnect();
        };
    }, []);

    /** С чего началось нажатие: откуда и при каком выделении (см. `@/utils/tap`). */
    const pressRef = useRef<Press | null>(null);

    /**
     * Какая плашка сейчас утоплена. Держим сами, а не отдаём браузеру `:active`, потому что
     * про нажатие мы знаем больше него — и в обе стороны.
     *
     * Он утапливает лишнее: `:active` зажигается на всей цепочке предков, и тычок по вымпелу
     * внутри плашки утапливал заодно и её, хотя вымпел про своё и до ответа не доходит.
     *
     * И держит дольше нужного: `:active` не отпустит до отпускания кнопки, а протяжка по тексту
     * перестаёт быть ответом в тот миг, когда пошло выделение. Плашка при этом обязана отжаться
     * сразу — иначе человек до конца протяжки видит нажатую кнопку, которая уже не сработает.
     *
     * Утапливаем прямо в DOM, а не состоянием: от нажатия в ленте не меняется ничего, кроме
     * одной плашки, а перерисовка пересобрала бы весь разговор целиком — со всеми цепочками,
     * цитатами и подписями. Нажатие в ленте самое частое действие, какое в ней есть, и платить
     * за него разговором в сотню строк не за что.
     */
    const pressedRef = useRef<HTMLElement | null>(null);

    const release = (): void => {
        pressedRef.current?.classList.remove(styles.pressed);
        pressedRef.current = null;
    };

    const handlePress = (event: PointerEvent<HTMLDivElement>): void => {
        pressRef.current = startPress(event);
        release();
        pressedRef.current = event.currentTarget;
        event.currentTarget.classList.add(styles.pressed);
    };

    /**
     * Пока плашка утоплена, следим за теми же двумя приметами, по которым потом решаем, был ли
     * это тычок (см. `handleTap`): ушли дальше `TAP_SLOP` или появилось выделение, которого
     * до нажатия не было. Сработала любая — плашка отжимается, не дожидаясь отпускания.
     *
     * Слушаем окно, а не плашку: протяжка легко уводит палец за её край, и отпускают кнопку
     * там же — событий плашки в этом случае не будет вовсе, и она осталась бы нажатой навсегда.
     * Выделение приходит своим событием `selectionchange`: долгое нажатие на телефоне никуда
     * курсор не ведёт и `pointermove` не шлёт, а выделение оставляет.
     *
     * Подписки живут всё время жизни ленты, а не только под нажатием: сторожа стоят копейки
     * и при отжатой плашке сразу выходят, а подписка по нажатию требовала бы состояния —
     * ровно той перерисовки, которой мы тут и избегаем.
     */
    useEffect(() => {
        const watchMove = (event: globalThis.PointerEvent): void => {
            if (drifted(pressRef.current, event)) {
                release();
            }
        };
        const watchSelection = (): void => {
            if (selectedSince(pressRef.current)) {
                release();
            }
        };
        window.addEventListener('pointermove', watchMove);
        window.addEventListener('pointerup', release);
        window.addEventListener('pointercancel', release);
        document.addEventListener('selectionchange', watchSelection);
        return () => {
            window.removeEventListener('pointermove', watchMove);
            window.removeEventListener('pointerup', release);
            window.removeEventListener('pointercancel', release);
            document.removeEventListener('selectionchange', watchSelection);
        };
    }, []);

    /**
     * Тычок по плашке — ответить. Но не всякое нажатие тычок: текст в ленте можно и нужно
     * выделять — протяжкой на десктопе, долгим нажатием на телефоне, — и ответ на выделение
     * срабатывать не должен. Человек тянул курсор через реплику, чтобы её скопировать,
     * а получал панель ответа и сбитое выделение. Как отличается одно от другого — в `isTap`.
     */
    const handleTap = (event: MouseEvent<HTMLDivElement>, message: Message): void => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!isTap(press, event)) {
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
     * Как показать автора строчки. Сперва нынешний корабль, а если его на рейде уже нет —
     * снимок, записанный при отправке: лента переживает участников, и у сообщения корабля,
     * который снялся с рейда, иначе пропадала бы аватарка, а в цитате ответа вместо позывного
     * вставало бы «Неизвестный».
     */
    const lookOf = (ref: MemberRef): AuthorLook | undefined => authorLook(ref, byId.get(ref.memberId));

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
    // Цитируемое ищем по указателю, а не перебором: перебор внутри перебора — это квадрат
    // от длины разговора, и на сотнях реплик он уже заметен.
    const byMessageId = new Map(messages.map((message) => [message.messageId, message]));

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
        <div ref={listRef} className={styles.list}>
            {messages.length > 0 && <div className={styles.dateChip}>{formatDate(messages[0].sentAt)}</div>}
            {messages.map((message, index) => {
                const own = message.author.memberId === myId;
                const author = lookOf(message.author);
                // На рейде ли он ещё. Оклик есть только у тех, кто есть: окликать некого,
                // и мигать в кадре нечему — корабль ушёл.
                const afloat = byId.has(message.author.memberId);
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
                                action={
                                    afloat
                                        ? {
                                              title: `Окликнуть «${author.name}»`,
                                              onClick: () => onHail(message.author.memberId),
                                          }
                                        : undefined
                                }
                            />
                        )}
                    </div>
                );

                /*
                 * Системная запись стоит на месте пузыря и живёт по тем же правилам: своя
                 * плашка, время в углу, ответ по нажатию. Отличается она одним цветом —
                 * ни размером, ни отступами, ни скруглениями: это такое же сообщение канала,
                 * и выглядеть заплаткой в ленте ему незачем.
                 */
                const system = message.kind === 'system';
                const plaque = system
                    ? { own: styles.systemNoteOwn, other: styles.systemNote }
                    : { own: styles.bubbleOwn, other: styles.bubble };

                /*
                 * Позывной у служебной строчки стоит всегда — и у своей, и у второй подряд
                 * в цепочке. Фраза в ней безличная («Сменил позывной»), и без имени над ней
                 * непонятно, кто сменил; у реплики такой беды нет — там кто говорит, видно
                 * по стороне ленты и по аватарке.
                 *
                 * Рядом с позывным — ответный вымпел: он и помечает строчку служебной вместо
                 * прежних полоски и мелкого кегля. Нажатие по нему говорит, что он значит,
                 * и дальше пузыря не идёт: нажатие по самому пузырю — это ответ на строчку,
                 * а вымпел не про ответ.
                 */
                const noticeHead = system && author && (
                    <span className={styles.noticeHead}>
                        <MemberName name={author.name} color={author.color} />
                        <button
                            type="button"
                            className={styles.pennantButton}
                            aria-label={NOTICE_TITLE}
                            title={NOTICE_TITLE}
                            // Нажатие по вымпелу не утапливает плашку: оно про вымпел, а не про
                            // ответ, и плашка на него отзываться не должна. Останавливаем именно
                            // нажатие, а не только щелчок ниже: утопление плашки заводится
                            // с `pointerdown`, и до `onClick` она успела бы моргнуть.
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                notify(NOTICE_TITLE);
                            }}
                        >
                            <CodePennant />
                        </button>
                    </span>
                );

                const thread = system ? undefined : message.thread;
                const replyTo = thread ? byMessageId.get(thread.messageId) : undefined;

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
                            {noticeHead}
                            {!system && !own && firstOfGroup && author && (
                                <MemberName name={author.name} color={author.color} />
                            )}
                            {replyTo && (
                                <span className={styles.replyCell}>
                                    <ReplyQuote
                                        author={lookOf(replyTo.author)}
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
            {/*
             * Якорь низа: полоска в пиксель под последней строчкой. Она одна в ленте помечена
             * `overflow-anchor: auto`, поэтому именно за неё браузер держится, когда содержимое
             * над ней меняется, — новое сообщение вставляется сверху от якоря, а вид остаётся
             * на месте. Прокрутки при этом нет вовсе: место держит раскладка, до кадра,
             * а не скрипт после него.
             *
             * Стоит в конце списка, а не в начале с перевёрнутым порядком: лента обязана лежать
             * в DOM по времени — от этого зависят и выделение с копированием, и чтение вслух.
             */}
            <div className={styles.bottomAnchor} />
        </div>
    );
}

/**
 * Лента перерисовывается только по своим входным данным.
 *
 * Растёт она без предела — сотни пузырей с аватарками, цитатами и вымпелами, — а стоит внутри
 * коробки, которую человек постоянно тянет за кромку. Размер ленты задаёт раскладка, и от него
 * в разметке пузырей не меняется ничего: перерисовывать её на каждый шаг пальца незачем.
 */
export default memo(MessageList);
