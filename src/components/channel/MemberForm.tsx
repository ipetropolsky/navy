import { KeyboardEvent, MouseEvent, PointerEvent, useRef, useState } from 'react';

import { ChannelError, MemberDraft } from '@/backend';
import MemberName from '@/components/ships/MemberName';
import ShipPortrait, { shipSpecLine } from '@/components/ships/ShipPortrait';
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
    ShipKind,
    Side,
    isValidHullNumber,
} from '@/types/channel';
import { limitMessage, overLimit } from '@/utils/limit';
import { Press, isTap, startPress } from '@/utils/tap';
import { isTouch } from '@/utils/viewport';

import styles from './MemberForm.module.less';

/**
 * Предел длины позывного. Он стоит над репликой в ленте и подписью у корабля в кадре,
 * и длинный расползся бы на всю строку. Мягкий, как и все пределы: набранное сверх него
 * не обрезается, а поле краснеет и отвечает снекбаром (см. `@/utils/limit`).
 */
const NAME_MAX_LENGTH = 20;

interface MemberFormProps {
    /** Вход в канал или переоснащение уже стоящего в строю корабля. */
    mode: 'join' | 'edit';
    /** Кто уже на связи: подсказка, а не проверка — проверяет бэкенд. */
    crew: Member[];
    /** Свой корабль, если он уже в строю: его цвет из занятых не исключаем. */
    myId: string | null;
    initial?: MemberDraft;
    /**
     * Каким цветом эта личность ходила в прошлый раз (`useChannel.lastLook`). Годится только
     * входящему: у стоящего в строю цвет свой, он приходит в `initial`. Занят на этом рейде —
     * берём первый свободный, как и без всякой памяти.
     */
    lastColor?: string;
    /**
     * Выбранный силуэт. Живёт снаружи: от размера корабля зависит, куда он влезет на рейде,
     * а свободные места показывает не форма, а сцена.
     */
    shipKind: ShipKind;
    onShipKind: (kind: ShipKind) => void;
    /**
     * Выбранный курс. Тоже снаружи и по той же причине: его показывает стрелка на воде,
     * и переставляют её оттуда же — нажатием на выбранное место. Держи форма курс у себя,
     * кнопки в ней и стрелка в кадре разошлись бы, показывая каждая своё.
     */
    facing: Side;
    onFacing: (side: Side) => void;
    onSubmit: (draft: MemberDraft) => Promise<void>;
    onCancel?: () => void;
    /**
     * Открыта ли форма. Закрытая — это та же форма, только свёрнутая до одной кнопки посреди
     * плашки: гость, зашедший по ссылке, попадает не в настройку корабля, а на рейд, который
     * можно просто разглядывать. Закрытым состоянием живёт только вход (`mode="join"`):
     * переоснащение открывают нажатием, и закрывать его нечему.
     *
     * Состояние формы при этом никуда не девается — набранный позывной и выбранный корабль
     * переживают закрытие: это одна и та же форма в двух видах, а не две разные.
     */
    open?: boolean;
    onOpen?: () => void;
}

const randomHullNumber = (): string => String(Math.floor(Math.random() * 900) + 100);

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
 * Корабль участника: силуэт, цвет, бортовой номер и позывной. Форма одна и та же
 * при входе и при переоснащении — меняются только заголовок и состав кнопок.
 *
 * У входа есть ещё и закрытый вид (`open={false}`): пустая плашка с одной кнопкой посреди.
 * Это не отдельный экран, а та же самая форма, свёрнутая до своего единственного вопроса, —
 * и потому набранное в ней закрытие переживает.
 */
