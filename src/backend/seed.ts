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
    channel: {
        channelId: DEMO_CHANNEL_ID,
        slug: DEMO_CHANNEL_SLUG,
        title: 'Эскадра «Полночь»',
        createdAt: minutesAfterMidnight(21, 30),
    },
    members: [
        {
            memberId: 'm-albatros',
            name: 'Альбатрос',
            hullNumber: '317',
            shipKind: 'patrol',
            color: '#8ecae6',
            place: { slot: 9, corridor: 'center', left: 52, facing: 'left', enterFrom: 'right', tried: ['center'] },
            joinedAt: minutesAfterMidnight(21, 30),
        },
        {
            memberId: 'm-vympel',
            name: 'Вымпел',
            hullNumber: '561',
            shipKind: 'missile',
            color: '#f2cc8f',
            place: { slot: 6, corridor: 'right', left: 79, facing: 'right', enterFrom: 'left', tried: ['right'] },
            joinedAt: minutesAfterMidnight(21, 32),
        },
        {
            memberId: 'm-rezvy',
            name: 'Резвый',
            hullNumber: '208',
            shipKind: 'torpedo',
            color: '#95d5b2',
            place: { slot: 4, corridor: 'left', left: 21, facing: 'left', enterFrom: 'right', tried: ['left'] },
            joinedAt: minutesAfterMidnight(21, 34),
        },
    ],
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
