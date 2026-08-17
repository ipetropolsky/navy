import { describe, expect, it } from 'vitest';

import { Member, authorLook, memberLook, memberRef } from '@/types/channel';

/**
 * Как в ленте находят автора. Правило простое, но у него две стороны, и обе видны только
 * вызовом: нынешний корабль важнее снимка, а снимок нужен затем, что участника может уже
 * не быть. В браузере вторую сторону пришлось бы добывать целым уходом с рейда.
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

describe('memberLook', () => {
    it('снимает с участника только то, чем он представлен в ленте', () => {
        expect(memberLook(ALBATROS)).toEqual({ name: 'Альбатрос', hullNumber: '317', color: '#8ecae6' });
    });
});

describe('memberRef', () => {
    it('кладёт рядом с id снимок: по нему автора и узнают, когда корабль уйдёт', () => {
        expect(memberRef(ALBATROS)).toEqual({
            memberId: 'm-albatros',
            look: { name: 'Альбатрос', hullNumber: '317', color: '#8ecae6' },
        });
    });
});

describe('authorLook', () => {
    it('показывает нынешний корабль, а не снимок: переоснастился — и в ленте он новый', () => {
        const refit: Member = { ...ALBATROS, name: 'Буран', hullNumber: '512' };

        expect(authorLook(memberRef(ALBATROS), refit)).toEqual({
            name: 'Буран',
            hullNumber: '512',
            color: '#8ecae6',
        });
    });

    it('берётся за снимок, когда корабля на рейде уже нет', () => {
        expect(authorLook(memberRef(ALBATROS), undefined)).toEqual({
            name: 'Альбатрос',
            hullNumber: '317',
            color: '#8ecae6',
        });
    });

    it('молчит, когда нет ни того ни другого: выдумывать позывной не из чего', () => {
        expect(authorLook({ memberId: 'm-albatros' }, undefined)).toBeUndefined();
    });
});
