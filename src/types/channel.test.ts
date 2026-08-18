import { describe, expect, it } from 'vitest';

import { Member, SLOT_COUNT, authorLook, memberLook, memberRef, projectLeft, slotShare } from '@/types/channel';

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

/**
 * Трапеция, которой рейд ложится на экран. Проверять тут стоит не арифметику — она в одну
 * строку, — а те два свойства, на которых держится вся затея: середина никуда не едет,
 * и чем дальше линия, тем сильнее точку тянет к середине. Первое отвечает за то, что рейд
 * остаётся по центру кадра, второе — за то, что у дальнего края место не кончается.
 */
const REACH_FAR = 92 / 124;
const NEAR = SLOT_COUNT - 1;

describe('projectLeft', () => {
    it('середину рейда оставляет серединой кадра на любой дальности', () => {
        expect(projectLeft(50, slotShare(0), REACH_FAR)).toBe(50);
        expect(projectLeft(50, slotShare(NEAR), REACH_FAR)).toBe(50);
    });

    it('на ближней линии не трогает ничего: там рейд и есть передний край', () => {
        expect(projectLeft(3.5, slotShare(NEAR), REACH_FAR)).toBeCloseTo(3.5, 10);
        expect(projectLeft(96.5, slotShare(NEAR), REACH_FAR)).toBeCloseTo(96.5, 10);
    });

    it('на дальней линии поджимает кромки к середине ровно во столько раз', () => {
        expect(projectLeft(0, slotShare(0), REACH_FAR)).toBeCloseTo(50 - 50 * REACH_FAR, 10);
        expect(projectLeft(100, slotShare(0), REACH_FAR)).toBeCloseTo(50 + 50 * REACH_FAR, 10);
    });

    it('тянет к середине тем сильнее, чем дальше линия', () => {
        const bySlot = [...new Array<number>(SLOT_COUNT)].map((_, slot) => projectLeft(0, slotShare(slot), REACH_FAR));

        expect(bySlot).toEqual([...bySlot].sort((a, b) => b - a));
        expect(bySlot[0]).toBeGreaterThan(bySlot[NEAR]);
    });

    it('на широком кадре проекция прямоугольная: рейд ложится один в один', () => {
        expect(projectLeft(0, slotShare(0), 1)).toBe(0);
        expect(projectLeft(100, slotShare(0), 1)).toBe(100);
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
