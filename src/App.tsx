import {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from 'react';

import { ChannelDraft, ChannelError, MemberDraft, backend, freeBerths, suggestBerth } from '@/backend';
import { DEMO_CHANNEL_SLUG } from '@/backend/seed';
import SeaScene, { BerthChoice } from '@/components/SeaScene/SeaScene';
import CreateChannel from '@/components/channel/CreateChannel';
import LeaveRaid from '@/components/channel/LeaveRaid';
import MemberForm from '@/components/channel/MemberForm';
import MembersList from '@/components/channel/MembersList';
import ShipCard from '@/components/channel/ShipCard';
import Composer from '@/components/chat/Composer';
import MessageList from '@/components/chat/MessageList';
import Button from '@/components/ui/Button';
import CloseButton from '@/components/ui/CloseButton';
import Counter from '@/components/ui/Counter';
import IconButton from '@/components/ui/IconButton';
import Panel from '@/components/ui/Panel';
import Shade from '@/components/ui/Shade';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LeaveIcon } from '@/components/ui/icons';
import { FEED_MIN, SHEET_HANDLE } from '@/config/layout';
import { paced } from '@/config/time';
import { HAIL_SIGNAL, morseDuration } from '@/hooks/morse';
import { useChannel } from '@/hooks/useChannel';
import { chatMagnets, useLayout } from '@/hooks/useLayout';
import { useSettled } from '@/hooks/useSettled';
import { useSlide } from '@/hooks/useSlide';
import { useSwipe } from '@/hooks/useSwipe';
import { useUnread } from '@/hooks/useUnread';
import { channelLink, useRoute } from '@/routing';
import { NOTHING_OPEN, reduce } from '@/state/layers';
import { Berth, Message, MorseFeed, ShipKind, Side, authorLook, isSameBerth, otherSide } from '@/types/channel';
import { copyText } from '@/utils/clipboard';
import { Fling, rubberBand, settleMagnet, stepMagnet, trackFling } from '@/utils/magnet';
import { plural } from '@/utils/plural';

import styles from './App.module.less';

/**
 * Сколько оклик держится в состоянии, мс: ровно на свою передачу и ещё немного сверху —
 * лампа могла в этот момент договаривать печать, и до оклика очередь дошла не сразу.
 * Считается по самому сигналу, а не проставляется числом: сигнал ещё будет меняться,
 * а забытый потолок молча обрезал бы его на полуслове.
 */
const HAIL_HOLD_MS = morseDuration(HAIL_SIGNAL) + 1200;

/** С каким кораблём открывается форма у того, кто ещё не в строю и ничем прежде не ходил. */
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
 * Среднее из трёх начинается закрытым: на месте разговора одна кнопка «Встать на рейд»,
 * и до нажатия по ней человек — гость. Рейд ему видно как обычно, а больше ничего: ни разговора,
 * ни списка кораблей, ни нажатий по кораблям в кадре. Исключение одно — канал, заведённый
 * в этой же вкладке: там форма открыта сразу (см. `ownChannel`).
 *
 * Раскладка у всех трёх одна: кадр со сценой и разговор — под кадром или сбоку от него,
 * смотря по форме окна (см. hooks/useLayout). Меняется только содержимое разговора, поэтому
 * море не прыгает при переходах, а корабли видно ещё до входа в канал.
 *
 * Поверх этого — второй слой коробки и шторки, и всё это необязательное. Слоем выезжают форма
 * своего корабля и список кораблей: оба про рейд, оба никого не загораживают, и открытыми
 * разом не бывают. Шторкой поверх всего приезжают карточка чужого корабля и прощание с рейдом:
 * пока они на экране, разговор идёт только про них, и под ними ничего не выбирают. Разница
 * между слоем и шторкой ровно в этом, а не в содержимом.
 *
 * Данные приходят из useChannel, а тот берёт их у ChannelBackend. Ни localStorage,
 * ни соседних вкладок здесь не видно: всё это дело бэкенда.
 */
