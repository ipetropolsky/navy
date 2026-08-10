import { SyntheticEvent, useState } from 'react';

import { ChannelError, MemberDraft } from '@/backend';
import { SHIP_SPRITES } from '@/components/ships/shipSprites';
import Button from '@/components/ui/Button';
import {
    HULL_NUMBER_LENGTH,
    MEMBER_COLORS,
    SHIP_KINDS,
    SHIP_KIND_LABELS,
    SHIP_SPECS,
    ShipKind,
    isValidHullNumber,
} from '@/types/channel';
import { plural } from '@/utils/plural';

import styles from './MemberForm.module.less';

interface MemberFormProps {
    /** Вход в канал или переоснащение уже стоящего в строю корабля. */
    mode: 'join' | 'edit';
    /** Позывные тех, кто уже на связи: подсказка, а не проверка — проверяет бэкенд. */
    crew: string[];
    /** Занятые цвета: из них по умолчанию не выбираем, чтобы реплики не сливались. */
    takenColors: string[];
    initial?: MemberDraft;
    onSubmit: (draft: MemberDraft) => Promise<void>;
    onCancel?: () => void;
}

const randomHullNumber = (): string => String(Math.floor(Math.random() * 900) + 100);

/**
 * Корабль участника: силуэт, цвет, бортовой номер и позывной. Форма одна и та же
 * при входе и при переоснащении — меняется только заголовок и кнопка.
 */
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

export default function MemberForm({ mode, crew, takenColors, initial, onSubmit, onCancel }: MemberFormProps) {
    const [name, setName] = useState(initial?.name ?? '');
    const [hullNumber, setHullNumber] = useState(initial?.hullNumber ?? randomHullNumber);
    const [shipKind, setShipKind] = useState<ShipKind>(initial?.shipKind ?? 'corvette');
    // Цвет по умолчанию — первый свободный: два одинаковых позывных в ленте не различить.
    const [color, setColor] = useState(
        initial?.color ?? MEMBER_COLORS.find((option) => !takenColors.includes(option)) ?? MEMBER_COLORS[0]
    );
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const hullNumberOk = isValidHullNumber(hullNumber);
    // Надпись одна на оба случая: что при входе, что при переоснащении человек делает одно
    // и то же — заканчивает с формой. Что именно случится, уже написано в заголовке.
    const submitLabel = busy ? 'Минуту…' : 'Готово';
    const canSubmit = name.trim().length > 0 && hullNumberOk;

    const handleSubmit = async (event: SyntheticEvent) => {
        event.preventDefault();
        if (!canSubmit || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onSubmit({ name: name.trim(), hullNumber, shipKind, color });
        } catch (failure) {
            // Занятый позывной или полный канал — это ответ бэкенда, а не поломка.
            setError(failure instanceof ChannelError ? failure.message : 'Не вышло. Попробуй ещё раз.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className={styles.card} onSubmit={handleSubmit}>
            <h1 className={styles.heading}>{mode === 'join' ? 'Встать в строй' : 'Переоснастить корабль'}</h1>
            {/* Название канала уже стоит в шапке над сценой, здесь только состав. */}
            <p className={styles.crew}>
                {crew.length ? `На связи: ${crew.join(', ')}` : 'На связи пока никого — ты первый'}
            </p>

            <label className={styles.field}>
                <span className={styles.label}>Позывной</span>
                <input
                    className={styles.input}
                    value={name}
                    maxLength={20}
                    placeholder="Гром"
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                />
            </label>

            <label className={styles.field}>
                <span className={styles.label}>Бортовой номер — {HULL_NUMBER_LENGTH} цифры</span>
                <input
                    className={hullNumber && !hullNumberOk ? styles.inputShortBad : styles.inputShort}
                    value={hullNumber}
                    maxLength={HULL_NUMBER_LENGTH}
                    inputMode="numeric"
                    autoComplete="off"
                    onChange={(event) => setHullNumber(event.target.value.replace(/\D/g, ''))}
                />
            </label>

            <div className={styles.field}>
                <span className={styles.label}>Цвет</span>
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
                    <span className={styles.colorPreview} style={{ color }}>
                        {name.trim() || 'Позывной'}
                    </span>
                </div>
            </div>

            <div className={styles.field}>
                <span className={styles.label}>Корабль</span>
                <div className={styles.kinds}>
                    {SHIP_KINDS.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            className={kind === shipKind ? styles.kindActive : styles.kind}
                            onClick={() => setShipKind(kind)}
                        >
                            <img className={styles.kindImage} src={SHIP_SPRITES[kind].url} alt="" />
                            <span className={styles.kindLabel}>{SHIP_KIND_LABELS[kind]}</span>
                            <span className={styles.kindSpec}>{shipSpecLine(kind)}</span>
                        </button>
                    ))}
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
                {onCancel && (
                    <Button variant="secondary" onClick={onCancel}>
                        Отмена
                    </Button>
                )}
                <Button type="submit" disabled={!canSubmit || busy}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}
