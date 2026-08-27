import { plural } from '@/utils/plural';
import {
    MorseFeed,
    SHIP_KINDS,
    SHIP_KIND_LABELS,
    SHIP_SPECS,
    ShipKind,
    Side,
    shipSizeShare,
} from '@shared/types/channel';

import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';

import styles from './ShipPortrait.module.less';

/**
 * Портрет корабля: силуэт в своём масштабе, под ним линейка на десять метров.
 *
 * Один и тот же и в форме, где корабль выбирают, и в карточке, где на чужой смотрят: это
 * одно и то же изображение одного и того же корабля, и разводить его на два — верный способ
 * однажды получить два разных.
 *
 * Размер силуэта — тем же правилом, что и в сцене (`shipSizeShare`): самый длинный корабль
 * занимает всю ширину, самый короткий — свою долю от неё, остальные между. Строго по длине
 * катер выходил бы втрое мельче корабля, и разглядеть его было бы нечего.
 *
 * Масштаб от этого у каждого свой, и сравнивать силуэты между собой на глаз уже нельзя —
 * зато под каждым стоит его собственная линейка на десять метров, и по ней разница видна сразу.
 *
 * Всё считается долями своей ширины, ни одного числа в пикселях: на любом экране и при любом
 * изменении окна и линейка, и силуэт тянутся вместе, а соотношение между ними не меняется.
 */
const SCALE_METRES = 10;
const SCALE_SEGMENTS = [0, 1, 2, 3, 4];

/** Ширина силуэта в долях ширины места под него — по тому же правилу, что и размер в сцене. */
const shipWidth = (kind: ShipKind): number => shipSizeShare(kind);

/**
 * Ширина линейки: десять метров в масштабе именно этого силуэта. У мелкого корабля масштаб
 * крупнее — и линейка длиннее. Толщина и подпись у всех одинаковые: меняется только длина.
 */
const scaleWidth = (kind: ShipKind): number => (SCALE_METRES * shipWidth(kind)) / SHIP_SPECS[kind].length;

/** Высота силуэта в долях ширины места: ширина, делённая на пропорции его рисунка. */
const shipHeight = (kind: ShipKind): number =>
    (shipWidth(kind) * SHIP_SPRITES[kind].size.height) / SHIP_SPRITES[kind].size.width;

/**
 * Место под силуэт: у всех оно одно, ростом с самый высокий из рисунков в его собственном
 * масштабе. Портреты от этого одной высоты, корабли стоят на одном уровне, а лишнего поля
 * над мачтами ровно столько, сколько нужно самому высокому.
 */
const IMAGE_BOX_ASPECT = 1 / Math.max(...SHIP_KINDS.map(shipHeight));

/** Место ровно по этому силуэту: ни строчки пустого неба над мачтами. */
const ownBoxAspect = (kind: ShipKind): number => 1 / shipHeight(kind);

const percent = (share: number): string => `${(share * 100).toFixed(2)}%`;

/**
 * Во сколько раз силуэт вырастает, когда его разглядывают вблизи: место под него занято
 * своей долей, а вблизи он занимает его целиком. У самого длинного корабля справочника доля
 * и так единица — ему расти некуда, и нажатие на его портрете ничего не меняет: он и без того
 * показан во всю ширину.
 */
const zoomFactor = (kind: ShipKind): number => 1 / shipWidth(kind);

/** Что случится по нажатию на портрет. Подсказка меняется вместе с положением, как и у «Ход»/«Якорь». */
const ZOOM_IN_TITLE = 'Рассмотреть вблизи';
const ZOOM_OUT_TITLE = 'Отойти на шаг';

/**
 * Строчка с характеристиками силуэта: длина, водоизмещение, полный ход. Числа не украшение —
 * по ним считается ход корабля в сцене, и катер потому и уходит с рейда быстрее тральщика.
 * Порядок тот же, что в справочниках: размер, масса, скорость.
 */
export const shipSpecLine = (kind: ShipKind): string => {
    const spec = SHIP_SPECS[kind];
    const number = (value: number): string => value.toLocaleString('ru-RU');
    const knots = `${number(spec.knots)} ${plural(spec.knots, ['узел', 'узла', 'узлов'])}`;
    return `${number(spec.length)} м · ${number(spec.displacement)} т · ${knots}`;
};

