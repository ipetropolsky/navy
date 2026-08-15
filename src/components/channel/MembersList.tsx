import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import Pennant from '@/components/ships/Pennant';
import IconButton from '@/components/ui/IconButton';
import { useSnackbar } from '@/components/ui/Snackbar';
import { Member, SHIP_KIND_LABELS } from '@/types/channel';

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
}

/**
 * Список тех, кто на связи. Переключиться на чужой корабль нельзя: за каждый говорит
 * своя вкладка со своим memberId, а не выбор в списке.
 *
 * Действие у строчки одно, и стоит оно у всех на одном месте — справа в самой строке.
 * В своей это «настроить корабль», в чужих у старшего на рейде — «высадить». Отдельной
 * полосы кнопок под списком нет: собранные внизу, они спрашивали бы корабль второй раз,
 * уже выбранный строчкой. Второе действие со своим кораблём — уйти с рейда — живёт
 * в шапке и появляется там же, где открылась форма.
 *
 * Вымпел стоит всегда и всегда отвечает званием — тычком на снекбар, наведением на подсказку.
 * Словами звание подписано там, где на подпись есть ширина: бэдж справа в строке прячется,
 * когда сам список становится узок (@container в стилях). Разметка про это не знает, и порога
 * «телефон ли это» здесь нет — дело только в ширине блока, в котором список показывают.
 *
 * Сам по себе список — только колонка со своей прокруткой. Показывает его шторка (`Shade`),
 * причём вторым этажом — поверх разговора, а не на его месте, — и рамка, затемнение, выезд
 * и крестик там свои.
 */
export default function MembersList({ members, myId, seniorId, onEditMe, onKick, onHail }: MembersListProps) {
    const notify = useSnackbar();
    const iAmSenior = Boolean(myId) && myId === seniorId;

    return (
        <div className={styles.list}>
            <div className={styles.title}>На связи</div>
            <div className={styles.hint}>Каждый корабль говорит из своей вкладки</div>
            {members.map((member) => {
                const mine = member.memberId === myId;
                const senior = member.memberId === seniorId;
                return (
                    <div key={member.memberId} className={mine ? styles.rowActive : styles.row}>
                        {/* В списке аватарка окликает, а не открывает карточку: строчка и так
                            показывает всё, что в карточке есть, — позывной, силуэт, вымпел. */}
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
        </div>
    );
}
