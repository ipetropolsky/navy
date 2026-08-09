/* eslint-disable no-restricted-syntax -- Обёртки browser-api-utils в проекте нет, а правило
   общего конфига бережёт от обращения к window при серверном рендеринге. Здесь статический SPA
   без SSR, и весь прямой доступ к хранилищам собран в этом файле — больше его нигде нет. */

/**
 * Хранилище браузера за одной дверью. Заодно они перестают падать: в приватном режиме
 * и при переполнении квоты запись бросает исключение, а чат из-за этого валиться не должен —
 * хуже, чем «не сохранилось», будет только белый экран.
 */

export const localStore = {
    read(key: string): string | null {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    write(key: string, value: string): void {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // Приватный режим или кончилась квота: продолжаем без записи.
        }
    },
    remove(key: string): void {
        try {
            window.localStorage.removeItem(key);
        } catch {
            // Нечего чистить — и не надо.
        }
    },
};
