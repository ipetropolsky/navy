import { describe, expect, test } from 'vitest';

import {
    ISLAND_FREE_SLOT,
    SHIP_KINDS,
    SHIP_SPECS,
    ShipKind,
    ShipPlacement,
    Side,
    shipWidthPercent,
} from '@shared/types/channel';

import {
    LEAVE_GUARD,
    RELOCATE_PAUSE_SECONDS,
    leaveCourse,
    manoeuvreSeconds,
    pathToEdge,
    relocateCourse,
    sailSeconds,
    shiftAcross,
} from '@/components/SeaScene/shipMotion';

/**
 * Куда корабль уходит из кадра. Правило это целиком счётное и в браузере проверяется дорого:
 * чтобы увидеть один манёвр, надо поднять сцену, дождаться захода, переставить корабль
 * и досмотреть уход до конца. А расклад на входе тут известный, ответ единственный —
 * это работа для юнита.
 *
 * Случайности в `leaveCourse` нет вовсе: тот же расклад всегда даёт тот же ответ.
 */

/** Оси коридоров, % ширины кадра: EDGE_MARGIN + доля коридора от воды между полями. */
const AXIS: Record<'left' | 'center' | 'right', number> = { left: 22.1, center: 50, right: 77.9 };

/** Корабль на рейде: место, коридор и курс. Сторона захода тут ни при чём — её спрашивают отдельно. */
const at = (slot: number, corridor: 'left' | 'center' | 'right', facing: Side): ShipPlacement => ({
    slot,
    corridor,
    left: AXIS[corridor],
    facing,
    // Уходу это поле не нужно: корабль уходит с места, а не заходит на него.
    enterFrom: facing === 'left' ? 'right' : 'left',
});

/** Средний корабль справочника: ни самый длинный, ни самый короткий. */
const KIND: ShipKind = 'pr201';

/** Ближняя половина рейда, где остров уже не помеха. */
const NEAR = 8;

describe('уход с рейда', () => {
    test('на свободном рейде корабль уходит носом вперёд, даже если так дальше', () => {
        // Корабль в левом коридоре смотрит вправо: до правой кромки ему через весь кадр,
        // до левой — рукой подать. И всё равно он идёт вперёд: ход носом стоит дешевле
        // заднего, и разницы в полтора корпуса на то, чтобы развернуть корабль, не хватает.
        expect(leaveCourse(at(NEAR, 'left', 'right'), KIND, [])).toEqual({ side: 'right', astern: false });
        expect(leaveCourse(at(NEAR, 'right', 'left'), KIND, [])).toEqual({ side: 'left', astern: false });
    });

    test('в остров не уходит никто', () => {
        // На дальних слотах слева берег. Корабль с курсом на него уходит задним ходом вправо:
        // дороже и медленнее, зато не по суше.
        const far = ISLAND_FREE_SLOT - 1;
        expect(leaveCourse(at(far, 'center', 'left'), KIND, [])).toEqual({ side: 'right', astern: true });
    });

    test('перед соседом корабль пятится, а не идёт напролом', () => {
        // Уходящему с рейда совсем возвращаться некуда, и довод у него один — помеха впереди.
        // Что сосед на своей линии, что через линию: разворот дешевле, чем пройти сквозь него.
        const place = at(NEAR, 'right', 'left');
        expect(leaveCourse(place, KIND, [at(NEAR, 'left', 'right')])).toEqual({ side: 'right', astern: true });
        expect(leaveCourse(place, KIND, [at(NEAR - 1, 'left', 'right')])).toEqual({ side: 'right', astern: true });
        // А сосед за кормой не помеха вовсе: корабль уходит вперёд, как и на пустом рейде.
        expect(leaveCourse(place, KIND, [at(NEAR, 'right', 'left')])).toEqual({ side: 'left', astern: false });
    });
});

/** Корабль, каким его видит кадр: место да силуэт. Ровно это сцена и сравнивает при перемене. */
const afloat = (place: ShipPlacement, shipKind: ShipKind = KIND) => ({ place, shipKind });

