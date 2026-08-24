import { useState } from 'react';

import { Account, ChannelDraft, ChannelError } from '@/backend';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import IconButton from '@/components/ui/IconButton';
import Input from '@/components/ui/Input';
import Panel from '@/components/ui/Panel';
import { useSnackbar } from '@/components/ui/Snackbar';
import { LinkIcon } from '@/components/ui/icons';
import { channelLink } from '@/routing';
import { copyText } from '@/utils/clipboard';
import { limitMessage, overLimit } from '@/utils/limit';
import { SLUG_MAX_LENGTH, isValidSlug, slugify, slugifyInput } from '@/utils/slug';
import { isTouch } from '@/utils/viewport';
import { TITLE_MAX_LENGTH } from '@shared/types/channel';

import styles from './CreateChannel.module.less';

interface CreateChannelProps {
    onCreate: (draft: ChannelDraft) => Promise<void>;
    /** Адрес демо-канала: обычная ссылка, её видно и можно скопировать. */
    demoHref: string;
    /** Переход в демо без перезагрузки страницы. */
    onOpenDemo: () => void;
    /** Кто вошёл. Показывается мелко и только ему самому — в канале за человека говорит корабль. */
    account: Account | null;
    onSignOut: () => void;
}

/**
 * Главная сервиса: канал ещё не выбран, поэтому в море пусто — кораблей нет.
 * Отсюда два хода: завести свой канал связи или заглянуть в демо.
 */
export default function CreateChannel({ onCreate, demoHref, onOpenDemo, account, onSignOut }: CreateChannelProps) {
    const [title, setTitle] = useState('');
    // Адрес предлагаем из названия, но как только его правят руками, перестаём перебивать:
    // человек знает, чего хочет, а название он может ещё десять раз поменять.
    const [slug, setSlug] = useState('');
    const [slugEdited, setSlugEdited] = useState(false);
    const [busy, setBusy] = useState(false);
    const notify = useSnackbar();

    const handleTitleChange = (nextTitle: string) => {
        setTitle(nextTitle);
        if (!slugEdited) {
            setSlug(slugify(nextTitle));
        }
    };

    const handleSlugChange = (nextSlug: string) => {
        setSlugEdited(true);
        // Приводим к виду адреса прямо в поле: так сразу видно, что получится,
        // а набранная по привычке кириллица не пропадает, а транслитерируется.
        setSlug(slugifyInput(nextSlug));
    };

    const slugOk = isValidSlug(slug);
    const canSubmit = Boolean(title.trim()) && slugOk;

    const handleCopy = () => {
        void copyText(channelLink(slug)).then((done) =>
            notify(done ? 'Ссылка на канал скопирована' : 'Не вышло скопировать ссылку')
        );
    };

    const handleSubmit = async () => {
        if (!canSubmit || busy) {
            return;
        }
        // Перебор длины кнопку не гасит: недоступная кнопка молчит, а тут надо сказать,
        // насколько перебрали. Правило и слова общие со строкой сообщения (`@/utils/limit`).
        if (overLimit(title, TITLE_MAX_LENGTH)) {
            notify(limitMessage(title, TITLE_MAX_LENGTH));
            return;
        }
        setBusy(true);
        try {
            await onCreate({ slug, title: title.trim() });
        } catch (failure) {
            // Занятый адрес — ответ бэкенда: он один знает про все каналы. Говорим снекбаром,
            // чтобы отказ не раздвигал форму и не уводил кнопку из-под пальца.
            notify(failure instanceof ChannelError ? failure.message : 'Не вышло. Попробуй ещё раз.');
            setBusy(false);
        }
    };

    return (
        <Panel
            // Название сервиса уже стоит в шапке над сценой, здесь — про действие.
            title="Создать канал"
            hint="Заведи свой канал связи, поставь корабль на рейд и позови остальных, отправив им адрес."
            onSubmit={handleSubmit}
            actions={
                <Button type="submit" disabled={!canSubmit || busy}>
                    {busy ? 'Минуту…' : 'Создать канал'}
                </Button>
            }
            footer={
                <>
                    Или загляни в{' '}
                    {/* Ссылка настоящая: её видно в строке состояния, можно скопировать и открыть
                        в новой вкладке. Но обычный клик уводим в приложение — перезагружать страницу
                        незачем, а со сцены при этом слетают и анимация входа, и загруженные картинки.
                        Клик с модификатором и средней кнопкой не трогаем: человек метит в новую вкладку. */}
                    <a
                        className={styles.demoLink}
                        href={demoHref}
                        onClick={(event) => {
                            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                                return;
                            }
                            event.preventDefault();
                            onOpenDemo();
                        }}
                    >
                        демо-канал
                    </a>
                    {/* Кто вошёл — приписка, а не заголовок: имя и почта нужны здесь только
                        для того, чтобы человек убедился, что он это он, и мог выйти. */}
                    {account && (
                        <span className={styles.account}>
                            {`Вы вошли как ${account.name ?? account.email ?? 'моряк'}. `}
                            <button type="button" className={styles.signOut} onClick={onSignOut}>
                                Выйти
                            </button>
                        </span>
                    )}
                </>
            }
        >
            <Field label="Название">
                <Input
                    value={title}
                    half
                    maxLength={TITLE_MAX_LENGTH}
                    placeholder="Эскадра «Полночь»"
                    autoComplete="off"
                    // Пальцем — значит клавиатура экранная, и фокус выкинул бы её поверх формы.
                    autoFocus={!isTouch()}
                    onChange={(event) => handleTitleChange(event.target.value)}
                />
            </Field>

            <Field label="Адрес — латинские буквы, цифры и дефис">
                {/* Кнопка прилеплена к полю: сам адрес показывать негде — ссылка длинная,
                    а нужна она целиком и в буфере, а не на экране. */}
                <Input
                    value={slug}
                    invalid={Boolean(slug) && !slugOk}
                    half
                    maxLength={SLUG_MAX_LENGTH}
                    placeholder="eskadra-polnoch"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => handleSlugChange(event.target.value)}
                    action={
                        <IconButton
                            variant="inField"
                            onClick={handleCopy}
                            disabled={!slugOk}
                            aria-label="Скопировать ссылку на канал"
                            title="Скопировать ссылку на канал"
                        >
                            <LinkIcon size={19} />
                        </IconButton>
                    }
                />
            </Field>
        </Panel>
    );
}
