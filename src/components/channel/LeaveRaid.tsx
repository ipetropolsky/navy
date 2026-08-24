import { KeyboardEvent, MouseEvent, PointerEvent, useRef, useState } from 'react';

import Avatar from '@/components/ships/Avatar';
import MemberName from '@/components/ships/MemberName';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Input from '@/components/ui/Input';
import Sheet from '@/components/ui/Sheet';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LeaveIcon } from '@/components/ui/icons';
import { limitMessage, overLimit } from '@/utils/limit';
import { Press, isTap, startPress } from '@/utils/tap';
import { isTouch } from '@/utils/viewport';
import { MAX_COURSE_LENGTH, Member } from '@shared/types/channel';

import styles from './LeaveRaid.module.less';

interface LeaveRaidProps {
    /**
     * Остальные на рейде — без своего корабля. Нужны только тогда, когда уходит сам старший
     * и на рейде остаётся кто-то ещё: выбирать преемника есть из кого.
     */
    others: Member[];
    /** Уходящий сейчас — старший на рейде. */
    iAmSenior: boolean;
    /**
     * Уйти, назвав новый курс. Курс уже без крайних пробелов и точно не пустой.
     * `nextOwnerId` приходит, только если преемника выбрали, — не выбрали, или выбор
     * вовсе не спрашивали, и здесь `undefined`.
     */
    onConfirm: (course: string, nextOwnerId?: string) => void;
    /** Остаться на рейде. */
    onCancel: () => void;
}

/**
 * Прощание с рейдом: куда корабль пошёл.
 *
 * Спрашивается это не из вежливости. Уход с рейда — единственное действие в канале, которое
 * ничего после себя не оставляет: корабль пропадает из кадра и из списка, и остальным виден
 * только пустой рейд. Новый курс и есть то, что от ушедшего остаётся, — им и подписана
 * строчка о его уходе в ленте.
 *
 * Поэтому поле обязательное: без курса уходить некуда, и кнопка ухода до него недоступна.
 * Ограничение длины общее со всеми полями приложения — набранное сверх предела не обрезается,
 * поле краснеет, а насколько перебрали, говорит снекбар по нажатию (см. `@/utils/limit`).
 *
 * Уходит старший, а на рейде остаётся кто-то ещё, — тем же движением предлагаем выбрать
 * и преемника: иначе старшинство всегда доставалось бы тому, кто дольше всех на рейде,
 * без разбора, годится ли ему эта роль. Поле необязательное — это выбор, а не требование:
 * не выбрали никого, и остаётся то же прежнее правило, старшинство отходит самому давнему.
 * Рядовому и последнему на рейде спрашивать некого — там выбор либо не про него, либо
 * отдавать некому, — и поле не показывается вовсе.
 *
 * Показывают эту форму шторкой поверх списка кораблей (`cover`): уходят из списка, и человек,
 * передумав, ждёт вернуться ровно в него.
 */
export default function LeaveRaid({ others, iAmSenior, onConfirm, onCancel }: LeaveRaidProps) {
    const [course, setCourse] = useState('');
    const [nextOwnerId, setNextOwnerId] = useState<string | null>(null);
    const notify = useSnackbar();

    /** С чего началось нажатие на строчку преемника (см. `@/utils/tap`). */
    const pressRef = useRef<Press | null>(null);

    const needsSuccessor = iAmSenior && others.length > 0;
    const wanted = course.trim();
    // Преемник не входит в готовность: выбор ему предлагают, а не требуют — не выбрали,
    // и бэкенд сам передаст старшинство тому, кто дольше всех на рейде, тем же правилом,
    // что действовало и до этой формы.
    const ready = Boolean(wanted);

    const chooseSuccessor = (memberId: string): void => setNextOwnerId(memberId);

    const handleRowTap = (event: MouseEvent<HTMLDivElement>, memberId: string): void => {
        const press = pressRef.current;
        pressRef.current = null;
        if (!isTap(press, event)) {
            return;
        }
        chooseSuccessor(memberId);
    };

    const handleRowKey = (event: KeyboardEvent<HTMLDivElement>, memberId: string): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            chooseSuccessor(memberId);
        }
    };

    const handleSubmit = () => {
        if (!ready) {
            return;
        }
        // Перебор длины кнопку не гасит: недоступная кнопка молчит, а тут надо сказать,
        // насколько перебрали.
        if (overLimit(course, MAX_COURSE_LENGTH)) {
            notify(limitMessage(course, MAX_COURSE_LENGTH));
            return;
        }
        onConfirm(wanted, nextOwnerId ?? undefined);
    };

    return (
        <Sheet
            title={<h2 className={styles.title}>Вы уходите с рейда</h2>}
            /* Уход стоит первым, потому что за ним сюда и пришли: шторка открылась нажатием
               на выход, и подтверждение — продолжение того же движения. «Полный назад»
               рядом второй кнопкой и уводит обратно в список — туда же, куда крестик
               и нажатие мимо шторки. */
            actions={
                <>
                    <Button type="submit" disabled={!ready}>
                        <LeaveIcon />
                        <span>Курс верный</span>
                    </Button>
                    <Button variant="secondary" onClick={onCancel}>
                        Полный назад
                    </Button>
                </>
            }
            onSubmit={handleSubmit}
        >
            {/* Преемник — первым: это то самое решение, ради которого шторка спрашивает больше
                одного поля, и курс логичнее набирать после него, а не до. */}
            {needsSuccessor && (
                <Field label="Кто останется старшим" group>
                    <div className={styles.successors}>
                        {others.map((member) => (
                            <div
                                key={member.memberId}
                                role="button"
                                tabIndex={0}
                                aria-pressed={member.memberId === nextOwnerId}
                                aria-label={`Оставить старшим «${member.name}»`}
                                className={member.memberId === nextOwnerId ? styles.successorActive : styles.successor}
                                onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
                                    pressRef.current = startPress(event);
                                }}
                                onClick={(event) => handleRowTap(event, member.memberId)}
                                onKeyDown={(event) => handleRowKey(event, member.memberId)}
                            >
                                <Avatar number={member.hullNumber} />
                                <MemberName name={member.name} color={member.color} />
                            </div>
                        ))}
                    </div>
                </Field>
            )}
            {/* Подписи к полю хватает: «Задайте новый курс» говорит ровно то же, что говорила
                бы объясняющая строчка над ним, и повторять её значило бы не доверять человеку. */}
            <div className={styles.course}>
                <Field label="Задайте новый курс">
                    <Input
                        value={course}
                        maxLength={MAX_COURSE_LENGTH}
                        placeholder="В Кронштадт, на зимовку"
                        autoComplete="off"
                        // Пальцем — значит клавиатура экранная, и фокус выкинул бы её поверх шторки.
                        // Преемника при этом спрашивают раньше — там же есть куда ставить фокус
                        // самим выбором, а поле курса остаётся точкой входа для всех остальных.
                        autoFocus={!needsSuccessor && !isTouch()}
                        onChange={(event) => setCourse(event.target.value)}
                    />
                </Field>
            </div>
        </Sheet>
    );
}