describe('перезаход на новое место', () => {
    test('на соседнюю линию своего коридора корабль выходит за ближнюю кромку и с неё же возвращается', () => {
        // Наблюдённый случай: корабль в правом коридоре носом вправо переставили на соседнюю
        // линию того же коридора. Заход был назначен наперёд, носом вперёд, то есть слева, —
        // и уход подстраивался под него: корабль пятился через весь кадр влево и оттуда же
        // шёл направо. Четыре пролёта там, где хватает двух.
        //
        // Считая оба перегона вместе, дешевле выходит выйти за правую кромку носом и оттуда же
        // вернуться кормой вперёд: задний ход стоит два корпуса, а круг вокруг сцены — восемь.
        const way = relocateCourse(afloat(at(9, 'right', 'right')), afloat(at(8, 'right', 'right')), []);
        expect(way.leave).toEqual({ side: 'right', astern: false });
        expect(way.enter).toEqual({ side: 'right', astern: true });
    });

    test('через весь рейд корабль по-прежнему заходит носом вперёд', () => {
        // А вот когда места стоят у разных кромок, привычный ход и остаётся лучшим: уйти
        // вперёд за правую кромку и зайти носом с левой. Возвращаться к правой ради того,
        // чтобы пятиться через весь кадр, себе дороже даже с кругом вокруг сцены.
        const way = relocateCourse(afloat(at(NEAR, 'right', 'right')), afloat(at(NEAR - 1, 'left', 'right')), []);
        expect(way.leave).toEqual({ side: 'right', astern: false });
        expect(way.enter).toEqual({ side: 'left', astern: false });
    });

    test('в остров не заходит никто', () => {
        // На дальних слотах слева берег: заходить оттуда нельзя ни при каком курсе, и корабль
        // с курсом на остров подходит справа — носом вперёд, потому что идёт он от правой
        // кромки влево, туда же, куда смотрит.
        const far = ISLAND_FREE_SLOT - 1;
        const way = relocateCourse(afloat(at(NEAR, 'center', 'left')), afloat(at(far, 'center', 'left')), []);
        expect(way.enter).toEqual({ side: 'right', astern: false });
    });

    test('сквозь соседа по своей линии корабль не заходит, даже соглашаясь на круг', () => {
        // Заходить кораблю было бы удобно справа, но справа же на его новой линии стоит другой.
        // Пройти сквозь него нельзя ничем — заход идёт с левой кромки, а с ним и уход.
        const sameLine = [at(8, 'right', 'left')];
        const way = relocateCourse(afloat(at(9, 'center', 'right')), afloat(at(8, 'center', 'right')), sameLine);
        expect(way.enter.side).toBe('left');
        expect(way.leave.side).toBe('left');
    });
});

/** Наименьший ход по кадру, % ширины сцены в секунду: тот самый MIN_SAIL_PACE. */
const PACE = 3.2;

/** Все линии рейда — от самой дальней до самой ближней. */
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('ход по кадру', () => {
    test('всякий манёвр в кадре идёт этим самым малым, а не своими узлами', () => {
        // Проверка не на число, а на то, что число это единственное. Ход на рейде расписан
        // по длине корпуса (4 узла у самого длинного, 6.7 у самого короткого), но кадр
        // шириной в сотню-другую метров: на таких узлах корабль пересекал бы его минутами.
        // Поэтому сверху стоит наименьший ход по кадру, и упирается в него каждый манёвр —
        // от катера на ближней линии до тральщика у горизонта. Отсюда и вывод для правок:
        // скорость в кадре меняет только MIN_SAIL_PACE, а узлы её не трогают вовсе.
        const kinds = Object.keys(SHIP_SPECS) as ShipKind[];
        const paces = SLOTS.flatMap((slot) =>
            kinds.flatMap((kind) => {
                const path = pathToEdge(50, shipWidthPercent(slot, kind), 'right', LEAVE_GUARD);
                return [false, true].map((astern) => path / sailSeconds(path, slot, kind, astern));
            })
        );
        paces.forEach((pace) => expect(pace).toBeCloseTo(PACE, 5));
    });

    test('время идёт за путём, а не стоит на месте', () => {
        // Ровно то, ради чего мерка экранная, а не временная: вдвое короче путь — вдвое
        // короче и манёвр. Плоский потолок в секундах, стоявший тут раньше, растягивал
        // короткий ход на те же полминуты.
        expect(sailSeconds(40, 5, KIND, false)).toBeCloseTo(sailSeconds(20, 5, KIND, false) * 2, 5);
    });
});

