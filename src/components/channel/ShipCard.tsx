import { useState } from 'react';

import MemberName from '@/components/ships/MemberName';
import Pennant from '@/components/ships/Pennant';
import ShipPortrait, { shipSpecLine } from '@/components/ships/ShipPortrait';
import Actions from '@/components/ui/Actions';
import Button from '@/components/ui/Button';
import { useSnackbar } from '@/components/ui/Snackbar';
import Switch from '@/components/ui/Switch';
import { BeaconIcon } from '@/components/ui/icons';
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
 * Положения переключателя огней. Порядок тут и есть порядок на дорожке: «Ход» слева, «Якорь»
 * справа. Список постоянный и лежит снаружи разметки — как и всё, что от состояния карточки
 * не зависит.
 */
const UNDERWAY_OPTIONS = [
    { value: 'underway', label: 'Ход' },
    { value: 'anchored', label: 'Якорь' },
] as const;

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
    // Разглядывают ли корабль вблизи. Живёт это тут же, рядом с огнями, и по той же причине:
    // приближение — способ посмотреть, а не свойство корабля, и забывается вместе с карточкой.
    const [zoomed, setZoomed] = useState(false);
    const notify = useSnackbar();

    const handleSignal = () => {
        setReply((prev) => ({ seq: (prev?.seq ?? 0) + 1, text: HAIL_SIGNAL }));
    };

    return (
        <div className={styles.card}>
            {/* Мотается только тело: полоса кнопок стоит под ним своей строкой (см. ui/Actions). */}
            <div className={styles.body}>
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
                якорные. Ходовые зажигает кнопка внизу, и только на портрете.

                Нажатие на сам портрет приближает корабль: силуэт занимает место целиком,
                и вместе с ним растёт линейка. Мелкие проекты в карточке выходят вдвое меньше
                места под них — не по прихоти, а потому что размер тут общий со сценой
                (см. shipSizeShare), и катер обязан быть мельче корвета. Разглядеть его при
                этом всё равно хочется, и приближение — единственное место в приложении,
                где корабль показан не в масштабе флота, а сам по себе. */}
                <ShipPortrait
                    kind={member.shipKind}
                    hullNumber={member.hullNumber}
                    facing={member.place.facing}
                    mode={underway ? 'underway' : 'anchored'}
                    morseFeed={reply}
                    ownHeight
                    zoomed={zoomed}
                    onZoom={() => setZoomed((was) => !was)}
                />

                <div className={styles.kind}>{SHIP_KIND_LABELS[member.shipKind]}</div>
                <div className={styles.spec}>{shipSpecLine(member.shipKind)}</div>
            </div>

            {/* Ряд тот же, что внизу форм, но по содержимому и влево: переключатель рядом
                тянуть нельзя (см. ui/Actions и ui/Switch). */}
            <Actions ownWidth>
                <Button variant="secondary" onClick={handleSignal}>
                    <BeaconIcon />
                    {/* «Подать сигнал» — там, где карточка широка, и просто «Сигнал», где узка.
                        Меряется карточка, а не окно: она живёт в шторке, а та бывает и в треть
                        экрана шириной (см. .signalWide). */}
                    <span className={styles.signalWide}>Подать сигнал</span>
                    <span className={styles.signalNarrow}>Сигнал</span>
                </Button>
                {/* Положения, а не действия: кнопка тут показывала обратное нынешнему —
                    на якоре предлагала ход, — и прочесть по ней, как корабль стоит сейчас,
                    было нельзя. */}
                <Switch
                    label="Огни"
                    options={UNDERWAY_OPTIONS}
                    value={underway ? 'underway' : 'anchored'}
                    onChange={(mode) => setUnderway(mode === 'underway')}
                />
            </Actions>
        </div>
    );
}
