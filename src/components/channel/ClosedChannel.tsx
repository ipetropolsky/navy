import { useState } from 'react';

import { ChannelError } from '@/backend';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Input from '@/components/ui/Input';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import { isTouch } from '@/utils/viewport';
import { ACCESS_CODE_MAX_LENGTH } from '@shared/types/channel';
import { limitMessage, overLimit } from '@shared/utils/limit';

/**
 * Закрытая частота. Стоит на месте разговора там же, где вход и форма постановки в строй,
 * и устроена так же — заголовок, поле, одна кнопка. Показывается вместо них, пока канал
 * закрыт (`channel.closed`) и код ещё не подтверждён (см. `needsCode` в App.tsx).
 *
 * Код здесь ничего не запирает по-настоящему — это подсказка человеку, а не проверка
 * (см. `checkAccessCode` в src/backend/types.ts): по-настоящему код сверяет сервер заново
 * уже при самой постановке в строй. Неверный код отвечает тем же отказом, что и она.
 */

interface ClosedChannelProps {
    /** Проверить код на сервере. Отказ — `ChannelError('channel-closed', …)`, показываем снекбаром. */
    onCheck: (code: string) => Promise<void>;
}

export default function ClosedChannel({ onCheck }: ClosedChannelProps) {
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const notify = useSnackbar();

    const handleSubmit = async () => {
        if (!code.trim() || busy) {
            return;
        }
        // Перебор длины кнопку не гасит: недоступная кнопка молчит, а тут надо сказать,
        // насколько перебрали. Правило и слова общие со строкой сообщения (`@shared/utils/limit`).
        if (overLimit(code, ACCESS_CODE_MAX_LENGTH)) {
            notify(limitMessage(code, ACCESS_CODE_MAX_LENGTH));
            return;
        }
        setBusy(true);
        try {
            await onCheck(code.trim());
        } catch (failure) {
            notify(failure instanceof ChannelError ? failure.message : 'Не вышло. Попробуйте ещё раз.');
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Закрытая частота"
            hint="Код доступа спросите у старшего на рейде."
            onSubmit={handleSubmit}
            actions={
                <Button type="submit" disabled={!code.trim() || busy}>
                    {busy ? 'Минуту…' : 'Войти'}
                </Button>
            }
        >
            <Field label="Код доступа">
                <Input
                    value={code}
                    maxLength={ACCESS_CODE_MAX_LENGTH}
                    placeholder="Код доступа"
                    autoComplete="off"
                    // Пальцем — значит клавиатура экранная, и фокус выкинул бы её поверх формы.
                    autoFocus={!isTouch()}
                    onChange={(event) => setCode(event.target.value)}
                />
            </Field>
        </Panel>
    );
}
