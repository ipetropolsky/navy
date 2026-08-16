import { describe, expect, test } from 'vitest';

import { Corridor, ISLAND_FREE_SLOT, ISLAND_SIDE, ShipKind, otherSide, shipWidthPercent } from '@/types/channel';

import { Anchored, fleetLefts, placeShip } from '@/backend/placement';

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

/**
 * Расхождение тесных соседей. Считается оно чистой функцией от состава кадра — ни экрана,
 * ни времени тут не нужно, — и потому проверяется юнитом. Браузеру остаётся то, чего в числах
 * не увидеть: что корпуса в кадре и правда не налезли друг на друга.
 */

/** Корабль в кадре: место да силуэт, больше расхождению ничего не нужно. */
const anchored = (memberId: string, slot: number, corridor: Corridor, kind: ShipKind, joinedAt = 0): Anchored => ({
    memberId,
    joinedAt,
    shipKind: kind,
    // `left` тут для полноты места: расхождение считает точку само, от слота, коридора
    // и позывного, — сохранённое число оно не читает вовсе.
    place: { slot, corridor, left: 50, facing: 'left', enterFrom: 'right' },
});

/** Налезли ли корпуса: сравниваем расстояние между серединами с полусуммой ширин. */
const overlap = (fleet: Anchored[]): boolean => {
    const left = fleetLefts(fleet);
    return fleet.some((one) =>
        fleet.some(
            (other) =>
                one.memberId !== other.memberId &&
                one.place.slot === other.place.slot &&
                Math.abs(left[one.memberId] - left[other.memberId]) <
                    (shipWidthPercent(one.place.slot, one.shipKind) +
                        shipWidthPercent(other.place.slot, other.shipKind)) /
                        2
        )
    );
};

describe('расхождение тесных соседей', () => {
    test('уступают оба, и никто не остаётся под чужим корпусом', () => {
        // Катер и корабль в полсотни метров, вставшие на одну линию. Расходятся оба: мелкий
        // отдаёт всё, что у него есть, — на этой линии ему до кромки поля ближе, чем нужно
        // воды, — а остаток добирает крупный.
        const small = anchored('malysh', NEAR, 'left', 'pr1400');
        const big = anchored('grom', NEAR, 'center', 'pr1141');
        const together = fleetLefts([small, big]);
        expect(together[small.memberId], 'мелкий не тронулся с места').not.toBeCloseTo(
            fleetLefts([small])[small.memberId],
            3
        );
        expect(together[big.memberId], 'крупный не добрал остаток').not.toBeCloseTo(fleetLefts([big])[big.memberId], 3);
        expect(overlap([small, big]), 'корпуса налезли друг на друга').toBe(false);
    });

    test('уходящий сосед давит на место, пока он в кадре', () => {
        // Уходящий корабль виден в кадре ещё полминуты после того, как снялся с рейда,
        // и всё это время он занимает своё место: сосед, отошедший от него, обязан стоять
        // отжатым, а не идти обратно ему под корпус.
        const staying = anchored('malysh', NEAR, 'left', 'pr1400');
        const leaving = anchored('grom', NEAR, 'center', 'pr1141');
        const pressed = fleetLefts([staying, leaving], new Set([leaving.memberId]));
        expect(pressed[staying.memberId], 'сосед отпустил резинку раньше, чем уходящий отошёл').toBeCloseTo(
            fleetLefts([staying, leaving])[staying.memberId],
            3
        );
        expect(pressed[staying.memberId], 'уходящий перестал занимать своё место').not.toBeCloseTo(
            fleetLefts([staying])[staying.memberId],
            3
        );
    });

    test('уходящий уступает счёт, когда его место занял новичок', () => {
        // Трое на одной линии бывают только так: один снялся с рейда и ещё идёт к кромке,
        // а его место занял новичок — в тот же коридор, потому что оно освободилось. Воды
        // на линии на троих может и не быть, и разводить приходится тех двоих, кто на ней
        // останется: уходящий сейчас уйдёт, и стоять с ними ему незачем.
        const staying = anchored('malysh', NEAR, 'left', 'pr1141', 1);
        const leaving = anchored('grom', NEAR, 'center', 'pr1400', 2);
        const joined = anchored('novik', NEAR, 'center', 'pr1400', 3);
        const line = [staying, leaving, joined];
        const lefts = fleetLefts(line, new Set([leaving.memberId]));
        expect(lefts[joined.memberId], 'новичок не разошёлся с тем, кто остаётся').toBe(
            fleetLefts([staying, joined])[joined.memberId]
        );
        expect(overlap(line.filter((ship) => ship !== leaving)), 'корпуса налезли друг на друга').toBe(false);
    });
});
