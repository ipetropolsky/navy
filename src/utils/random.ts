/**
 * Случайный выбор: взять один из набора и перемешать набор.
 *
 * Отдельным файлом, потому что случайность нужна двоим и по разным поводам: расстановке —
 * чтобы строй не выглядел построенным, демо-каналу — чтобы витрина каждый раз выглядела
 * иначе. Ничего специфического ни для того, ни для другого тут нет.
 */

/** Один из набора, равновероятно. Набор пустым не бывает — на пустом вернётся undefined. */
export const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** Тот же набор в случайном порядке. Исходный не трогаем: перемешивается копия. */
export const shuffled = <T>(items: T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

/** Целое из отрезка, оба конца включительно. */
export const pickBetween = (from: number, to: number): number => from + Math.floor(Math.random() * (to - from + 1));
