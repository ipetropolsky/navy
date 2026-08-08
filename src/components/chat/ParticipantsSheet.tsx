import HullBadge from '@/components/ships/HullBadge';
import { Participant, SHIP_KIND_LABELS } from '@/types/chat';

import styles from './ParticipantsSheet.module.less';

interface ParticipantsSheetProps {
    open: boolean;
    participants: Participant[];
    activeId: string;
    onSwitch: (participantId: string) => void;
    onClose: () => void;
}

/** Шторка со списком участников; тап по участнику «переключает» тебя на него. */
export default function ParticipantsSheet({ open, participants, activeId, onSwitch, onClose }: ParticipantsSheetProps) {
    if (!open) {
        return null;
    }

    return (
        <div className={styles.overlay}>
            <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Закрыть" />
            <div className={styles.sheet} role="dialog" aria-label="Участники">
                <div className={styles.grip} />
                <div className={styles.title}>На связи</div>
                <div className={styles.hint}>Нажми на корабль, чтобы писать от его имени</div>
                {participants.map((participant) => {
                    const active = participant.id === activeId;
                    return (
                        <button
                            key={participant.id}
                            type="button"
                            className={active ? styles.rowActive : styles.row}
                            onClick={() => onSwitch(participant.id)}
                        >
                            <span className={styles.avatar}>
                                <HullBadge number={participant.hullNumber} />
                            </span>
                            <span className={styles.info}>
                                <span className={styles.name}>{participant.name}</span>
                                <span className={styles.kind}>{SHIP_KIND_LABELS[participant.shipKind]}</span>
                            </span>
                            {active && (
                                <svg
                                    className={styles.check}
                                    viewBox="0 0 24 24"
                                    width="20"
                                    height="20"
                                    aria-hidden="true"
                                >
                                    <path
                                        d="M4 12.5 L9.5 18 L20 6.5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
