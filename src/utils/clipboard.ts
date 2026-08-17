/**
 * Копирование в буфер обмена. Буфер доступен не везде — например, в iframe без разрешения
 * или по http, — поэтому ответ приходит признаком успеха, а не исключением: вызывающему
 * нужно решить, что показать человеку, а не разбирать ошибку.
 */
export const copyText = (text: string): Promise<boolean> => {
    if (!navigator.clipboard) {
        return Promise.resolve(false);
    }
    return navigator.clipboard
        .writeText(text)
        .then(() => true)
        .catch(() => false);
};
