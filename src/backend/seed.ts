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
 * Места на рейде заданы руками, по одному кораблю в каждом коридоре и на разной дальности:
 * так сразу видно и перспективу, и то, что корабли не толпятся. Левый коридор занят только
 * с четвёртого слота — ближе к горизонту там остров.
 */

export const DEMO_CHANNEL_ID = 'ch-demo';
export const DEMO_CHANNEL_SLUG = 'demo';

const minutesAfterMidnight = (hours: number, minutes: number): number => {
    const midnight = new Date();
    midnight.setHours(hours, minutes, 0, 0);
    return midnight.getTime();
};

export const createDemoChannel = (): ChannelSnapshot => ({
    id: DEMO_CHANNEL_ID,
    slug: DEMO_CHANNEL_SLUG,
    title: 'Эскадра «Полночь»',
    createdAt: minutesAfterMidnight(21, 30),
    members: [
        {
            id: 'm-albatros',
            name: 'Альбатрос',
            hullNumber: '317',
            shipKind: 'patrol',
            color: '#8ecae6',
            place: { slot: 9, corridor: 1, left: 52, facing: 'left', enterFrom: 'right', tried: [1] },
            joinedAt: minutesAfterMidnight(21, 30),
        },
        {
            id: 'm-vympel',
            name: 'Вымпел',
            hullNumber: '561',
            shipKind: 'missile',
            color: '#f2cc8f',
            place: { slot: 6, corridor: 2, left: 79, facing: 'right', enterFrom: 'left', tried: [2] },
            joinedAt: minutesAfterMidnight(21, 32),
        },
        {
            id: 'm-rezvy',
            name: 'Резвый',
            hullNumber: '208',
            shipKind: 'torpedo',
            color: '#95d5b2',
            place: { slot: 4, corridor: 0, left: 21, facing: 'left', enterFrom: 'right', tried: [0] },
            joinedAt: minutesAfterMidnight(21, 34),
        },
    ],
    messages: [
        {
            id: 'msg-1',
            memberId: 'm-albatros',
            text: 'Встали на рейде у острова. Море спокойное, видимость отличная.',
            sentAt: minutesAfterMidnight(21, 37),
        },
        {
            id: 'msg-2',
            memberId: 'm-vympel',
            text: 'Принял. Огни притушить, работаем только сигнальной лампой.',
            sentAt: minutesAfterMidnight(21, 39),
        },
        {
            id: 'msg-3',
            memberId: 'm-rezvy',
            text: 'Резвый на связи. Швартовы отданы, выходим из бухты.',
            sentAt: minutesAfterMidnight(21, 41),
        },
        {
            id: 'msg-4',
            memberId: 'm-albatros',
            text: 'Идём следом, держу кильватер.',
            threadId: 'msg-3',
            sentAt: minutesAfterMidnight(21, 42),
        },
        {
            id: 'msg-5',
            memberId: 'm-vympel',
            text: 'Вымпел на позиции, к переходу готов.',
            sentAt: minutesAfterMidnight(21, 44),
        },
        {
            id: 'msg-6',
            memberId: 'm-vympel',
            text: 'Луна вышла — остров как на ладони. Красота.',
            sentAt: minutesAfterMidnight(21, 47),
        },
        {
            id: 'msg-7',
            memberId: 'm-albatros',
            text: 'Ради такого и служим.',
            threadId: 'msg-6',
            sentAt: minutesAfterMidnight(21, 48),
        },
    ],
});
