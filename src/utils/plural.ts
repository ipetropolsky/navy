/**
 * Форма слова по числу: «1 узел», «2 узла», «5 узлов». Формы передаются в этом же порядке.
 *
 * Дробное число всегда берёт вторую форму — «16,5 узла», а не «16,5 узлов»: по-русски
 * дробь согласуется с долей, а не с целой частью.
 */
export const plural = (value: number, forms: [string, string, string]): string => {
    if (!Number.isInteger(value)) {
        return forms[1];
    }
    const hundreds = Math.abs(value) % 100;
    const tail = hundreds % 10;
    // Второй десяток — исключение: одиннадцать, двенадцать и далее берут последнюю форму.
    if (hundreds > 10 && hundreds < 20) {
        return forms[2];
    }
    if (tail > 1 && tail < 5) {
        return forms[1];
    }
    return tail === 1 ? forms[0] : forms[2];
};
