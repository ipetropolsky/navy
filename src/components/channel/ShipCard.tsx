import { useState } from 'react';

import MemberName from '@/components/ships/MemberName';
import Pennant from '@/components/ships/Pennant';
import ShipPortrait, { shipSpecLine } from '@/components/ships/ShipPortrait';
import Button from '@/components/ui/Button';
import { HAIL_SIGNAL } from '@/hooks/morse';
import { Member, MorseFeed, SHIP_KIND_LABELS } from '@/types/channel';

import styles from './ShipCard.module.less';

interface ShipCardProps {
    member: Member;
    /** Старший на рейде: у него вымпел рядом с позывным, как и в списке. */
    senior: boolean;
    /** Окликнуть корабль: он отвечает лампой и здесь, и со своего места на рейде. */
    onHail: () => void;
}

/** Что означает вымпел. То же слово, что и в списке: звание одно. */
const SENIOR_TITLE = 'Старший на рейде';

/**
 * Карточка чужого корабля: портрет с бортовым номером, позывной, силуэт и его характеристики.
 *
 * Открывается тычком по кораблю в кадре и тычком по аватарке в ленте — с двух сторон одного
 * и того же вопроса: «что это за корабль там стоит» и «кто это говорит». В ленте от корабля
 * видно три цифры на аватарке, в кадре — силуэт без подписи, и связать одно с другим иначе
 * нечем.
 *
 * Портрет тот же, что в форме своего корабля (`ShipPortrait`), и это не совпадение: человек
 * уже выбирал корабль по этой картинке и знает, как её читать. Курс — настоящий, с рейда:
 * карточка показывает тот самый корабль, который стоит в кадре, а не образец из справочника.
 *
 * Оклик живёт здесь же. Раньше он был на самой аватарке, но аватарка теперь открывает
 * карточку, и место окликом занято быть не может: «который из них твой» — это вопрос
 * про корабль, и задаётся он с его карточки, где сразу видно и ответ лампой на портрете,
 * и вспышку на рейде.
 */
export default function ShipCard({ member, senior, onHail }: ShipCardProps) {
    // Отклик лампой на портрете: тот же сигнал, что уходит и на рейд. Счётчик в seq — чтобы
    // окликать можно было подряд: буква каждый раз одна и та же, и по ней двух окликов
    // не различить.
    const [reply, setReply] = useState<MorseFeed | null>(null);

    const handleHail = () => {
        setReply((prev) => ({ seq: (prev?.seq ?? 0) + 1, text: HAIL_SIGNAL }));
        onHail();
    };

    return (
        <div className={styles.card}>
            <div className={styles.title}>
                <MemberName name={member.name} color={member.color} />
                {senior && (
                    <span className={styles.pennant} title={SENIOR_TITLE} aria-label={SENIOR_TITLE}>
                        <Pennant />
                    </span>
                )}
            </div>
            <div className={styles.hullNumber}>Бортовой номер {member.hullNumber}</div>

            {/* Корабль стоит на якоре — он и правда стоит на рейде, и огни у него якорные. */}
            <ShipPortrait
                kind={member.shipKind}
                hullNumber={member.hullNumber}
                facing={member.place.facing}
                mode="anchored"
                morseFeed={reply}
            />

            <div className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</div>
            <div className={styles.spec}>{shipSpecLine(member.shipKind)}</div>

            <div className={styles.actions}>
                <Button variant="secondary" onClick={handleHail}>
                    Окликнуть
                </Button>
            </div>
        </div>
    );
}
