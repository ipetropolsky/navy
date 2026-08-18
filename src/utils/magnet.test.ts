import { describe, expect, test } from 'vitest';

import { MAGNET_PULL, MAGNET_THROW_MS, normalizeMagnets, settleMagnet } from '@/utils/magnet';

/**
 * Магнитные точки шторки. Проверять их руками — занятие безнадёжное: обе половины механики
 * (какие точки остались и куда шторка приедет) считаются числами, а видно только результат —
 * шторка встала не туда. Поэтому здесь их и держим, отдельно от e2e: та проверяет, что шторка
 * вообще слушается пальца, а эта — что слушается по правилам.
 *
 * Строгостей у магнита две (`pointsOnly`), и проверяются они порознь: шторка встаёт только
 * на точки, боковая панель — куда её поставили, а точки ей только помогают прицелиться.
 */

describe('normalizeMagnets', () => {
    test('проценты меряются от хода, пиксели остаются собой', () => {
        expect(normalizeMagnets([0, '33%', '66%', '100%'], 900)).toEqual([0, 297, 594, 900]);
        expect(normalizeMagnets([0, 300, 400], 900)).toEqual([0, 300, 400]);
    });

    test('точки идут по порядку, повторы уходят', () => {
        expect(normalizeMagnets(['100%', 0, '50%', 450], 900)).toEqual([0, 450, 900]);
    });

    test('точка за пределом хода прижимается к пределу', () => {
        // «Не мельче трёхсот» на экране в двести — это «во весь рост», а не «такого
        // положения нет».
        expect(normalizeMagnets([0, 300], 200)).toEqual([0, 200]);
        expect(normalizeMagnets([-50, '150%'], 400)).toEqual([0, 400]);
    });

    test('из двух сошедшихся остаётся та, у которой соседи ровнее', () => {
        // Пример из описания механики: сошлись 375 и 400, уходит 375 — у неё до соседей
        // 75 и 175, а у 400 ровнее, 100 и 150.
        expect(normalizeMagnets([550, 400, 375, 300], 600)).toEqual([300, 400, 550]);
    });

    test('на краю остаётся крайняя: пределы шкалы не двигаются внутрь', () => {
        expect(normalizeMagnets([550, 500, 400, 300], 600)).toEqual([300, 400, 550]);
        expect(normalizeMagnets([0, 50, 400], 600)).toEqual([0, 400]);
    });

    test('тесноту разбирают по одной паре, начиная с самой тесной', () => {
        // 300 и 340 сошлись теснее, чем 340 и 420, — и разбирается сперва первая пара.
        // Убрав 340, вторая пара распадается сама: до 420 от 300 уже сто двадцать.
        expect(normalizeMagnets([300, 340, 420], 600)).toEqual([300, 420]);
    });

    test('мерка тесноты своя у каждой шторки', () => {
        expect(normalizeMagnets([0, 60, 200], 600, 40)).toEqual([0, 60, 200]);
        expect(normalizeMagnets([0, 60, 200], 600, 300)).toEqual([0, 200]);
    });

    test('одна точка остаётся одна, ни с кем не спорит', () => {
        expect(normalizeMagnets(['100%'], 300)).toEqual([300]);
    });

    test('без заданных точек шторка получает обычные две: закрыта и по содержимому', () => {
        expect(normalizeMagnets([], 300)).toEqual([0, 300]);
    });
});

/** Точки разговора в вертикальной раскладке при ходе в 900px. */
const CHAT = [0, 300, 600, 900];

