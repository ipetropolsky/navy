import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import Actions from '@/components/ui/Actions';
import Button from '@/components/ui/Button';
import { Member, SHIP_KIND_LABELS } from '@/types/channel';

import styles from './MembersSheet.module.less';

interface MembersSheetProps {
    open: boolean;
    members: Member[];
    /** Корабль этой вкладки: его помечаем и только для него показываем действия. */
    myId: string | null;
    onEditMe: () => void;
    onLeave: () => void;
    onClose: () => void;
    /** Окликнуть корабль: тычок в аватарку — и тот отвечает лампой со своего места на рейде. */
    onHail: (memberId: string) => void;
}

/**
 * Список тех, кто на связи. Переключиться на чужой корабль нельзя: за каждый говорит
 * своя вкладка со своим memberId, а не выбор в списке. Свои действия — настроить корабль
 * и уйти с рейда — внизу, отбитые чертой.
 */
export default function MembersSheet({ open, members, myId, onEditMe, onLeave, onClose, onHail }: MembersSheetProps) {
    if (!open) {
        return null;
    }

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
                            </span>
                        </div>
                    );
                })}
                {myId && (
                    // Список бывает длиннее шторки, и кнопки уезжают под обрез так же,
                    // как в форме корабля, — значит и держим мы их так же.
                    <Actions wide pinned className={styles.actions}>
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
