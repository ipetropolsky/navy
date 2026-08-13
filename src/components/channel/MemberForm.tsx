import { useState } from 'react';

import { ChannelError, MemberDraft } from '@/backend';
import MemberName from '@/components/ships/MemberName';
import Ship from '@/components/ships/Ship';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Input from '@/components/ui/Input';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import { HAIL_SIGNAL } from '@/hooks/morse';
import {
    HULL_NUMBER_LENGTH,
    MEMBER_COLORS,
    Member,
    MorseFeed,
    SHIP_KINDS,
    SHIP_KIND_LABELS,
    SHIP_SPECS,
    ShipKind,
    Side,
    isValidHullNumber,
    shipSizeShare,
} from '@/types/channel';
import { plural } from '@/utils/plural';
import { isMobile } from '@/utils/viewport';

import styles from './MemberForm.module.less';

interface MemberFormProps {
    /** Вход в канал или переоснащение уже стоящего в строю корабля. */
    mode: 'join' | 'edit';
    /** Кто уже на связи: подсказка, а не проверка — проверяет бэкенд. */
    crew: Member[];
    /** Свой корабль, если он уже в строю: его цвет из занятых не исключаем. */
    myId: string | null;
    initial?: MemberDraft;
    /**
     * Выбранный силуэт. Единственное поле формы, которое живёт снаружи: от размера корабля
     * зависит, куда он влезет на рейде, а свободные места показывает не форма, а сцена.
     */
    shipKind: ShipKind;
    onShipKind: (kind: ShipKind) => void;
    onSubmit: (draft: MemberDraft) => Promise<void>;
    onCancel?: () => void;
}

const randomHullNumber = (): string => String(Math.floor(Math.random() * 900) + 100);

/**
 * Курс, с которым открывается форма: монетка. Осмысленного умолчания тут нет — куда смотреть
 * носом, дело вкуса, — а один и тот же курс у всех выстроил бы рейд в кильватерную колонну.
 */
const randomCourse = (): Side => (Math.random() < 0.5 ? 'left' : 'right');

/** Порядок кнопок курса — как на компасе, каким его видит глаз: влево слева, вправо справа. */
const COURSES: Side[] = ['left', 'right'];

/** Стрелка курса. Рисуется влево, вправо разворачивается отражением: линии у них одни и те же. */
const CourseArrow = ({ side }: { side: Side }) => (
    <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        style={{ scale: side === 'right' ? '-1 1' : '' }}
    >
        <path
            d="M20 12H5M11 6l-6 6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
    </svg>
);

/**
 * Размер силуэта в списке — тем же правилом, что и в сцене (shipSizeShare): самый длинный
 * корабль занимает всю ширину кнопки, самый короткий — SHIP_SIZE_MIN от неё, остальные между.
 * Строго по длине катер выходил бы втрое мельче корабля, и разглядеть его было бы нечего.
 *
 * Масштаб от этого у каждого свой, и сравнивать силуэты между собой на глаз уже нельзя —
 * зато под каждым стоит его собственная линейка на десять метров, и по ней разница видна сразу.
 *
 * Всё считается долями ширины кнопки, ни одного числа в пикселях: на любом экране и при любом
 * изменении окна и линейка, и силуэт тянутся вместе, а соотношение между ними не меняется.
 */
const SCALE_METRES = 10;
const SCALE_SEGMENTS = [0, 1, 2, 3, 4];

/** Ширина силуэта в долях ширины кнопки — по тому же правилу, что и размер корабля в сцене. */
const shipWidth = (kind: ShipKind): number => shipSizeShare(kind);

/**
 * Ширина линейки: десять метров в масштабе именно этого силуэта. У мелкого корабля масштаб
 * крупнее — и линейка длиннее. Толщина и подпись у всех одинаковые: меняется только длина.
 */
const scaleWidth = (kind: ShipKind): number => (SCALE_METRES * shipWidth(kind)) / SHIP_SPECS[kind].length;

/** Высота силуэта в долях ширины кнопки: ширина, делённая на пропорции его рисунка. */
const shipHeight = (kind: ShipKind): number =>
    (shipWidth(kind) * SHIP_SPRITES[kind].size.height) / SHIP_SPRITES[kind].size.width;

/**
 * Место под силуэт: у всех кнопок одно, ростом с самый высокий из рисунков в их собственном
 * масштабе. Кнопки от этого одной высоты, корабли стоят на одном уровне, а лишнего поля
 * над мачтами ровно столько, сколько нужно самому высокому.
 */