export default function App() {
    const route = useRoute();
    const channelState = useChannel(route.channel, route.memberId);
    const { channel, myId, reception, lastLook, loading } = channelState;
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    /**
     * Что открыто поверх рейда: список кораблей, форма своего корабля, карточка чужого, прощание
     * с рейдом, постановка в строй — и подняла ли панель на экран сама открывшаяся в неё форма.
     *
     * Одним состоянием и одним набором намерений, см. state/layers: правила переходов там,
     * и там же они проверены юнитами. Здесь остаётся сказать, что случилось («нажали название
     * канала»), и доиграть разницу — движение панели, замеры, фокус.
     */
    const [layers, act] = useReducer(reduce, NOTHING_OPEN);
    const { list: sheetOpen, form: editing, shownId, leaving, joining, brought: broughtPanel, bringing } = layers;
    const notify = useSnackbar();

    /**
     * Пол разговора под кадром, px: ручка для хвата и плашка ввода под ней.
     *
     * Это самое малое, во что разговор сворачивается свайпом, и в этом виде он остаётся
     * полезным: ленты не видно ни строчки, а написать в канал можно, ничего не разворачивая.
     * Кнопки, убирающей разговор совсем, под кадром нет вовсе — на телефоне он всегда снизу.
     *
     * Меряется плашка по живой разметке, а не задана числом: высота у неё меняется от плашки
     * ответа над полем и от выреза экрана под ним, и записанное число разошлось бы с ней
     * при первой же правке. Плашки нет вовсе (главная, гость на входе) — полом остаётся одна
     * ручка: тянуть разговор обратно всё равно есть за что.
     */
    const [composerHeight, setComposerHeight] = useState(0);
    const floor = SHEET_HANDLE + composerHeight;
    // Замер висит на самой ссылке, а не в отдельном useEffect: плашки в разметке то нет, то она
    // есть, и ссылка узнаёт об этом первой — ей и заводить наблюдателя. Возвращённую уборку
    // React зовёт, когда плашка уходит.
    //
    // Наблюдатель, а не разовый замер: плашка растёт и опадает вместе с ответом, на который
    // отвечают, и пол обязан идти за ней.
    const measureComposer = useCallback((node: HTMLFormElement | null) => {
        if (!node) {
            setComposerHeight(0);
            return undefined;
        }
        const observer = new ResizeObserver(() => setComposerHeight(node.getBoundingClientRect().height));
        observer.observe(node);
        return () => {
            observer.disconnect();
            setComposerHeight(0);
        };
    }, []);

    // Раскладка целиком: где стоит разговор и какого он размера. Место выбирает форма окна,
    // размер — человек, и всё это сверено с нынешним окном одним местом на все проверки,
    // см. hooks/useLayout. Здесь остаётся только пользоваться готовым.
    const { layout, resize, hide, show } = useLayout(floor);
    const { mode, shown, folded, size } = layout;
    const atSide = mode === 'side';
    // Разговор на экране по-настоящему: не убран и не свёрнут свайпом до пола. Свёрнутый
    // числится тут вместе с убранным — ленты в нём не видно, — и так на него смотрит всё,
    // что спрашивает «есть ли куда показать разговор»: выезжающий в него список кораблей,
    // рост коробки под этим списком. Сам свёрнутый разговор при этом живой: в поле ввода
    // пишут, за ручку его достают обратно, и коридор для свайпа стоит по его кромке (`shown`).
    const talking = shown && !folded;

    /**
     * Сколько чужих реплик пришло, пока разговор был убран с экрана. Считает их `useUnread`,
     * здесь остаётся показать: счётчиком на кнопке, которой панель возвращают, и той же цифрой
     * в её подписи.
     *
     * Спрашиваем про `shown`, а не про `talking`: свёрнутый до пола разговор ленты не
     * показывает, это правда, — но и кнопки, на которой стояла бы пилюля, под кадром нет вовсе.
     * Копить непрочитанное там, где его нечем показать, значит однажды выдать его человеку
     * пачкой в тот миг, когда он повернёт телефон.
     */
    const unread = useUnread(channel, myId, shown);

    // Ленте не досталось и одной реплики: разговор либо стоит на полу, либо его ведут от пола
    // вверх и он ещё не дорос. Выглядит он в этом случае одинаково — ручка и плашка ввода, —
    // а ленты нет вовсе, см. FEED_MIN в config/layout и .contentTight в стилях. Сбоку такого
    // не бывает: там разговор либо во всю высоту окна, либо убран целиком.
    //
    // Решение это про коробку, какой она станет, а рисуем по тому, какая она сейчас: коробка
    // едет к своему размеру полсекунды, и лента, погашенная в начале дороги, пропадала бы
    // из ещё полной коробки. `useSettled` придерживает до конца движения только исчезновение
    // ленты; возвращается она первым же кадром — место под неё в едущей коробке уже есть.
    const contentRef = useRef<HTMLElement>(null);
    const tight = useSettled(!atSide && size - layout.floor < FEED_MIN, contentRef);

    const sceneRef = useRef<HTMLDivElement>(null);

    /**
     * Размер разговора выбрал человек: потянул кромку, повёл свайпом, нажал стрелку, убрал
     * панель кнопкой.
     *
     * Тем самым панель перестаёт быть поднятой ради открытого в неё слоя (`brought` в модели):
     * задвинуть её потом за человека значило бы забрать то, что он только что выбрал сам.
     */
    const chose = useCallback(() => act({ type: 'chose' }), []);
    const toggleChat = useCallback(() => {
        chose();
        return shown ? hide() : show();
    }, [chose, shown, hide, show]);

    /**
     * Переезд разговора из раскладки в раскладку.
     *
     * Повернули телефон — коробка меняет сторону, и ехать ей туда неоткуда: прежнего места
     * в новом окне уже нет. Поэтому переезд — не полёт из угла в угол, а приезд из-за своей
     * новой кромки, и приезжает разговор сразу в том размере, в каком встанет. Прежде вместо
     * этого он оказывался на новом месте первым же кадром и оттуда поджимался до нужной
     * ширины на глазах — замер на повороте: 390px схлопывались до 333 за те же полсекунды,
     * что и всё остальное движение.
     *
     * Держится это одним кадром — тем единственным, в котором коробка стоит за кромкой
     * (`.appAtEdge`). Переходы в нём сняты все разом: иначе браузер повёз бы её из старого
     * места в новое, а заодно из старой ширины в новую. Считается этот кадр так, будто
     * разговора на экране нет вовсе (см. `takenNow` ниже), — и со следующего кадра всё
     * трогается разом: коробка едет на место, кадр уступает ей ровно столько, сколько она
     * занимает, полоса шапки и коридор для свайпа идут за ними. Тем же самым движением,
     * каким разговор возвращают кнопкой.
     */
    const [atEdge, setAtEdge] = useState(false);
    const modeWas = useRef(mode);
    useLayoutEffect(() => {
        if (modeWas.current !== mode) {
            modeWas.current = mode;
            setAtEdge(true);
        }
    }, [mode]);
    useEffect(() => {
        if (!atEdge) {
            return undefined;
        }
        // Кадром, а не таймером: тронуться коробка должна с той отрисовки, в которой она уже
        // стоит за кромкой, — иначе переходу не от чего отсчитывать, и он не поедет вовсе.
        const frame = requestAnimationFrame(() => setAtEdge(false));
        return () => cancelAnimationFrame(frame);
    }, [atEdge]);

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

    /**
     * Канал, заведённый в этой самой вкладке. Тому, кто только что его создал, форму корабля
     * открываем сразу: он пришёл ставить свой корабль, а не смотреть на пустую воду, и закрытая
     * форма была бы лишним нажатием там, где ответ известен заранее.
     *
     * Помним именно адрес, а не «да/нет»: из своего канала можно уйти на главную и оттуда
     * открыть чужой — и его встречать надо уже как гостя.
     */
    const ownChannel = useRef<string | null>(null);
    useEffect(() => {
        act({ type: 'arrive', own: route.channel !== null && route.channel === ownChannel.current });
    }, [route.channel]);
    // Встал в строй — форма своё отработала и закрывается. Отсюда, а не из отправки: уйти
    // с рейда можно и потом, и вернуться человек должен ровно туда, куда пришёл, — на рейд
    // с закрытой формой, а не в анкету.
    useEffect(() => {
        if (inChat) {
            act({ type: 'joined' });
        }
    }, [inChat]);

    /**
     * Закрытая форма: канал открыт, а человек в нём ещё никто — и не начинал им становиться.
     * Видно ему при этом только сам рейд: разговора нет (его и не с кем вести), списка кораблей
     * нет, и корабли в кадре не нажимаются. Пока человек не встал в строй, канал о нём не знает
     * ничего — и он о канале ровно столько же.
     */
    const atGate = !loading && Boolean(channel) && !me && !joining;
    // Она же открытая: форма постановки в строй во весь рост. Второе состояние того же самого —
    // третьего у входа нет.
    const joinOpen = !loading && Boolean(channel) && !me && joining;
    // Форма своего корабля: выезжает снизу поверх разговора и уходит туда же. Пока едет —
    // остаётся на экране, см. useSlide. Поднявшая панель форма своего хода не имеет вовсе:
    // её везёт панель (`bringing` в модели и эффект под ним).
    const formOpen = editing && inChat;
    const formSlide = useSlide(formOpen);

    /**
     * Список кораблей — второй такой же слой той же коробки, а не шторка поверх всего.
     *
     * Шторка затемняет под собой экран: пока она открыта, разговор идёт только про неё.
     * Со списком это неправда — он про рейд, и гасить рейд ради него незачем. В коробке он
     * никого не загораживает: сцена остаётся живой, а список приезжает туда же, куда приезжает
     * форма своего корабля, и уходит тем же движением.
     *
     * Слоёв в коробке стопка, и список — нижний из них: открытая поверх форма его не закрывает,
     * а накрывает собой. Ушла форма — список остался ровно там, где был, вместе с прокруткой
     * и без своего движения: показывать выезд снизу тому, кто и не уезжал, незачем.
     */
    const listOpen = sheetOpen && inChat;
    const listSlide = useSlide(listOpen);

    // Место на рейде выбирают в форме корабля и только в ней: это её поле, просто вынесенное
    // на воду. На главной канала ещё нет, вставать некуда и не в чем — там рейд пустой
    // и ничего не предлагает. Закрытая форма мест тоже не показывает: выбирать их незачем,
    // пока не решено вставать.
    const picking = joinOpen || (!loading && Boolean(channel) && editing);

    // Какой корабль выбран в форме. Держим здесь, а не в самой форме: от размера зависит,
    // куда этот корабль вообще влезет, и точки свободных мест на воде обязаны это знать.
    // Пока форма закрыта, выбор ничей — как и выбранное место, см. ниже.
    const [pickedKind, setPickedKind] = useState<ShipKind | null>(null);
    const shipKind = pickedKind ?? me?.shipKind ?? lastLook?.shipKind ?? DEFAULT_SHIP_KIND;

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
    const handlePickBerth = useCallback(
        (berth: Berth) => {
            if (pickedBerth && isSameBerth(berth, pickedBerth)) {
                setPickedFacing(otherSide(facing));
                return;
            }
            setPickedBerth(berth);
        },
        [pickedBerth, facing]
    );

    // Выбор мест уходит в кадр одним свойством и тоже запоминанием: кадр перерисовывается
    // только когда меняется то, что на нём нарисовано, а не всякий раз, когда приложению
    // случилось отрисоваться.
    const berths: BerthChoice | undefined = useMemo(
        () => (picking ? { options: berthOptions, picked: pickedBerth, facing, onPick: handlePickBerth } : undefined),
        [picking, berthOptions, pickedBerth, facing, handlePickBerth]
    );

    // Показать карточку чужого корабля. Список кораблей при этом не трогаем: карточка ложится
    // поверх него (см. cover у Shade), и закрыв её, человек возвращается туда, откуда открыл.
    // Открытая из кадра, она ложится поверх пустого места — там закрывать и нечего.
    const handleShowShip = useCallback((memberId: string) => act({ type: 'show-ship', memberId }), []);

    const handleCreate = async (draft: ChannelDraft) => {
        const { channel: created } = await backend.createChannel({ channel: draft });
        // Запоминаем до перехода: по адресу канала и узнаётся свой — см. `ownChannel`.
        ownChannel.current = created.slug;
        route.openChannel(created.slug);
    };

    const handleMemberSubmit = async (draft: MemberDraft) => {
        const withBerth = { ...draft, berth: pickedBerth ?? undefined };
        if (editing) {
            await channelState.updateMe(withBerth);
            act({ type: 'close-form' });
        } else {
            await channelState.join(withBerth);
        }
    };

    // Чью реплику сейчас принимают. Корабль мог за это время сняться с рейда — тогда сказать
    // о нём в шапке нечего, и строчка возвращается к обычной.
    const sendingMember = reception ? members.find((member) => member.memberId === reception.memberId) : null;
    // Отвечать можно и тому, кто уже снялся с рейда: тогда позывной с цветом берутся
    // из снимка при сообщении, а не из состава (см. `authorLook`).
    const replyToAuthor = replyTo
        ? (authorLook(
              replyTo.author,
              members.find((member) => member.memberId === replyTo.author.memberId)
          ) ?? null)
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

    // Свой набор: пока человек печатает, его корабль мигает лампой по набранному. Дальше этой
    // вкладки набор не идёт вовсе — соседним он покажется тогда же, когда придёт сообщение,
    // и уже приёмом (см. `useReception`).
    //
    // Кусками, а не по буквам: приходят они из плашки ввода уже собранными за треть секунды,
    // и вставленное разом сообщение приходит одним куском — посимвольного потока в этом случае
    // нет вовсе. Лампе это всё равно: она дописывает кусок в свою очередь и проигрывает подряд,
    // ни на какие части его не деля — делить есть смысл там, где надо поспевать за чужой
    // печатью, а здесь печатают прямо тут.
    const [typed, setTyped] = useState<{ memberId: string; feed: MorseFeed } | null>(null);
    const handleTyped = useCallback(
        (chars: string) => {
            if (myId) {
                setTyped((prev) => ({ memberId: myId, feed: { seq: (prev?.feed.seq ?? 0) + 1, text: chars } }));
            }
        },
        [myId]
    );
    // Снимается набор, отмигав своё, — по той же причине, что и оклик: висящий в состоянии
    // повод передавать достался бы кораблю, собранному заново, и тот мигнул бы сам по себе.
    useEffect(() => {
        if (!typed) {
            return undefined;
        }
        const timer = window.setTimeout(() => setTyped(null), paced(morseDuration(typed.feed.text)));
        return () => window.clearTimeout(timer);
    }, [typed]);

    // Лампа мигает у того, чью реплику принимают, и у своего корабля — пока по нему печатают.
    //
    // Собирается запоминанием: это входное свойство кадра, и новый объект на каждую отрисовку
    // означал бы, что кадр перерисовывается вместе со всем приложением — в том числе на каждом
    // шаге пальца по кромке разговора, где до ламп никому нет дела.
    const morseFeeds = useMemo(() => {
        const feeds: Partial<Record<string, MorseFeed>> = {};
        if (reception) {
            feeds[reception.memberId] = reception.feed;
        }
        if (typed) {
            feeds[typed.memberId] = typed.feed;
        }
        // Оклик поверх остального: окликнули того, чью реплику как раз принимают, — лампа
        // передаст и то и другое, очередь у неё общая. А вот приём затёр бы оклик молча,
        // поэтому оклик и ставится последним.
        if (hail) {
            feeds[hail.memberId] = hail.feed;
        }
        return feeds;
    }, [reception, typed, hail]);

    // Лента с подменённым текстом принимаемой реплики: в ней стоит ровно столько, сколько
    // успело напечататься. Подменяем, а не храним отдельно, — сообщение в канале уже лежит
    // целиком, и вторая его копия разошлась бы с первой на ответах, цитатах и порядке.
    const shownMessages = useMemo(() => {
        const messages = channel?.messages ?? [];
        if (!reception) {
            return messages;
        }
        return messages.map((message) =>
            message.messageId === reception.messageId && message.kind !== 'system'
                ? { ...message, text: reception.shown }
                : message
        );
    }, [channel, reception]);

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

    /**
     * Панель под открывшийся слой — форму своего корабля или список кораблей.
     *
     * Слой стоит в той же коробке, что и разговор, и ровно её размера. Поэтому закрытую панель
     * возвращаем на экран: открывать слой в коробку, которой на экране нет, значит открывать
     * его в никуда. Свёрнутый до ручки разговор — то же самое: полоска в двадцать точек
     * ни списку, ни форме не жильё. Возвращается панель в тот размер, в каком её оставили
     * (`back` в hooks/useLayout).
     *
     * Открытая панель принимает слой как есть: тот выезжает в неё снизу своим ходом и уходит
     * туда же, а панель как стояла, так и стоит.
     *
     * Закрытая — выдвигается **вместе с готовым слоем внутри**: своего движения у слоя тогда
     * нет вовсе, и на экране остаётся одно движение вместо двух наехавших друг на друга.
     * Закрылся слой — панель тем же движением задвигается обратно, и слой уезжает в ней.
     *
     * Решает это модель — открывающие намерения несут ей `talking`, — а здесь остаётся движение:
     * дождаться кадра, в котором слой уже стоит внутри закрытой панели, и тронуть панель.
     * Кадром, а не таймером: тронуться она должна с той отрисовки, где слой уже на месте.
     */
    useEffect(() => {
        if (!bringing) {
            return undefined;
        }
        const frame = requestAnimationFrame(() => {
            act({ type: 'panel-moved' });
            show();
        });
        return () => cancelAnimationFrame(frame);
    }, [bringing, show]);

    // Слот опустел — панель, поднятая ради него, задвигается обратно. Отсюда, а не из каждой
    // закрывалки: слой закрывают и кнопкой в нём, и названием канала в шапке, и свайпом вниз,
    // и отправкой формы, а движение после всех этих способов одно.
    const layerOpen = formOpen || listOpen;
    // Что стоит в коробке вместо разговора с его плашкой ввода — и, значит, во что коробку
    // сминать нельзя (см. `chatMagnets`). Форма постановки в строй разговором не подпирается
    // вовсе: до строя его нет.
    const boxHasForm = layerOpen || joinOpen;
    useEffect(() => {
        if (!layerOpen && broughtPanel) {
            hide();
        }
    }, [layerOpen, broughtPanel, hide]);

    // Уехал слой вместе с панелью и снялся с экрана — память о поднятой панели больше ни при чём:
    // следующий слой посмотрит на панель заново. До этого мига она нужна: пока слой уезжает,
    // именно она говорит ему стоять в панели, а не уходить вниз своим ходом.
    useEffect(() => {
        if (!layerOpen && !formSlide.mounted && !listSlide.mounted) {
            act({ type: 'layers-gone' });
        }
    }, [layerOpen, formSlide.mounted, listSlide.mounted]);

    /**
     * Свайп по кадру двигает коробку на соседнее положение: вверх — на ступеньку выше,
     * вниз — на ступеньку ниже, вплоть до нижней, где от разговора остаётся одна ручка.
     *
     * Ступенька, а не «убрать-вернуть»: у коробки четыре положения, и палец, ведущий кадр,
     * ведёт её по тем же, по каким её водит кромка. Кадр при этом растёт и сжимается ровно
     * настолько, насколько отдала или забрала коробка, — свайп по рейду и есть способ
     * разглядеть рейд.
     *
     * Точки берутся с оглядкой на слой: со стоящей поверх разговора формой нижней ступеньки
     * нет вовсе — сминать слой в полоску ручки некуда (см. `chatMagnets`).
     *
     * Сбоку свайпа нет: там коробка меряется шириной, и вертикальное движение по кадру
     * про неё ничего не говорит. Размер панели меняют её кромкой.
     */
    const stepChat = useCallback(
        (direction: 'up' | 'down') => {
            if (atSide) {
                return;
            }
            chose();
            resize(stepMagnet(chatMagnets(layout, boxHasForm), layout.size, direction === 'up' ? 1 : -1), true);
        },
        [atSide, boxHasForm, chose, layout, resize]
    );
    useSwipe(sceneRef, stepChat);

    // Список кораблей открывается названием канала. Поверх списка может стоять форма своего
    // корабля, и тогда то же нажатие снимает её — возвращает к списку, из которого её и позвали.
    const handleShips = useCallback(() => act({ type: 'ships', talking }), [talking]);

    /**
     * Настроить свой корабль: та же форма и из кадра, и из списка кораблей.
     *
     * Список за собой не закрываем: форма ложится поверх него, и закрытая — возвращает
     * человека туда, откуда он её позвал. Карточку чужого корабля, наоборот, закрываем:
     * до рейда из-под открытой шторки не дотянуться вовсе (под ней по всему окну лежит
     * затемнение, см. .backdrop в Shade), и останься она поверх выехавшей формы, то накрыла бы
     * собой ровно то, ради чего по кораблю и нажали.
     */
    const handleEditShip = useCallback(() => act({ type: 'edit-ship', talking }), [talking]);

    // Уход с рейда спрашивает новый курс — куда корабль пошёл. Молча корабль не пропадает:
    // остальным виден только опустевший рейд, и курс — единственное, что от ушедшего
    // остаётся (см. components/channel/LeaveRaid).
    //
    // Форму своего корабля при этом закрываем: выход есть и в ней, а спрашивать курс поверх
    // настроек корабля, который через секунду уйдёт, незачем.
    const handleLeave = () => act({ type: 'ask-course' });

    const handleLeaveConfirm = (course: string) => {
        void channelState
            .leave(course)
            .then(() => act({ type: 'left' }))
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
        if (sendingMember) {
            return `«${sendingMember.name}» передаёт…`;
        }
        // Строчка нарочно короткая: на телефоне месяц стоит на её высоте, и длинный
        // подзаголовок наезжал бы на него.
        return members.length ? `${members.length} на связи` : 'никого нет';
    };

    /**
     * Подпись кнопки панели. Непрочитанное входит в неё словами: сама пилюля со счётчиком
     * читалке не достаётся (см. `ui/Counter`), и без этого убранная панель молчала бы
     * о новостях всем, кроме глаз.
     */
    const panelLabel = (): string => {
        if (shown) {
            return 'Убрать панель';
        }
        if (unread === 0) {
            return 'Вернуть панель';
        }
        const news = plural(unread, ['новое сообщение', 'новых сообщения', 'новых сообщений']);
        return `Вернуть панель, ${unread} ${news}`;
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
                поверх разговора — см. ниже.

                Закрытая, она сворачивается до одной кнопки посреди плашки, и рейд остаётся
                виден как обычно. Держим её при этом на месте, а не разбираем: это одна форма
                в двух видах, и набранное в ней закрытие переживает. Закрывается она «Отменой»
                рядом с «Встать на рейд»: коробку тянут за ручку, и потяг этот про её размер,
                а не про то, что в ней стоит. */}
            {!loading && channel && !me && (
                <MemberForm
                    mode="join"
                    crew={members}
                    myId={myId}
                    lastColor={lastLook?.color}
                    shipKind={shipKind}
                    onShipKind={setPickedKind}
                    facing={facing}
                    onFacing={setPickedFacing}
                    onSubmit={handleMemberSubmit}
                    open={joining}
                    onOpen={() => act({ type: 'open-join' })}
                    // Обратно к закрытому виду — «Отменой». Набранное при этом не теряется:
                    // форма остаётся на месте и в закрытом виде.
                    onCancel={() => act({ type: 'close-join' })}
                />
            )}
            {channel && me && (
                <>
                    <MessageList
                        messages={shownMessages}
                        members={members}
                        myId={me.memberId}
                        onReply={setReplyTo}
                        onHail={handleHail}
                    />
                    <Composer
                        // Плашкой ввода меряется пол разговора: свёрнутый до упора, он стоит
                        // ручкой и этой плашкой (см. `floor` выше).
                        ref={measureComposer}
                        replyTo={replyTo}
                        replyToAuthor={replyToAuthor}
                        onCancelReply={() => setReplyTo(null)}
                        onSend={handleSend}
                        // Фразу об отказе складывает само поле по общей мерке длины
                        // (`@/utils/limit`), нам остаётся её показать.
                        onTooLong={notify}
                        onTyped={handleTyped}
                    />
                </>
            )}
        </>
    );

    // Коробка разговора: в каком размере она стоит. Обычно это сам разговор — и свёрнутый тоже:
    // сворачиваясь, он не уезжает, а честно садится в свой пол, иначе плашка ввода уехала бы
    // под кромку окна вместе с низом коробки, а видно осталась бы верхушка ленты. А вот убранная
    // кнопкой панель уезжает за кромку целиком, своим размером, — сминать ленту с полем ввода
    // в ноль на глазах незачем. Ей и берём размер возврата.
    const chatBox = shown ? size : layout.back;

    // Насколько коробка разговора ушла за кромку: всё, что от неё не видно. У стоящего
    // разговора, хоть свёрнутого, это ноль; уходит за кромку только убранная панель.
    //
    // Своей коробки у слоёв — формы своего корабля и списка кораблей — нет: они стоят в этой же
    // и ровно её размера. Отсюда всё их поведение разом: тянут кромку — слой меняет размер
    // вместе с разговором под ним, убирают панель — слой уходит за кромку вместе с ней. Открыть
    // слой в убранную или свёрнутую панель нельзя — её сперва возвращают на экран
    // (см. эффект «Панель под открывшийся слой»), иначе форма встала бы в полоску ручки с полем
    // ввода или вовсе в ничто.
    const chatOff = Math.max(chatBox - size, 0);

    // Сколько разговор отнял у кадра: снизу и справа. Одно число на всю коробку — и на разговор,
    // и на стоящий поверх него слой: коробка на экране одна, и занимают её всегда вместе; вторая
    // сторона в это время в нуле.
    //
    // Две мерки, а не «одна плюс раскладка», потому что кадру раскладка безразлична: ему важно,
    // с какой стороны его поджали и насколько. На эти два числа считаются и высота сцены,
    // и её правая кромка, и отвод полосы шапки, и ширина шторок на сцене, и по ним же ходит
    // коридор для свайпа — он держится видимой кромки. Смена раскладки для всех них — обычное
    // движение: одно число идёт в ноль, второе из нуля, и едут они разом (см. .header в стилях).
    const take = atSide ? { under: 0, side: size } : { under: size, side: 0 };

    // Единственный кадр переезда стоит на прежних числах: коробка в нём уже ушла за свою новую
    // кромку, а кадр отмерен ровно так, как был отмерен до поворота, — и потому не двигается
    // вовсе. Со следующего кадра числа становятся новыми, и всё трогается разом: коробка едет
    // из-за кромки на место, а кадр — из прежних мер в новые, теми же секундами и той же кривой.
    //
    // Прежде этот кадр считался так, будто разговора нет вовсе: кадр в нём разом распахивался
    // во всё окно и следующим движением уступал место коробке. Прыжка выходило два — сперва
    // вширь, потом обратно.
    // Прежние числа помнит ссылка, и обновляется она, только пока раскладка та же. Это и есть
    // вся хитрость: первая отрисовка в новой раскладке (`modeWas` ещё со старой) память не
    // трогает, и на кадре переезда в ней лежит ровно то, чем кадр был отмерен до поворота.
    // Обновись она заодно со всем остальным — держать переезду было бы нечего.
    const takeWas = useRef(take);
    const taken = atEdge ? takeWas.current : take;
    if (!atEdge && modeWas.current === mode) {
        takeWas.current = take;
    }

    // Раздача мерок. Наборов два, и каждый идёт ровно тем, кто его читает.
    //
    // Мерки ненаследуемые (см. @property в index.less): поставленные на приложение, они
    // на каждый шаг тянущего пальца делали бы недействительными стили всему дереву — полусотне
    // кораблей, сотне пузырей ленты, — притом что читают их считанные узлы. Ненаследуемая
    // мерка останавливается на том узле, которому её дали, и стоит замер это разницы в полсотни
    // раз (2.4 мс против 0.05 на телефоне).
    //
    // Отсюда и раздача поимённо: список читающих виден в одном месте — здесь.

    // Сама коробка: её размер и уход за кромку. Читают их коробка разговора и слои в ней —
    // форма своего корабля и список кораблей: своей коробки у них нет, они стоят в этой же.
    const boxSize = {
        '--chat-box': `${chatBox}px`,
        '--chat-off': `${chatOff}px`,
    } as CSSProperties;

    // Сколько коробки видно с каждой стороны. Читают эти мерки те, кто стоит по её видимой
    // кромке: кадр со сценой (из них считаются высота сцены и её правая кромка), полоса шапки
    // над кадром и коридор для свайпа вдоль самой кромки.
    const boxEdge = {
        '--chat-under': `${taken.under}px`,
        '--chat-side': `${taken.side}px`,
    } as CSSProperties;

    /**
     * Потяг за коридор вдоль кромки разговора — один на обе раскладки.
     *
     * Меряется всё в открытости: сколько разговора видно. Раскладка говорит только, вдоль какой
     * оси идёт палец и в какую сторону это «шире»: сбоку разговор стоит справа, и открывает его
     * движение влево; под кадром он лежит внизу, и открывает его движение вверх. Дальше числа
     * одни и те же, и правило у них одно.
     *
     * Указатель захватывается кромкой: она шириной в шестнадцать пикселей, и первый же шаг
     * выносит палец наружу, а с захватом события всё равно приходят ей. Записываем начало
     * свайпа, а не считаем сдвиг от кадра к кадру: размер по дороге упирается в пределы,
     * и накопленный сдвиг разошёлся бы с указателем ровно на то, что срезали упоры.
     */
    const dragFrom = useRef<{ pointerId: number; at: number; size: number; open: number; fling: Fling } | null>(null);
    const [dragging, setDragging] = useState(false);

    // Где палец вдоль той оси, по которой ходит кромка. Одна и та же мерка в обеих раскладках:
    // дальше её вычитают из начальной, и «шире» выходит само — влево сбоку, вверх под кадром.
    const gripAxis = useCallback(
        (event: { clientX: number; clientY: number }) => (atSide ? event.clientX : event.clientY),
        [atSide]
    );

    const handleGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        // Вторичные кнопки мыши кромку не тянут: у правой своё дело — меню.
        if (event.button !== 0) {
            return;
        }
        dragFrom.current = { pointerId: event.pointerId, at: gripAxis(event), size, open: size, fling: trackFling() };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        chose();
    };

    const handleGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const from = dragFrom.current;
        if (from?.pointerId !== event.pointerId) {
            return;
        }
        from.open = from.size + (from.at - gripAxis(event));
        // Отмечаем то, куда палец увёл коробку, а не то, куда её пустили: скорость меряется
        // намерением. Брошенная за нижнюю точку коробка обязана долететь до неё с разгона,
        // а не потерять его на упоре, о который палец тёрся последние полсекунды.
        from.fling.mark(from.open, event.timeStamp);
        // Ниже нижней своей точки коробка не идёт: со слоем это не пол, а наименьшая настоящая
        // доля — сминать список или форму в полоску ручки с полем ввода некуда (см. `chatMagnets`).
        // Упор при этом не глухой: коробка подаётся за него на дюжину точек с затуханием,
        // и отпущенная возвращается — видно, что она упёрлась, а не заела.
        const points = chatMagnets(layout, boxHasForm);
        resize(rubberBand(from.open, points[0], points[points.length - 1]));
    };

    /**
     * Отпустили — разговор приезжает к своей точке.
     *
     * Точки в обеих раскладках одни и те же, и считает их раскладка (`chatMagnets`): сбоку
     * они прижаты её пределами, и там, где кадру нельзя отдать меньше шестисот, «две трети»
     * и «весь ход» сходятся в один упор. Между точками разговор не встаёт: положений у него
     * ровно столько, сколько точек.
     *
     * Считается приземление не от места, где палец встал, а от того, куда разговор долетел
     * бы по инерции: короткий сильный рывок вниз проскакивает точки насквозь и уводит
     * разговор с экрана целиком, а медленный подвод к трети на ней и останавливается
     * (см. `settleMagnet`).
     *
     * Обрыв без отпускания — системный жест, потерянный захват — сюда же и приходит,
     * с нулевой скоростью: разговор встаёт на ближнюю точку, а не отматывается назад.
     * Отматывать его обратно человек не просил.
     */
    const handleGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const from = dragFrom.current;
        if (from?.pointerId !== event.pointerId) {
            return;
        }
        dragFrom.current = null;
        setDragging(false);
        resize(
            settleMagnet({
                from: from.size,
                to: from.open,
                velocity: from.fling.speed(event.timeStamp),
                points: chatMagnets(layout, boxHasForm),
            }),
            true
        );
    };

    /**
     * Что вешают на всякое место хвата за кромку разговора: сам коридор и ручки слоёв коробки.
     * Захват теряется и без отпускания — палец сняли с экрана посреди движения; на обычном
     * отпускании событие тоже приходит, но движение там уже закрыто, и второй заход
     * ничего не делает.
     */
    const gripHandlers = {
        onPointerDown: handleGripDown,
        onPointerMove: handleGripMove,
        onPointerUp: handleGripUp,
        onPointerCancel: handleGripUp,
        onLostPointerCapture: handleGripUp,
    };

    /**
     * Тот же коридор с клавиатуры: стрелками по ступеньке, Home и End — до упора. Коридор
     * объявлен разделителем (role="separator") и умеет то, что разделителю положено уметь;
     * без этого размер разговора нельзя было бы поменять вовсе, не взяв в руки мышь.
     *
     * Стрелки те, вдоль которых кромка и ходит: сбоку левая-правая, под кадром вверх-вниз.
     * Ходит клавиатура по тем же точкам, что и палец: положений у разговора ровно столько,
     * сколько точек, и стрелке взять промежуточное неоткуда.
     */
    const handleGripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const points = chatMagnets(layout, boxHasForm);
        const to = {
            [atSide ? 'ArrowLeft' : 'ArrowUp']: stepMagnet(points, size, 1),
            [atSide ? 'ArrowRight' : 'ArrowDown']: stepMagnet(points, size, -1),
            Home: points[points.length - 1],
            End: points[0],
        }[event.key];
        if (to !== undefined) {
            event.preventDefault();
            chose();
            resize(to, true);
        }
    };

    return (
        <div
            className={[
                styles.app,
                atSide ? styles.appSide : styles.appUnder,
                dragging ? styles.appDragging : '',
                atEdge ? styles.appAtEdge : '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            {/* Мерки коробки внизу экрана в вертикальной раскладке и справа в горизонтальной.
                Высота это или ширина, говорит раскладка, а не число. Коробка одна на всё, что
                в ней стоит: и на разговор, и на выехавший поверх него слой, — и потому мерки
                у них общие, просто розданы поимённо (см. boxSize и boxEdge выше). */}
            <header className={styles.header} style={boxEdge}>
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
                        // до рейда из-под открытой шторки не дотянуться вовсе, под ней по всему
                        // окну лежит затемнение (см. .backdrop в Shade). Останься карточка
                        // поверх выехавшей формы, она
                        // накрыла бы собой ровно то, ради чего по кораблю и нажали, — и сброс
                        // тут стоит дешевле, чем разбор, кто кого сейчас не пускает. Список
                        // кораблей закрывать не надо: он и так не открыт, пока открыта форма.
                        //
                        // При закрытой форме нажатий нет вовсе: пришедший по ссылке смотрит
                        // на рейд со стороны, и трогать чужие корабли ему нечем — как и им его.
                        onEditShip={atGate ? undefined : handleEditShip}
                        // А щелчок по чужому — его карточку: своим на рейде распоряжаются,
                        // чужой разглядывают.
                        onShowShip={atGate ? undefined : handleShowShip}
                        berths={berths}
                    />
                </div>
                <div className={styles.headerBar} style={boxEdge}>
                    <div className={styles.headerInfo}>
                        {/* Название канала — это и кнопка «кто на связи»: по нажатию открывается
                            список кораблей. Значок стоит в конце названия, а не отдельной кнопкой
                            справа: список — это и есть «кто в этом канале», и спрашивают о нём,
                            тыча в его название.

                            Нажимается весь блок целиком — и название со значком, и строчка
                            «сколько на связи» под ним: строчка отвечает ровно на тот же вопрос,
                            что и список, и мимо неё в название человек попадает чаще, чем в само
                            название. Целить пальцем в одну строку из двух, стоящих вплотную,
                            незачем, когда обе ведут в одно и то же место.

                            Кнопкой блок становится только у своих: список показывают тем,
                            кто уже на рейде, а гостю на входе открывать нечего — ему остаются
                            те же две строчки простым текстом. Их же видно и на главной, где
                            канала нет вовсе: там на этом месте название сервиса.

                            Своё положение кнопка называет вслух (`aria-expanded`): иначе читалка
                            объявляет её просто кнопкой с названием канала, не говоря, открыт ли
                            список. «Открыт» тут значит «список виден»: под формой своего корабля
                            он накрыт, и то же нажатие возвращает к нему, а не убирает. */}
                        {inChat && channel ? (
                            <button
                                type="button"
                                className={styles.chatTitleButton}
                                onClick={handleShips}
                                title="Корабли на связи"
                                aria-expanded={listOpen && !editing}
                            >
                                <span className={styles.chatTitleLine}>
                                    <span className={styles.chatTitleName}>{channel.channel.title}</span>
                                    {/* Значок один и тот же в обоих положениях. Менять его
                                        на облачко разговора, пока список открыт, значило бы
                                        обещать переход куда-то ещё: список никуда не уводит,
                                        он приезжает поверх и тем же нажатием убирается —
                                        как и всякая шторка. */}
                                    <span className={styles.chatTitleIcon}>
                                        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                                            <path
                                                d="M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zm7 .4a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4zM9 13c-3 0-6 1.5-6 3.6V19h12v-2.4C15 14.5 12 13 9 13zm7 .8c-.5 0-1 .05-1.5.16 1.1.86 1.8 1.96 1.8 3.24V19H22v-2c0-1.8-2.6-3.2-6-3.2z"
                                                fill="currentColor"
                                            />
                                        </svg>
                                    </span>
                                </span>
                                <span className={styles.chatStatus}>{loading ? 'связь…' : status()}</span>
                            </button>
                        ) : (
                            <>
                                <div className={styles.chatTitle}>{channel?.channel.title ?? 'Кильватер'}</div>
                                <div className={styles.chatStatus}>{loading ? 'связь…' : status()}</div>
                            </>
                        )}
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
                        {/* Убрать боковую панель с экрана и вернуть её обратно. Значок один
                            и тот же в обоих положениях — оконце с отчёркнутой боковой полосой:
                            кнопка говорит «панель», а не «спрятать» или «показать», и менять
                            её на другой значок значило бы обещать переход куда-то ещё. Так же
                            себя ведёт и значок списка кораблей в названии канала.

                            Есть она только в боковой раскладке. Под кадром разговор убрать
                            нечем и незачем: свайпом он сворачивается до ручки с плашкой ввода
                            и в этом виде всегда под рукой — писать в канал можно, ничего
                            не разворачивая, а тянуть его обратно есть за что. Кнопка там
                            была бы третьим способом сказать то же самое.

                            Возвращается панель в тот размер, в каком её убрали, а не
                            в умолчание: убрать и вернуть — это одно движение туда и обратно,
                            и терять на нём выбранную ширину не за что (см. `back`
                            в hooks/useLayout).

                            Про канал кнопка не спрашивает: раскладка — про кадр и разговор,
                            а они на месте и на главной, где вместо разговора стоит форма
                            создания канала. Кадр там такой же настоящий, и смотреть на него
                            во весь экран хочется не меньше.

                            Стоит она и под открытым слоем — формой своего корабля, списком
                            кораблей: коробка у них с разговором одна, и убирается она целиком,
                            вместе с тем, что в ней сейчас стоит. Кнопка поэтому означает
                            ровно то же, что и всегда, — «панель», — и прятать её не за что. */}
                        {atSide && (
                            // Счётчик непрочитанного — пилюлей в углу кнопки. Место ему отводит
                            // это гнездо, а не сама пилюля: где счётчику сидеть, знает тот,
                            // у чьей кнопки он стоит (см. ui/Counter).
                            //
                            // Стоит он ровно на той кнопке, которой панель и возвращают: убранный
                            // разговор ничем другим о себе не напоминает, а кнопка эта на экране
                            // всегда. Пропадает счётчик вместе с возвратом панели — не по таймеру
                            // и не по нажатию: разговор на экране, читать показано, и держать
                            // цифру дольше было бы враньём.
                            <span className={styles.panelSlot}>
                                <IconButton onClick={toggleChat} aria-label={panelLabel()}>
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
                                            d="M15 4v16"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            fill="none"
                                        />
                                    </svg>
                                </IconButton>
                                {unread > 0 && (
                                    <span className={styles.panelCount} data-unread={unread}>
                                        <Counter value={unread} />
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </header>
            {/* Разговор. Убранная кнопкой панель остаётся в разметке и в полном своём размере —
                иначе пропали бы и место прокрутки ленты, и набранное в поле, — просто уезжает
                за кромку окна. Там же она и глохнет вовсе: ни указателю, ни клавиатуре,
                ни чтению вслух. Свёрнутый до пола разговор, наоборот, остаётся живым: плашка
                ввода на экране, и писать в неё можно, ничего не разворачивая. */}
            <main
                ref={contentRef}
                className={[styles.content, atSide ? styles.contentSide : '', tight ? styles.contentTight : '']
                    .filter(Boolean)
                    .join(' ')}
                style={boxSize}
                inert={!shown}
            >
                {/* Ручка для хвата — единственное место, за которое эту коробку тянут. Движение
                    у неё одно на всё, что в коробке стоит, и то же самое, что у коридора над
                    ней: коробка внизу экрана одна, кромка у неё одна, и хват за эту кромку
                    тоже один. */}
                {!atSide && (
                    <div className={styles.sheetHandle} aria-hidden="true" {...gripHandlers}>
                        <span className={styles.sheetGrip} />
                    </div>
                )}
                {baseContent}
            </main>
            {/* Коридор вдоль кромки разговора: за него меняют его размер. Есть он в обеих
                раскладках — сбоку вдоль левой кромки, под кадром вдоль верхней, — и это одна
                и та же полоска, просто повёрнутая: разговор и там и там шторка, которую тянут
                за её кромку.

                Стоит он рядом с разговором, а не внутри, и приходится ровно на стык — половиной
                на кадр, половиной на разговор. Внутри он лежал поверх ленты и съедал поле нажатия
                у аватарок вместе с краем самого кружка, а разговор обрезан наглухо, и высунуть
                половину коридора наружу оттуда нечем. За кромкой он идёт своим переходом,
                тем же и по тем же секундам, что и разговор, — см. .grip в стилях.
                У свёрнутого разговора коридор остаётся: полоска ручки торчит из-за кромки окна,
                и за неё разговор достают обратно тем же свайпом, каким свернули. Нет коридора
                только у убранного: размера у него ноль, и тянуть не за что — вернуть его можно
                кнопкой в шапке. */}
            {shown && (
                <div
                    className={[styles.grip, atSide ? styles.gripSide : styles.gripUnder].join(' ')}
                    style={boxEdge}
                    {...gripHandlers}
                    onKeyDown={handleGripKey}
                    role="separator"
                    // Разделитель между кадром и разговором: сбоку он стоит вертикальной чертой,
                    // под кадром лежит поперёк.
                    aria-orientation={atSide ? 'vertical' : 'horizontal'}
                    aria-label={atSide ? 'Ширина разговора' : 'Высота разговора'}
                    aria-valuenow={Math.round(size)}
                    aria-valuemin={layout.min}
                    aria-valuemax={layout.max}
                    tabIndex={0}
                />
            )}
            {/* Список кораблей — вторым слоем той же коробки, где стоит разговор, и тем же
                выездом снизу, что и форма своего корабля. Шторкой он не стал нарочно: шторка
                затемняет под собой экран, потому что пока она открыта, разговор идёт только
                про неё, — а список кораблей про рейд, и гасить рейд ради него незачем. В коробке
                он никого не загораживает: сцена остаётся живой и открытой в обеих раскладках.

                Отсюда и раскладок ему не нужно двух: коробка сама стоит там, где ей положено, —
                под кадром на телефоне, панелью справа на десктопе, — и список едет вместе с ней.
                Вместе с ней он и убирается за кромку, и глохнет там (inert), — как форма своего
                корабля рядом.

                Своей ручки у него нет: ручка — это кромка коробки, а список приезжает внутрь
                коробки, под неё. Хват на кромке остаётся один и тот же, и коробку с открытым
                списком тянут ровно тем же движением, что и без него. */}
            {listSlide.mounted && (
                <section
                    ref={listSlide.ref}
                    className={[styles.list, listOpen ? '' : styles.listLeaving, broughtPanel ? styles.layerStill : '']
                        .filter(Boolean)
                        .join(' ')}
                    style={boxSize}
                    aria-label="Корабли на связи"
                    // Глохнет он не только за кромкой, но и под накрывшей его формой: видно
                    // из-под неё нечего, а фокус по Tab уходил бы в невидимое.
                    inert={!shown || formOpen}
                >
                    {/* Крестик — там же, где у шторки. Закрывается список ещё и названием канала
                        в шапке, тем же нажатием, каким его открыли, — но искать выход в другом
                        конце экрана человек не обязан. */}
                    <CloseButton onClick={() => act({ type: 'close-list' })} />
                    <MembersList
                        members={members}
                        myId={myId}
                        seniorId={channel?.channel.owner?.memberId ?? null}
                        // Настройка своего корабля — та же форма и тем же путём, что и по щелчку
                        // по кораблю на рейде (см. `handleEditShip`).
                        onEditMe={handleEditShip}
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
                </section>
            )}
            {/* Форма своего корабля — верхний слой той же коробки, где стоит разговор, и ростом
                в неё за вычетом ручки: ручка — кромка коробки, форма приезжает внутрь, под неё,
                и своей ручки не заводит. Отсюда всё её поведение разом: тянут кромку — форма
                меняет размер вместе с разговором под ней, убирают панель — уходит за кромку
                вместе с ней и там глохнет (inert), как и разговор. Открыть форму в убранную
                или свёрнутую панель нельзя — та сперва возвращается на экран (см. эффект
                «Панель под открывшийся слой»).

                Стоит она в разметке последней из слоёв — за списком кораблей, — и потому
                рисуется поверх него: слои лежат стопкой, и открытая из списка форма его
                не разбирает, а накрывает. Закрылась — список остался на месте, там же,
                где и был, вместе с прокруткой.

                Написана она соседом разговору, а не внутри него: разговор обрезан наглухо,
                и выезжающая снизу форма из него бы не высунулась. */}
            {formSlide.mounted && me && (
                <div
                    ref={formSlide.ref}
                    className={[styles.form, editing ? '' : styles.formLeaving, broughtPanel ? styles.layerStill : '']
                        .filter(Boolean)
                        .join(' ')}
                    style={boxSize}
                    inert={!shown}
                >
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
                        onCancel={() => act({ type: 'close-form' })}
                    />
                </div>
            )}
            {/* Карточка чужого корабля — шторкой, и это не непоследовательность. Карточка
                приходит с двух сторон — из строчки списка и щелчком по кораблю в кадре, —
                и в обоих случаях разговор идёт ровно про неё: под ней ничего не выбирают,
                а рейд в этот момент только фон. Список живёт по другому правилу и потому
                стоит слоем в коробке (см. выше).

                Ложится она поверх (cover): открытая из строчки списка, она его продолжает,
                и закрыв её, человек ждёт увидеть список, а не пустой рейд. */}
            <Shade
                open={Boolean(shownMember)}
                onClose={() => act({ type: 'close-card' })}
                label="Корабль"
                onScene={atSide}
                sideWidth={taken.side}
                cover
            >
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
                onClose={() => act({ type: 'close-course' })}
                label="Вы уходите с рейда"
                onScene={atSide}
                sideWidth={taken.side}
                cover
            >
                <LeaveRaid onConfirm={handleLeaveConfirm} onCancel={() => act({ type: 'close-course' })} />
            </Shade>
        </div>
    );
}
