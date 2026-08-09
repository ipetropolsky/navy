import { SyntheticEvent, useState } from 'react';

import styles from './CreateChannel.module.less';

interface CreateChannelProps {
    onCreate: (title: string) => Promise<void>;
    /** Адрес демо-канала: обычная ссылка, её видно и можно скопировать. */
    demoHref: string;
}

/**
 * Главная сервиса: канал ещё не выбран, поэтому в море пусто — кораблей нет.
 * Отсюда два хода: завести свой канал связи или заглянуть в демо.
 */
export default function CreateChannel({ onCreate, demoHref }: CreateChannelProps) {
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const handleSubmit = async (event: SyntheticEvent) => {
        event.preventDefault();
        if (!title.trim() || busy) {
            return;
        }
        setBusy(true);
        try {
            await onCreate(title.trim());
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className={styles.card} onSubmit={handleSubmit}>
            <h1 className={styles.heading}>Кильватер</h1>
            <p className={styles.hint}>
                Канал связи — это эскадра. Заведи свой, поставь в строй корабль и позови остальных, отправив им адрес.
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
                    onChange={(event) => setTitle(event.target.value)}
                />
            </label>
            <button type="submit" className={styles.primary} disabled={!title.trim() || busy}>
                {busy ? 'Минуту…' : 'Создать канал'}
            </button>
            <p className={styles.demo}>
                Или загляни в демо-канал с начатым разговором:
                <a className={styles.demoLink} href={demoHref}>
                    {demoHref}
                </a>
            </p>
        </form>
    );
}
