import { Member, ShipKind } from '@/types/channel';

import { Standing, placeShip } from '@/backend/placement';
import { ChannelSnapshot } from '@/backend/types';

/**
 * Демо-канал: три корабля и уже начатый разговор. Нужен, чтобы чат было на что посмотреть
 * до того, как в него кто-то войдёт, — пустая лента ничего не показывает ни про группировку
 * сообщений, ни про ответы, ни про цвета позывных.
 *
 * Записывается в хранилище один раз, при первом запуске. Если состояние там уже есть,
 * демо не трогает его: разговор, который вы вели вчера, не должен пропадать из-за того,
 * что мы решили что-то показать.
 *
 * Время у сообщений считается от полуночи сегодняшнего дня, а не хранится числом:
 * иначе демо-переписка со временем уезжала бы всё дальше в прошлое.
 *
 * Места на рейде не заданы руками, а выбираются той же расстановкой, что и для всех
 * остальных: три корабля разного размера встают по её правилам — крупный дальше, мелкий
 * ближе, — и каждый раз по-новому. Заодно это и проверка расстановки: демо открывают чаще,
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
        shipKind: 'patrol',
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

const placeDemoCrew = (): Member[] => {
    const taken: Standing[] = [];
    return DEMO_CREW.map((member) => {
        // Место найдётся всегда: три корабля на десять слотов. Пустого места ради типов
        // хватит и первого слота — до него дело не дойдёт.
        const place = placeShip(member.shipKind, taken) ?? { ...taken[0].place };
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
    },
    members: placeDemoCrew(),
    messages: [
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
