import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChannelDraft, ChannelError, MemberDraft, backend, freeBerths, suggestBerth } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import MemberForm from '@/components/channel/MemberForm';
import MembersList from '@/components/channel/MembersList';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Panel from '@/components/ui/Panel';
import Shade from '@/components/ui/Shade';
import { useSnackbar } from '@/components/ui/Snackbar';
import TopFade from '@/components/ui/TopFade';
import { HAIL_SIGNAL, morseDuration } from '@/hooks/morse';
import { useChannel } from '@/hooks/useChannel';
import { useSlide } from '@/hooks/useSlide';
import { useSwipe } from '@/hooks/useSwipe';
import { channelLink, useRoute } from '@/routing';
import { Berth, MAX_MESSAGE_LENGTH, Message, MorseFeed, ShipKind, Side, isSameBerth, otherSide } from '@/types/channel';
import { copyText } from '@/utils/clipboard';

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
 * Курс, с которым форма открывается у новичка: монетка. Осмысленного умолчания тут нет —
 * куда смотреть носом, дело вкуса, — а один и тот же курс у всех выстроил бы рейд
 * в кильватерную колонну.
 */
const randomCourse = (): Side => (Math.random() < 0.5 ? 'left' : 'right');

/**
 * Три состояния сервиса, и выбираются они по адресу и по тому, кто эта вкладка:
 *   нет channelId              — главная: пустое море и создание канала;
 *   channelId без memberId     — канал открыт, но корабль ещё не в строю: ставим его;
 *   channelId и memberId       — сам чат.
 *
 * Раскладка у всех трёх одна: кадр со сценой сверху, блок контента под ним. Меняется только
 * содержимое блока, поэтому море не прыгает при переходах, а корабли видно ещё до входа
 * в канал.
 *
 * Поверх этого — три вещи, и все три необязательные: раскладка «больше сцены» (одна кнопка
 * в шапке), форма своего корабля (выезжает поверх разговора) и шторка со списком кораблей
 * (выезжает поверх всего). Ничего четвёртого в приложении нет.
 *
 * Данные приходят из useChannel, а тот берёт их у ChannelBackend. Ни localStorage,
 * ни соседних вкладок здесь не видно: всё это дело бэкенда.
 */
