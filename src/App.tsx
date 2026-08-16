import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { ChannelDraft, ChannelError, MemberDraft, backend, freeBerths, suggestBerth } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import LeaveRaid from '@/components/channel/LeaveRaid';
import MemberForm from '@/components/channel/MemberForm';
import MembersList from '@/components/channel/MembersList';
import ShipCard from '@/components/channel/ShipCard';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Panel from '@/components/ui/Panel';
import Shade from '@/components/ui/Shade';
import { useSnackbar } from '@/components/ui/Snackbar';
import TopFade from '@/components/ui/TopFade';
import { LeaveIcon } from '@/components/ui/icons';
import { HAIL_SIGNAL, morseDuration } from '@/hooks/morse';
import { useChannel } from '@/hooks/useChannel';
import { useLayout } from '@/hooks/useLayout';
import { useSlide } from '@/hooks/useSlide';
import { useSwipe } from '@/hooks/useSwipe';
import { channelLink, useRoute } from '@/routing';
import { Berth, Message, MorseFeed, ShipKind, Side, isSameBerth, otherSide } from '@/types/channel';
import { copyText } from '@/utils/clipboard';

import styles from './App.module.less';

/**
 * Сколько оклик держится в состоянии, мс: ровно на свою передачу и ещё немного сверху —
 * лампа могла в этот момент договаривать печать, и до оклика очередь дошла не сразу.
 * Считается по самому сигналу, а не проставляется числом: сигнал ещё будет меняться,
 * а забытый потолок молча обрезал бы его на полуслове.
 */
const HAIL_HOLD_MS = morseDuration(HAIL_SIGNAL) + 1200;

/**
 * На сколько стрелка двигает кромку разговора, px, и на сколько — стрелка с Shift.
 * Шаг мелкий нарочно: с клавиатуры ширину доводят, а не выбирают заново, — а для «заново»
 * есть Home и End.
 */