interface ShipPortraitProps {
    kind: ShipKind;
    /** Номер на борту. Пустой — борт чистый: так стоят силуэты, которые не выбраны. */
    hullNumber?: string;
    facing: Side;
    /** Под парами или на якоре: от этого зависит, какие огни горят. */
    mode: 'underway' | 'anchored';
    /** Повод мигнуть лампой: отклик на нажатие или оклик. */
    morseFeed?: MorseFeed | null;
    /**
     * Место под силуэт — ровно по нему, а не по самому высокому из рисунков. Нужно там, где
     * портрет один: в карточке чужого корабля сравнивать его не с чем, а пустая полоса неба
     * над мачтами катера в полкарточки высотой — это просто дыра, на которую вытянулась шторка.
     * Там же, где силуэты стоят рядом (список кораблей в форме), общая высота обязательна:
     * без неё корабли встают на разные уровни.
     */
    ownHeight?: boolean;
    /**
     * Разглядывают ли корабль вблизи. Силуэт тогда занимает место целиком, а вместе с ним
     * растёт и линейка: она мерит этот самый рисунок, и оставь её прежней — она начала бы врать.
     */
    zoomed?: boolean;
    /**
     * Что делать по нажатию на портрет. Передан — портрет становится кнопкой; не передан —
     * остаётся картинкой, на которую незачем нажимать (так он стоит в форме своего корабля,
     * где силуэт и без того выбирают строчкой списка).
     */
    onZoom?: () => void;
}

export default function ShipPortrait({
    kind,
    hullNumber = '',
    facing,
    mode,
    morseFeed = null,
    ownHeight = false,
    zoomed = false,
    onZoom,
}: ShipPortraitProps) {
    // Место под силуэт: своё по этому кораблю, а вблизи — ниже ровно во столько же раз,
    // во сколько силуэт шире. Меняется соотношение сторон, а не высота в пикселях: ширину
    // месту даёт то, в чём оно лежит, и в пикселях её тут никто не знает.
    const boxAspect = ownHeight ? ownBoxAspect(kind) : IMAGE_BOX_ASPECT;
    const zoom = zoomed ? zoomFactor(kind) : 1;
    const box = { aspectRatio: boxAspect / zoom };
    const inner = (
        <span className={styles.portraitShip} style={{ width: percent(shipWidth(kind) * zoom) }}>
            <Ship
                kind={kind}
                name={SHIP_KIND_LABELS[kind]}
                hullNumber={hullNumber}
                facing={facing}
                mode={mode}
                morseFeed={morseFeed}
            />
        </span>
    );

    return (
        <>
            {/* Место под силуэт одно на всех, а сам силуэт в нём той ширины, какую даёт его
                длина. Корабль тут тот же, что в сцене, вместе с огнями и сигнальной лампой:
                стоянка на рейде — это то, ради чего его и выбирают, а огни у каждого силуэта
                свои и стоят по-разному. Номер на борту — того же размера и на том же месте,
                каким он будет виден в кадре. */}
            {onZoom ? (
                // Кнопка без всякой кнопочности: нажимают саму картинку, и подсказка говорит,
                // что случится. `aria-pressed` — потому что это положение, а не разовое
                // действие: портрет остаётся увеличенным, пока его не уменьшат обратно.
                <button
                    type="button"
                    className={`${styles.portraitBox} ${styles.portraitZoom}`}
                    style={box}
                    title={zoomed ? ZOOM_OUT_TITLE : ZOOM_IN_TITLE}
                    aria-label={zoomed ? ZOOM_OUT_TITLE : ZOOM_IN_TITLE}
                    aria-pressed={zoomed}
                    onClick={onZoom}
                >
                    {inner}
                </button>
            ) : (
                <span className={styles.portraitBox} style={box}>
                    {inner}
                </span>
            )}
            <span className={styles.scaleRow}>
                <span className={styles.scaleBar} style={{ width: percent(scaleWidth(kind) * zoom) }}>
                    {SCALE_SEGMENTS.map((step) => (
                        <span key={step} className={step % 2 ? styles.scaleDark : styles.scaleLight} />
                    ))}
                </span>
                <span className={styles.scaleLabel}>{SCALE_METRES} м</span>
            </span>
        </>
    );
}
