import { useState } from 'react';

import { ChannelError } from '@/backend';
import Button from '@/components/ui/Button';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import { AccountMark } from '@/components/ui/icons';

/**
 * Плашка входа. Стоит на месте разговора там же, где стоят форма создания канала и форма
 * корабля, и устроена так же: заголовок, пояснение, одна кнопка. Ничего фирменного и яркого
 * в ней нет — знак одноцветный, в тон кнопке (см. `ui/icons`, `AccountMark`).
 *
 * Приписка под кнопкой говорит, каким аккаунтом входят, и умолчать об этом нельзя: по нажатию
 * откроется чужое окно с выбором аккаунта, и человек должен понимать, что сейчас произойдёт.
 * Сдержанность — это когда не кричат, а не когда не предупреждают.
 */

interface SignInProps {
    /** Зачем входить именно здесь: у главной и у канала по ссылке поводы разные. */
    hint: string;
    onSignIn: () => Promise<void>;
}

export default function SignIn({ hint, onSignIn }: SignInProps) {
    const notify = useSnackbar();
    const [busy, setBusy] = useState(false);

    const handleSignIn = async () => {
        if (busy) {
            return;
        }
        setBusy(true);
        try {
            await onSignIn();
        } catch (failure) {
            // Отказы входа разные, и человеку они говорят разное: окно закрыли сами,
            // окно не пустил браузер, связи нет (см. `backend/auth`).
            notify(failure instanceof ChannelError ? failure.message : 'Не вышло войти. Попробуйте ещё раз');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel
            title="Кто на связи"
            hint={hint}
            actions={
                <Button onClick={handleSignIn} disabled={busy}>
                    <AccountMark />
                    <span>{busy ? 'Минуту…' : 'Войти'}</span>
                </Button>
            }
            footer="Через аккаунт Google"
        />
    );
}
