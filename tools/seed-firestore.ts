/**
 * Сидирует демо-канал в Firestore: три корабля, уже стоящие на рейде, и начатый разговор.
 * Нужен по той же причине, что и `src/backend/seed.ts` у местного бэкенда, — открыть демо
 * на пустой базе и увидеть не пустую ленту, а живой канал, — только пишет не в localStorage
 * вкладки, а в Firestore эмулятора, через Admin SDK, в обход правил безопасности.
 *
 * Идемпотентен: у канала, участников, брони мест и сообщений — фиксированные id, и каждый
 * документ пишется через set(), а не add(). Повторный запуск переписывает те же документы
 * тем же телом, а не заводит вторые: посчитать корабли и реплики после двух запусков подряд —
 * и оба раза увидеть одно и то же число.
 *
 * Только для эмулятора: без FIRESTORE_EMULATOR_HOST в окружении скрипт не запускается — это
 * не боевой инструмент, а часть проверочного стенда (см. package.json → test:e2e:firebase,
 * куда переменную подставляет сам `firebase emulators:exec`).
 */

import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { paths } from '@shared/config/model';
import { Standing, berthAt, placeShip } from '@shared/placement';
import { Member, MemberRef, ShipKind, ShipNotice, memberLook } from '@shared/types/channel';

const CHANNEL_ID = 'ch-demo';
// Тот же адрес, на который ведёт кнопка «Демо» в App.tsx вне зависимости от бэкенда.
const CHANNEL_SLUG = 'demo';

// Время — от полуночи сегодняшнего дня, а не число из прошлого: демо не должно выглядеть
// перепиской недельной давности. В пределах одного запуска (и двух подряд — при проверке
// идемпотентности) полночь одна и та же, так что документы выходят одинаковыми побайтово.
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
const at = (hours: number, minutes: number): number => midnight.getTime() + (hours * 60 + minutes) * 60_000;

/** Экипаж демо-канала: три корабля разного размера, чтобы в кадре была видна разница. */
const CREW: (Omit<Member, 'place'> & { shipKind: ShipKind })[] = [
    {
        memberId: 'm-albatros',
        name: 'Альбатрос',
        hullNumber: '317',
        shipKind: 'pr1400',
        color: '#8ecae6',
        joinedAt: at(9, 0),
    },
    {
        memberId: 'm-vympel',
        name: 'Вымпел',
        hullNumber: '561',
        shipKind: 'pr1234',
        color: '#f2cc8f',
        joinedAt: at(9, 2),
    },
    { memberId: 'm-rezvy', name: 'Резвый', hullNumber: '208', shipKind: 'pr205', color: '#95d5b2', joinedAt: at(9, 4) },
];

/**
 * Куда встаёт каждый: по одному в свой коридор, подальше от острова (см. ISLAND_SIDE
 * в shared/types/channel.ts) — картинка фиксированная, а не собранная на глаз, но
 * геометрию по-прежнему считает расстановка (placeShip), а не эта строчка.
 */
const WANTED_BERTHS = [berthAt(1, 'left'), berthAt(5, 'center'), berthAt(8, 'right')];

/** Расставляет экипаж по местам той же функцией, которой пользуется настоящий вход на рейд. */
const placeCrew = (): Member[] => {
    const taken: Standing[] = [];
    return CREW.map((member, index) => {
        const place = placeShip(member.shipKind, taken, WANTED_BERTHS[index]);
        if (!place) {
            // Три корабля на тридцать мест — сюда дойти невозможно; это защита от опечатки
            // в WANTED_BERTHS, а не ожидаемый исход.
            throw new Error(`не нашлось места для ${member.name}`);
        }
        taken.push({ shipKind: member.shipKind, place });
        return { ...member, place };
    });
};

/** Кто-то из экипажа как автор реплики или системной строчки. */
const said =
    (members: Member[]) =>
    (memberId: string): MemberRef => {
        const member = members.find((item) => item.memberId === memberId);
        if (!member) {
            throw new Error(`нет такого участника: ${memberId}`);
        }
        return { memberId: member.memberId, look: memberLook(member) };
    };

interface SeedMessage {
    messageId: string;
    author: MemberRef;
    sentAt: number;
    kind?: 'system';
    text?: string;
    thread?: { messageId: string };
    notice?: ShipNotice;
}