describe('переход по воде', () => {
    test('на соседний коридор своей же линии корабль переходит, а не перезаходит', () => {
        // Ходу тут меньше трети кадра, и весь он на глазах. Уходить ради этого за кромку
        // и заходить обратно — полкадра туда, полкадра сюда да пауза между ними.
        const shift = shiftAcross(afloat(at(NEAR, 'left', 'right')), afloat(at(NEAR, 'center', 'right')));
        expect(shift).toMatchObject({ toward: 'right', astern: false });
        expect(shift!.path).toBeCloseTo(AXIS.center - AXIS.left, 5);
    });

    test('назад корабль переходит задним ходом, не разворачиваясь', () => {
        // Нос смотрит вправо, а идти влево. Разворачиваться ради трети кадра незачем —
        // на рейде так и маневрируют.
        const astern = shiftAcross(afloat(at(NEAR, 'center', 'right')), afloat(at(NEAR, 'left', 'right')));
        const ahead = shiftAcross(afloat(at(NEAR, 'left', 'right')), afloat(at(NEAR, 'center', 'right')));
        expect(astern).toMatchObject({ toward: 'left', astern: true });
        // Времени задний ход при этом не добавляет, и это не оплошность: манёвр упирается
        // в наименьший ход по кадру (MIN_SAIL_PACE), а не в узлы. Замер: на переход
        // между соседними коридорами уходит 8.72 с на любой линии и любому кораблю
        // справочника, хоть носом, хоть кормой. Медленнее этого корабль в кадре не ходит —
        // ниже уже начинается ожидание, а не манёвр.
        expect(astern!.path).toBeCloseTo(ahead!.path, 5);
        expect(astern!.seconds).toBeCloseTo(ahead!.seconds, 5);
    });

    test('через весь рейд идти дольше, чем на соседний коридор', () => {
        // Путь вдвое длиннее, и время идёт за ним: наименьший ход по кадру держит постоянной
        // скорость, а не длительность (см. MIN_SAIL_PACE).
        const near = shiftAcross(afloat(at(NEAR, 'left', 'right')), afloat(at(NEAR, 'center', 'right')));
        const far = shiftAcross(afloat(at(NEAR, 'left', 'right')), afloat(at(NEAR, 'right', 'right')));
        expect(far!.path).toBeCloseTo(near!.path * 2, 5);
        expect(far!.seconds).toBeGreaterThan(near!.seconds);
    });

    test('перемена дальности, силуэта или курса переходом по воде не отыгрывается', () => {
        const here = at(NEAR, 'left', 'right');
        // Другая линия — другой размер, а расти на глазах кораблю нельзя.
        expect(shiftAcross(afloat(here), afloat(at(NEAR - 1, 'center', 'right')))).toBeNull();
        // Другой силуэт — это уже другой корабль: прежний обязан уйти с рейда.
        expect(shiftAcross(afloat(here), afloat(at(NEAR, 'center', 'right'), 'pr1400'))).toBeNull();
        // Другой курс — разворот, а его в кадре не отыграть: силуэт отзеркалился бы мгновенно.
        expect(shiftAcross(afloat(here), afloat(at(NEAR, 'center', 'left')))).toBeNull();
        // И то же самое место — не перемена вовсе.
        expect(shiftAcross(afloat(here), afloat(at(NEAR, 'left', 'right')))).toBeNull();
    });
});

describe('оценка манёвра', () => {
    test('вход на рейд — один заход из-за кромки', () => {
        const to = afloat(at(NEAR, 'center', 'right'));
        // Приходить новичку неоткуда, и весь его манёвр — это заход: ни ухода, ни паузы.
        expect(manoeuvreSeconds(undefined, to, [])).toBeGreaterThan(0);
        expect(manoeuvreSeconds(undefined, to, [])).toBeLessThan(
            manoeuvreSeconds(afloat(at(NEAR, 'left', 'left')), to, [])
        );
    });

    test('перезаход — уход, пауза и заход, и всё это дольше одного захода', () => {
        const from = afloat(at(NEAR, 'left', 'right'));
        const to = afloat(at(NEAR - 2, 'right', 'right'));

        expect(manoeuvreSeconds(from, to, [])).toBeGreaterThan(
            RELOCATE_PAUSE_SECONDS + manoeuvreSeconds(undefined, to, [])
        );
    });

    test('переход по воде оценивается своим ходом, без паузы', () => {
        const from = afloat(at(NEAR, 'left', 'right'));
        const to = afloat(at(NEAR, 'center', 'right'));

        expect(manoeuvreSeconds(from, to, [])).toBeCloseTo(shiftAcross(from, to)!.seconds, 5);
    });

    test('самый долгий манёвр укладывается в предел, который принимает бэкенд', () => {
        // Предел там — минута с лишним (MANOEUVRE_MAX_SECONDS в functions/src/parse.ts),
        // и оценка обязана в него влезать: отвергнутую запись доигрывать будет нечем.
        // Худший случай — самый крупный корабль на ближней линии, где кадр в корпусах мал,
        // с уходом и заходом через весь рейд.
        const worst = SHIP_KINDS.map((kind) => {
            const from = afloat(at(0, 'left', 'right'), kind);
            const to = afloat(at(0, 'right', 'left'), kind);
            return manoeuvreSeconds(from, to, []);
        });

        expect(Math.max(...worst)).toBeLessThan(120);
    });
});
