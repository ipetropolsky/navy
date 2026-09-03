import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { SLUG_MAX_LENGTH } from '@/utils/slug';

import {
    HULL_NUMBER_LENGTH,
    MAX_MESSAGE_LENGTH,
    MEMBER_COLORS,
    Member,
    NAME_MAX_LENGTH,
    SLOT_COUNT,
    TITLE_MAX_LENGTH,
    authorLook,
    isManoeuvre,
    manoeuvreFrom,
    memberLook,
    memberRef,
    projectLeft,
    resolveMemberColor,
    slotShare,
} from './channel';

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

/**
 * Пределы длины, продублированные в правилах безопасности. Импортов в языке правил нет:
 * предел стоит там числом, а здесь константой, — и такие пары разъезжаются молча. Причём
 * в худшую сторону: форма пускает, сервер отказывает, и поломкой это выглядит со стороны
 * приложения. Поэтому проверка читает настоящий `firestore.rules`, а не копию рядом.
 */

const RULES = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

const limitInRules = (name: string): number | undefined => {
    const found = new RegExp(`function ${name}\\(\\)\\s*\\{\\s*return\\s+(\\d+);`).exec(RULES);
    return found ? Number(found[1]) : undefined;
};

describe('пределы длины', () => {
    it.each([
        ['maxTitle', TITLE_MAX_LENGTH],
        ['maxSlug', SLUG_MAX_LENGTH],
        ['maxText', MAX_MESSAGE_LENGTH],
        ['maxName', NAME_MAX_LENGTH],
        ['maxHull', HULL_NUMBER_LENGTH],
    ])('%s в firestore.rules — то же число, что и в коде', (name, limit) => {
        expect(limitInRules(name)).toBe(limit);
    });
});

describe('isManoeuvre', () => {
    it('видит перемену места, силуэта и курса — всё, что кораблю не сменить стоя', () => {
        const moved = { place: { ...ALBATROS.place, slot: 7 }, shipKind: ALBATROS.shipKind };
        const refit = { place: ALBATROS.place, shipKind: 'pr1258' as const };
        const turned = { place: { ...ALBATROS.place, facing: 'right' as const }, shipKind: ALBATROS.shipKind };

        expect(isManoeuvre(ALBATROS, moved)).toBe(true);
        expect(isManoeuvre(ALBATROS, refit)).toBe(true);
        expect(isManoeuvre(ALBATROS, turned)).toBe(true);
    });

    it('молчит на позывном и номере: их меняют, не снимаясь с якоря', () => {
        const renamed: Member = { ...ALBATROS, name: 'Буран', hullNumber: '512' };

        expect(isManoeuvre(ALBATROS, renamed)).toBe(false);
    });
});

describe('manoeuvreFrom', () => {
    it('без срока не записывает ничего: доигрывать по такой записи нечего', () => {
        expect(manoeuvreFrom(ALBATROS, undefined, 1000)).toBeUndefined();
    });

    it('оставляет от прежнего корабля только место и силуэт', () => {
        // Целиком участник сюда не годится: у него есть и свой прошлый манёвр,
        // и запись вложилась бы сама в себя.
        expect(manoeuvreFrom(ALBATROS, 12.5, 1000)).toEqual({
            from: { place: ALBATROS.place, shipKind: 'pr1400' },
            startedAt: 1000,
            seconds: 12.5,
        });
    });

    it('входящему прежнего места не пишет вовсе: приходить ему неоткуда', () => {
        expect(manoeuvreFrom(undefined, 12.5, 1000)).toEqual({ startedAt: 1000, seconds: 12.5 });
    });
});

/**
 * Цвет в форме входа (`resolveMemberColor` — то же умолчание, что MemberForm.tsx считает
 * заново на каждый проход, а не один раз в useState). Аккаунт отдаёт прошлый цвет (`lastColor`)
 * не сразу с первым `onChange`, а вторым, асинхронным приёмом (`src/backend/auth.ts`) — форма
 * к этому мигу уже смонтирована. Вызов с одним и тем же `picked`, но разным `lastColor`
 * как раз и разыгрывает эти два прохода: первый, ещё без прошлого цвета, и второй, когда
 * он подъехал следом.
 */
describe('resolveMemberColor', () => {
    it('первым проходом, пока прошлый цвет ещё не подъехал, берёт первый свободный', () => {
        expect(resolveMemberColor(null, [], undefined, undefined)).toBe(MEMBER_COLORS[0]);
    });

    it('вторым проходом, когда прошлый цвет подъехал следом, подставляет его', () => {
        // Тот же человек, тот же рейд — переменилось только то, что accountLook наконец дошёл.
        // На старом коде (useState с ленивым инициализатором) второй проход ничего не менял:
        // цвет застревал первым свободным, посчитанным ещё до прихода lastColor.
        expect(resolveMemberColor(null, [], undefined, MEMBER_COLORS[2])).toBe(MEMBER_COLORS[2]);
    });

    it('прошлый цвет, занятый на этом рейде, не подставляет — берёт первый свободный', () => {
        const taken = [MEMBER_COLORS[0], MEMBER_COLORS[2]];

        expect(resolveMemberColor(null, taken, undefined, MEMBER_COLORS[2])).toBe(MEMBER_COLORS[1]);
    });

    it('своя рука сильнее прошлого цвета: поздний lastColor её не перебивает', () => {
        // Человек уже ткнул в другой цвет до того, как lastColor вообще подъехал, — и после
        // прихода lastColor выбор остаётся его собственным, а не переезжает следом за пропом.
        expect(resolveMemberColor(MEMBER_COLORS[4], [], undefined, undefined)).toBe(MEMBER_COLORS[4]);
        expect(resolveMemberColor(MEMBER_COLORS[4], [], undefined, MEMBER_COLORS[1])).toBe(MEMBER_COLORS[4]);
    });

    it('цвет уже стоящего в строю корабля сильнее прошлого: он и есть нынешний, а не прошлый', () => {
        expect(resolveMemberColor(null, [], MEMBER_COLORS[3], MEMBER_COLORS[1])).toBe(MEMBER_COLORS[3]);
    });
});