/** Три входа на рейд и начатый разговор — есть что показать и на строчки канала, и на ленту. */
const buildMessages = (members: Member[]): SeedMessage[] => {
    const from = said(members);
    const joined = (memberId: string, hour: number, minute: number, before: ShipNotice['before']): SeedMessage => ({
        messageId: `msg-join-${memberId}`,
        author: from(memberId),
        sentAt: at(hour, minute),
        kind: 'system',
        notice: { event: 'joined', before },
    });

    return [
        joined('m-albatros', 9, 0, { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' }),
        joined('m-vympel', 9, 2, { shipKind: 'pr1234', name: 'Вымпел', hullNumber: '561' }),
        joined('m-rezvy', 9, 4, { shipKind: 'pr205', name: 'Резвый', hullNumber: '208' }),
        {
            messageId: 'msg-1',
            author: from('m-albatros'),
            sentAt: at(9, 6),
            text: 'Встали на рейде у острова. Видимость отличная.',
        },
        {
            messageId: 'msg-2',
            author: from('m-vympel'),
            sentAt: at(9, 7),
            text: 'Принял. Огни притушить, работаем сигнальной лампой.',
        },
        {
            messageId: 'msg-3',
            author: from('m-rezvy'),
            sentAt: at(9, 9),
            text: 'Резвый на связи, швартовы отданы.',
        },
        {
            messageId: 'msg-4',
            author: from('m-albatros'),
            sentAt: at(9, 10),
            text: 'Идём следом, держу кильватер.',
            thread: { messageId: 'msg-3' },
        },
        {
            messageId: 'msg-5',
            author: from('m-vympel'),
            sentAt: at(9, 12),
            text: 'Луна вышла, остров как на ладони.',
        },
    ];
};

const seed = async (): Promise<void> => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        throw new Error(
            'FIRESTORE_EMULATOR_HOST не задан. Этот скрипт сидирует только эмулятор — ' +
                'запускайте его через firebase emulators:exec (см. package.json → test:e2e:firebase)'
        );
    }

    const projectId = process.env.GCLOUD_PROJECT ?? 'demo-navy';
    initializeApp({ projectId });
    const db = getFirestore();

    const members = placeCrew();
    const messages = buildMessages(members);
    const batch = db.batch();

    batch.set(db.doc(paths.channel({ channelId: CHANNEL_ID })), {
        slug: CHANNEL_SLUG,
        title: 'Эскадра «Полночь»',
        createdAt: at(9, 0),
        owner: { memberId: members[0].memberId },
        serverAt: FieldValue.serverTimestamp(),
    });
    // Бронь адреса — тот же документ, что завела бы настоящая createChannel: без него слаг
    // не резервируется и вторую попытку создать канал с адресом «demo» ничего не остановит.
    batch.set(db.doc(paths.slug({ slug: CHANNEL_SLUG })), { channelId: CHANNEL_ID, createdAt: at(9, 0) });

    for (const member of members) {
        batch.set(db.doc(paths.member({ channelId: CHANNEL_ID, memberId: member.memberId })), {
            name: member.name,
            hullNumber: member.hullNumber,
            shipKind: member.shipKind,
            color: member.color,
            place: member.place,
            joinedAt: member.joinedAt,
            user: { userId: member.memberId },
        });
        const { slot, corridor } = member.place;
        batch.set(db.doc(paths.berth({ channelId: CHANNEL_ID, slot, corridor })), {
            slot,
            corridor,
            memberId: member.memberId,
            takenAt: member.joinedAt,
        });
    }

    for (const { messageId, ...doc } of messages) {
        batch.set(db.doc(paths.message({ channelId: CHANNEL_ID, messageId })), {
            ...doc,
            serverAt: FieldValue.serverTimestamp(),
        });
    }

    await batch.commit();

    // console.warn, а не console.log: правилам проекта дозволены только warn/error, а сама
    // строка — не предупреждение, а единственный отчёт скрипта о том, что он сделал.
    console.warn(
        `Готово: канал «${CHANNEL_SLUG}» (${CHANNEL_ID}), участников: ${members.length}, сообщений: ${messages.length}`
    );
};

seed().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
