import pr1141Url from '@/assets/scene/ship-pr1141.png';
import pr1234Url from '@/assets/scene/ship-pr1234.png';
import pr12412Url from '@/assets/scene/ship-pr12412.png';
import pr1258Url from '@/assets/scene/ship-pr1258.png';
import pr1400Url from '@/assets/scene/ship-pr1400.png';
import pr201Url from '@/assets/scene/ship-pr201.png';
import pr205Url from '@/assets/scene/ship-pr205.png';
import { SHIP_SPECS, ShipKind, shipSizeShare } from '@/types/channel';

/**
 * Точка на спрайте — пиксели от левого верхнего угла картинки, в её собственном размере.
 * Пиксели, а не проценты, потому что отметки ставят по картинке: открыл спрайт, навёл курсор,
 * переписал числа. В разметку они переводятся в доли ширины и высоты и потому не зависят
 * от того, каким корабль вышел на экране.
 */
export interface SpritePoint {
    x: number;
    y: number;
}

/**
 * Огни корабля. Ходовые горят на ходу, якорные — на стоянке, и это разные фонари: топовый
 * светит только вперёд и потому круговым якорным быть не может, сколько его ни оставляй
 * включённым.
 */
export interface ShipLights {
    /** Сигнальная лампа: ею передают морзянку. К навигационным огням отношения не имеет. */
    signal: SpritePoint;
    /** Топовый белый: светит вперёд, стоит на передней части надстройки. */
    masthead: SpritePoint;
    /** Второй топовый: позади и выше первого. Обязателен на кораблях от 50 м. */
    mastheadAft: SpritePoint;
    /** Бортовой: красный, когда виден левый борт, зелёный — когда правый. */
    side: SpritePoint;
    /** Кормовой белый: светит назад. */
    stern: SpritePoint;
    /** Якорный носовой: белый круговой, в носовой части и выше кормового. */
    anchorFore: SpritePoint;
    /** Якорный кормовой: белый круговой, у кормы. Нужен на кораблях от 50 м. */
    anchorAft: SpritePoint;
}

export interface ShipSprite {
    url: string;
    /** Размер картинки в пикселях: в нём же заданы все отметки. */
    size: { width: number; height: number };
    /** Какую долю ширины слота занимает силуэт в сцене: см. shipSizeShare. */
    scale: number;
    /** Центр бортового номера. */
    hullNumber: SpritePoint;
    lights: ShipLights;
}

/**
 * Спрайты нарисованы носом влево; в сцене отражаем по горизонтали, если нужно наоборот.
 *
 * Рисунки проектов лежат в ветке `ships` (`src/assets/sources/ships`) вместе со справочником
 * ships.json. Оттуда сюда они попадают в три шага: обрезка по непрозрачным пикселям,
 * отражение (в источнике корабли смотрят вправо) и уменьшение до 1100px по ширине.
 *
 * Отметки сняты с картинок замером: линия палубы — там, где силуэт становится шириной
 * с корпус, передняя стенка надстройки — первый сплошной участок выше палубы, мачта — самая
 * высокая точка. Дальше их можно двигать руками: это просто числа.
 *
 * Размер в сцене у всех считается одинаково — по длине из справочника.
 */
export const SHIP_SPRITES: Record<ShipKind, ShipSprite> = {
    pr1234: {
        url: pr1234Url,
        size: { width: 1100, height: 393 },
        scale: shipSizeShare('pr1234'),
        hullNumber: { x: 242, y: 342 },
        lights: {
            signal: { x: 594, y: 14 },
            masthead: { x: 410, y: 200 },
            mastheadAft: { x: 594, y: 53 },
            side: { x: 408, y: 228 },
            stern: { x: 1055, y: 302 },
            anchorFore: { x: 594, y: 77 },
            anchorAft: { x: 1070, y: 297 },
        },
    },
    pr12412: {
        url: pr12412Url,
        size: { width: 1100, height: 387 },
        scale: shipSizeShare('pr12412'),
        hullNumber: { x: 242, y: 337 },
        lights: {
            signal: { x: 598, y: 10 },
            masthead: { x: 338, y: 229 },
            mastheadAft: { x: 598, y: 49 },
            side: { x: 371, y: 262 },
            stern: { x: 1055, y: 308 },
            anchorFore: { x: 598, y: 72 },
            anchorAft: { x: 1022, y: 274 },
        },
    },
    pr1141: {
        url: pr1141Url,
        size: { width: 1100, height: 385 },
        scale: shipSizeShare('pr1141'),
        hullNumber: { x: 242, y: 335 },
        lights: {
            signal: { x: 575, y: 23 },
            masthead: { x: 374, y: 205 },
            mastheadAft: { x: 575, y: 62 },
            side: { x: 407, y: 240 },
            stern: { x: 1058, y: 300 },
            anchorFore: { x: 575, y: 85 },
            anchorAft: { x: 905, y: 248 },
        },
    },
    pr201: {
        url: pr201Url,
        size: { width: 1100, height: 351 },
        scale: shipSizeShare('pr201'),
        hullNumber: { x: 242, y: 305 },
        lights: {
            signal: { x: 554, y: 54 },
            masthead: { x: 510, y: 150 },
            mastheadAft: { x: 554, y: 89 },
            side: { x: 385, y: 238 },
            stern: { x: 1055, y: 285 },
            anchorFore: { x: 554, y: 110 },
            anchorAft: { x: 1022, y: 271 },
        },
    },
    pr205: {
        url: pr205Url,
        size: { width: 1100, height: 356 },
        scale: shipSizeShare('pr205'),
        hullNumber: { x: 242, y: 310 },
        lights: {
            signal: { x: 518, y: 6 },
            masthead: { x: 439, y: 187 },
            mastheadAft: { x: 518, y: 42 },
            side: { x: 472, y: 212 },
            stern: { x: 1055, y: 257 },
            anchorFore: { x: 518, y: 63 },
            anchorAft: { x: 1040, y: 262 },
        },
    },
    pr1258: {
        url: pr1258Url,
        size: { width: 1100, height: 542 },
        scale: shipSizeShare('pr1258'),
        hullNumber: { x: 242, y: 488 },
        lights: {
            signal: { x: 536, y: 32 },
            masthead: { x: 304, y: 321 },
            mastheadAft: { x: 536, y: 86 },
            side: { x: 337, y: 384 },
            stern: { x: 1060, y: 455 },
            anchorFore: { x: 536, y: 119 },
            anchorAft: { x: 1030, y: 440 },
        },
    },
    pr1400: {
        url: pr1400Url,
        size: { width: 1100, height: 450 },
        scale: shipSizeShare('pr1400'),
        hullNumber: { x: 242, y: 401 },
        lights: {
            signal: { x: 686, y: 49 },
            masthead: { x: 658, y: 180 },
            mastheadAft: { x: 686, y: 94 },
            side: { x: 447, y: 268 },
            stern: { x: 1055, y: 354 },
            anchorFore: { x: 686, y: 121 },
            anchorAft: { x: 1022, y: 336 },
        },
    },
};

/**
 * От какой длины кораблю положены вторые огни: второй топовый на ходу и второй якорный
 * на стоянке. Ниже этого предела достаточно одного, а у совсем малых их и не ставят.
 */
export const TWO_LIGHTS_FROM_METRES = 50;

export const hasTwoLights = (kind: ShipKind): boolean => SHIP_SPECS[kind].length >= TWO_LIGHTS_FROM_METRES;