export default function MemberForm({
    mode,
    crew,
    myId,
    initial,
    lastColor,
    shipKind,
    onShipKind,
    facing,
    onFacing,
    onSubmit,
    onCancel,
    open = true,
    onOpen,
}: MemberFormProps) {
    const takenColors = crew.filter((member) => member.memberId !== myId).map((member) => member.color);
    const [name, setName] = useState(initial?.name ?? '');
    const [hullNumber, setHullNumber] = useState(initial?.hullNumber ?? randomHullNumber);
    // Цвет по умолчанию — прошлый свой, если он на этом рейде свободен, иначе первый свободный:
    // два корабля одного цвета в ленте не различить.
    const freeColor = MEMBER_COLORS.find((option) => !takenColors.includes(option)) ?? MEMBER_COLORS[0];
    const [color, setColor] = useState(
        initial?.color ?? (lastColor && !takenColors.includes(lastColor) ? lastColor : freeColor)
    );
    const [busy, setBusy] = useState(false);
    // Отклик выбранного корабля: ткнули в кнопку — он мигнул лампой ровно так же, как чужой
    // корабль в кадре на тычок в аватарку. Держится он в состоянии, а не собирается на каждый
    // проход: лампа считает поводом новый объект, и собранный заново отклик передавал бы
    // без конца. Счётчик в seq — чтобы можно было ткнуть в тот же силуэт второй раз: сигнал
    // всегда один и тот же, и по нему двух нажатий не различить.
    const [reply, setReply] = useState<MorseFeed | null>(null);
    const notify = useSnackbar();

    /** С чего началось нажатие на плашку корабля: откуда и при каком выделении (см. `@/utils/tap`). */
    const pressRef = useRef<Press | null>(null);

    const chooseShip = (kind: ShipKind): void => {
        onShipKind(kind);
        setReply((prev) => ({ seq: (prev?.seq ?? 0) + 1, text: HAIL_SIGNAL }));
    };

    /**
     * Тычок по плашке — выбрать корабль. Но плашка почти целиком состоит из текста: название
     * и строчка характеристик, — и протяжка по ним значит «выделить и скопировать», а не
     * «выбрать». Отличаем одно от другого общим правилом (`isTap`).
     */
    const handleShipTap = (event: MouseEvent<HTMLDivElement>, kind: ShipKind): void => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!isTap(press, event)) {
            return;
        }
        chooseShip(kind);
    };

    // Плашка — не `button`, а `div` с ролью кнопки: из настоящей кнопки браузер не даёт выделить
    // текст вовсе, даже при `user-select: text`, и нажатие по ней не сбрасывает уже набранное
    // выделение. Значит, клавиатуру плашка отрабатывает сама — пробелом и вводом, как кнопка.
    const handleShipKey = (event: KeyboardEvent<HTMLDivElement>, kind: ShipKind): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            // Пробел иначе прокрутил бы форму, ввод — отправил её раньше времени.
            event.preventDefault();
            chooseShip(kind);
        }
    };

    const hullNumberOk = isValidHullNumber(hullNumber);
    // Надпись одна на оба случая: что при входе, что при переоснащении человек делает одно
    // и то же — заканчивает с формой. Что именно случится, уже написано в заголовке.
    const submitLabel = busy ? 'Минуту…' : 'Готово';
    const canSubmit = name.trim().length > 0 && hullNumberOk;

    const handleSubmit = async () => {
        if (!canSubmit || busy) {
            return;
        }
        // Перебор длины кнопку не гасит: недоступная кнопка молчит, а тут надо сказать,
        // насколько перебрали. Правило и слова общие со строкой сообщения (`@/utils/limit`).
        if (overLimit(name, NAME_MAX_LENGTH)) {
            notify(limitMessage(name, NAME_MAX_LENGTH));
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

    // Закрытая форма: на месте разговора одна кнопка, и больше на экране ничего не прибавилось.
    // Заголовка у плашки нет — его сказала бы та же строчка, что и написана на кнопке.
    if (!open) {
        return (
            <Panel>
                <div className={styles.gate}>
                    <Button onClick={onOpen}>Встать на рейд</Button>
                </div>
            </Panel>
        );
    }

    return (
        <Panel
            title={mode === 'join' ? 'Встать на рейд' : 'Настроить корабль'}
            // Состав здесь не перечисляем: пока форма открыта, занятые места на рейде подписаны
            // позывными, и то же самое второй раз строкой над формой — лишнее.
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
                    half
                    maxLength={NAME_MAX_LENGTH}
                    placeholder="Гром"
                    autoComplete="off"
                    // Пальцем — значит клавиатура экранная, и фокус выкинул бы её поверх формы.
                    autoFocus={!isTouch()}
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
                            onClick={() => onFacing(side)}
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
                        <div
                            key={kind}
                            role="button"
                            tabIndex={0}
                            aria-pressed={kind === shipKind}
                            className={kind === shipKind ? styles.kindActive : styles.kind}
                            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                                pressRef.current = startPress(event);
                            }}
                            onClick={(event) => handleShipTap(event, kind)}
                            onKeyDown={(event) => handleShipKey(event, kind)}
                        >
                            {/* Портрет — общий с карточкой чужого корабля (ShipPortrait):
                                силуэт в своём масштабе и линейка под ним.

                                Выбранный корабль стоит под парами: у него горят ходовые огни,
                                у остальных — якорные. Так и видно, который из них сейчас твой,
                                и разница между двумя наборами огней заодно показана вживую,
                                а не описана словами. Отклик лампой достаётся тоже ему одному,
                                и номер на борту — тоже: набранный выше, он стоит на выбранном
                                корпусе ровно там же и того же размера, каким будет виден
                                в кадре. На всех сразу он читался бы как часть рисунка, а так
                                видно, как номер сядет именно на этот борт. */}
                            <ShipPortrait
                                kind={kind}
                                hullNumber={kind === shipKind ? hullNumber : ''}
                                facing={facing}
                                mode={kind === shipKind ? 'underway' : 'anchored'}
                                morseFeed={kind === shipKind ? reply : null}
                            />
                            <span className={styles.kindLabel}>{SHIP_KIND_LABELS[kind]}</span>
                            <span className={styles.kindSpec}>{shipSpecLine(kind)}</span>
                        </div>
                    ))}
                </div>
            </Field>
        </Panel>
    );
}
