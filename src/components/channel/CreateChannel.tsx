import { SyntheticEvent, useState } from 'react';

import { ChannelDraft, ChannelError } from '@/backend';
import { SLUG_MAX_LENGTH, isValidSlug, slugify, slugifyInput } from '@/utils/slug';

import styles from './CreateChannel.module.less';

interface CreateChannelProps {
    onCreate: (draft: ChannelDraft) => Promise<void>;
    /** Адрес демо-канала: обычная ссылка, её видно и можно скопировать. */
    demoHref: string;
}

/**
 * Главная сервиса: канал ещё не выбран, поэтому в море пусто — кораблей нет.
 * Отсюда два хода: завести свой канал связи или заглянуть в демо.
 */
export default function CreateChannel({ onCreate, demoHref }: CreateChannelProps) {
    const [title, setTitle] = useState('');
    // Адрес предлагаем из названия, но как только его правят руками, перестаём перебивать:
    // человек знает, чего хочет, а название он может ещё десять раз поменять.
    const [slug, setSlug] = useState('');
    const [slugEdited, setSlugEdited] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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
            <h1 className={styles.heading}>Канал связи</h1>
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
                <input
                    className={slug && !slugOk ? styles.inputBad : styles.input}
                    value={slug}
                    maxLength={SLUG_MAX_LENGTH}
                    placeholder="eskadra-polnoch"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => handleSlugChange(event.target.value)}
                />
                {/* Сразу показываем, какой получится ссылка: её и придётся пересылать. */}
                <span className={styles.preview}>{slugOk ? `?channel=${slug}` : 'по этому адресу канал и найдут'}</span>
            </label>

            {error && <div className={styles.error}>{error}</div>}

            <button type="submit" className={styles.primary} disabled={!canSubmit || busy}>
                {busy ? 'Минуту…' : 'Создать канал'}
            </button>

            <p className={styles.demo}>
                Или загляни в{' '}
                <a className={styles.demoLink} href={demoHref}>
                    демо-канал
                </a>
            </p>
        </form>
    );
}
