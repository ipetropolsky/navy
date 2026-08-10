/**
 * Slug — адрес канала в ссылке: `?channel=eskadra-polnoch`. Ссылку пересылают друг другу
 * и набирают руками, поэтому в ней только строчные латинские буквы, цифры и дефис
 * между словами.
 *
 * Slug — не идентификатор. Основной идентификатор канала (channelId) отдельный и неизменный,
 * а адрес можно переназначить, и ссылки от этого не должны разъезжаться внутри системы.
 *
 * Русское название в адрес не годится — в ссылке оно превратилось бы в проценты, — поэтому
 * предлагаем транслитерацию: «Эскадра «Полночь»» → `eskadra-polnoch`.
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SLUG_MAX_LENGTH = 40;

/** Годится ли строка в адрес: строчные латинские буквы и цифры, дефис — между словами. */
export const isValidSlug = (value: string): boolean => SLUG_PATTERN.test(value) && value.length <= SLUG_MAX_LENGTH;

// Пары «буква — замена» одной строкой: ключами-кириллицей объект заводить нельзя,
// имена свойств в проекте только латинские. Мягкий и твёрдый знаки пропадают.
const TRANSLIT_PAIRS =
    'а=a б=b в=v г=g д=d е=e ё=e ж=zh з=z и=i й=y к=k л=l м=m н=n о=o п=p р=r с=s т=t у=u ф=f х=h ц=ts ч=ch ш=sh щ=sch ъ= ы=y ь= э=e ю=yu я=ya';

const TRANSLIT = new Map<string, string>(
    TRANSLIT_PAIRS.split(' ').map((pair) => {
        const [from, to] = pair.split('=');
        return [from, to ?? ''];
    })
);

const transliterate = (value: string): string =>
    value
        .toLowerCase()
        .split('')
        .map((char) => TRANSLIT.get(char) ?? char)
        .join('')
        .replace(/[^a-z0-9]+/g, '-');

/**
 * Превращает название в адрес: транслитерирует, всё лишнее заменяет дефисом, лишние дефисы
 * схлопывает. Результат может оказаться пустым — например, если в названии одни знаки
 * препинания, — и тогда предлагать нечего, пусть вводят руками.
 */
export const slugify = (title: string): string =>
    transliterate(title)
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_MAX_LENGTH)
        .replace(/-+$/g, '');

/**
 * То же самое, но для набора руками. Отличие одно: дефис на конце остаётся, иначе его
 * нельзя было бы поставить — он исчезал бы сразу после нажатия, до следующей буквы.
 * Кириллицу тоже транслитерируем: набрал «Норд» — получил `nord`, а не пустоту.
 */
export const slugifyInput = (value: string): string =>
    transliterate(value).replace(/^-+/, '').slice(0, SLUG_MAX_LENGTH);
