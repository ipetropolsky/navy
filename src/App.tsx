import {
    AnimationEvent as ReactAnimationEvent,
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    TransitionEvent,
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
import { HAIL_SIGNAL, morseDuration } from '@/hooks/morse';
import { useChannel } from '@/hooks/useChannel';
import { useLayout } from '@/hooks/useLayout';
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

/**
 * Через сколько половина переезда блока контента считается доехавшей, даже если о конце
 * движения так и не сообщили, мс. Анимации бывают отключены совсем, а вкладка в фоне их
 * не отыгрывает; без страховки блок остался бы за кромкой навсегда — то есть разговор
 * пропал бы с экрана.
 *
 * Число с запасом от самой половины (@move-seconds в motion.less — 0.18s): срабатывать оно
 * должно только тогда, когда события уже точно не будет.
 */
const MOVE_GRACE_MS = 600;

/**
 * На сколько стрелка двигает кромку боковой панели, px, и на сколько — стрелка с Shift.
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
 * Раскладка у всех трёх одна: кадр со сценой сверху, блок контента под ним. Меняется только
 * содержимое блока, поэтому море не прыгает при переходах, а корабли видно ещё до входа
 * в канал.
 *
 * Поверх этого — четыре вещи, и все четыре необязательные: раскладка «больше сцены» (одна
 * кнопка в шапке), форма своего корабля (выезжает поверх разговора) и две шторки поверх всего —
 * список кораблей и карточка чужого корабля. Шторок именно две, а не одна с разным содержимым:
 * приходят они с разных сторон — из шапки и из кадра, — и открытыми разом не бывают.
 * Ничего пятого в приложении нет.
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
    const notify = useSnackbar();

    // Раскладка целиком: развёрнут ли кадр, стоит ли разговор сбоку и какой он ширины. Всё
    // это выбирает человек, всё это помнит вкладка, и всё это сверено с нынешним окном — одним
    // местом на все проверки, см. hooks/useLayout. Здесь остаётся только пользоваться готовым:
    // `side` уже значит «стоит сбоку и в это окно это помещается». Своего у приложения к этому
    // одно — время переезда, пока разговор ещё не там, где выбран (см. holdUnder ниже).
    const { layout, choose, resizeSide, keep } = useLayout();
    const { expanded, sideWidth, sideFits, sideOnExpand } = layout;

    // Переезд: 'out' — блок уходит с прежнего места, 'in' — приезжает на новое. Пока не
    // переезжает, его нет вовсе. Половинки идут по очереди, и место меняется между ними —
    // одно движение из угла в угол было бы полётом коробки через всю сцену.
    const [moving, setMoving] = useState<'out' | 'in' | null>(null);

    // Держим ли разговор под кадром вопреки выбору. Так и только так идёт разворот в боковую
    // раскладку: пока кадр расхлопывается, разговор ещё внизу и оттуда уходит переездом
    // (см. switchLayout). Отдельным состоянием, а не подменой выбора: выбор — то, что человек
    // просил, и придержать разговор на полсекунды не значит передумать. Подмени мы его здесь,
    // перезагрузка в эти полсекунды открыла бы вкладку без панели, а отменённый разворот
    // стёр бы выбор насовсем.
    const [holdUnder, setHoldUnder] = useState(false);

    // Где разговор стоит прямо сейчас. Отличается от выбранного только на время разворота.
    const atSide = layout.side && !holdUnder;

    // Раскладку переключает не только кнопка, но и свайп по кадру: сжатый раздаётся движением
    // вниз, раздутый сжимается движением вверх — палец ведёт кромку кадра туда, куда она поедет.
    // Обратные движения кадр не трогают, и потяг страницы к обновлению на них работает как был.
    //
    // Свернули кадр — разговор возвращается вниз сам: сбоку он стоит во всю высоту окна,
    // а сжатому кадру рядом с ним не остаётся ничего, и раскладка это знает без напоминаний.
    // Переезда при этом нет: кадр в этот миг и так едет, и второе движение поверх него
    // читалось бы поломкой. Выбор «разговор сбоку» никуда не девается — развернут кадр
    // обратно, и разговор вернётся туда, где его оставили.
    //
    // А вот разворот в боковую раскладку — это два движения, и оба настоящие: кадр
    // расхлопывается ровно так же, как расхлопнулся бы с разговором внизу, а разговор в это же
    // время уезжает за нижнюю кромку и приезжает в панель — тем самым переездом, что и по
    // кнопке. Идут они разом, а не по очереди: переезд успевает дважды за то время, что
    // разворот идёт однажды, и в очереди второе движение начиналось бы после уже вставшего
    // кадра — почти вдвое дольше на одно нажатие.
    //
    // Прежде боковая раскладка вставала первым же кадром, до всякого движения, и разворот
    // читался задом наперёд: сперва собиралась сжатая раскладка с узкой панелью сбоку,
    // и уже она раздвигалась во всю ширину окна.
    const sceneRef = useRef<HTMLDivElement>(null);
    const switchLayout = useCallback(() => {
        const toSide = !expanded && sideOnExpand;
        choose((was) => ({ expanded: !was.expanded }));
        setHoldUnder(toSide);
        setMoving(toSide ? 'out' : null);
    }, [choose, expanded, sideOnExpand]);
    useSwipe(sceneRef, expanded ? 'up' : 'down', switchLayout);

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

    // Показать карточку чужого корабля. Список кораблей при этом закрываем: карточка — это
    // ответ про один корабль, и оставшийся под ней список отвечал бы про все разом.
    const handleShowShip = useCallback((memberId: string) => {
        setSheetOpen(false);
        setShownId(memberId);
    }, []);

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
                        onShowShip={handleShowShip}
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

    /**
     * Середина переезда: блок ушёл за кромку, и здесь — и только здесь — меняется его место.
     * Пока блок за кромкой, его перекладывание ничего не показывает; дальше вторая половина
     * сама приедет из-за той кромки, к которой он теперь стоит.
     *
     * Место меняется двумя разными способами, и разница в том, чей это переезд. По кнопке
     * переезжает сам выбор: разговор был внизу — станет сбоку, и наоборот. А в развороте
     * выбор с самого начала стоит на «сбоку», и разговор внизу лишь придержан (см. holdUnder) —
     * менять там нечего, довольно отпустить.
     */
    const arrive = useCallback(() => {
        if (holdUnder) {
            setHoldUnder(false);
        } else {
            choose((was) => ({ side: !was.side }));
        }
        setMoving('in');
    }, [holdUnder, choose]);

    /**
     * Конец первой половины переезда: блок ушёл за кромку.
     *
     * Проверяется и цель, и свойство: внутри блока едет своё — форма поверх разговора,
     * ответы, кнопки, — и до переезда это не относится.
     */
    const handleContentTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
        if (moving === 'out' && event.target === event.currentTarget && event.propertyName === 'transform') {
            arrive();
        }
    };

    /** Конец второй половины: блок на месте, переезда больше нет. */
    const handleContentAnimationEnd = (event: ReactAnimationEvent<HTMLElement>) => {
        if (moving === 'in' && event.target === event.currentTarget) {
            setMoving(null);
        }
    };

    // Страховка на случай, когда о конце движения так и не сообщили: анимации бывают отключены
    // совсем, а вкладка в фоне их не отыгрывает. Первая половина без этого оставила бы блок
    // за кромкой навсегда — то есть разговор просто пропал бы с экрана.
    //
    // Срок с запасом от самого движения (см. MOVE_GRACE_MS): доводит переезд только тогда,
    // когда событие уже точно не придёт, и в обычной жизни не срабатывает ни разу.
    useEffect(() => {
        if (!moving) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            if (moving === 'out') {
                arrive();
            } else {
                setMoving(null);
            }
        }, MOVE_GRACE_MS);
        return () => window.clearTimeout(timer);
    }, [moving, arrive]);

    /**
     * Потяг за коридор вдоль кромки боковой панели.
     *
     * Слушаем окно, а не сам коридор: он шириной в шестнадцать пикселей, и первый же шаг
     * указателя выносит палец за его кромку. Записываем начало потяга, а не считаем сдвиг
     * от кадра к кадру: ширина по дороге упирается в пределы, и накопленный сдвиг разошёлся
     * бы с указателем ровно на то, что срезали упоры.
     *
     * Панель стоит справа, поэтому влево — шире.
     */
    const dragFrom = useRef<{ x: number; width: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const handleGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        dragFrom.current = { x: event.clientX, width: sideWidth };
        setDragging(true);
    };

    useEffect(() => {
        if (!dragging) {
            return undefined;
        }
        const onMove = (event: PointerEvent) => {
            const from = dragFrom.current;
            if (from) {
                resizeSide(from.width + (from.x - event.clientX));
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
    }, [dragging, resizeSide, keep]);

    /**
     * Тот же коридор с клавиатуры: стрелками по шагу, Home и End — до упора. Коридор объявлен
     * разделителем (role="separator") и умеет то, что разделителю положено уметь; без этого
     * ширину панели нельзя было бы поменять вовсе, не взяв в руки мышь.
     */
    const handleGripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? GRIP_STEP_BIG : GRIP_STEP;
        const to = {
            ArrowLeft: sideWidth + step,
            ArrowRight: sideWidth - step,
            Home: layout.maxWidth,
            End: layout.minWidth,
        }[event.key];
        if (to !== undefined) {
            event.preventDefault();
            resizeSide(to, true);
        }
    };

    const contentLook = [
        styles.content,
        atSide ? styles.contentSide : '',
        moving === 'out' ? styles.contentGoing : '',
        moving === 'in' ? styles.contentComing : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            className={[
                styles.app,
                expanded ? styles.appExpanded : '',
                atSide ? styles.appSide : '',
                dragging ? styles.appDragging : '',
            ]
                .filter(Boolean)
                .join(' ')}
            // Ширина боковой панели — одним числом на всё, что этой ширины: сама панель,
            // шторка внутри неё и затемнение под шторкой (см. --side-width в стилях).
            style={{ '--side-width': `${sideWidth}px` } as CSSProperties}
        >
            <header className={[styles.header, atSide ? styles.headerSide : ''].filter(Boolean).join(' ')}>
                <div className={styles.scene} ref={sceneRef}>
                    <SeaScene
                        members={members}
                        myId={myId ?? ''}
                        morseFeeds={morseFeeds}
                        full={expanded}
                        ready={!loading && Boolean(channel)}
                        // Щелчок по своему кораблю открывает ту же форму, что и кнопка
                        // «Настроить корабль»: и корабль, и место на рейде меняются в одном месте.
                        //
                        // Карточку чужого при этом закрываем. Открытая, она никак не мешает
                        // дотянуться до своего корабля — стоит она над одним краем кадра, — но
                        // остаться поверх выехавшей формы значило бы накрыть собой ровно то,
                        // ради чего по кораблю и нажали. Список кораблей закрывать не надо:
                        // он и так не открыт, пока открыта форма.
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
                        {/* Куда поставить разговор — вниз под кадр или сбоку от него.
                            Кнопка есть только в развёрнутой раскладке: в свёрнутой сбоку
                            стоять нечему, там сжат сам кадр. На узком окне её нет вовсе —
                            и решает это тот же ответ, по которому не работает и сама боковая
                            раскладка (sideFits, см. hooks/useLayout): кнопка, которая ничего
                            не меняет, не бесполезна, а лжива.

                            Про канал она не спрашивает: раскладка — про кадр и блок контента,
                            а они на месте и на главной, где в блоке стоит форма создания
                            канала. Кадр там такой же настоящий, и смотреть на него из-под
                            узкой колонки хочется не меньше.

                            Значок — плашка с отделённой полосой: справа, когда разговор
                            встанет сбоку, и снизу, когда вернётся вниз. Рисунок один,
                            меняется только та сторона, к которой прижата полоса. */}
                        {expanded && sideFits && (
                            <IconButton
                                onClick={() => setMoving('out')}
                                aria-label={atSide ? 'Разговор под кадром' : 'Разговор сбоку'}
                            >
                                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                                    <rect
                                        x="3"
                                        y="4"
                                        width="18"
                                        height="16"
                                        rx="2"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        fill="none"
                                    />
                                    <path
                                        d={atSide ? 'M3 15h18' : 'M15 4v16'}
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        fill="none"
                                    />
                                </svg>
                            </IconButton>
                        )}
                        {/* Переключатель раскладки. Значок — стрелки по диагонали: в разные
                            стороны, когда разворачивать, и к середине, когда сворачивать.
                            Диагональ у обоих одна, меняются только концы, и переключение
                            читается как одно движение. */}
                        <IconButton
                            onClick={switchLayout}
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
            <main
                className={contentLook}
                onTransitionEnd={handleContentTransitionEnd}
                onAnimationEnd={handleContentAnimationEnd}
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
                {/* Коридор вдоль кромки панели: за него меняют её ширину. Лежит он в самом
                    блоке, а не рядом с ним, — и потому переезжает вместе с ним и не остаётся
                    висеть посреди сцены, пока блок едет. Пока блок в пути, коридора нет вовсе:
                    тянуть едущее не за что. */}
                {atSide && !moving && (
                    <div
                        className={styles.grip}
                        onPointerDown={handleGripDown}
                        onKeyDown={handleGripKey}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Ширина разговора"
                        aria-valuenow={Math.round(sideWidth)}
                        aria-valuemin={layout.minWidth}
                        aria-valuemax={layout.maxWidth}
                        tabIndex={0}
                    />
                )}
            </main>
            {/* Список кораблей — шторкой поверх всего. Закрывается совсем, а не складывается:
                сложенный список был бы полоской ни с чем поверх разговора. */}
            <Shade
                open={sheetOpen && inChat && !editing}
                onClose={() => setSheetOpen(false)}
                label="Корабли на связи"
                // Сбоку шторка вылезает не поверх окна, а внутри разговора: поверх окна она
                // накрыла бы собой рейд, ради которого разговор в панель и убирают.
                inside={atSide}
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
                />
            </Shade>
            {/* Карточка чужого корабля — такой же шторкой. Второй шторкой, а не содержимым
                первой: список и карточка приходят с разных сторон — из шапки и из кадра, —
                и класть карточку внутрь списка значило бы открывать список там, где его
                не звали. Открыты обе разом они не бывают: карточка закрывает список за собой. */}
            <Shade open={Boolean(shownMember)} onClose={() => setShownId(null)} label="Корабль" inside={atSide}>
                {shownCard && (
                    <ShipCard
                        key={shownCard.memberId}
                        member={shownCard}
                        senior={shownCard.memberId === channel?.channel.owner?.memberId}
                        // Оклик уходит на рейд, а карточка остаётся открытой: лампа отвечает
                        // и на портрете, и на самом корабле в кадре, и закрыть её в этот миг
                        // значило бы спрятать половину ответа.
                        onHail={() => handleHail(shownCard.memberId)}
                    />
                )}
            </Shade>
        </div>
    );
}
