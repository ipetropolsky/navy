import { ShipKind } from '@/types/chat';

export interface ShipShape {
    /** Основной силуэт корпуса (нос смотрит вправо). */
    hull: string;
    /** Надстройки и прочие заливаемые детали. */
    details: string[];
    /** Мачты, стрелы, стволы — рисуются штрихом. */
    strokes: string[];
    /** Точка сигнальной лампы (верхняя точка мачты). */
    lamp: { x: number; y: number };
    bowLight: { x: number; y: number };
    sternLight: { x: number; y: number };
    /** Базовая линия названия на борту. */
    nameY: number;
}

export const SHIP_VIEWBOX = { width: 260, height: 100 };

export const SHIP_SHAPES: Record<ShipKind, ShipShape> = {
    patrol: {
        hull: 'M10 88 L16 66 L248 66 L237 88 Z',
        details: [
            'M62 66 L62 48 L150 48 L150 66 Z',
            'M80 48 L80 36 L124 36 L124 48 Z',
            'M176 66 L176 58 L198 58 L198 66 Z',
        ],
        strokes: ['M102 36 L102 14', 'M94 22 L110 22'],
        lamp: { x: 102, y: 12 },
        bowLight: { x: 240, y: 61 },
        sternLight: { x: 20, y: 61 },
        nameY: 81,
    },
    missile: {
        hull: 'M10 88 L18 64 L246 64 L234 88 Z',
        details: [
            'M96 64 L96 42 L168 42 L168 64 Z',
            'M112 42 L112 32 L150 32 L150 42 Z',
            'M40 64 L50 46 L66 46 L58 64 Z',
            'M64 64 L74 46 L90 46 L82 64 Z',
        ],
        strokes: ['M132 32 L132 12', 'M124 19 L140 19'],
        lamp: { x: 132, y: 10 },
        bowLight: { x: 238, y: 59 },
        sternLight: { x: 22, y: 59 },
        nameY: 80,
    },
    minesweeper: {
        hull: 'M12 88 L18 64 L242 64 L230 88 Z',
        details: ['M70 64 L70 44 L170 44 L170 64 Z', 'M90 44 L90 32 L132 32 L132 44 Z'],
        strokes: ['M110 32 L110 14', 'M103 20 L117 20', 'M38 64 L54 32', 'M54 32 L44 26'],
        lamp: { x: 110, y: 12 },
        bowLight: { x: 234, y: 59 },
        sternLight: { x: 24, y: 59 },
        nameY: 80,
    },
    corvette: {
        hull: 'M8 88 L14 62 L172 62 L240 50 L252 52 L240 88 Z',
        details: [
            'M70 62 L70 40 L152 40 L152 62 Z',
            'M86 40 L86 28 L122 28 L122 40 Z',
            'M132 40 L132 26 L146 26 L146 40 Z',
            'M186 58 L186 50 L206 50 L206 58 Z',
        ],
        strokes: ['M104 28 L104 8', 'M96 15 L112 15', 'M206 53 L224 48'],
        lamp: { x: 104, y: 6 },
        bowLight: { x: 244, y: 47 },
        sternLight: { x: 16, y: 57 },
        nameY: 80,
    },
    torpedo: {
        hull: 'M14 88 L22 70 L240 70 L226 88 Z',
        details: ['M100 70 L100 56 L148 56 L148 70 Z', 'M38 70 L38 62 L92 62 L92 70 Z'],
        strokes: ['M124 56 L124 38', 'M117 44 L131 44'],
        lamp: { x: 124, y: 36 },
        bowLight: { x: 232, y: 65 },
        sternLight: { x: 26, y: 65 },
        nameY: 82,
    },
};
