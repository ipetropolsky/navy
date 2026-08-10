import corvetteUrl from '@/assets/scene/ship-corvette.png';
import frigateUrl from '@/assets/scene/ship-frigate.png';
import patrolUrl from '@/assets/scene/ship-patrol.png';
import pr1141Url from '@/assets/scene/ship-pr1141.png';
import pr1234Url from '@/assets/scene/ship-pr1234.png';
import pr12412Url from '@/assets/scene/ship-pr12412.png';
import pr1258Url from '@/assets/scene/ship-pr1258.png';
import pr1400Url from '@/assets/scene/ship-pr1400.png';
import pr201Url from '@/assets/scene/ship-pr201.png';
import pr205Url from '@/assets/scene/ship-pr205.png';
import { SHIP_SPECS, ShipKind } from '@/types/channel';

export interface ShipSprite {
    url: string;
    /** Размер картинки в пикселях: по нему считается место под силуэт в форме корабля. */
    size: { width: number; height: number };
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

/** Корабль, по которому меряются все остальные: у него в сцене масштаб 1. */
const SCALE_REFERENCE: ShipKind = 'corvette';

/** Размер в сцене по длине корабля: настоящий корвет вдвое длиннее катера — вдвое и рисуем. */
const scaleByLength = (kind: ShipKind): number =>
    Number((SHIP_SPECS[kind].length / SHIP_SPECS[SCALE_REFERENCE].length).toFixed(3));

/**
 * Спрайты нарисованы носом влево; в сцене отражаем по горизонтали, если нужно наоборот.
 *
 * Рисунки проектов лежат в ветке `ships` (`src/assets/sources/ships`) вместе со справочником
 * ships.json. Оттуда сюда они попадают в три шага: обрезка по непрозрачным пикселям,
 * отражение (в источнике корабли смотрят вправо) и уменьшение до 1100px по ширине.
 * Отметки лампы, огней и номера сняты с готовых картинок замером, а не на глаз.
 *
 * Пяти безномерным силуэтам рисунков досталось три на всех, поэтому размер им подобран
 * вручную. У проектов он считается по длине из справочника.
 */
export const SHIP_SPRITES: Record<ShipKind, ShipSprite> = {
    pr1234: {
        url: pr1234Url,
        size: { width: 1100, height: 393 },
        scale: scaleByLength('pr1234'),
        lamp: { x: 54, y: 1 },
        bowLight: { x: 5, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    pr12412: {
        url: pr12412Url,
        size: { width: 1100, height: 387 },
        scale: scaleByLength('pr12412'),
        lamp: { x: 54.4, y: 1 },
        bowLight: { x: 4, y: 85 },
        sternLight: { x: 98, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    pr1141: {
        url: pr1141Url,
        size: { width: 1100, height: 385 },
        scale: scaleByLength('pr1141'),
        lamp: { x: 37, y: 1 },
        bowLight: { x: 5, y: 85 },
        sternLight: { x: 96, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    pr201: {
        url: pr201Url,
        size: { width: 1100, height: 351 },
        scale: scaleByLength('pr201'),
        lamp: { x: 51.3, y: 1 },
        bowLight: { x: 5, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    pr205: {
        url: pr205Url,
        size: { width: 1100, height: 356 },
        scale: scaleByLength('pr205'),
        lamp: { x: 47.1, y: 1 },
        bowLight: { x: 5, y: 85 },
        sternLight: { x: 96, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    pr1258: {
        url: pr1258Url,
        size: { width: 1100, height: 542 },
        scale: scaleByLength('pr1258'),
        lamp: { x: 52.4, y: 1 },
        bowLight: { x: 4, y: 88 },
        sternLight: { x: 97, y: 88 },
        hullNumber: { x: 22, y: 90 },
    },
    pr1400: {
        url: pr1400Url,
        size: { width: 1100, height: 450 },
        scale: scaleByLength('pr1400'),
        lamp: { x: 62.5, y: 1 },
        bowLight: { x: 6, y: 87 },
        sternLight: { x: 98, y: 87 },
        hullNumber: { x: 22, y: 89 },
    },
    corvette: {
        url: corvetteUrl,
        size: { width: 1100, height: 366 },
        scale: 1,
        lamp: { x: 55.85, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 87 },
    },
    missile: {
        url: frigateUrl,
        size: { width: 1100, height: 337 },
        scale: 0.82,
        lamp: { x: 53.4, y: 1.3 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 23, y: 87 },
    },
    patrol: {
        url: patrolUrl,
        size: { width: 1100, height: 355 },
        scale: 0.68,
        lamp: { x: 55.5, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 86 },
    },
    minesweeper: {
        url: patrolUrl,
        size: { width: 1100, height: 355 },
        scale: 0.78,
        lamp: { x: 55.5, y: 1.2 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 22, y: 86 },
    },
    torpedo: {
        url: frigateUrl,
        size: { width: 1100, height: 337 },
        scale: 0.55,
        lamp: { x: 53.4, y: 1.3 },
        bowLight: { x: 6, y: 85 },
        sternLight: { x: 97, y: 85 },
        hullNumber: { x: 23, y: 87 },
    },
};
