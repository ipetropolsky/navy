/**
 * Значки, которые встречаются больше одного раза.
 *
 * Каждый значок — десяток чисел в `path`, и списанный во второе место он расходится с первым
 * при первой же правке: подправили ссылку в поле создания канала — та же ссылка в шторке
 * осталась прежней. Здесь их общий вид, а размер каждое место просит своё: в кнопке шапки
 * значок ростом в 24, в кнопке с подписью — в 18.
 *
 * Значков в приложении больше, чем здесь: те, что стоят в одном-единственном месте, живут
 * прямо в разметке рядом со своей кнопкой. Переезжают они сюда, когда понадобятся во втором.
 */

interface IconProps {
    /** Рост значка в пикселях. Умолчание — под кнопку с подписью. */
    size?: number;
}

/**
 * Звено цепи: ссылка. Стоит везде, где ссылку копируют, — в поле адреса нового канала
 * и на «Координатах» в списке кораблей.
 */
export function LinkIcon({ size = 18 }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
            <path
                d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1 1M13.5 10.5a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

/**
 * Маячок: подать сигнал. Огонёк с расходящимися от него дугами — то же, что видно с чужого
 * борта, когда лампа замигала. Стоит на кнопке сигнала в карточке корабля.
 *
 * Дуги — половинки окружностей вокруг того же центра, что и огонёк: обе стороны выходят
 * зеркальными сами собой, без подгонки каждой точки.
 */
export function BeaconIcon({ size = 18 }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
            <circle cx="12" cy="12" r="2.5" fill="currentColor" />
            <path
                d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

/**
 * Крестик: закрыть выехавшее поверх. Стоит на шторке и на слое в блоке разговора — рисует его
 * `ui/CloseButton`, и больше нигде он не нужен.
 *
 * Ростом он крупнее прочих значков: крестик сидит в кнопке шапки, а не в кнопке с подписью.
 */
export function CloseIcon({ size = 22 }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
            <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
    );
}

/**
 * Стрелка из двери: уйти с рейда. Стоит на самой кнопке выхода, на её подтверждении
 * («Курс верный») и в шапке, пока открыта форма своего корабля.
 */
export function LeaveIcon({ size = 18 }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
            <path
                d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M13 12H21M18 8l4 4-4 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
            />
        </svg>
    );
}
