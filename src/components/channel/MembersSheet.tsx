import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import Actions from '@/components/ui/Actions';
import Button from '@/components/ui/Button';
import IconButton from '@/components/ui/IconButton';
import { Member, SHIP_KIND_LABELS } from '@/types/channel';

import styles from './MembersSheet.module.less';

interface MembersSheetProps {
    open: boolean;
    members: Member[];
    /** Корабль этой вкладки: его помечаем и только для него показываем действия. */
    myId: string | null;
    /** Старший на рейде: у него бэдж, и только ему видны кнопки высадки. */
    seniorId: string | null;
    onEditMe: () => void;
    onLeave: () => void;
    /** Высадить чужой корабль с рейда. */
    onKick: (memberId: string) => void;
    onClose: () => void;
    /** Окликнуть корабль: тычок в аватарку — и тот отвечает лампой со своего места на рейде. */
    onHail: (memberId: string) => void;
}

/**
 * Список тех, кто на связи. Переключиться на чужой корабль нельзя: за каждый говорит
 * своя вкладка со своим memberId, а не выбор в списке. Свои действия — настроить корабль
 * и уйти с рейда — внизу, отбитые чертой.
 *
 * Старший на рейде отмечен бэджем, и у него же в чужих строчках появляется кнопка высадки.
 * Кнопка стоит в строке того, кого высаживают, а не собрана в отдельный список: так видно,
 * к кому она относится, и не надо выбирать корабль дважды.
 */
export default function MembersSheet({
    open,
    members,
    myId,
    seniorId,
    onEditMe,
    onLeave,
    onKick,
    onClose,
    onHail,
}: MembersSheetProps) {
    if (!open) {
        return null;
    }

    const iAmSenior = Boolean(myId) && myId === seniorId;

    return (
        <div className={styles.overlay}>
            <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Закрыть" />
            <div className={styles.sheet} role="dialog" aria-label="Корабли на связи">
                <div className={styles.grip} />
                <div className={styles.title}>На связи</div>
                <div className={styles.hint}>Каждый корабль говорит из своей вкладки</div>
                {members.map((member) => {
                    const mine = member.memberId === myId;
                    return (
                        <div key={member.memberId} className={mine ? styles.rowActive : styles.row}>
                            <Avatar number={member.hullNumber} large onHail={() => onHail(member.memberId)} />
                            <span className={styles.info}>
                                <span>
                                    <MemberName name={member.name} color={member.color} />
                                    {mine && <span className={styles.you}> — ты</span>}
                                </span>
                                <span className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</span>
                                {member.memberId === seniorId && <span className={styles.badge}>Старший на рейде</span>}
                            </span>
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
                {myId && (
                    // Список бывает длиннее шторки, и кнопки уезжают под обрез так же,
                    // как в форме корабля, — значит и держим мы их так же.
                    <Actions wide pinned>
                        <Button variant="secondary" onClick={onEditMe}>
                            Настроить корабль
                        </Button>
                        <Button variant="danger" onClick={onLeave}>
                            Уйти с рейда
                        </Button>
                    </Actions>
                )}
            </div>
        </div>
    );
}
