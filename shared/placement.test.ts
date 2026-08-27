import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
    Berth,
    CORRIDORS,
    Corridor,
    ISLAND_FREE_SLOT,
    ISLAND_SIDE,
    SHIP_KINDS,
    SLOT_COUNT,
    ShipKind,
    Side,
    otherSide,
    shipWidthPercent,
} from './types/channel';

import {
    Anchored,
    EDGE_MARGIN,
    Standing,
    berthAt,
    fleetLefts,
    freeBerths,
    freeCorridors,
    isBerthFree,
    nearestBerth,
    placeShip,
    preferredBerths,
    restingDrift,
    restingLeft,
    restingYaw,
    suggestBerth,
} from './placement';

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

/** Самый длинный корабль справочника: его тянет к дальнему краю рейда. */
const BIG: ShipKind = 'pr1234';

/** Самый короткий: его тянет к переднему плану, и рядом с ним помещается кто угодно. */
const SMALL: ShipKind = 'pr1400';

/** Ближняя половина рейда, где остров уже не помеха. */
const NEAR = 8;

/**
 * Чужой корабль на рейде, каким его видит расстановка: место да силуэт. Курс и сторона захода
 * тут для полноты — ни один запрет их не читает.
 */
const standing = (slot: number, corridor: Corridor, kind: ShipKind = SMALL): Standing => ({
    shipKind: kind,
    place: { ...berthAt(slot, corridor), facing: 'left', enterFrom: 'right' },
});

/**
 * Места одной строчкой, по возрастанию. Порядок в ответах расстановки случайный — она
 * нарочно перемешивает набор, — поэтому сравнивать их можно только составом.
 */
const spots = (berths: Berth[]): string[] => berths.map((berth) => `${berth.slot}:${berth.corridor}`).sort();

/** Все места на этих дальностях в этих коридорах — так короче перечислять ожидаемое. */
const spread = (slots: number[], corridors: Corridor[]): Berth[] =>
    slots.flatMap((slot) => corridors.map((corridor) => berthAt(slot, corridor)));

/**
 * Рейд, на котором свободны только тесные места: дальние слоты держит остров да по кораблю
 * на каждом, ближние заняты парами, а на слоте 3 стоит один — и оба оставшихся места на нём
 * соседям в затылок: в центре сосед на слоте 2, справа — на слоте 4.
 */
const CROWDED_RAID: Standing[] = [
    standing(0, 'center'),
    standing(1, 'center'),
    standing(2, 'center'),
    standing(3, 'left'),
    ...[4, 5, 6, 7, 8, 9].flatMap((slot) => [standing(slot, 'center'), standing(slot, 'right')]),
];

/** Тот же рейд, занятый до последнего места. */
const FULL_RAID: Standing[] = [...CROWDED_RAID, standing(3, 'center')];

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
 * Запреты рейда: куда встать нельзя вовсе. Это сердце расстановки — на `freeCorridors`
 * стоят и свободные места на воде, и выбор случайного места, и проверка выбранного в форме, —
 * и спрашивать про запреты `placeShip` значило бы смотреть на ответ, в который случай
 * подмешал ещё три склонности.
 */
describe('запреты рейда', () => {
    test('место соседа занято, а та же полоса на соседней линии — нет', () => {
        // На линии сосед в центре: его коридор занят — точка на воде у них была бы одна
        // на двоих. А вот соседняя линия того же коридора не запрещена: это теснота,
        // и разбирается она при выборе, а не здесь.
        const taken = [standing(NEAR, 'center')];
        expect([...freeCorridors(NEAR, KIND, taken)].sort()).toEqual(['left', 'right']);
        expect([...freeCorridors(NEAR - 1, KIND, taken)].sort()).toEqual(['center', 'left', 'right']);
    });

    test('на дальних слотах левого коридора нет никогда, и второму места там не остаётся', () => {
        // Слева остров: на дальних слотах корабль оказался бы прямо на суше. Он же и держит
        // линию за соседа — там, где стоит берег, второму кораблю не встать.
        for (let slot = 0; slot < ISLAND_FREE_SLOT; slot += 1) {
            expect(freeCorridors(slot, KIND, []), `слот ${slot}`).not.toContain('left');
            expect(freeCorridors(slot, KIND, [standing(slot, 'center')]), `слот ${slot}`).toEqual([]);
        }
        expect(freeCorridors(ISLAND_FREE_SLOT, KIND, [])).toContain('left');
    });

    test('двое на линии занимают её целиком, сколько бы воды между ними ни оставалось', () => {
        // Третьему на линии не стоять, даже если он катер и вода на него есть: он оказался бы
        // заперт между двумя соседями, и уходя с рейда прошёл бы сквозь одного из них.
        const pair = [standing(NEAR, 'left'), standing(NEAR, 'right')];
        expect(freeCorridors(NEAR, SMALL, pair)).toEqual([]);
    });

    test('не расходятся бортами — линия занята, и коридор тут ни при чём', () => {
        // Два самых длинных корабля на ближней линии занимают почти весь кадр: разойтись им
        // негде, и запрет тут на всю линию, а не на чей-то коридор — расходятся-то они
        // по всему кадру, а не внутри своих полос.
        const near = SLOT_COUNT - 1;
        expect(freeCorridors(near, BIG, [standing(near, 'center', BIG)])).toEqual([]);
        // Та же пара подальше, где силуэты мельче, на линию помещается.
        expect([...freeCorridors(6, BIG, [standing(6, 'center', BIG)])].sort()).toEqual(['left', 'right']);
    });
});

