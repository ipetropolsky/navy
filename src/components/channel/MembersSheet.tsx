import { ReactNode } from 'react';

import styles from './MembersSheet.module.less';

interface MembersSheetProps {
    open: boolean;
    onClose: () => void;
    /** Список кораблей: `MembersList`. */
    children: ReactNode;
}

/**
 * Список кораблей в обычном виде: шторка снизу поверх приложения, с затемнением и выездом.
 * Здесь только рамка вокруг списка — сам список живёт в `MembersList`, потому что в
 * полноэкранном виде его показывает большая шторка (`Shade`), а рамка у неё своя.
 */
export default function MembersSheet({ open, onClose, children }: MembersSheetProps) {
    if (!open) {
        return null;
    }

    return (
        <div className={styles.overlay}>
            <button type="button" className={styles.backdrop} onClick={onClose} aria-label="Закрыть" />
            <div className={styles.sheet} role="dialog" aria-label="Корабли на связи">
                <div className={styles.grip} />
                {children}
            </div>
        </div>
    );
}
