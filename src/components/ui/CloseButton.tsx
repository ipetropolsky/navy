import IconButton from '@/components/ui/IconButton';
import { CloseIcon } from '@/components/ui/icons';

import styles from './CloseButton.module.less';

/**
 * Крестик в углу выехавшего поверх: шторки (`ui/Shade`) и слоя в блоке разговора (список
 * кораблей). Выход этот один и тот же, и выглядеть он обязан одинаково — иначе в одном месте
 * он окажется вполголоса, а в другом крупнее кнопок шапки рядом.
 *
 * Своих чисел у него нет: где он сидит и какого он роста, говорит хозяин переменными
 * (`.close-metrics()`, см. close.less). Хозяин же и решает, быть ли ему вовсе: у шторки,
 * которую закрывают только ответом на вопрос, крестика может не быть.
 */
export default function CloseButton({ onClick }: { onClick: () => void }) {
    return (
        <div className={styles.close}>
            <IconButton variant="muted" onClick={onClick} aria-label="Закрыть">
                <CloseIcon />
            </IconButton>
        </div>
    );
}
