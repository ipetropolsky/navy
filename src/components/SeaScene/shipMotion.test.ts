import { describe, expect, test } from 'vitest';

import { ISLAND_FREE_SLOT, ShipKind, ShipPlacement, Side } from '@/types/channel';

import { leaveCourse, shiftAcross } from '@/components/SeaScene/shipMotion';

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

    test('перезаходящий уходит туда, откуда будет заходить, — хоть бы и задним ходом', () => {
        // Наблюдённый случай, с которого шаг и начинался: корабль стоял в правом коридоре
        // носом влево, а переставили его в левый коридор — заходить туда слева. Уход считался
        // отдельно и уводил корабль вправо задним ходом: слева стоял сосед через линию.
        // Выходил круг вокруг всей сцены, да ещё и кормой вперёд на первом перегоне.
        const place = at(NEAR, 'right', 'left');
        const neighbour = [at(NEAR - 1, 'left', 'right')];
        expect(leaveCourse(place, KIND, neighbour, 'left')).toEqual({ side: 'left', astern: false });
        // И наоборот: заходить справа — значит и уходить вправо, даже кормой вперёд. Круг
        // вокруг сцены дороже разворота.
        expect(leaveCourse(place, KIND, [], 'right')).toEqual({ side: 'right', astern: true });
    });

    test('круг вокруг сцены дешевле, чем сквозь соседа по своей линии', () => {
        // Заходить кораблю слева, но слева же на его линии стоит другой. Пройти сквозь него
        // нельзя ничем, и корабль уходит вправо, соглашаясь на круг.
        const place = at(NEAR, 'right', 'left');
        const sameLine = [at(NEAR, 'left', 'right')];
        expect(leaveCourse(place, KIND, sameLine, 'left')).toEqual({ side: 'right', astern: true });
    });
});

/** Корабль, каким его видит кадр: место да силуэт. Ровно это сцена и сравнивает при перемене. */
const afloat = (place: ShipPlacement, shipKind: ShipKind = KIND) => ({ place, shipKind });

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
        // между соседними коридорами уходит 6.97 с на любой линии и любому кораблю
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
