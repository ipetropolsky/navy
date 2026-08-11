import { Fragment, useState } from 'react';

import { ChannelError, MemberDraft } from '@/backend';
import MemberName from '@/components/ships/MemberName';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Input from '@/components/ui/Input';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import {
    HULL_NUMBER_LENGTH,
    MEMBER_COLORS,
    Member,
    SHIP_KINDS,
    SHIP_KIND_LABELS,
    SHIP_SPECS,
    ShipKind,
    isValidHullNumber,
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
    onSubmit: (draft: MemberDraft) => Promise<void>;
    onCancel?: () => void;
}

const randomHullNumber = (): string => String(Math.floor(Math.random() * 900) + 100);

/**
 * Масштаб в списке один на всех: самый длинный корабль занимает всю ширину кнопки, остальные —
 * свою долю от него. Катер рядом с корветом и выглядит катером, сравнивать их можно прямо
 * глазами, а линейка внизу говорит, сколько это в метрах: она у всех одна и та же, десять
 * метров.
 *
 * Всё считается долями ширины кнопки, ни одного числа в пикселях: на любом экране и при любом
 * изменении окна и линейка, и силуэт тянутся вместе, а соотношение между ними не меняется.
 */
const SCALE_METRES = 10;
const SCALE_SEGMENTS = [0, 1, 2, 3, 4];

/** Самый длинный корабль в справочнике: по нему и построен масштаб. */
const LONGEST_SHIP = Math.max(...SHIP_KINDS.map((kind) => SHIP_SPECS[kind].length));

/** Ширина силуэта в долях ширины кнопки. */
const shipWidth = (kind: ShipKind): number => SHIP_SPECS[kind].length / LONGEST_SHIP;

/** Ширина линейки в тех же долях: десять метров в том же масштабе. */
const SCALE_WIDTH = SCALE_METRES / LONGEST_SHIP;

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
export default function MemberForm({ mode, crew, myId, initial, onSubmit, onCancel }: MemberFormProps) {
    const takenColors = crew.filter((member) => member.memberId !== myId).map((member) => member.color);
    const [name, setName] = useState(initial?.name ?? '');
    const [hullNumber, setHullNumber] = useState(initial?.hullNumber ?? randomHullNumber);
    const [shipKind, setShipKind] = useState<ShipKind>(initial?.shipKind ?? 'corvette');
    // Цвет по умолчанию — первый свободный: два одинаковых позывных в ленте не различить.
    const [color, setColor] = useState(
        initial?.color ?? MEMBER_COLORS.find((option) => !takenColors.includes(option)) ?? MEMBER_COLORS[0]
    );
    const [busy, setBusy] = useState(false);
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
            await onSubmit({ name: name.trim(), hullNumber, shipKind, color });
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
            // Название канала уже стоит в шапке над сценой, здесь только состав. Позывные
            // подписаны так же, как в ленте: по цвету видно, чья реплика будет чьей.
            hint={
                crew.length ? (
                    <>
                        На связи:{' '}
                        {crew.map((member, index) => (
                            <Fragment key={member.memberId}>
                                {index > 0 && <span>, </span>}
                                <MemberName name={member.name} color={member.color} />
                            </Fragment>
                        ))}
                    </>
                ) : (
                    'На связи пока никого — ты первый'
                )
            }
            onSubmit={handleSubmit}
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

            <Field label="Корабль" group>
                {/* Корабли в столбик: они вытянутые, в ряд превратились бы в нечитаемые полоски.
                    Зато в столбик каждому достаётся вся ширина панели — силуэт видно как следует. */}
                <div className={styles.kinds}>
                    {SHIP_KINDS.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            className={kind === shipKind ? styles.kindActive : styles.kind}
                            onClick={() => setShipKind(kind)}
                        >
                            {/* Место под силуэт одно на всех, а сам силуэт в нём той ширины,
                                какую даёт его длина. */}
                            <span className={styles.kindImageBox} style={{ aspectRatio: IMAGE_BOX_ASPECT }}>
                                <img
                                    className={styles.kindImage}
                                    style={{ width: percent(shipWidth(kind)) }}
                                    src={SHIP_SPRITES[kind].url}
                                    alt=""
                                />
                            </span>
                            <span className={styles.scaleRow}>
                                <span className={styles.scaleBar} style={{ width: percent(SCALE_WIDTH) }}>
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