export default function App() {
    const route = useRoute();
    const channelState = useChannel(route.channel, route.memberId);
    const { channel, myId, typing, loading } = channelState;
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    // Открыт ли список кораблей. Он приезжает шторкой поверх всего остального, а не подменяет
    // собой содержимое: подмена уносила вместе с разговором и место прокрутки, и набранное
    // в поле, и выделение.
    const [sheetOpen, setSheetOpen] = useState(false);
    // Открыта ли форма своего корабля. Она выезжает поверх разговора — по той же причине
    // и тем же движением, что и шторка.
    const [editing, setEditing] = useState(false);
    const notify = useSnackbar();

    // Раскладка «больше сцены»: кадр забирает окно, блоку контента остаётся сжатая мерка.
    // Одно состояние на всё приложение, а не на экран: развернул в разговоре — открыл форму
    // корабля и выбираешь место на том же большом кадре.
    const [expanded, setExpanded] = useState(false);

    // Раскладку переключает не только кнопка, но и свайп по кадру: сжатый раздаётся движением
    // вниз, раздутый сжимается движением вверх — палец ведёт кромку кадра туда, куда она поедет.
    // Обратные движения кадр не трогают, и потяг страницы к обновлению на них работает как был.
    const sceneRef = useRef<HTMLDivElement>(null);
    const switchLayout = useCallback(() => setExpanded((was) => !was), []);
    useSwipe(sceneRef, expanded ? 'up' : 'down', switchLayout);

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
    const inChat = Boolean(channel && me);
    // Место на рейде выбирают в форме корабля и только в ней: это её поле, просто вынесенное
    // на воду. На главной канала ещё нет, вставать некуда и не в чем — там рейд пустой
    // и ничего не предлагает.
    const picking = !loading && Boolean(channel) && (editing || !me);

    // Какой корабль выбран в форме. Держим здесь, а не в самой форме: от размера зависит,
    // куда этот корабль вообще влезет, и точки свободных мест на воде обязаны это знать.
    // Пока форма закрыта, выбор ничей — как и выбранное место, см. ниже.
    const [pickedKind, setPickedKind] = useState<ShipKind | null>(null);
    const shipKind = pickedKind ?? me?.shipKind ?? DEFAULT_SHIP_KIND;

    // Курс — здесь по той же причине: его показывает стрелка на выбранном месте, и оттуда же
    // его меняют повторным нажатием. Начальный достаётся от своего корабля, а новичку — монеткой:
    // осмысленного умолчания тут нет, а один и тот же курс у всех выстроил бы рейд в колонну.
    // Монетка бросается один раз за вкладку, а не на каждый проход: пересчитываемая на месте,
    // она переворачивала бы корабль в форме от любой перерисовки.
    const initialCourse = useRef(randomCourse());
    const [pickedFacing, setPickedFacing] = useState<Side | null>(null);
    const facing = pickedFacing ?? me?.place.facing ?? initialCourse.current;

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
        if (pickedFacing) {
            setPickedFacing(null);
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

    /**
     * Нажатие по месту на рейде. Второй раз по тому же месту — это не выбор заново, а разворот:
     * на выбранном месте нарисована стрелка курса, и менять курс естественнее там же, где он
     * и показан. Место при этом остаётся выбранным — уйти с него можно, ткнув в другое.
     */
    const handlePickBerth = (berth: Berth) => {
        if (pickedBerth && isSameBerth(berth, pickedBerth)) {
            setPickedFacing(otherSide(facing));
            return;
        }
        setPickedBerth(berth);
    };

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

    const handleLeave = () => {
        setEditing(false);
        void channelState.leave();
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

    // Нижний слой блока контента: разговор или то, что стоит на его месте, пока разговаривать
    // не с кем. Форма своего корабля выезжает поверх и этот слой не разбирает.
    const baseContent = (
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
            {/* Форма постановки в строй — это и есть содержимое блока: разговора у того, кто
                ещё не в строю, нет, и накрывать ей нечего. Переоснащение, наоборот, выезжает
                поверх разговора — см. ниже. */}
            {!loading && channel && !me && (
                <MemberForm
                    mode="join"
                    crew={members}
                    myId={myId}
                    shipKind={shipKind}
                    onShipKind={setPickedKind}
                    facing={facing}
                    onFacing={setPickedFacing}
                    onSubmit={handleMemberSubmit}
                />
            )}
            {channel && me && (
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

    // Форма своего корабля: выезжает снизу поверх разговора и уходит туда же. Пока едет —
    // остаётся на экране, см. useSlide.
    const formSlide = useSlide(editing && inChat);

    return (
        <div className={[styles.app, expanded ? styles.appExpanded : ''].filter(Boolean).join(' ')}>
            <header className={styles.header}>
                <div className={styles.scene} ref={sceneRef}>
                    <SeaScene
                        members={members}
                        myId={myId ?? ''}
                        morseFeeds={morseFeeds}
                        full={expanded}
                        ready={!loading && Boolean(channel)}
                        // Щелчок по своему кораблю открывает ту же форму, что и кнопка
                        // «Настроить корабль»: и корабль, и место на рейде меняются в одном месте.
                        onEditShip={() => setEditing(true)}
                        berths={
                            picking
                                ? { options: berthOptions, picked: pickedBerth, facing, onPick: handlePickBerth }
                                : undefined
                        }
                    />
                </div>
                <div className={[styles.headerBar, expanded ? styles.headerBarExpanded : ''].filter(Boolean).join(' ')}>
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
                        {inChat &&
                            (editing ? (
                                // Пока открыта форма, на месте списка кораблей — выход с рейда:
                                // это второе, что делают с собственным кораблём, и место ему
                                // рядом с его настройками. Список в этот момент не нужен —
                                // разговор всё равно накрыт формой.
                                <IconButton onClick={handleLeave} aria-label="Уйти с рейда">
                                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                        <path
                                            d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M13 12H21M18 8l4 4-4 4"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            fill="none"
                                        />
                                    </svg>
                                </IconButton>
                            ) : (
                                // Кнопка переключает, а не только открывает, и меняет значок:
                                // пока список открыт, на ней облачко разговора — иначе непонятно,
                                // чем вернуться назад. Нажатие мимо списка делает то же самое,
                                // но по нему надо догадаться.
                                <IconButton
                                    large={expanded}
                                    onClick={() => setSheetOpen((open) => !open)}
                                    aria-label={sheetOpen ? 'Вернуться к разговору' : 'Корабли на связи'}
                                >
                                    {sheetOpen ? (
                                        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                            <path
                                                d="M20 3H4a2 2 0 0 0-2 2v9.5a2 2 0 0 0 2 2h2.5V21l4.5-4.5H20a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"
                                                fill="currentColor"
                                            />
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                            <path
                                                d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                                fill="currentColor"
                                            />
                                        </svg>
                                    )}
                                </IconButton>
                            ))}
                        {/* Переключатель раскладки. Значок — стрелки по диагонали: в разные
                            стороны, когда разворачивать, и к середине, когда сворачивать.
                            Диагональ у обоих одна, меняются только концы, и переключение
                            читается как одно движение. */}
                        <IconButton
                            large={expanded}
                            onClick={() => setExpanded((on) => !on)}
                            aria-label={expanded ? 'Свернуть сцену' : 'Развернуть сцену'}
                        >
                            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                <path
                                    d={
                                        expanded
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
            <main className={[styles.content, expanded ? styles.contentCompact : ''].filter(Boolean).join(' ')}>
                <TopFade className={styles.base}>{baseContent}</TopFade>
                {formSlide.mounted && me && (
                    <div
                        className={[styles.form, editing ? '' : styles.formLeaving].filter(Boolean).join(' ')}
                        onTransitionEnd={formSlide.onTransitionEnd}
                    >
                        <TopFade>
                            <MemberForm
                                mode="edit"
                                crew={members}
                                myId={myId}
                                initial={myDraft}
                                shipKind={shipKind}
                                onShipKind={setPickedKind}
                                facing={facing}
                                onFacing={setPickedFacing}
                                onSubmit={handleMemberSubmit}
                                onCancel={() => setEditing(false)}
                            />
                        </TopFade>
                    </div>
                )}
            </main>
            {/* Список кораблей — шторкой поверх всего. Закрывается совсем, а не складывается:
                сложенный список был бы полоской ни с чем поверх разговора. */}
            <Shade open={sheetOpen && inChat && !editing} onClose={() => setSheetOpen(false)} label="Корабли на связи">
                <MembersList
                    members={members}
                    myId={myId}
                    seniorId={channel?.channel.owner?.memberId ?? null}
                    // Настройка своего корабля — та же форма, что и по щелчку по нему на рейде.
                    // Список за собой закрываем: форма выезжает поверх разговора, и оставшаяся
                    // сверху шторка накрыла бы её целиком.
                    onEditMe={() => {
                        setSheetOpen(false);
                        setEditing(true);
                    }}
                    // Список остаётся открытым: высадив один корабль, старший чаще всего смотрит
                    // на список дальше, а не уходит из него.
                    onKick={(memberId) => void channelState.kick(memberId)}
                    onHail={handleHail}
                />
            </Shade>
        </div>
    );
}
