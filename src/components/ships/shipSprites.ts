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
import { SHIP_KINDS, SHIP_SPECS, ShipKind } from '@/types/channel';

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
    /** Относительный размер в сцене (крупный корабль = 1). */
    scale: number;
    /** Центр бортового номера. */
    hullNumber: SpritePoint;
    lights: ShipLights;
}

/**
 * Сколько метров в единице масштаба сцены. Мерка взята по самому длинному кораблю
 * справочника: он занимает свой слот целиком, остальные — свою долю от него. То же правило,
 * что и в списке кораблей, только там доля от ширины кнопки, а здесь — от ширины слота.
 *
 * Привязывать мерку к конкретному кораблю нельзя: стоит ему стать короче, и вся сцена
 * поедет вместе со скоростями. А вот «самый длинный» — это правило, и оно держит масштаб
 * на месте: сцена всегда занята кораблями настолько, насколько может.
 */
export const SCENE_SCALE_LENGTH = Math.max(...SHIP_KINDS.map((kind) => SHIP_SPECS[kind].length));

/** Размер в сцене по длине корабля: настоящий корвет вдвое длиннее катера — вдвое и рисуем. */
const scaleByLength = (kind: ShipKind): number => Number((SHIP_SPECS[kind].length / SCENE_SCALE_LENGTH).toFixed(3));

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
 * Размер в сцене у всех считается одинаково — по длине из справочника. Раньше пяти
 * безномерным силуэтам он подбирался на глаз, и рядом с проектами это стало видно:
 * девятнадцатиметровый катер выходил в кадре крупнее сорокаметрового.
 */
