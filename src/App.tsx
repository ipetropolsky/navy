import { FocusEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChannelDraft, ChannelError, MemberDraft, backend, freeBerths, suggestBerth } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import MemberForm from '@/components/channel/MemberForm';
import MembersList from '@/components/channel/MembersList';
import MembersSheet from '@/components/channel/MembersSheet';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Panel from '@/components/ui/Panel';
import Shade from '@/components/ui/Shade';
import { useSnackbar } from '@/components/ui/Snackbar';
import { ShadeStop } from '@/components/ui/shadeStops';
import { HAIL_SIGNAL, morseDuration } from '@/hooks/morse';
import { useChannel } from '@/hooks/useChannel';
import { channelLink, useRoute } from '@/routing';
import { Berth, MAX_MESSAGE_LENGTH, Message, MorseFeed, ShipKind, isSameBerth } from '@/types/channel';
import { copyText } from '@/utils/clipboard';
import { isTextField } from '@/utils/keyboard';

import styles from './App.module.less';

/**
 * Сколько оклик держится в состоянии, мс: ровно на свою передачу и ещё немного сверху —
 * лампа могла в этот момент договаривать печать, и до оклика очередь дошла не сразу.
 * Считается по самому сигналу, а не проставляется числом: сигнал ещё будет меняться,
 * а забытый потолок молча обрезал бы его на полуслове.
 */
const HAIL_HOLD_MS = morseDuration(HAIL_SIGNAL) + 1200;

