import HullBadge from '@/components/ships/HullBadge';
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
}

/**
 * Список тех, кто на связи. Переключиться на чужой корабль нельзя: за каждый говорит
 * своя вкладка со своим memberId, а не выбор в списке. Свои действия — переоснастить
 * корабль и выйти из канала — внизу, отбитые чертой.
 */
export default function MembersSheet({ open, members, myId, onEditMe, onLeave, onClose }: MembersSheetProps) {
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
                            <span className={styles.avatar}>
                                <HullBadge number={member.hullNumber} />
                            </span>
                            <span className={styles.info}>
                                <span className={styles.name} style={{ color: member.color }}>
                                    {member.name}
                                    {mine && <span className={styles.you}> — ты</span>}
                                </span>
                                <span className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</span>
                            </span>
                        </div>
                    );
                })}
                {myId && (
                    <div className={styles.actions}>
                        <Button variant="secondary" onClick={onEditMe}>
                            Переоснастить корабль
                        </Button>
                        <Button variant="danger" onClick={onLeave}>
                            Выйти из канала
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