export const SHIP_SPRITES: Record<ShipKind, ShipSprite> = {
    pr1234: {
        url: pr1234Url,
        size: { width: 1100, height: 393 },
        scale: scaleByLength('pr1234'),
        hullNumber: { x: 242, y: 342 },
        lights: {
            signal: { x: 594, y: 6 },
            masthead: { x: 311, y: 225 },
            mastheadAft: { x: 594, y: 56 },
            side: { x: 344, y: 254 },
            stern: { x: 1055, y: 302 },
            anchorFore: { x: 594, y: 85 },
            anchorAft: { x: 1022, y: 265 },
        },
    },
    pr12412: {
        url: pr12412Url,
        size: { width: 1100, height: 387 },
        scale: scaleByLength('pr12412'),
        hullNumber: { x: 242, y: 337 },
        lights: {
            signal: { x: 598, y: 6 },
            masthead: { x: 338, y: 229 },
            mastheadAft: { x: 598, y: 58 },
            side: { x: 371, y: 262 },
            stern: { x: 1055, y: 308 },
            anchorFore: { x: 598, y: 87 },
            anchorAft: { x: 1022, y: 274 },
        },
    },
    pr1141: {
        url: pr1141Url,
        size: { width: 1100, height: 385 },
        scale: scaleByLength('pr1141'),
        hullNumber: { x: 242, y: 335 },
        lights: {
            signal: { x: 407, y: 5 },
            masthead: { x: 374, y: 205 },
            mastheadAft: { x: 407, y: 53 },
            side: { x: 407, y: 240 },
            stern: { x: 1055, y: 288 },
            anchorFore: { x: 407, y: 80 },
            anchorAft: { x: 1022, y: 251 },
        },
    },
    pr201: {
        url: pr201Url,
        size: { width: 1100, height: 351 },
        scale: scaleByLength('pr201'),
        hullNumber: { x: 242, y: 305 },
        lights: {
            signal: { x: 564, y: 5 },
            masthead: { x: 220, y: 158 },
            mastheadAft: { x: 564, y: 54 },
            side: { x: 253, y: 244 },
            stern: { x: 1055, y: 285 },
            anchorFore: { x: 564, y: 81 },
            anchorAft: { x: 1022, y: 255 },
        },
    },
    pr205: {
        url: pr205Url,
        size: { width: 1100, height: 356 },
        scale: scaleByLength('pr205'),
        hullNumber: { x: 242, y: 310 },
        lights: {
            signal: { x: 518, y: 5 },
            masthead: { x: 439, y: 187 },
            mastheadAft: { x: 518, y: 47 },
            side: { x: 472, y: 212 },
            stern: { x: 1055, y: 257 },
            anchorFore: { x: 518, y: 70 },
            anchorAft: { x: 1022, y: 221 },
        },
    },
    pr1258: {
        url: pr1258Url,
        size: { width: 1100, height: 542 },
        scale: scaleByLength('pr1258'),
        hullNumber: { x: 242, y: 488 },
        lights: {
            signal: { x: 576, y: 9 },
            masthead: { x: 304, y: 321 },
            mastheadAft: { x: 576, y: 85 },
            side: { x: 337, y: 384 },
            stern: { x: 1054, y: 447 },
            anchorFore: { x: 576, y: 128 },
            anchorAft: { x: 1021, y: 401 },
        },
    },
    pr1400: {
        url: pr1400Url,
        size: { width: 1100, height: 450 },
        scale: scaleByLength('pr1400'),
        hullNumber: { x: 242, y: 401 },
        lights: {
            signal: { x: 688, y: 7 },
            masthead: { x: 445, y: 265 },
            mastheadAft: { x: 688, y: 67 },
            side: { x: 478, y: 300 },
            stern: { x: 1055, y: 354 },
            anchorFore: { x: 688, y: 100 },
            anchorAft: { x: 1022, y: 313 },
        },
    },
    corvette: {
        url: corvetteUrl,
        size: { width: 1100, height: 366 },
        scale: scaleByLength('corvette'),
        hullNumber: { x: 242, y: 318 },
        lights: {
            signal: { x: 614, y: 6 },
            masthead: { x: 409, y: 216 },
            mastheadAft: { x: 614, y: 55 },
            side: { x: 442, y: 246 },
            stern: { x: 1054, y: 289 },
            anchorFore: { x: 614, y: 83 },
            anchorAft: { x: 1021, y: 257 },
        },
    },
    missile: {
        url: frigateUrl,
        size: { width: 1100, height: 337 },
        scale: scaleByLength('missile'),
        hullNumber: { x: 253, y: 293 },
        lights: {
            signal: { x: 587, y: 6 },
            masthead: { x: 410, y: 192 },
            mastheadAft: { x: 587, y: 50 },
            side: { x: 443, y: 222 },
            stern: { x: 1054, y: 263 },
            anchorFore: { x: 587, y: 75 },
            anchorAft: { x: 1021, y: 232 },
        },
    },
    patrol: {
        url: patrolUrl,
        size: { width: 1100, height: 355 },
        scale: scaleByLength('patrol'),
        hullNumber: { x: 242, y: 305 },
        lights: {
            signal: { x: 610, y: 6 },
            masthead: { x: 424, y: 198 },
            mastheadAft: { x: 610, y: 52 },
            side: { x: 457, y: 229 },
            stern: { x: 1054, y: 272 },
            anchorFore: { x: 610, y: 77 },
            anchorAft: { x: 1021, y: 239 },
        },
    },
    minesweeper: {
        url: patrolUrl,
        size: { width: 1100, height: 355 },
        scale: scaleByLength('minesweeper'),
        hullNumber: { x: 242, y: 305 },
        lights: {
            signal: { x: 610, y: 6 },
            masthead: { x: 424, y: 198 },
            mastheadAft: { x: 610, y: 52 },
            side: { x: 457, y: 229 },
            stern: { x: 1054, y: 272 },
            anchorFore: { x: 610, y: 77 },
            anchorAft: { x: 1021, y: 239 },
        },
    },
    torpedo: {
        url: frigateUrl,
        size: { width: 1100, height: 337 },
        scale: scaleByLength('torpedo'),
        hullNumber: { x: 253, y: 293 },
        lights: {
            signal: { x: 587, y: 6 },
            masthead: { x: 410, y: 192 },
            mastheadAft: { x: 587, y: 50 },
            side: { x: 443, y: 222 },
            stern: { x: 1054, y: 263 },
            anchorFore: { x: 587, y: 75 },
            anchorAft: { x: 1021, y: 232 },
        },
    },
};

/**
 * От какой длины кораблю положены вторые огни: второй топовый на ходу и второй якорный
 * на стоянке. Ниже этого предела достаточно одного, а у совсем малых их и не ставят.
 */
export const TWO_LIGHTS_FROM_METRES = 50;

export const hasTwoLights = (kind: ShipKind): boolean => SHIP_SPECS[kind].length >= TWO_LIGHTS_FROM_METRES;
