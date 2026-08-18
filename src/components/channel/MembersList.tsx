import { KeyboardEvent, MouseEvent, PointerEvent, useRef } from 'react';

import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import Pennant from '@/components/ships/Pennant';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import Sheet from '@/components/ui/Sheet';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LeaveIcon, LinkIcon } from '@/components/ui/icons';
import { Member, SHIP_KIND_LABELS } from '@/types/channel';
import { Press, isTap, startPress } from '@/utils/tap';

import styles from './MembersList.module.less';

/** Что означает вымпел. Одна строчка на бэдж и на снекбар: это одно и то же звание. */
const SENIOR_TITLE = 'Старший на рейде';

interface MembersListProps {
    members: Member[];
    /** Корабль этой вкладки: его помечаем и только для него показываем действия. */
    myId: string | null;
    /** Старший на рейде: у него бэдж, и только ему видны кнопки высадки. */
    seniorId: string | null;
    /** Настроить свой корабль: форма выезжает поверх разговора, а список закрывается. */
    onEditMe: () => void;
    /** Высадить чужой корабль с рейда. */
    onKick: (memberId: string) => void;
    /** Окликнуть корабль: тычок в аватарку — и тот отвечает лампой со своего места на рейде. */
    onHail: (memberId: string) => void;
    /** Показать карточку чужого корабля: тем же движением, что и щелчок по нему в кадре. */
    onShowShip: (memberId: string) => void;
    /** Координаты рейда: ссылка на канал уходит в буфер, а ответом служит снекбар. */
    onCopyLink: () => void;
    /** Уйти с рейда. */
    onLeave: () => void;
}

/**
 * Список тех, кто на связи. Переключиться на чужой корабль нельзя: за каждый говорит
 * своя вкладка со своим memberId, а не выбор в списке.
 *
 * Строчка целиком нажимается и делает то же, что щелчок по кораблю в кадре: своя открывает
 * форму, чужая — карточку. Правило одно на всё приложение: своим на рейде распоряжаются,
 * чужой разглядывают, — и в списке оно то же самое, что и на воде. У своей строчки то же
 * действие продублировано значком справа: по нему видно, что случится, ещё до нажатия.
 *
 * Аватарка при этом своя: тычок в неё окликает корабль, и в кадре он отзывается лампой
 * со своего места. Оклик и есть ответ на вопрос «который из них», а карточка на него отвечает
 * хуже — она накрывает собой ровно тот кадр, в котором корабль и надо было увидеть.
 *
 * Значок действия стоит у всех на одном месте — справа в строке. В своей это «настроить
 * корабль», в чужих у старшего на рейде — «высадить». Действий с кораблём в полосе внизу
 * нет и не будет: собранные внизу, они спрашивали бы корабль второй раз, уже выбранный
 * строчкой.
 *
 * Полоса внизу — про рейд целиком, а не про корабль в списке: позвать ещё кого-то
 * («Координаты» — ссылка на канал уходит в буфер) и уйти самому. Оба ответа на один
 * и тот же вопрос «кто здесь»: посмотрев, кто уже пришёл, зовут остальных или уходят.
 * Прежде координаты копировались нажатием на название канала в шапке, а выход стоял
 * там же значком — обоим не хватало подписи, по которой видно, что случится.
 *
 * Вымпел стоит всегда и всегда отвечает званием — тычком на снекбар, наведением на подсказку.
 * Словами звание подписано там, где на подпись есть ширина: бэдж справа в строке прячется,
 * когда сам список становится узок (@container в стилях). Разметка про это не знает, и порога
 * «телефон ли это» здесь нет — дело только в ширине блока, в котором список показывают.
 *
 * Сам по себе список — колонка из двух частей: строчки со своей прокруткой и полоса кнопок
 * под ними. Показывает его слой в блоке
 * разговора: он выезжает снизу тем же движением, что и форма своего корабля, и встаёт ровно
 * туда, где только что была лента. Шторкой поверх всего список не показывают нарочно — шторка
 * гасит под собой экран, а список кораблей про рейд, и гасить рейд ради него незачем
 * (см. `.list` в App.module.less). Рамка, выезд, ручка и крестик там свои.
 */
