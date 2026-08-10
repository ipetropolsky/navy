import { SyntheticEvent, useState } from 'react';

import { ChannelDraft, ChannelError } from '@/backend';
import { useSnackbar } from '@/components/ui/Snackbar';
import { channelLink } from '@/routing';
import { copyText } from '@/utils/clipboard';
import { SLUG_MAX_LENGTH, isValidSlug, slugify, slugifyInput } from '@/utils/slug';

import styles from './CreateChannel.module.less';

interface CreateChannelProps {
    onCreate: (draft: ChannelDraft) => Promise<void>;
    /** Адрес демо-канала: обычная ссылка, её видно и можно скопировать. */
    demoHref: string;
    /** Переход в демо без перезагрузки страницы. */
    onOpenDemo: () => void;
}

/**
 * Главная сервиса: канал ещё не выбран, поэтому в море пусто — кораблей нет.
 * Отсюда два хода: завести свой канал связи или заглянуть в демо.
 */
export default function CreateChannel({ onCreate, demoHref, onOpenDemo }: CreateChannelProps) {
    const [title, setTitle] = useState('');
    // Адрес предлагаем из названия, но как только его правят руками, перестаём перебивать:
    // человек знает, чего хочет, а название он может ещё десять раз поменять.
    const [slug, setSlug] = useState('');
    const [slugEdited, setSlugEdited] = useState(false);
    const [error, setError] = useState<string | null>(null);
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

    const handleSubmit = async (event: SyntheticEvent) => {
        event.preventDefault();
        if (!canSubmit || busy) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await onCreate({ slug, title: title.trim() });
        } catch (failure) {
            // Занятый адрес — ответ бэкенда: он один знает про все каналы.
            setError(failure instanceof ChannelError ? failure.message : 'Не вышло. Попробуй ещё раз.');
            setBusy(false);
        }
    };

    return (
        <form className={styles.card} onSubmit={handleSubmit}>
            {/* Название сервиса уже стоит в шапке над сценой, здесь — про действие. */}
            <h1 className={styles.heading}>Создать канал</h1>
            <p className={styles.hint}>
                Заведи свой канал связи, поставь корабль на рейд и позови остальных, отправив им адрес.
            </p>

            <label className={styles.field}>
                <span className={styles.label}>Название канала</span>
                <input
                    className={styles.input}
                    value={title}
                    maxLength={40}
                    placeholder="Эскадра «Полночь»"
                    autoComplete="off"
                    autoFocus
                    onChange={(event) => handleTitleChange(event.target.value)}
                />
            </label>

            <label className={styles.field}>
                <span className={styles.label}>Адрес канала — латинские буквы и дефис</span>
                {/* Кнопка прилеплена к полю: сам адрес показывать негде — ссылка длинная,
                    а нужна она целиком и в буфере, а не на экране. */}
                <span className={styles.inputRow}>
                    <input
                        className={slug && !slugOk ? styles.inputBad : styles.input}
                        value={slug}
                        maxLength={SLUG_MAX_LENGTH}
                        placeholder="eskadra-polnoch"
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => handleSlugChange(event.target.value)}
                    />
                    <button
                        type="button"
                        className={styles.copy}
                        onClick={handleCopy}
                        disabled={!slugOk}
                        aria-label="Скопировать ссылку на канал"
                        title="Скопировать ссылку на канал"
                    >
                        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                            <path
                                d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1 1M13.5 10.5a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1-1"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                            />
                        </svg>
                    </button>
                </span>
            </label>

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.primary} disabled={!canSubmit || busy}>
                {busy ? 'Минуту…' : 'Создать канал'}
            </button>

            <p className={styles.demo}>
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
            </p>
        </form>
    );
}