const IMAGE_BOX_ASPECT = 1 / Math.max(...SHIP_KINDS.map(shipHeight));

const percent = (share: number): string => `${(share * 100).toFixed(2)}%`;

/**
 * Строчка с характеристиками силуэта: длина, водоизмещение, полный ход. Числа не украшение —
 * по ним считается ход корабля в сцене, и катер потому и уходит с рейда быстрее тральщика.
 * Порядок тот же, что в справочниках: размер, масса, скорость.
 */
const shipSpecLine = (kind: ShipKind): string => {
    const spec = SHIP_SPECS[kind];
    const number = (value: number): string => value.toLocaleString('ru-RU');
    const knots = `${number(spec.knots)} ${plural(spec.knots, ['узел', 'узла', 'узлов'])}`;
    return `${number(spec.length)} м · ${number(spec.displacement)} т · ${knots}`;
};

/**
 * Корабль участника: силуэт, цвет, бортовой номер и позывной. Форма одна и та же
 * при входе и при переоснащении — меняются только заголовок и состав кнопок.
 */
export default function MemberForm({
    mode,
    crew,
    myId,
    initial,
    shipKind,
    onShipKind,
    onSubmit,
    onCancel,
}: MemberFormProps) {
    const takenColors = crew.filter((member) => member.memberId !== myId).map((member) => member.color);
    const [name, setName] = useState(initial?.name ?? '');
    const [hullNumber, setHullNumber] = useState(initial?.hullNumber ?? randomHullNumber);
    // Цвет по умолчанию — первый свободный: два одинаковых позывных в ленте не различить.
    const [color, setColor] = useState(
        initial?.color ?? MEMBER_COLORS.find((option) => !takenColors.includes(option)) ?? MEMBER_COLORS[0]
    );
    // Курс живёт в форме, а не снаружи: от него, в отличие от силуэта, не зависит ничего,
    // кроме самого корабля, — свободных мест на рейде он не меняет.
    const [facing, setFacing] = useState<Side>(initial?.facing ?? randomCourse);
    const [busy, setBusy] = useState(false);
    // Отклик выбранного корабля: ткнули в кнопку — он мигнул лампой ровно так же, как чужой
    // корабль в кадре на тычок в аватарку. Держится он в состоянии, а не собирается на каждый
    // проход: лампа считает поводом новый объект, и собранный заново отклик передавал бы
    // без конца. Счётчик в seq — чтобы можно было ткнуть в тот же силуэт второй раз: сигнал
    // всегда один и тот же, и по нему двух нажатий не различить.
    const [reply, setReply] = useState<MorseFeed | null>(null);
    const notify = useSnackbar();

    const hullNumberOk = isValidHullNumber(hullNumber);
    // Надпись одна на оба случая: что при входе, что при переоснащении человек делает одно
    // и то же — заканчивает с формой. Что именно случится, уже написано в заголовке.
    const submitLabel = busy ? 'Минуту…' : 'Готово';
    const canSubmit = name.trim().length > 0 && hullNumberOk;

    const handleSubmit = async () => {
        if (!canSubmit || busy) {
            return;
        }
        setBusy(true);
        try {
            await onSubmit({ name: name.trim(), hullNumber, shipKind, color, facing });
        } catch (failure) {
            // Занятый позывной или полный канал — это ответ бэкенда, а не поломка. Снекбаром,
            // чтобы отказ не раздвигал форму: кнопка должна остаться там, куда целились.
            notify(failure instanceof ChannelError ? failure.message : 'Не вышло. Попробуй ещё раз.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title={mode === 'join' ? 'Встать в строй' : 'Переоснастить корабль'}
            // Состав здесь не перечисляем: пока форма открыта, занятые места на рейде подписаны
            // позывными, и то же самое второй раз строкой над формой — лишнее.
            onSubmit={handleSubmit}
            // Форма длинная: корабли идут столбиком, и кнопки без этого уезжают под обрез.
            pinActions
            actions={
                <>
                    {onCancel && (
                        <Button variant="secondary" onClick={onCancel}>
                            Отмена
                        </Button>
                    )}
                    <Button type="submit" disabled={!canSubmit || busy}>
                        {submitLabel}
                    </Button>
                </>
            }
        >
            <Field label="Позывной">
                <Input
                    value={name}
                    maxLength={20}
                    placeholder="Гром"
                    autoComplete="off"
                    // На телефоне фокус сразу выкидывает клавиатуру поверх формы.
                    autoFocus={!isMobile()}
                    onChange={(event) => setName(event.target.value)}
                />
            </Field>

            <Field label={`Бортовой номер — ${HULL_NUMBER_LENGTH} цифры`}>
                {/* Недобранный номер подсвечиваем сразу: три цифры — жёсткое требование,
                    место на борту под них и нарисовано. */}
                <Input
                    value={hullNumber}
                    invalid={Boolean(hullNumber) && !hullNumberOk}
                    compact
                    maxLength={HULL_NUMBER_LENGTH}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) => setHullNumber(event.target.value.replace(/\D/g, ''))}
                />
            </Field>

            <Field label="Цвет" group>
                <div className={styles.colors}>
                    {MEMBER_COLORS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={option === color ? styles.colorActive : styles.color}
                            style={{ background: option }}
                            aria-label={`Цвет ${option}`}
                            onClick={() => setColor(option)}
                        />
                    ))}
                    {/* Живой пример: цвет выбирают не сам по себе, а под то, как им подписана реплика. */}
                    <MemberName name={name.trim() || 'Позывной'} color={name.trim() ? color : undefined} />
                </div>
            </Field>

            {/* Курс идёт перед силуэтами, потому что силуэты им и развёрнуты: сперва решаем,
                куда корабль смотрит, и дальше выбираем из кораблей, стоящих на этом курсе.
                Обратный порядок заставлял бы выбирать силуэт, а потом смотреть, как весь
                список переворачивается. */}
            <Field label="Курс" group>
                <div className={styles.courses}>
                    {COURSES.map((side) => (
                        <button
                            key={side}
                            type="button"
                            className={side === facing ? styles.courseActive : styles.course}
                            aria-label={side === 'left' ? 'Курс влево' : 'Курс вправо'}
                            aria-pressed={side === facing}
                            onClick={() => setFacing(side)}
                        >
                            <CourseArrow side={side} />
                        </button>
                    ))}
                </div>
            </Field>

            <Field label="Корабль" group>
                {/* Корабли в столбик: они вытянутые, в ряд превратились бы в нечитаемые полоски.
                    Зато в столбик каждому достаётся вся ширина панели — силуэт видно как следует. */}
                <div className={styles.kinds}>
                    {SHIP_KINDS.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            className={kind === shipKind ? styles.kindActive : styles.kind}
                            onClick={() => {
                                onShipKind(kind);
                                setReply((prev) => ({ seq: (prev?.seq ?? 0) + 1, text: HAIL_SIGNAL }));
                            }}
                        >
                            {/* Место под силуэт одно на всех, а сам силуэт в нём той ширины,
                                какую даёт его длина. Корабль тут тот же, что в сцене, вместе
                                с огнями и сигнальной лампой: стоянка на рейде — это то, ради
                                чего его и выбирают, а огни у каждого силуэта свои и стоят
                                по-разному. Бортового номера в списке нет: его набирают выше,
                                и на двенадцати корпусах сразу он читался бы как часть рисунка.

                                Выбранный корабль стоит под парами: у него горят ходовые огни,
                                у остальных — якорные. Так и видно, который из них сейчас твой,
                                и разница между двумя наборами огней заодно показана вживую,
                                а не описана словами. Отклик лампой достаётся тоже ему одному. */}
                            <span className={styles.kindImageBox} style={{ aspectRatio: IMAGE_BOX_ASPECT }}>
                                <span className={styles.kindShip} style={{ width: percent(shipWidth(kind)) }}>
                                    <Ship
                                        kind={kind}
                                        name={SHIP_KIND_LABELS[kind]}
                                        hullNumber=""
                                        facing={facing}
                                        mode={kind === shipKind ? 'underway' : 'anchored'}
                                        morseFeed={kind === shipKind ? reply : null}
                                    />
                                </span>
                            </span>
                            <span className={styles.scaleRow}>
                                <span className={styles.scaleBar} style={{ width: percent(scaleWidth(kind)) }}>
                                    {SCALE_SEGMENTS.map((step) => (
                                        <span key={step} className={step % 2 ? styles.scaleDark : styles.scaleLight} />
                                    ))}
                                </span>
                                <span className={styles.scaleLabel}>{SCALE_METRES} м</span>
                            </span>
                            <span className={styles.kindLabel}>{SHIP_KIND_LABELS[kind]}</span>
                            <span className={styles.kindSpec}>{shipSpecLine(kind)}</span>
                        </button>
                    ))}
                </div>
            </Field>
        </Panel>
    );
}
