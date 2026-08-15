import { Berth, CORRIDORS, Corridor, Member, ShipKind } from '@/types/channel';
import { pick, pickBetween, shuffled } from '@/utils/random';

import { Standing, berthAt, placeShip } from '@/backend/placement';
import { ChannelSnapshot } from '@/backend/types';

/**
 * Демо-канал: три корабля и уже начатый разговор. Нужен, чтобы чат было на что посмотреть
 * до того, как в него кто-то войдёт, — пустая лента ничего не показывает ни про группировку
 * сообщений, ни про ответы, ни про цвета позывных, ни про строчки самого канала.
 *
 * Строчки канала здесь тоже настоящие: три о входе и одна о переоснащении. Вымпел вошёл
 * с бортовым 555 и сменил его на 561 — так в демо видно оба вида строчки, ровный и с пометкой
 * на изменившемся.
 *
 * Записывается в хранилище один раз, при первом запуске. Если состояние там уже есть,
 * демо не трогает его: разговор, который вы вели вчера, не должен пропадать из-за того,
 * что мы решили что-то показать.
 *
 * Время у сообщений считается от полуночи сегодняшнего дня, а не хранится числом:
 * иначе демо-переписка со временем уезжала бы всё дальше в прошлое.
 *
 * Места на рейде не заданы руками: демо просит по месту в каждой трети рейда и в каждом
 * коридоре, а назначает их та же расстановка, что и всем остальным (см. `demoBerths`).
 * Каждый запуск — своя картинка, и заодно это проверка расстановки: демо открывают чаще,
 * чем читают тесты.
 */

export const DEMO_CHANNEL_ID = 'ch-demo';
export const DEMO_CHANNEL_SLUG = 'demo';

const minutesAfterMidnight = (hours: number, minutes: number): number => {
    const midnight = new Date();
    midnight.setHours(hours, minutes, 0, 0);
    return midnight.getTime();
};

/**
 * Корабли демо-канала: крупный, средний и малый — чтобы в кадре была видна разница в размере,
 * а расстановка развела их по дальности. Места раздаются по очереди, как при настоящем входе.
 */
const DEMO_CREW: (Omit<Member, 'place'> & { shipKind: ShipKind })[] = [
    {
        memberId: 'm-albatros',
        name: 'Альбатрос',
        hullNumber: '317',
        shipKind: 'pr1400',
        color: '#8ecae6',
        joinedAt: minutesAfterMidnight(21, 30),
    },
    {
        memberId: 'm-vympel',
        name: 'Вымпел',
        hullNumber: '561',
        shipKind: 'pr1234',
        color: '#f2cc8f',
        joinedAt: minutesAfterMidnight(21, 32),
    },
    {
        memberId: 'm-rezvy',
        name: 'Резвый',
        hullNumber: '208',
        shipKind: 'pr205',
        color: '#95d5b2',
        joinedAt: minutesAfterMidnight(21, 34),
    },
];

/**
 * Трети рейда по дальности: у горизонта, посередине и на переднем плане. Демо-кораблю
 * достаётся своя треть, а слот внутри неё берётся случайно.
 */
const DEMO_BANDS: [number, number][] = [
    [0, 2],
    [3, 6],
    [7, 9],
];

/**
 * Куда встают демо-корабли: по одному в каждый коридор и в каждую треть рейда, а кто куда —
 * случайно.
 *
 * Общее правило расстановки ведёт корабль размером: крупный тянет к горизонту, мелкий
 * к переднему плану (`preferredSlot`). На живом рейде это правильно — кадр не загораживается
 * и никто не теряется точкой у горизонта, — но на составе из трёх кораблей оно выходит боком:
 * перспектива уменьшает дальнего ровно настолько, насколько он крупнее ближнего, и все трое
 * оказываются одного видимого размера, выстроившись по росту от горизонта. Витрине это
 * не годится: она затем и нужна, чтобы разница была видна.
 *
 * Поэтому демо просит места само, разводя размер и дальность. Именно просит: место
 * по-прежнему назначает расстановка (`placeShip` с `wanted`), и если просимое занято
 * или запрещено, корабль встаёт по общим правилам, как все.
 *
 * Дальняя треть достаётся не левому коридору: там остров, и ставить туда нельзя
 * (`ISLAND_FREE_SLOT`) — расстановка такое место всё равно отвергнет.
 */
