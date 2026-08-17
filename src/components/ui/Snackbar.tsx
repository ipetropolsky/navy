import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import styles from './Snackbar.module.less';

/**
 * Снекбар — короткое уведомление внизу экрана, как в мессенджерах: «скопировано»,
 * «отправлено», «не вышло». Показывается сам, гаснет сам, ничего не спрашивает и ничем
 * не перекрывает работу. Всё, что от него нужно снаружи, — одна функция:
 *
 *     const notify = useSnackbar();
 *     notify('Ссылка на канал скопирована');
 *
 * Сообщение одно за раз: следующее вытесняет предыдущее. Очередь тут не нужна — уведомления
 * редкие и по делу, а копить их значило бы показывать человеку то, что уже неактуально.
 */

/** Сколько сообщение висит, прежде чем начать гаснуть. */
const SHOW_MS = 3000;

/** Сколько длится проявление и угасание. Должно совпадать с длительностью в стилях. */
const FADE_MS = 220;

interface Toast {
    /** Свой у каждого сообщения: по нему перезапускается анимация появления. */
    id: number;
    text: string;
    /** Уже гаснет: держим в разметке, пока идёт анимация ухода. */
    leaving: boolean;
}

const SnackbarContext = createContext<(text: string) => void>(() => undefined);

/** Показать уведомление. Работает в любом месте под SnackbarProvider. */
export const useSnackbar = (): ((text: string) => void) => useContext(SnackbarContext);

export function SnackbarProvider({ children }: { children: ReactNode }) {
    const [toast, setToast] = useState<Toast | null>(null);
    const seqRef = useRef(0);

    const notify = useCallback((text: string) => {
        seqRef.current += 1;
        setToast({ id: seqRef.current, text, leaving: false });
    }, []);

    // Сначала выдержка, потом угасание — двумя шагами, чтобы уходящее сообщение успело
    // доиграть анимацию, а не пропало из разметки на середине.
    useEffect(() => {
        if (!toast) {
            return undefined;
        }
        const timer = window.setTimeout(
            () =>
                setToast((current) => {
                    if (current?.id !== toast.id) {
                        return current;
                    }
                    return current.leaving ? null : { ...current, leaving: true };
                }),
            toast.leaving ? FADE_MS : SHOW_MS
        );
        return () => window.clearTimeout(timer);
    }, [toast]);

    return (
        <SnackbarContext.Provider value={notify}>
            {children}
            {toast && (
                // key — чтобы новое сообщение проявилось заново, а не подменило текст на месте.
                <div key={toast.id} className={toast.leaving ? styles.snackbarLeaving : styles.snackbar} role="status">
                    {toast.text}
                </div>
            )}
        </SnackbarContext.Provider>
    );
}
