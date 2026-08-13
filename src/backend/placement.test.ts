import { describe, expect, test } from 'vitest';

import { ISLAND_FREE_SLOT, ISLAND_SIDE, ShipKind, otherSide } from '@/types/channel';

import { placeShip } from '@/backend/placement';

/**
 * Заход на рейд: с какой стороны корабль приходит и куда встаёт носом. Правило счётное,
 * и расклад на входе известный — это работа для юнита, а не для браузера.
 *
 * Случайность в расстановке есть (`Math.random` в противовесе сторон и в выборе места),
 * но сюда она не достаёт: место передаётся готовым, а сторона у боковых коридоров считается
 * правилом, а не жребием. Единственное место, где жребий остаётся, — центральный коридор,
 * и его мы проверяем только на то, что сторона и курс не спорят друг с другом.
 */

/** Средний корабль справочника: влезает на любой слот. */
const KIND: ShipKind = 'pr201';

/** Ближняя половина рейда, где остров уже не помеха. */
const NEAR = 8;

describe('заход на рейд', () => {
    test('в боковой коридор корабль заходит снаружи и встаёт носом к середине кадра', () => {
        // Курса не назвали — значит, решает коридор. В левый заходят слева и встают носом
        // вправо, в правый — наоборот. Кораблю, приткнувшемуся к краю кадра носом наружу,
        // смотреть было бы не на что: за носом обрез, весь рейд за кормой.
        const toLeft = placeShip(KIND, [], { slot: NEAR, corridor: 'left', left: 22.1 });
        expect(toLeft).toMatchObject({ corridor: 'left', enterFrom: 'left', facing: 'right' });
        const toRight = placeShip(KIND, [], { slot: NEAR, corridor: 'right', left: 77.9 });
        expect(toRight).toMatchObject({ corridor: 'right', enterFrom: 'right', facing: 'left' });
    });

    test('курс из формы главнее правила: как выбрали, так корабль и встанет', () => {
        // Человек в форме выбирает курс сам, и это выбор, а не пожелание. Сторона захода
        // тогда считается от курса: заходят носом вперёд, то есть с противоположного борта.
        const place = placeShip(KIND, [], { slot: NEAR, corridor: 'left', left: 22.1 }, 'left');
        expect(place).toMatchObject({ facing: 'left', enterFrom: 'right' });
    });

    test('на дальних слотах заходят только со стороны, свободной от берега', () => {
        // Слева остров, и подойти оттуда нельзя ни при каком курсе. Корабль с курсом на остров
        // подходит с чистой стороны задним ходом — это видно по тому, что нос смотрит туда же,
        // откуда он пришёл.
        const far = ISLAND_FREE_SLOT - 1;
        const clean = otherSide(ISLAND_SIDE);
        const place = placeShip(KIND, [], { slot: far, corridor: 'center', left: 50 }, ISLAND_SIDE);
        expect(place).toMatchObject({ enterFrom: clean, facing: ISLAND_SIDE });
    });

    test('без курса корабль всегда заходит носом вперёд', () => {
        // Центральный коридор — единственный, где сторону решает жребий. Что бы он ни выпал,
        // курс обязан быть от него: корабль заходит носом вперёд, а не боком.
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const place = placeShip(KIND, [], { slot: NEAR, corridor: 'center', left: 50 });
            expect(place?.facing).toBe(otherSide(place!.enterFrom));
        }
    });
});
