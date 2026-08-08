export const TAU = Math.PI * 2;

const SIN_TABLE_SIZE = 4096;
const SIN_TABLE_MASK = SIN_TABLE_SIZE - 1;
const SIN_TABLE_SCALE = SIN_TABLE_SIZE / TAU;

const SIN_TABLE = new Float32Array(SIN_TABLE_SIZE);
for (let i = 0; i < SIN_TABLE_SIZE; i++) {
    SIN_TABLE[i] = Math.sin((i / SIN_TABLE_SIZE) * TAU);
}

/**
 * Синус по таблице с линейной интерполяцией: точности (~3e-7) с запасом хватает
 * для оттенков воды, а считается он в разы быстрее Math.sin.
 * Так же делали волны в 16-битных играх — только там таблица была целочисленной.
 */
export function fastSin(angle: number): number {
    const position = angle * SIN_TABLE_SCALE;
    const index = Math.floor(position);
    const fraction = position - index;
    // Размер таблицы — степень двойки, поэтому остаток берётся маской.
    // Она же корректно заворачивает отрицательные углы.
    /* eslint-disable no-bitwise -- дешёвый остаток по модулю в горячем цикле */
    const from = SIN_TABLE[index & SIN_TABLE_MASK];
    const to = SIN_TABLE[(index + 1) & SIN_TABLE_MASK];
    /* eslint-enable no-bitwise */
    return from + (to - from) * fraction;
}

export function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    return value > max ? max : value;
}

export function mix(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

/** Плавная ступенька: 0 до edgeFrom, 1 после edgeTo, сглаженный переход между ними. */
export function smoothstep(edgeFrom: number, edgeTo: number, value: number): number {
    if (edgeFrom === edgeTo) {
        return value < edgeFrom ? 0 : 1;
    }
    const normalized = clamp((value - edgeFrom) / (edgeTo - edgeFrom), 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
}
