import { useState } from 'react';

import MemberName from '@/components/ships/MemberName';
import Pennant from '@/components/ships/Pennant';
import ShipPortrait, { shipSpecLine } from '@/components/ships/ShipPortrait';
import Actions from '@/components/ui/Actions';
import Button from '@/components/ui/Button';
import { useSnackbar } from '@/components/ui/Snackbar';
import { HAIL_SIGNAL } from '@/hooks/morse';
import { Member, MorseFeed, SHIP_KIND_LABELS } from '@/types/channel';

import styles from './ShipCard.module.less';

interface ShipCardProps {
    member: Member;
    /** Старший на рейде: у него вымпел рядом с позывным, как и в списке. */
    senior: boolean;
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
 * Высота места под силуэт здесь своя, по этому кораблю: сравнивать его тут не с чем, и общая
 * на всех высота оборачивалась бы полосой пустого неба над мачтами катера.
 *
 * Две кнопки внизу — то, что с портретом можно сделать: попросить подать сигнал и переключить
 * огни с рейдовых на ходовые. Обе живут только в карточке и до рейда не доходят: это показ
 * корабля, а не команда ему. Чужой корабль в кадре стоит на якоре и стоит молча — распоряжаться
 * им с его же карточки было бы странно, а увидеть, как он выглядит на ходу и как отвечает
 * лампой, хочется ровно здесь, где он и показан крупно.
 */
export default function ShipCard({ member, senior }: ShipCardProps) {
    // Отклик лампой на портрете. Счётчик в seq — чтобы просить сигнал можно было подряд:
    // буква каждый раз одна и та же, и по ней двух сигналов не различить.
    const [reply, setReply] = useState<MorseFeed | null>(null);
    // Под парами или на якоре. Показ, а не состояние корабля: на рейде он как стоял на якоре,
    // так и стоит, — поэтому и живёт это только в карточке и забывается вместе с ней.
    const [underway, setUnderway] = useState(false);
    const notify = useSnackbar();

    const handleSignal = () => {
        setReply((prev) => ({ seq: (prev?.seq ?? 0) + 1, text: HAIL_SIGNAL }));
    };

    return (
        <div className={styles.card}>
            <div className={styles.title}>
                <MemberName name={member.name} color={member.color} large />
                {/* Отвечает званием по нажатию — так же, как в списке кораблей: вымпел
                    в карточке ничем не подписан, и спросить, что он значит, человек может
                    только тычком. */}
                {senior && (
                    <button
                        type="button"
                        className={styles.pennant}
                        title={SENIOR_TITLE}
                        aria-label={SENIOR_TITLE}
                        onClick={() => notify(SENIOR_TITLE)}
                    >
                        <Pennant />
                    </button>
                )}
            </div>
            <div className={styles.hullNumber}>Бортовой номер {member.hullNumber}</div>

            {/* По умолчанию корабль на якоре — он и правда стоит на рейде, и огни у него
                якорные. Ходовые зажигает кнопка внизу, и только на портрете. */}
            <ShipPortrait
                kind={member.shipKind}
                hullNumber={member.hullNumber}
                facing={member.place.facing}
                mode={underway ? 'underway' : 'anchored'}
                morseFeed={reply}
                ownHeight
            />

            <div className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</div>
            <div className={styles.spec}>{shipSpecLine(member.shipKind)}</div>

            {/* Ряд кнопок тот же, что внизу форм: одна механика на всё приложение — как они
                делят ширину, когда переносятся и как липнут к нижней кромке. */}
            <Actions pinned>
                <Button variant="secondary" onClick={handleSignal}>
                    Сигнал
                </Button>
                {/* Подпись — действие, а не положение: пока корабль на якоре, кнопка предлагает
                    дать ход, а под парами — отдать якорь. Обе подписи лежат в кнопке разом,
                    чтобы переключение не меняло её ширину (см. .swap). */}
                <Button variant="secondary" onClick={() => setUnderway((was) => !was)}>
                    <span className={styles.swap}>
                        <span className={underway ? styles.swapHidden : undefined}>Ход</span>
                        <span className={underway ? undefined : styles.swapHidden}>Якорь</span>
                    </span>
                </Button>
            </Actions>
        </div>
    );
}