const GRIP_STEP = 16;
const GRIP_STEP_BIG = 64;

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
 * Раскладка у всех трёх одна: кадр со сценой и разговор — под кадром или сбоку от него,
 * смотря по форме окна (см. hooks/useLayout). Меняется только содержимое разговора, поэтому
 * море не прыгает при переходах, а корабли видно ещё до входа в канал.
 *
 * Поверх этого — три вещи, и все три необязательные: форма своего корабля (выезжает поверх
 * разговора) и две шторки поверх всего — список кораблей и карточка чужого корабля. Шторок
 * именно две, а не одна с разным содержимым: приходят они с разных сторон — из шапки
 * и из кадра, — и открытыми разом не бывают. Ничего четвёртого в приложении нет.
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
    // Чей корабль показан карточкой. Своей карточки нет: свой корабль настраивают, а не
    // разглядывают, и по нему открывается форма.
    const [shownId, setShownId] = useState<string | null>(null);
    // Спрашивают ли сейчас новый курс: шторка прощания с рейдом. Уход — единственное
    // действие, после которого ничего не остаётся, и курс как раз то, что остаётся.
    const [leaving, setLeaving] = useState(false);
    const notify = useSnackbar();

    // Раскладка целиком: где стоит разговор и какого он размера. Место выбирает форма окна,
    // размер — человек, и всё это сверено с нынешним окном одним местом на все проверки,
    // см. hooks/useLayout. Здесь остаётся только пользоваться готовым.
    const { layout, resize, keep, hide, show } = useLayout();
    const { mode, shown, size } = layout;
    const atSide = mode === 'side';

    // Разговор убирают не только кнопкой, но и свайпом по кадру. Палец ведёт сам разговор,
    // а не кадр: разговор лежит снизу, и движение вниз отталкивает его с экрана, движение
    // вверх притягивает обратно. Обратные движения кадр не трогает, и потяг страницы
    // к обновлению на них работает как был.
    const sceneRef = useRef<HTMLDivElement>(null);
    const toggleChat = useCallback(() => (shown ? hide() : show()), [shown, hide, show]);
    useSwipe(sceneRef, shown ? 'down' : 'up', toggleChat);

    // Пустой список — тоже список, но новый на каждой отрисовке: без useMemo он менял бы
    // ссылку каждый раз и заставлял пересчитывать всё, что от него зависит.
    const members = useMemo(() => channel?.members ?? [], [channel]);
    const me = members.find((member) => member.memberId === myId) ?? null;
    // Чей корабль в карточке. Ищем каждый раз заново, а не запоминаем самого участника:
    // он мог за это время переоснаститься или уйти с рейда, и карточка обязана показывать
    // нынешний корабль, а не тот, каким его открыли. Ушёл совсем — карточка закрывается сама:
    // показывать нечего.
    const shownMember = shownId ? (members.find((member) => member.memberId === shownId) ?? null) : null;
    // Кого рисовать в карточке, пока она уезжает. Закрытая шторка ещё какое-то время на экране,
    // а корабля у неё в этот момент уже нет — и без этой памяти карточка на прощание схлопывалась
    // бы в пустую полоску.
    const shownLastRef = useRef(shownMember);
    if (shownMember) {
        shownLastRef.current = shownMember;
    }
    const shownCard = shownMember ?? shownLastRef.current;
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

    // Показать карточку чужого корабля. Список кораблей при этом не трогаем: карточка ложится
    // поверх него (см. cover у Shade), и закрыв её, человек возвращается туда, откуда открыл.
    // Открытая из кадра, она ложится поверх пустого места — там закрывать и нечего.
    const handleShowShip = useCallback((memberId: string) => setShownId(memberId), []);

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

    // Координаты рейда — ссылка на канал. Показывать её негде, она длинная, поэтому уходит
    // прямо в буфер, а ответом служит снекбар. Живёт это в списке кораблей: позвать ещё
    // кого-то — то же самое действие, что и посмотреть, кто уже пришёл.
    const handleCopyLink = () => {
        if (channel) {
            void copyText(channelLink(channel.channel.slug)).then((done) =>
                notify(done ? 'Координаты скопированы' : 'Не вышло скопировать координаты')
            );
        }
    };

    // Список кораблей открывается названием канала. Пока открыта форма своего корабля,
    // списка не видно (он бы её накрыл), и то же нажатие возвращает от формы к списку —
    // из него форму и открыли.
    const handleShips = () => {
        if (editing) {
            setEditing(false);
            setSheetOpen(true);
            return;
        }
        setSheetOpen((open) => !open);
    };

    // Уход с рейда спрашивает новый курс — куда корабль пошёл. Молча корабль не пропадает:
    // остальным виден только опустевший рейд, и курс — единственное, что от ушедшего
    // остаётся (см. components/channel/LeaveRaid).
    //
    // Форму своего корабля при этом закрываем: выход есть и в ней, а спрашивать курс поверх
    // настроек корабля, который через секунду уйдёт, незачем.
    const handleLeave = () => {
        setEditing(false);
        setLeaving(true);
    };

    const handleLeaveConfirm = (course: string) => {
        void channelState
            .leave(course)
            .then(() => {
                setLeaving(false);
                setSheetOpen(false);
            })
            // Отказ бэкенда (например, курс длиннее предела) оставляет шторку открытой:
            // набранное не потеряно, и сказанное снекбаром можно исправить на месте.
            .catch((failure: unknown) =>
                notify(failure instanceof ChannelError ? failure.message : 'Не вышло уйти с рейда')
            );
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
                        // Фразу об отказе складывает само поле по общей мерке длины
                        // (`@/utils/limit`), нам остаётся её показать.
                        onTooLong={notify}
                        onTyped={channelState.reportTyping}
                    />
                </>
            )}
        </>
    );

    // Форма своего корабля: выезжает снизу поверх разговора и уходит туда же. Пока едет —
    // остаётся на экране, см. useSlide.
    const formSlide = useSlide(editing && inChat);

    /**
     * Потяг за коридор вдоль кромки разговора.
     *
     * Слушаем окно, а не сам коридор: он шириной в шестнадцать пикселей, и первый же шаг
     * указателя выносит палец за его кромку. Записываем начало потяга, а не считаем сдвиг
     * от кадра к кадру: ширина по дороге упирается в пределы, и накопленный сдвиг разошёлся
     * бы с указателем ровно на то, что срезали упоры.
     *
     * Разговор стоит справа, поэтому влево — шире.
     */
    const dragFrom = useRef<{ x: number; width: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const handleGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        dragFrom.current = { x: event.clientX, width: size };
        setDragging(true);
    };

    useEffect(() => {
        if (!dragging) {
            return undefined;
        }
        const onMove = (event: PointerEvent) => {
            const from = dragFrom.current;
            if (from) {
                resize(from.width + (from.x - event.clientX));
            }
        };
        const onUp = () => {
            setDragging(false);
            keep();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        // Потяг обрывают и без отпускания — системным жестом, потерей окна. Ширина при этом
        // остаётся той, до которой дотянули: отматывать её обратно человек не просил.
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [dragging, resize, keep]);

    /**
     * Тот же коридор с клавиатуры: стрелками по шагу, Home и End — до упора. Коридор объявлен
     * разделителем (role="separator") и умеет то, что разделителю положено уметь; без этого
     * ширину разговора нельзя было бы поменять вовсе, не взяв в руки мышь.
     */
    const handleGripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? GRIP_STEP_BIG : GRIP_STEP;
        const to = {
            ArrowLeft: size + step,
            ArrowRight: size - step,
            Home: layout.max,
            End: layout.min,
        }[event.key];
        if (to !== undefined) {
            event.preventDefault();
            resize(to, true);
        }
    };

    return (
        <div
            className={[styles.app, atSide ? styles.appSide : styles.appUnder, dragging ? styles.appDragging : '']
                .filter(Boolean)
                .join(' ')}
            // Размер разговора — одним числом на всё, что от него считается: сам разговор,
            // высота кадра, ширина шторки на сцене и затемнение под ней (см. --chat-to
            // в стилях). Высота это или ширина, говорит раскладка, а не число.
            style={{ '--chat-to': `${size}px` } as CSSProperties}
        >
            <header className={styles.header}>
                <div className={styles.scene} ref={sceneRef}>
                    <SeaScene
                        members={members}
                        myId={myId ?? ''}
                        morseFeeds={morseFeeds}
                        ready={!loading && Boolean(channel)}
                        // Щелчок по своему кораблю открывает ту же форму, что и кнопка
                        // «Настроить корабль»: и корабль, и место на рейде меняются в одном месте.
                        //
                        // Карточку чужого при этом закрываем — на всякий случай, а не по нужде:
                        // до рейда из-под открытой шторки не дотянуться вовсе, под ней всюду
                        // лежит затемнение (в нижней раскладке по окну, в боковой по сцене,
                        // см. .backdrop в Shade). Останься карточка поверх выехавшей формы, она
                        // накрыла бы собой ровно то, ради чего по кораблю и нажали, — и сброс
                        // тут стоит дешевле, чем разбор, кто кого сейчас не пускает. Список
                        // кораблей закрывать не надо: он и так не открыт, пока открыта форма.
                        onEditShip={() => {
                            setShownId(null);
                            setEditing(true);
                        }}
                        // А щелчок по чужому — его карточку: своим на рейде распоряжаются,
                        // чужой разглядывают.
                        onShowShip={handleShowShip}
                        berths={
                            picking
                                ? { options: berthOptions, picked: pickedBerth, facing, onPick: handlePickBerth }
                                : undefined
                        }
                    />
                </div>
                <div className={styles.headerBar}>
                    <div className={styles.headerInfo}>
                        {/* Название канала — это и кнопка «кто на связи»: по нажатию открывается
                            список кораблей. Значок стоит в конце названия, а не отдельной кнопкой
                            справа: список — это и есть «кто в этом канале», и спрашивают о нём,
                            тыча в его название. Нажимается всё вместе, название со значком.

                            Кнопкой название становится только у своих: список показывают тем,
                            кто уже на рейде, а гостю на входе открывать нечего — ему остаётся
                            то же название простой строчкой. Её же видно и на главной, где
                            канала нет вовсе: там на этом месте название сервиса. */}
                        {inChat && channel ? (
                            <button
                                type="button"
                                className={styles.chatTitleButton}
                                onClick={handleShips}
                                title="Корабли на связи"
                            >
                                <span className={styles.chatTitleName}>{channel.channel.title}</span>
                                {/* Значок один и тот же в обоих положениях. Менять его на облачко
                                        разговора, пока список открыт, значило бы обещать переход
                                        куда-то ещё: список никуда не уводит, он приезжает поверх
                                        и тем же нажатием убирается — как и всякая шторка. */}
                                <span className={styles.chatTitleIcon}>
                                    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                                        <path
                                            d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                            fill="currentColor"
                                        />
                                    </svg>
                                </span>
                            </button>
                        ) : (
                            <div className={styles.chatTitle}>{channel?.channel.title ?? 'Кильватер'}</div>
                        )}
                        <div className={styles.chatStatus}>{loading ? 'связь…' : status()}</div>
                    </div>
                    {/* Кнопки идут вплотную: это один блок действий, а не два разных. */}
                    <div className={styles.headerActions}>
                        {/* Пока открыта форма своего корабля, в шапке стоит выход с рейда:
                            это второе, что делают с собственным кораблём, и место ему рядом
                            с его настройками. В остальное время в шапке кнопки списка нет —
                            список открывают названием канала слева. */}
                        {inChat && editing && (
                            <IconButton onClick={handleLeave} aria-label="Уйти с рейда">
                                <LeaveIcon size={24} />
                            </IconButton>
                        )}
                        {/* Убрать разговор с экрана и вернуть его обратно. Кнопка одна, а не две,
                            и значков у неё два: пока разговор на месте — стрелки по диагонали
                            в разные стороны, «кадру всё окно»; когда его нет — облачко реплики,
                            «верните разговор». Обещает каждый из них ровно то, что случится
                            по нажатию.

                            Возвращается разговор в тот размер, в каком его убрали, а не
                            в умолчание: убрать и вернуть — это одно движение туда и обратно,
                            и терять на нём выбранную высоту не за что (см. `back`
                            в hooks/useLayout).

                            Про канал кнопка не спрашивает: раскладка — про кадр и разговор,
                            а они на месте и на главной, где вместо разговора стоит форма
                            создания канала. Кадр там такой же настоящий, и смотреть на него
                            во весь экран хочется не меньше. */}
                        <IconButton onClick={toggleChat} aria-label={shown ? 'Убрать разговор' : 'Вернуть разговор'}>
                            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                <path
                                    d={
                                        shown
                                            ? 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'
                                            : 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6z'
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
            {/* Разговор. Убранный, он остаётся в разметке нулевого размера — иначе с ним
                пропали бы и место прокрутки ленты, и набранное в поле, — но становится
                недоступным вовсе: ни указателю, ни клавиатуре, ни чтению вслух. */}
            <main
                className={[styles.content, atSide ? styles.contentSide : '', shown ? '' : styles.contentGone]
                    .filter(Boolean)
                    .join(' ')}
                inert={!shown}
            >
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
            {/* Коридор вдоль кромки разговора: за него меняют его ширину. Стоит он рядом
                с разговором, а не внутри, и приходится ровно на стык — половиной на кадр,
                половиной на разговор. Внутри он лежал поверх ленты и съедал поле нажатия
                у аватарок вместе с краем самого кружка, а разговор обрезан наглухо, и высунуть
                половину коридора наружу оттуда нечем. За кромкой он идёт своим переходом,
                тем же и по тем же секундам, что и разговор, — см. .grip в стилях.
                У убранного разговора коридора нет: ширины у него ноль, и тянуть не за что —
                вернуть его можно кнопкой в шапке. */}
            {atSide && shown && (
                <div
                    className={styles.grip}
                    onPointerDown={handleGripDown}
                    onKeyDown={handleGripKey}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Ширина разговора"
                    aria-valuenow={Math.round(size)}
                    aria-valuemin={layout.min}
                    aria-valuemax={layout.max}
                    tabIndex={0}
                />
            )}
            {/* Список кораблей — шторкой поверх всего. Закрывается совсем, а не складывается:
                сложенный список был бы полоской ни с чем поверх разговора. */}
            <Shade
                open={sheetOpen && inChat && !editing}
                onClose={() => setSheetOpen(false)}
                label="Корабли на связи"
                // Сбоку шторка вылезает не поверх окна, а на сцене: список кораблей — про рейд,
                // и место ему там, где рейд и виден. Разговор в панели при этом не накрыт
                // ничем и остаётся читаемым.
                onScene={atSide}
            >
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
                    // Карточка чужого корабля — та же, что и по щелчку по нему в кадре. Здесь
                    // она ложится поверх списка и закрывается обратно в него.
                    onShowShip={handleShowShip}
                    // Позвать ещё кого-то и уйти самому — два действия про рейд целиком,
                    // а не про корабль в строчке. Оба стоят полосой внизу списка.
                    onCopyLink={handleCopyLink}
                    onLeave={handleLeave}
                />
            </Shade>
            {/* Карточка чужого корабля — такой же шторкой. Второй шторкой, а не содержимым
                первой: список и карточка приходят с разных сторон — из списка и из кадра, —
                и класть карточку внутрь списка значило бы открывать список там, где его
                не звали.

                Ложится она поверх (cover): открытая из строчки списка, она его продолжает,
                и закрыв её, человек ждёт увидеть список, а не пустой рейд. Открытая из кадра —
                поверх пустого места, и накрывать ей нечего. Обратное неверно: список, открытый
                из шапки, карточку под собой закрывает — разговор про тот корабль кончился. */}
            <Shade open={Boolean(shownMember)} onClose={() => setShownId(null)} label="Корабль" onScene={atSide} cover>
                {shownCard && (
                    <ShipCard
                        key={shownCard.memberId}
                        member={shownCard}
                        senior={shownCard.memberId === channel?.channel.owner?.memberId}
                    />
                )}
            </Shade>
            {/* Прощание с рейдом — тоже шторка и тоже поверх (cover): уходят из списка
                кораблей, и передумавший ждёт вернуться ровно в него, а не на пустой рейд.

                Закрывается она сама, как только корабль снялся: с уходом кончается inChat,
                а вместе с ним — и всё, что показывают своему кораблю. */}
            <Shade
                open={leaving && inChat}
                onClose={() => setLeaving(false)}
                label="Вы уходите с рейда"
                onScene={atSide}
                cover
            >
                <LeaveRaid onConfirm={handleLeaveConfirm} onCancel={() => setLeaving(false)} />
            </Shade>
        </div>
    );
}
