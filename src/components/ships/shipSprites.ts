import corvetteUrl from '@/assets/scene/ship-corvette.png';
import frigateUrl from '@/assets/scene/ship-frigate.png';
import patrolUrl from '@/assets/scene/ship-patrol.png';
import { ShipKind } from '@/types/channel';

export interface ShipSprite {
    url: string;
    /** Относительный размер в сцене (крупный корабль = 1). */
    scale: number;
    /** Сигнальная лампа — верхняя точка мачты, % от размеров спрайта. */
    lamp: { x: number; y: number };
    /** Ходовые огни на носу и корме, % от размеров спрайта. */
    bowLight: { x: number; y: number };
    sternLight: { x: number; y: number };
    /** Центр бортового номера, % от размеров спрайта. */
    hullNumber: { x: number; y: number };
}

// Спрайты нарисованы носом влево; в сцене отражаем по горизонтали, если нужно наоборот.
// Пока картинок три, поэтому пять типов кораблей используют их с разным масштабом.
export const SHIP_SPRITES: Record<ShipKind, ShipSprite> = {
    corvette: {
        url: corvetteUrl,
        scale: 1,
        lamp: { x: 55.85, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    missile: {
        url: frigateUrl,
        scale: 0.82,
        lamp: { x: 53.4, y: 1.3 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 23, y: 87 },
    },
    patrol: {
        url: patrolUrl,
        scale: 0.68,
        lamp: { x: 55.5, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 86 },
    },
    minesweeper: {
        url: patrolUrl,
        scale: 0.78,
        lamp: { x: 55.5, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 86 },
    },
    torpedo: {
        url: frigateUrl,
        scale: 0.55,
        lamp: { x: 53.4, y: 1.3 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 23, y: 87 },
    },
};