export default function MembersList({
    members,
    myId,
    seniorId,
    onEditMe,
    onKick,
    onHail,
    onShowShip,
    onCopyLink,
    onLeave,
}: MembersListProps) {
    const notify = useSnackbar();
    const iAmSenior = Boolean(myId) && myId === seniorId;

    /** С чего началось нажатие на строчку: откуда и при каком выделении (см. `@/utils/tap`). */
    const pressRef = useRef<Press | null>(null);

    const openMember = (member: Member): void => {
        if (member.memberId === myId) {
            onEditMe();
        } else {
            onShowShip(member.memberId);
        }
    };

    /**
     * Тычок по строчке — открыть корабль. Но строчка состоит из текста — позывной и тип
     * корабля, — и протяжка по нему значит «выделить и скопировать»: позывной переписывают
     * в разговор, чтобы позвать. Отличаем одно от другого общим правилом (`isTap`).
     */
    const handleTap = (event: MouseEvent<HTMLDivElement>, member: Member): void => {
        const press = pressRef.current;
        pressRef.current = null;
        // Внутри строчки есть свои кнопки — аватарка, вымпел, значок действия, — и их нажатия
        // всплывают сюда же. У каждой своё дело, и строчкино поверх него делать не надо:
        // тычок в аватарку окликает и не открывает корабль. Спрашиваем один раз про все, а не
        // глушим всплытие в каждой: кнопки эти разные и приходят из разных мест.
        if ((event.target as Element).closest('button')) {
            return;
        }
        if (!isTap(press, event)) {
            return;
        }
        openMember(member);
    };

    // Строчка — не `button`, а `div` с ролью кнопки: из настоящей кнопки не выделишь текст,
    // да и вложить кнопку в кнопку нельзя, а в строчке их до трёх — аватарка, вымпел и значок
    // действия. Значит, клавиатуру строчка отрабатывает сама — вводом и пробелом, как кнопка.
    const handleKey = (event: KeyboardEvent<HTMLDivElement>, member: Member): void => {
        // Нажатия вложенных кнопок сюда всплывают тоже, и без этого ввод по вымпелу открывал бы
        // заодно и корабль. Своё нажатие у строчки то, что пришло прямо в неё.
        if (event.target !== event.currentTarget) {
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMember(member);
        }
    };

    return (
        <Sheet
            title={<div className={styles.name}>На связи</div>}
            /* Ряд кнопок тот же, что внизу форм и карточки корабля: одна механика на всё
               приложение — как они делят ширину и когда переносятся. */
            actions={
                <>
                    <Button variant="secondary" onClick={onCopyLink}>
                        <LinkIcon />
                        {/* На широком списке подписи целиком, узкому хватает первого слова: рейд
                            и так один, тот самый, чей список открыт, — а вдвоём полные подписи
                            в строку не помещаются, и кнопки уезжают каждая на свою строчку.
                            Решает это ширина самого списка, а не окна (@container, см. стили). */}
                        <span>
                            Координаты<span className={styles.wide}> рейда</span>
                        </span>
                    </Button>
                    <Button variant="danger" onClick={onLeave}>
                        <LeaveIcon />
                        <span>
                            Уйти<span className={styles.wide}> с рейда</span>
                        </span>
                    </Button>
                </>
            }
        >
            <div className={styles.hint}>Каждый корабль говорит из своей вкладки</div>
            {members.map((member) => {
                const mine = member.memberId === myId;
                const senior = member.memberId === seniorId;
                return (
                    <div
                        key={member.memberId}
                        role="button"
                        tabIndex={0}
                        // Название строчке даём своё: собранное из содержимого, оно вышло бы
                        // из позывного, типа корабля, звания и подписей всех вложенных кнопок
                        // разом — читать такое с экрана невозможно.
                        aria-label={`Корабль «${member.name}»`}
                        className={mine ? styles.rowActive : styles.row}
                        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                            pressRef.current = startPress(event);
                        }}
                        onClick={(event) => handleTap(event, member)}
                        onKeyDown={(event) => handleKey(event, member)}
                    >
                        {/* В списке аватарка окликает, а не открывает корабль: оклик и есть ответ
                            на вопрос «который из них», и строчка вокруг неё отвечает на него хуже
                            — она уводит от кадра, в котором корабль и надо было увидеть. */}
                        <Avatar
                            number={member.hullNumber}
                            large
                            action={{ title: `Окликнуть «${member.name}»`, onClick: () => onHail(member.memberId) }}
                        />
                        <span className={styles.info}>
                            <span className={styles.nameRow}>
                                <MemberName name={member.name} color={member.color} />
                                {mine && <span className={styles.you}> — ты</span>}
                                {/* Отвечает званием всегда: снекбар с тем же словом лишним
                                    не бывает, а проверка «видна ли подпись» стоила бы порога
                                    на пустом месте. */}
                                {senior && (
                                    <button
                                        type="button"
                                        className={styles.pennantButton}
                                        aria-label={SENIOR_TITLE}
                                        title={SENIOR_TITLE}
                                        onClick={() => notify(SENIOR_TITLE)}
                                    >
                                        <Pennant />
                                    </button>
                                )}
                            </span>
                            <span className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</span>
                        </span>
                        {/* Прячет подпись не разметка, а сам список: хватает ли ей места —
                            вопрос его ширины, и отвечает на него @container в стилях. */}
                        {senior && <span className={styles.badge}>{SENIOR_TITLE}</span>}
                        {mine && (
                            <IconButton
                                variant="muted"
                                onClick={onEditMe}
                                aria-label="Настроить корабль"
                                title="Настроить корабль"
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                                    <path
                                        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a1.9 1.9 0 1 1-2.7 2.7l-.05-.06a1.6 1.6 0 0 0-1.78-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.9 1.9 0 1 1-3.8 0v-.09a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.9 1.9 0 1 1-2.7-2.7l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.98h-.17a1.9 1.9 0 1 1 0-3.8h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.78l-.06-.06a1.9 1.9 0 1 1 2.7-2.7l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 .97-1.47v-.17a1.9 1.9 0 0 1 3.8 0v.09a1.6 1.6 0 0 0 .98 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.9 1.9 0 1 1 2.7 2.7l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47.97h.17a1.9 1.9 0 0 1 0 3.8h-.09a1.6 1.6 0 0 0-1.46.98z"
                                        stroke="currentColor"
                                        strokeWidth="1.6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        fill="none"
                                    />
                                </svg>
                            </IconButton>
                        )}
                        {iAmSenior && !mine && (
                            <IconButton
                                variant="muted"
                                onClick={() => onKick(member.memberId)}
                                aria-label={`Высадить «${member.name}»`}
                                title="Высадить с рейда"
                            >
                                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                                    <path
                                        d="M9 4h6M4 7h16M7 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5L17 7M10.5 10.5v7M13.5 10.5v7"
                                        stroke="currentColor"
                                        strokeWidth="1.7"
                                        strokeLinecap="round"
                                        fill="none"
                                    />
                                </svg>
                            </IconButton>
                        )}
                    </div>
                );
            })}
        </Sheet>
    );
}
