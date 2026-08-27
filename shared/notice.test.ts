import { describe, expect, it } from 'vitest';

import { Member } from './types/channel';

import { refitNotices, shipTitle } from './notice';

/**
 * Записи канала о корабле. Проверяем ровно то, за что здесь отвечает бэкенд: что случилось
 * и с чем. Фраза складывается в ленте (`components/chat/ShipNoticeLine`), и её проверяют
 * сквозные проверки — там видно и саму строчку, и где она стоит.
 */

const ALBATROS: Member = {
    memberId: 'm-albatros',
    name: 'Альбатрос',
    hullNumber: '317',
    shipKind: 'pr1400',
    color: '#8ecae6',
    place: { slot: 4, corridor: 'center', left: 50, facing: 'left', enterFrom: 'right' },
    joinedAt: 0,
};

/** Тот же корабль с правкой: так его возвращает бэкенд после переоснащения. */
const changedTo = (patch: Partial<Member>): Member => ({ ...ALBATROS, ...patch });

describe('shipTitle', () => {
    it('снимает с участника только то, чем корабль зовут', () => {
        expect(shipTitle(ALBATROS)).toEqual({ shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' });
    });
});

describe('refitNotices', () => {
    it('называет изменившееся поле и оба состояния целиком', () => {
        expect(refitNotices(ALBATROS, changedTo({ hullNumber: '512' }))).toEqual([
            {
                event: 'refit',
                before: { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' },
                after: { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '512' },
                changed: 'hullNumber',
            },
        ]);
    });

    it('на каждую перемену пишет свою запись, а не одну на всё', () => {
        const notices = refitNotices(ALBATROS, changedTo({ hullNumber: '512', shipKind: 'pr1258', name: 'Буран' }));

        // Порядок титульный, от крупного к мелкому: силуэт, позывной, номер.
        expect(notices.map((notice) => notice.changed)).toEqual(['shipKind', 'name', 'hullNumber']);
        // Оба состояния у всех трёх одни и те же: перемена одна, а рассказана по частям.
        expect(notices.every((notice) => notice.after?.name === 'Буран')).toBe(true);
    });

    it('молчит, когда ничего не поменялось: пустой записи в ленте не место', () => {
        expect(refitNotices(ALBATROS, changedTo({}))).toEqual([]);
    });

    it('молчит и на смене цвета с местом: корабль от них не становится другим', () => {
        const moved = changedTo({
            color: '#f2cc8f',
            place: { slot: 7, corridor: 'left', left: 20, facing: 'right', enterFrom: 'left' },
        });

        expect(refitNotices(ALBATROS, moved)).toEqual([]);
    });
});
