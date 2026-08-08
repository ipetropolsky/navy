import { Message, Participant } from '@/types/chat';

export const DEMO_CHAT_TITLE = 'Эскадра «Полночь»';

export const DEMO_PARTICIPANTS: Participant[] = [
    { id: 'p1', name: 'Гроза', shipKind: 'corvette', joinedAt: 1 },
    { id: 'p2', name: 'Альбатрос', shipKind: 'patrol', joinedAt: 2 },
    { id: 'p3', name: 'Вымпел', shipKind: 'missile', joinedAt: 3 },
    { id: 'p4', name: 'Резвый', shipKind: 'torpedo', joinedAt: 4 },
    { id: 'p5', name: 'Кайра', shipKind: 'minesweeper', joinedAt: 5 },
];

export const DEMO_MESSAGES: Message[] = [
    {
        id: 'm1',
        authorId: 'p2',
        text: 'Встали на рейде у острова. Море спокойное, видимость отличная.',
        sentAt: '21:37',
    },
    { id: 'm2', authorId: 'p3', text: 'Принял. Огни притушить, работаем только сигнальной лампой.', sentAt: '21:39' },
    { id: 'm3', authorId: 'p1', text: 'Гроза на связи. Швартовы отданы, выходим из бухты.', sentAt: '21:41' },
    { id: 'm4', authorId: 'p4', text: 'Резвый идёт следом, держу кильватер.', replyToId: 'm3', sentAt: '21:42' },
    { id: 'm5', authorId: 'p5', text: 'Кайра на позиции. Тралы подняты, готова к переходу.', sentAt: '21:44' },
    { id: 'm6', authorId: 'p3', text: 'Луна вышла — остров как на ладони. Красота.', sentAt: '21:47' },
    { id: 'm7', authorId: 'p2', text: 'Ради такого и служим.', replyToId: 'm6', sentAt: '21:48' },
];

export const DEMO_TYPING_PHRASES = ['ТАК ТОЧНО', 'ПРИНЯЛ', 'КУРС НОРД', 'ЕСТЬ', 'ПОЛНЫЙ ВПЕРЁД'];

export const AUTHOR_COLORS = ['#8ecae6', '#f2cc8f', '#95d5b2', '#d8b4f8', '#f4978e'];