/**
 * Куда корабль встаёт, когда места не выбирали. Тут три склонности разом — размер, теснота
 * и простор, — и все три проверяются составом набора (`preferredBerths`), а не тем, куда
 * в итоге ткнул случай: набор и есть решение, жребий из него только достаёт.
 */
describe('куда корабль встаёт сам', () => {
    beforeEach(() => {
        // Жребий подменён, чтобы прогон повторялся: сам ответ мы проверяем не на конкретное
        // место, а на попадание в набор, который посчитан выше.
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('крупный выбирает из дальней части рейда, мелкий — из ближней', () => {
        // Самый длинный тянется к горизонту, самый короткий — к переднему плану, и берётся
        // не один «свой» слот, а четыре ближайших к нему: иначе строй выстроился бы по росту.
        // На дальних слотах левого коридора в наборе нет — там остров.
        expect(spots(preferredBerths(BIG, []))).toEqual(
            spots([...spread([0, 1, 2], ['center', 'right']), ...spread([3], CORRIDORS)])
        );
        expect(spots(preferredBerths(SMALL, []))).toEqual(spots(spread([6, 7, 8, 9], CORRIDORS)));
    });

    test('заняты желаемые дальности — набор сдвигается к следующим по удалённости', () => {
        // Три дальних слота держит остров да по кораблю на каждом — и набор крупного уезжает
        // к ближним от них, а не рассыпается по всему рейду. Центральный коридор на слотах 3
        // и 4 из набора выпал: там в трёх слотах стоит сосед по этой же полосе.
        const island = [standing(0, 'center'), standing(1, 'center'), standing(2, 'center')];
        expect(spots(preferredBerths(BIG, island))).toEqual(
            spots([...spread([3, 4], ['left', 'right']), ...spread([5, 6], CORRIDORS)])
        );
    });

    test('тесное место в набор не попадает, пока есть просторные', () => {
        // Сосед в центре на слоте 5 закрывает свою полосу на три слота в каждую сторону —
        // не запретом, а тем, что такие места берутся последними. Пока на рейде есть хоть
        // одно просторное, тесные не рассматриваются вовсе.
        const taken = [standing(5, 'center')];
        expect(spots(preferredBerths(SMALL, taken))).toEqual(
            spots([...spread([6, 7], ['left', 'right']), ...spread([8, 9], CORRIDORS)])
        );
        const chosen = suggestBerth(SMALL, taken);
        expect(chosen).not.toBeNull();
        expect(spots(preferredBerths(SMALL, taken))).toContain(`${chosen!.slot}:${chosen!.corridor}`);
    });

    test('просторных не осталось — берётся тесное', () => {
        // Рейд занят весь, кроме двух мест на слоте 3, и оба тесные: в центре сосед на слоте 2,
        // справа — на слоте 4. Встать рядом можно, просто это последнее, что берётся, —
        // и когда другого нет, расстановка берёт именно это, а не отказывает.
        const berths = spots([berthAt(3, 'center'), berthAt(3, 'right')]);
        expect(spots(freeBerths(KIND, CROWDED_RAID))).toEqual(berths);
        expect(spots(preferredBerths(KIND, CROWDED_RAID))).toEqual(berths);
        const chosen = suggestBerth(KIND, CROWDED_RAID);
        expect(chosen).not.toBeNull();
        expect(berths).toContain(`${chosen!.slot}:${chosen!.corridor}`);
    });
});

/**
 * Свободные места — то, что человек видит овалами на воде. Тут запреты и ничего больше:
 * склонности расстановки сюда не достают, потому что человек смотрит на весь кадр разом
 * и решает сам.
 */
describe('свободные места на воде', () => {
    test('занятое место пропадает, занятая линия — целиком, а соседняя остаётся', () => {
        const alone = freeBerths(KIND, [standing(NEAR, 'center')]);
        expect(spots(alone)).not.toContain(`${NEAR}:center`);
        expect(spots(alone)).toContain(`${NEAR}:left`);
        // Соседняя линия того же коридора предлагается наравне с прочими: это «не хочется»,
        // а не «нельзя», и решать за выбирающего тут нечего.
        expect(spots(alone)).toContain(`${NEAR - 1}:center`);
        // А на дальних слотах левого коридора нет вовсе: там остров.
        expect(spots(alone)).not.toContain('0:left');
        expect(spots(alone)).toContain('0:center');

        const pair = freeBerths(KIND, [standing(NEAR, 'center'), standing(NEAR, 'left')]);
        expect(spots(pair).filter((spot) => spot.startsWith(`${NEAR}:`))).toEqual([]);
    });

    test('отметки стоят на осях коридоров и от вызова к вызову не ездят', () => {
        // Разметка на воде — про выбор, и стоять она должна стройно: точка места — это ось
        // коридора, одна и та же для всех кораблей и во всех вкладках.
        const axes: Record<Corridor, number> = { left: 22.1, center: 50, right: 77.9 };
        const first = freeBerths(KIND, [standing(NEAR, 'center')]);
        for (const berth of first) {
            expect(berth.left, `${berth.slot}:${berth.corridor}`).toBeCloseTo(axes[berth.corridor], 6);
        }
        const again = freeBerths(KIND, [standing(NEAR, 'center')]);
        expect(spots(again)).toEqual(spots(first));
    });
});

/**
 * Место, выбранное в форме. Полагаться на этот выбор нельзя: пока человек раздумывал,
 * туда мог встать кто-то другой.
 */
describe('выбранное в форме место', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('свободное — корабль встаёт ровно на него', () => {
        // Ни разброса, ни склонностей: выбрали — значит, туда, даже если рядом сосед.
        const wanted = berthAt(NEAR, 'left');
        const place = placeShip(KIND, [standing(NEAR, 'center')], wanted);
        expect(place).toMatchObject(wanted);
    });

    test('занятое — корабль встаёт на ближайшее свободное, а не на первое попавшееся', () => {
        // Место заняли, пока человек раздумывал. Отказывать не за что, но и раскидывать
        // корабль по всему рейду тоже: он целился в конкретную точку, и правильный ответ —
        // тот же, что и у nearestBerth (см. ниже) на том же рейде и с тем же пожеланием.
        const wanted = berthAt(5, 'center');
        const taken = [standing(3, 'center'), standing(4, 'center'), standing(5, 'center'), standing(6, 'center')];
        const place = placeShip(KIND, taken, wanted);
        expect(place).toMatchObject(berthAt(7, 'center'));
    });

    test('мест нет вовсе — расстановка отказывает', () => {
        // При пяти участниках на десять слотов такого не бывает, но ответ на этот случай
        // должен быть определённый: null, а не первое попавшееся место.
        expect(placeShip(KIND, FULL_RAID)).toBeNull();
        expect(placeShip(KIND, FULL_RAID, berthAt(NEAR, 'left'))).toBeNull();
    });
});

/**
 * Ближайшее свободное место — запасной ход, когда пожелание занято. Расстояние одно
 * на все случаи (см. FIREBASE.md, «Правила рейда живут на сервере»): слоты вглубь плюс
 * коридоры вбок с ценой перехода CORRIDOR_COST. Числа здесь небольшие и подобраны так,
 * чтобы ответ был единственным — иначе от прогона к прогону его решал бы жребий.
 */
describe('ближайшее свободное место', () => {
    test('два слота в своём коридоре ближе, чем один коридор вбок', () => {
        // Вокруг пожелания и на нём самом — соседи по тому же коридору: слот 7 в двух шагах
        // (цена 2) остаётся единственным близким местом, хотя соседний коридор на том же
        // слоте всего в шаге в сторону (цена 3) — дальше, а не ближе.
        const from = berthAt(5, 'center');
        const taken = [standing(3, 'center'), standing(4, 'center'), standing(5, 'center'), standing(6, 'center')];
        expect(nearestBerth(KIND, taken, from)).toEqual(berthAt(7, 'center'));
    });

    test('четыре слота своим коридором — уже дальше соседнего коридора', () => {
        // Свой коридор занят от слота 3 до 8 — свободно на нём только через четыре слота,
        // на девятом (цена 4). Сосед по коридору на том же слоте, что и пожелание, обходится
        // дешевле (цена 3) и потому выигрывает, хоть он и в другой полосе.
        const from = berthAt(5, 'left');
        const taken = [3, 4, 5, 6, 7, 8].map((slot) => standing(slot, 'left'));
        expect(isBerthFree(berthAt(9, 'left'), KIND, taken), 'дальний слот своего коридора не освободили').toBe(true);
        expect(nearestBerth(KIND, taken, from)).toEqual(berthAt(5, 'center'));
    });

    test('ответ всегда берётся из freeBerths — запреты рейда не нарушаются', () => {
        // Рейд занят так, что свободны только два тесных места (см. CROWDED_RAID). Считать
        // расстояние можно от любой точки, но ответ обязан остаться среди них: острова,
        // интервалы и размеры формула расстояния не знает — их держит freeBerths.
        const free = spots(freeBerths(KIND, CROWDED_RAID));
        const nearest = nearestBerth(KIND, CROWDED_RAID, berthAt(9, 'right'));
        expect(nearest).not.toBeNull();
        expect(free).toContain(`${nearest!.slot}:${nearest!.corridor}`);
    });

    test('свободных мест нет вовсе — null', () => {
        expect(nearestBerth(KIND, FULL_RAID, berthAt(3, 'left'))).toBeNull();
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

/**
 * Поля по краям рейда. Рейд один и тот же на любом экране, и поля у него одинаковые с обеих
 * сторон и постоянные: ни ширина окна, ни курс корабля их не двигают. Где эти кромки окажутся
 * на экране, решает уже проекция в стилях (см. `projectLeft` в types/channel.ts), — и вот это
 * браузеру и остаётся показать.
 */

/** Тот же корабль, поставленный носом в заданную сторону. */
const heading = (ship: Anchored, facing: Side): Anchored => ({
    ...ship,
    place: { ...ship.place, facing, enterFrom: otherSide(facing) },
});

/** Насколько корпус отстоит от левой и от правой кромки рейда, % его ширины. */
const gaps = (ship: Anchored, left: number): [number, number] => {
    const half = shipWidthPercent(ship.place.slot, ship.shipKind) / 2;
    return [left - half, 100 - (left + half)];
};

/** Весь рейд разом: каждый корабль на каждом месте. */
const EVERYWHERE: Anchored[] = SHIP_KINDS.flatMap((kind) =>
    [...new Array<number>(SLOT_COUNT)].flatMap((_, slot) =>
        CORRIDORS.map((corridor) => anchored(`${kind}-${slot}-${corridor}`, slot, corridor, kind))
    )
);

describe('поля по краям рейда', () => {
    test('корпус не заходит в поле ни одним бортом', () => {
        for (const ship of EVERYWHERE) {
            for (const gap of gaps(ship, restingLeft(ship))) {
                expect(gap, `${ship.memberId} зашёл в поле`).toBeGreaterThanOrEqual(EDGE_MARGIN - 1e-9);
            }
        }
    });

    test('курс места не двигает: поля с обеих сторон одни и те же', () => {
        // Полю всё равно, куда корабль смотрит, — оно про воду, а не про силуэт. Раньше поле
        // у носа отмерялось кромкой окна, и от курса зависело; теперь окна расстановка
        // не знает вовсе.
        for (const ship of EVERYWHERE) {
            const [toLeft, toRight] = [heading(ship, 'left'), heading(ship, 'right')].map(restingLeft);
            expect(toLeft, `${ship.memberId} поехал от собственного курса`).toBe(toRight);
        }
    });

    test('и у кромки рейда стоит хоть кто-то — иначе поле нечем и мерить', () => {
        const pressed = EVERYWHERE.filter((ship) =>
            gaps(ship, restingLeft(ship)).some((gap) => gap < EDGE_MARGIN + 1e-9)
        );
        expect(pressed.length, 'никого к полю не прижало').toBeGreaterThan(0);
    });

    test('расхождение тесной пары тоже не выходит в поле', () => {
        // Расходятся двое до самых кромок рейда — дальше уступать некуда, и остаток они делят
        // между собой (см. roomAside).
        const small = heading(anchored('malysh', NEAR, 'left', SMALL), 'right');
        const big = heading(anchored('grom', NEAR, 'center', BIG), 'left');
        const lefts = fleetLefts([small, big]);
        for (const ship of [small, big]) {
            for (const gap of gaps(ship, lefts[ship.memberId])) {
                expect(gap, `${ship.memberId} разошёлся в поле`).toBeGreaterThanOrEqual(EDGE_MARGIN - 1e-9);
            }
        }
    });
});

/**
 * Стоянка: отход от своей линии по дальности и разворот корпуса. И то и другое — про то,
 * как корабль стоит на месте, а не про само место, и считается тем же хешем, что и разброс
 * поперёк. Значит, проверять тут надо ровно две вещи: что числа держатся в своих пределах
 * и что они у всех разные, — а видно ли это в кадре, показывает браузер.
 */

/** Десяток кораблей на одном месте: разными их делает только позывной. */
const CREW: Anchored[] = [...new Array<number>(10)].map((_, index) => anchored(`ship-${index}`, NEAR, 'center', KIND));

describe('живая стоянка', () => {
    test('отход от линии не выходит за пятую часть промежутка и не меняется от прогона к прогону', () => {
        for (const ship of CREW) {
            const drift = restingDrift(ship);
            expect(Math.abs(drift), `${ship.memberId} ушёл с линии дальше положенного`).toBeLessThanOrEqual(0.2);
            expect(restingDrift(ship), 'отход посчитался по-разному дважды подряд').toBe(drift);
        }
    });

    test('отходят в обе стороны и на разное расстояние', () => {
        // Иначе это был бы не разброс, а общий сдвиг всего флота на полшага к наблюдателю.
        const drifts = CREW.map(restingDrift);
        expect(
            drifts.some((drift) => drift > 0.02),
            'никто не подошёл ближе'
        ).toBe(true);
        expect(
            drifts.some((drift) => drift < -0.02),
            'никто не отошёл дальше'
        ).toBe(true);
        expect(new Set(drifts.map((drift) => drift.toFixed(4))).size, 'флот отошёл строем').toBe(drifts.length);
    });

    test('с крайних линий отходят только внутрь рейда', () => {
        // Дальше нулевой линии корабль встал бы на горизонт, ближе последней — ушёл бы
        // под нижнюю кромку кадра.
        for (const memberId of CREW.map((ship) => ship.memberId)) {
            expect(
                restingDrift(anchored(memberId, 0, 'center', KIND)),
                'с дальней линии ушли за горизонт'
            ).toBeGreaterThanOrEqual(0);
            expect(
                restingDrift(anchored(memberId, SLOT_COUNT - 1, 'center', KIND)),
                'с ближней линии ушли под кромку кадра'
            ).toBeLessThanOrEqual(0);
        }
    });

    test('разворот корпуса невелик и достаётся в обе стороны', () => {
        const yaws = CREW.map(restingYaw);
        for (const yaw of yaws) {
            expect(Math.abs(yaw), 'корабль развернуло сильнее, чем ветром на стоянке').toBeLessThanOrEqual(1.5);
        }
        expect(
            yaws.some((yaw) => yaw > 0.1),
            'никого не развернуло в одну сторону'
        ).toBe(true);
        expect(
            yaws.some((yaw) => yaw < -0.1),
            'никого не развернуло в другую'
        ).toBe(true);
    });

    test('отход, разворот и разброс поперёк не ходят вместе', () => {
        // У каждого свой ключ хеша нарочно: сойдись они — и корабль, отошедший вправо,
        // всегда отходил бы ещё и вперёд, и с тем же разворотом. Строй от такого правила
        // выглядел бы разложенным по одной линейке, а не стоящим на якорях.
        const order = (numbers: number[]): string =>
            numbers
                .map((value, index) => [value, index] as const)
                .sort(([one], [other]) => one - other)
                .map(([, index]) => index)
                .join(',');
        const drifts = order(CREW.map(restingDrift));
        const yaws = order(CREW.map(restingYaw));
        const lefts = order(CREW.map(restingLeft));
        expect(drifts, 'отход повторяет разворот').not.toBe(yaws);
        expect(drifts, 'отход повторяет разброс поперёк').not.toBe(lefts);
        expect(yaws, 'разворот повторяет разброс поперёк').not.toBe(lefts);
    });

    test('переставленный корабль стоит на новом месте по-новому', () => {
        // В ключ хеша входит место: перешёл на другую стоянку — встал на ней иначе,
        // а не повторил прежний отход.
        const here = anchored('malysh', NEAR, 'center', KIND);
        const there = anchored('malysh', NEAR - 1, 'center', KIND);
        expect(restingDrift(there), 'отход переехал вместе с кораблём').not.toBeCloseTo(restingDrift(here), 3);
        expect(restingYaw(there), 'разворот переехал вместе с кораблём').not.toBeCloseTo(restingYaw(here), 3);
    });
});
