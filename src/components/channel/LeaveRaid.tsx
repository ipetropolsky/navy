import { useState } from 'react';

import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Input from '@/components/ui/Input';
import Sheet from '@/components/ui/Sheet';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LeaveIcon } from '@/components/ui/icons';
import { MAX_COURSE_LENGTH } from '@/types/channel';
import { limitMessage, overLimit } from '@/utils/limit';
import { isTouch } from '@/utils/viewport';

import styles from './LeaveRaid.module.less';

interface LeaveRaidProps {
    /** Уйти, назвав новый курс. Курс уже без крайних пробелов и точно не пустой. */
    onConfirm: (course: string) => void;
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
 * Показывают эту форму шторкой поверх списка кораблей (`cover`): уходят из списка, и человек,
 * передумав, ждёт вернуться ровно в него.
 */
export default function LeaveRaid({ onConfirm, onCancel }: LeaveRaidProps) {
    const [course, setCourse] = useState('');
    const notify = useSnackbar();

    const wanted = course.trim();

    const handleSubmit = () => {
        if (!wanted) {
            return;
        }
        // Перебор длины кнопку не гасит: недоступная кнопка молчит, а тут надо сказать,
        // насколько перебрали.
        if (overLimit(course, MAX_COURSE_LENGTH)) {
            notify(limitMessage(course, MAX_COURSE_LENGTH));
            return;
        }
        onConfirm(wanted);
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
                    <Button type="submit" disabled={!wanted}>
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
                        autoFocus={!isTouch()}
                        onChange={(event) => setCourse(event.target.value)}
                    />
                </Field>
            </div>
        </Sheet>
    );
}