const demoBerths = (): Berth[] => {
    const offshore = pick<Corridor>(['center', 'right']);
    const [middle, near] = shuffled(CORRIDORS.filter((corridor) => corridor !== offshore));
    return [offshore, middle, near].map((corridor, index) => berthAt(pickBetween(...DEMO_BANDS[index]), corridor));
};

const placeDemoCrew = (): Member[] => {
    const taken: Standing[] = [];
    // Места перемешаны, а не розданы по порядку состава: иначе крупный «Вымпел» каждый раз
    // вставал бы в одну и ту же треть рейда, и картинка снова была бы одна на все запуски.
    const berths = shuffled(demoBerths());
    return DEMO_CREW.map((member, index) => {
        // Место найдётся всегда: три корабля на десять слотов. Пустого места ради типов
        // хватит и первого слота — до него дело не дойдёт.
        const place = placeShip(member.shipKind, taken, berths[index]) ?? { ...taken[0].place };
        taken.push({ shipKind: member.shipKind, place });
        return { ...member, place };
    });
};

export const createDemoChannel = (): ChannelSnapshot => ({
    channel: {
        channelId: DEMO_CHANNEL_ID,
        slug: DEMO_CHANNEL_SLUG,
        title: 'Эскадра «Полночь»',
        createdAt: minutesAfterMidnight(21, 30),
        // Старший — тот, кто встал первым: в настоящем канале это выходит само собой,
        // и демо не должно быть устроено иначе.
        owner: { memberId: DEMO_CREW[0].memberId },
    },
    members: placeDemoCrew(),
    messages: [
        {
            messageId: 'msg-join-1',
            author: { memberId: 'm-albatros' },
            kind: 'system',
            notice: { event: 'joined', before: { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' } },
            sentAt: minutesAfterMidnight(21, 30),
        },
        {
            messageId: 'msg-join-2',
            author: { memberId: 'm-vympel' },
            kind: 'system',
            notice: { event: 'joined', before: { shipKind: 'pr1234', name: 'Вымпел', hullNumber: '555' } },
            sentAt: minutesAfterMidnight(21, 32),
        },
        {
            messageId: 'msg-join-3',
            author: { memberId: 'm-rezvy' },
            kind: 'system',
            notice: { event: 'joined', before: { shipKind: 'pr205', name: 'Резвый', hullNumber: '208' } },
            sentAt: minutesAfterMidnight(21, 34),
        },
        {
            messageId: 'msg-1',
            author: { memberId: 'm-albatros' },
            text: 'Встали на рейде у острова. Море спокойное, видимость отличная.',
            sentAt: minutesAfterMidnight(21, 37),
        },
        {
            messageId: 'msg-2',
            author: { memberId: 'm-vympel' },
            text: 'Принял. Огни притушить, работаем только сигнальной лампой.',
            sentAt: minutesAfterMidnight(21, 39),
        },
        {
            messageId: 'msg-3',
            author: { memberId: 'm-rezvy' },
            text: 'Резвый на связи. Швартовы отданы, выходим из бухты.',
            sentAt: minutesAfterMidnight(21, 41),
        },
        {
            messageId: 'msg-4',
            author: { memberId: 'm-albatros' },
            text: 'Идём следом, держу кильватер.',
            thread: { messageId: 'msg-3' },
            sentAt: minutesAfterMidnight(21, 42),
        },
        {
            messageId: 'msg-5',
            author: { memberId: 'm-vympel' },
            text: 'Вымпел на позиции, к переходу готов.',
            sentAt: minutesAfterMidnight(21, 44),
        },
        {
            messageId: 'msg-refit',
            author: { memberId: 'm-vympel' },
            kind: 'system',
            notice: {
                event: 'refit',
                before: { shipKind: 'pr1234', name: 'Вымпел', hullNumber: '555' },
                after: { shipKind: 'pr1234', name: 'Вымпел', hullNumber: '561' },
                changed: ['hullNumber'],
            },
            sentAt: minutesAfterMidnight(21, 45),
        },
        {
            messageId: 'msg-6',
            author: { memberId: 'm-vympel' },
            text: 'Луна вышла — остров как на ладони. Красота.',
            sentAt: minutesAfterMidnight(21, 47),
        },
        {
            messageId: 'msg-7',
            author: { memberId: 'm-albatros' },
            text: 'Ради такого и служим.',
            thread: { messageId: 'msg-6' },
            sentAt: minutesAfterMidnight(21, 48),
        },
    ],
});