/** С каким кораблём открывается форма у того, кто ещё не в строю. */
const DEFAULT_SHIP_KIND: ShipKind = 'pr12412';

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

    // Развёрнутая сцена. Режим один на всё приложение, а не на экран: развернул в чате —
    // открыл форму корабля и выбираешь место на том же большом кадре. Ради этого он и заведён.
    const [fullscreen, setFullscreen] = useState(false);
    // На какой ступени стоит шторка полноэкранного вида. Держим здесь, а не в самой шторке:
    // её положение отнимает и возвращает клавиатура (см. ниже), а отнять можно только чужое.
    const [shadeStop, setShadeStop] = useState<ShadeStop>('peek');
    // На какой ступени шторка стояла до того, как в поле ввода встал фокус. Пока тут не null,
    // считается, что шторку подняла клавиатура, а не человек, и поднятое надо будет вернуть.
    const shadeBeforeKeyboard = useRef<ShadeStop | null>(null);

    // Разворачиваем — шторка опускается в щёлку: человек нажал кнопку ради кадра, и открывать
    // ему поверх кадра ленту во весь экран значит не показать ничего.
    const toggleFullscreen = (): void => {
        setFullscreen((on) => !on);
        setShadeStop('peek');
        shadeBeforeKeyboard.current = null;
    };

    // Шторку двигает человек — значит, это и есть то положение, которое надо потом вернуть.
    // Долг перед клавиатурой на этом списывается: вернуть прежнее теперь означало бы отменить
    // то, что он только что сделал сам.
    const handleShadeStop = (next: ShadeStop): void => {
        shadeBeforeKeyboard.current = null;
        setShadeStop(next);
    };

    // Клавиатуру браузер не показывает никак, поэтому ориентир — фокус в текстовом поле
    // (см. utils/keyboard). Встал фокус — поднимаем шторку до верха: клавиатура съедает
    // пол-экрана, и поле ввода в шторке на половине оказалось бы под ней.
    //
    // Слушаем не сами поля, а всё приложение: полей в нём с десяток — позывной, номер, поле
    // сообщения, — и вешать на каждое по паре обработчиков значит однажды завести одиннадцатое
    // и забыть. React отдаёт focusin/focusout всплывающими, так что хватает одной пары наверху.
    const handleFocusIn = (event: FocusEvent<HTMLDivElement>): void => {
        if (!fullscreen || !isTextField(event.target)) {
            return;
        }
        // Прыжок из поля в поле — не новый заход клавиатуры: она и не убиралась. Прежнее
        // положение при этом сохраняем то, самое первое.
        if (shadeBeforeKeyboard.current === null) {
            shadeBeforeKeyboard.current = shadeStop;
        }
        setShadeStop('full');
    };

    const handleFocusOut = (event: FocusEvent<HTMLDivElement>): void => {
        const before = shadeBeforeKeyboard.current;
        // relatedTarget — куда фокус ушёл. Ушёл в другое поле — клавиатура остаётся на месте.
        if (before === null || isTextField(event.relatedTarget)) {
            return;
        }
        shadeBeforeKeyboard.current = null;
        setShadeStop(before);
    };

    // Пустой список — тоже список, но новый на каждой отрисовке: без useMemo он менял бы
    // ссылку каждый раз и заставлял пересчитывать всё, что от него зависит.
    const members = useMemo(() => channel?.members ?? [], [channel]);
    const me = members.find((member) => member.memberId === myId) ?? null;
    // Чем форма заполняется при переоснащении. Собираем заявку руками, а не отдаём участника
    // целиком: курс у него лежит в месте на рейде, и без этой сборки форма открывалась бы
    // со случайным курсом у корабля, который уже на что-то смотрит.
    const myDraft: MemberDraft | undefined = me
        ? {
              name: me.name,
              hullNumber: me.hullNumber,
              shipKind: me.shipKind,
              color: me.color,
              facing: me.place.facing,
          }
        : undefined;
    const inChat = Boolean(channel && me && !editing);
    // Место на рейде выбирают в форме корабля и только в ней: это её поле, просто вынесенное
    // на воду. На главной канала ещё нет, вставать некуда и не в чем — там рейд пустой
    // и ничего не предлагает.
    const picking = !loading && Boolean(channel) && !inChat;

    // Какой корабль выбран в форме. Держим здесь, а не в самой форме: от размера зависит,
    // куда этот корабль вообще влезет, и точки свободных мест на воде обязаны это знать.
    // Пока форма закрыта, выбор ничей — как и выбранное место, см. ниже.
    const [pickedKind, setPickedKind] = useState<ShipKind | null>(null);
    const shipKind = pickedKind ?? me?.shipKind ?? DEFAULT_SHIP_KIND;

    // Свободные места на рейде: их показывает сцена, пока открыта форма корабля. Своё место
    // считается свободным — иначе, открыв форму, человек не видел бы, где он стоит сейчас.
    const berthOptions = useMemo(
        () =>
            picking
                ? freeBerths(
                      shipKind,
                      members.filter((member) => member.memberId !== myId)
                  )
                : [],
        [picking, shipKind, members, myId]
    );
    const [pickedBerth, setPickedBerth] = useState<Berth | null>(null);
    // Своё место выбрано заранее: у стоящего в строю — то, на котором он стоит, у входящего —
    // то, куда его поставила бы расстановка. Пустым оно не остаётся никогда: человек, ничего
    // не трогавший в форме, всё равно должен понимать, куда встанет его корабль.
    //
    // Спрашиваем именно расстановку (suggestBerth), а не берём случайное из списка: тот, кто
    // в форме ничего не выбирал, встаёт «сам», и правила у этого «сам» одни — простор, размер
    // корабля, теснота по дальности. Своё, отдельное случайное здесь означало бы, что правила
    // не работают ни для кого: через форму проходят все, кроме демо-канала.
    //
    // Пока он думает, на выбранное место мог встать кто-то другой. Тогда молча берём другое:
    // заставлять человека выбирать заново из-за чужого хода незачем, а бэкенд при отправке
    // проверит это ещё раз.
    const berthIsFree = pickedBerth && berthOptions.some((berth) => isSameBerth(berth, pickedBerth));
    if (!picking) {
        // Форма закрыта: выбор больше ничей. Оставить его — значит однажды переставить
        // корабль на место, которое человек выбирал в прошлый раз и с тех пор забыл.
        if (pickedBerth) {
            setPickedBerth(null);
        }
        if (pickedKind) {
            setPickedKind(null);
        }
    } else if (berthOptions.length > 0 && !berthIsFree) {
        setPickedBerth(
            (me && berthOptions.find((berth) => isSameBerth(berth, me.place))) ??
                suggestBerth(
                    shipKind,
                    members.filter((member) => member.memberId !== myId)
                )
        );
    }

    const handleCreate = async (draft: ChannelDraft) => {
        const { channel: created } = await backend.createChannel({ channel: draft });
        route.openChannel(created.slug);
    };

    const handleMemberSubmit = async (draft: MemberDraft) => {
        const withBerth = { ...draft, berth: pickedBerth ?? undefined };
        if (editing) {
            await channelState.updateMe(withBerth);
            setEditing(false);
        } else {
            await channelState.join(withBerth);
        }
    };

    const typingMember =
        typing && typing.memberId !== myId ? members.find((member) => member.memberId === typing.memberId) : null;
    const replyToAuthor = replyTo
        ? (members.find((member) => member.memberId === replyTo.author.memberId) ?? null)
        : null;

    // Оклик: тычок в аватарку — и корабль отзывается лампой со своего места на рейде.
    // Так в кадре находят нужный корабль: имя есть в ленте, а какой из десятка силуэтов
    // за ним стоит — иначе и не понять.
    //
    // Живёт оклик только в этой вкладке и до бэкенда не доходит, в отличие от печати. Печать
    // — это то, что человек делает сам, и всем видеть её правильно; оклик же делают с ним,
    // и мигание чужого корабля в чужой вкладке выглядело бы там сигналом ниоткуда.
    //
    // Счётчик в seq — чтобы окликать можно было подряд: лампе нужен новый повод передавать,
    // а буква каждый раз одна и та же, и по ней двух окликов не различить.
    const [hail, setHail] = useState<{ memberId: string; feed: MorseFeed } | null>(null);
    const handleHail = useCallback(
        (memberId: string) =>
            setHail((prev) => ({ memberId, feed: { seq: (prev?.feed.seq ?? 0) + 1, text: HAIL_SIGNAL } })),
        []
    );
    // Держится оклик ровно на свой сигнал и снимается. Он одноразовый, и оставлять его
    // в состоянии нельзя: корабль, собранный заново — сменил тип, ушёл и вернулся, — принял бы
    // висящий оклик за новый повод передавать и мигнул бы сам по себе.
    useEffect(() => {
        if (!hail) {
            return undefined;
        }
        const timer = window.setTimeout(() => setHail(null), HAIL_HOLD_MS);
        return () => window.clearTimeout(timer);
    }, [hail]);

    // Лампа мигает у того, кто печатает, — и у своего корабля тоже: событие о печати
    // приходит от бэкенда одинаково, своё оно или чужое.
    const morseFeeds: Partial<Record<string, MorseFeed>> = {};
    if (typing) {
        morseFeeds[typing.memberId] = typing.feed;
    }
    // Оклик поверх печати: окликнули печатающего — лампа передаст и то и другое, очередь у неё
    // общая. А вот запись о печати затёрла бы оклик молча, поэтому он и ставится последним.
    if (hail) {
        morseFeeds[hail.memberId] = hail.feed;
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
        // Строчка нарочно короткая: на телефоне месяц стоит на её высоте, и длинный
        // подзаголовок наезжал бы на него.
        return members.length ? `${members.length} на связи` : 'никого нет';
    };

    // Список кораблей. В обычном виде он приезжает своей шторкой поверх всего, в полноэкранном
    // — встаёт в большую шторку на место чата: две шторки одна поверх другой были бы уже
    // не «показать список», а второй этаж.
    const membersList = (
        <MembersList
            members={members}
            myId={myId}
            seniorId={channel?.channel.owner?.memberId ?? null}
            onEditMe={() => {
                setSheetOpen(false);
                setEditing(true);
            }}
            onLeave={() => {
                setSheetOpen(false);
                void channelState.leave();
            }}
            // Список остаётся открытым: высадив один корабль, старший чаще всего смотрит
            // на список дальше, а не уходит из него.
            onKick={(memberId) => void channelState.kick(memberId)}
            onHail={handleHail}
        />
    );

    // Содержимое панели: что лежит под сценой в обычном виде и что переезжает в шторку
    // в полноэкранном. Разметка одна на оба вида — меняется только то, во что она обёрнута.
    const panelContent = (
        <>
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
                    initial={myDraft}
                    shipKind={shipKind}
                    onShipKind={setPickedKind}
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
                        onHail={handleHail}
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
        </>
    );

    // Что показывает шторка и как она подписана для тех, кто её не видит. Заодно это ответ
    // на вопрос, зачем шторке щёлка: из неё видно заголовок того, что там лежит.
    const shadeIsMembers = sheetOpen && inChat;
    const shadeLabel = (): string => {
        if (shadeIsMembers) {
            return 'Корабли на связи';
        }
        return inChat ? 'Разговор' : 'Форма';
    };

    return (
        <div
            className={[styles.app, fullscreen ? styles.appFull : ''].filter(Boolean).join(' ')}
            onFocus={handleFocusIn}
            onBlur={handleFocusOut}
        >
            <header className={styles.header}>
                <div className={styles.scene}>
                    <SeaScene
                        members={members}
                        myId={myId ?? ''}
                        morseFeeds={morseFeeds}
                        full={fullscreen}
                        ready={!loading && Boolean(channel)}
                        // Щелчок по своему кораблю открывает ту же форму, что и переоснащение:
                        // и корабль, и место на рейде меняются в одном месте.
                        onEditShip={() => setEditing(true)}
                        berths={
                            picking ? { options: berthOptions, picked: pickedBerth, onPick: setPickedBerth } : undefined
                        }
                    />
                </div>
                <div className={[styles.headerBar, fullscreen ? styles.headerBarFull : ''].filter(Boolean).join(' ')}>
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
                            // Кнопка переключает, а не только открывает: в полноэкранном виде
                            // список приезжает в ту же шторку, что и чат, и закрыть его,
                            // ткнув мимо, нельзя — мимо там сцена.
                            <IconButton
                                large={fullscreen}
                                onClick={() => {
                                    setSheetOpen((on) => !on);
                                    // Открывать список в щёлке незачем: там видно один
                                    // заголовок. Поднимаем до половины, а выше человек
                                    // дотянет сам.
                                    if (!sheetOpen && shadeStop === 'peek') {
                                        setShadeStop('half');
                                    }
                                }}
                                aria-label="Корабли на связи"
                            >
                                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                    <path
                                        d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                        fill="currentColor"
                                    />
                                </svg>
                            </IconButton>
                        )}
                        {/* Разворот сцены. Значок — стрелки по диагонали: в разные стороны, когда
                            разворачивать, и к середине, когда сворачивать. Диагональ у обоих одна,
                            меняются только концы, и переключение читается как одно движение. */}
                        <IconButton
                            large={fullscreen}
                            onClick={toggleFullscreen}
                            aria-label={fullscreen ? 'Свернуть сцену' : 'Развернуть сцену'}
                        >
                            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                <path
                                    d={
                                        fullscreen
                                            ? 'M20 10h-6V4M4 14h6v6M14 10l6-6M10 14l-6 6'
                                            : 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'
                                    }
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    fill="none"
                                />
                            </svg>
                        </IconButton>
                    </div>
                </div>
            </header>
            {fullscreen ? (
                <Shade stop={shadeStop} onStop={handleShadeStop} label={shadeLabel()}>
                    <div className={styles.shadePanel}>{shadeIsMembers ? membersList : panelContent}</div>
                </Shade>
            ) : (
                <main className={styles.panel}>{panelContent}</main>
            )}
            {/* Список кораблей поверх обычного вида. В полноэкранном его показывает шторка
                выше, и вторая шторка тут была бы шторкой над шторкой. */}
            {!fullscreen && (
                <MembersSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
                    {membersList}
                </MembersSheet>
            )}
        </div>
    );
}