describe('settleMagnet со строгими точками', () => {
    test('без точек шторка остаётся там, где её отпустили', () => {
        expect(settleMagnet({ from: 900, to: 640, velocity: 0, points: [], pointsOnly: true })).toBe(640);
    });

    test('своя точка держит, пока не пройдена доля пути к соседней', () => {
        // Доля от трёхсот — 105 точек: на сто четыре шторка ещё держится, на сто шесть уходит.
        expect(settleMagnet({ from: 600, to: 496, velocity: 0, points: CHAT, pointsOnly: true })).toBe(600);
        expect(settleMagnet({ from: 600, to: 494, velocity: 0, points: CHAT, pointsOnly: true })).toBe(300);
    });

    test('дотянутая до соседней точки шторка на ней и останавливается', () => {
        expect(settleMagnet({ from: 600, to: 300, velocity: 0, points: CHAT, pointsOnly: true })).toBe(300);
        expect(settleMagnet({ from: 300, to: 600, velocity: 0, points: CHAT, pointsOnly: true })).toBe(600);
    });

    test('усилие проносит шторку мимо точек: чем сильнее, тем мимо большего числа', () => {
        // Палец ушёл всего на полсотни точек — своей точки шторке не покинуть, — но быстро,
        // и дальше она летит сама.
        const short = { from: 900, to: 850, points: CHAT, pointsOnly: true };
        expect(settleMagnet({ ...short, velocity: 0 })).toBe(900);
        expect(settleMagnet({ ...short, velocity: -1 })).toBe(600);
        expect(settleMagnet({ ...short, velocity: -3 })).toBe(300);
        expect(settleMagnet({ ...short, velocity: -6 })).toBe(0);
    });

    test('инерция считается тем же временем полёта, что и объявлено', () => {
        // Отпущенная на 700 со скоростью 1px/мс шторка долетает до 700 + 150, то есть
        // до самой точки 850 — и на ней встаёт.
        const points = [0, 850];
        expect(settleMagnet({ from: 0, to: 700, velocity: 1, points, pointsOnly: true })).toBe(700 + MAGNET_THROW_MS);
    });

    test('инерция не уносит шторку за пределы шкалы', () => {
        expect(settleMagnet({ from: 300, to: 880, velocity: 5, points: CHAT, pointsOnly: true })).toBe(900);
        expect(settleMagnet({ from: 300, to: 20, velocity: -5, points: CHAT, pointsOnly: true })).toBe(0);
    });

    test('рывок назад отменяет уход: считается место полёта, а не пальца', () => {
        // Палец ушёл вниз за половину пути, но в последний миг дёрнулся обратно — шторка
        // возвращается туда, откуда её взяли.
        expect(settleMagnet({ from: 600, to: 460, velocity: 1, points: CHAT, pointsOnly: true })).toBe(600);
    });

    test('между точками шторка не встаёт никогда', () => {
        // Куда бы палец ни привёл, ответом будет одна из точек: посередине шторке стоять негде.
        for (const to of [320, 450, 470, 610, 880]) {
            expect(CHAT).toContain(settleMagnet({ from: 900, to, velocity: 0, points: CHAT, pointsOnly: true }));
        }
    });

    test('две точки — это обычное «открыта или закрыта»', () => {
        // Ровно то, чем шторка жила до всяких магнитов: утянул больше трети — закрылась.
        const shade = { from: 400, points: [0, 400], pointsOnly: true };
        expect(settleMagnet({ ...shade, to: 260, velocity: 0 })).toBe(0);
        expect(settleMagnet({ ...shade, to: 280, velocity: 0 })).toBe(400);
        // А короткий и сильный рывок закрывает её и с полусотни пикселей.
        expect(settleMagnet({ ...shade, to: 350, velocity: -2 })).toBe(0);
    });
});

/** Точки боковой панели на широком окне: убрать, треть, упор в мерку кадра. */
const SIDE = [0, 467, 800];

describe('settleMagnet со свободной шкалой', () => {
    test('поставленная вдали от точек панель там и остаётся', () => {
        expect(settleMagnet({ from: 467, to: 527, velocity: 0, points: SIDE })).toBe(527);
        expect(settleMagnet({ from: 467, to: 640, velocity: 0, points: SIDE })).toBe(640);
    });

    test('подведённая к точке вплотную к ней и дотягивается', () => {
        // Мерка притяжения — 32 точки, и считается она от места приземления в обе стороны.
        expect(settleMagnet({ from: 800, to: 467 + MAGNET_PULL, velocity: 0, points: SIDE })).toBe(467);
        expect(settleMagnet({ from: 800, to: 467 - MAGNET_PULL, velocity: 0, points: SIDE })).toBe(467);
        expect(settleMagnet({ from: 800, to: 467 + MAGNET_PULL + 1, velocity: 0, points: SIDE })).toBe(
            467 + MAGNET_PULL + 1
        );
    });

    test('место, с которого панель взяли, ни на что не влияет', () => {
        // Своей точки, которая держала бы, у свободной шкалы нет: с любой стороны один ответ.
        expect(settleMagnet({ from: 0, to: 600, velocity: 0, points: SIDE })).toBe(600);
        expect(settleMagnet({ from: 800, to: 600, velocity: 0, points: SIDE })).toBe(600);
    });

    test('крайние точки остаются пределами: за них панель не выходит', () => {
        expect(settleMagnet({ from: 467, to: 1200, velocity: 0, points: SIDE })).toBe(800);
        expect(settleMagnet({ from: 467, to: -200, velocity: 0, points: SIDE })).toBe(0);
    });

    test('брошенная панель встаёт там, куда долетела', () => {
        // Полсотни точек пальцем и разгон в 1px/мс: 600 + 150 — и это вдали от всех точек.
        expect(settleMagnet({ from: 467, to: 600, velocity: 1, points: SIDE })).toBe(600 + MAGNET_THROW_MS);
        // А брошенная к кромке долетает до предела и уходит с экрана.
        expect(settleMagnet({ from: 467, to: 300, velocity: -5, points: SIDE })).toBe(0);
    });

    test('ширина отдаётся целыми пикселями', () => {
        expect(settleMagnet({ from: 467, to: 600.4, velocity: 0.001, points: SIDE })).toBe(601);
    });
});
