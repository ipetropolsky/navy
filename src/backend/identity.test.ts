import { beforeEach, describe, expect, it } from 'vitest';

import {
    forgetMemberId,
    myIdentity,
    readLastLook,
    readMemberId,
    rememberLastLook,
    rememberMemberId,
} from '@/backend/identity';

/**
 * Память вкладки о себе: кто она такая и каким кораблём ходит в каком канале.
 *
 * Хранилища тут нет — юниты идут в node, без окна и без браузера, — поэтому подставляем
 * своё: `sessionStore` берёт `window.sessionStorage` не на импорте, а на каждом обращении
 * (см. `utils/storage`), и подмены ему довольно. Заодно это и проверка того самого свойства:
 * сломайся ленивое обращение — тест перестал бы видеть записи.
 */

const cell = new Map<string, string>();

const fakeStorage = {
    getItem: (key: string): string | null => cell.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        cell.set(key, value);
    },
    removeItem: (key: string): void => {
        cell.delete(key);
    },
};

beforeEach(() => {
    cell.clear();
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: fakeStorage };
});

describe('личность', () => {
    it('заводится при первом обращении и дальше не меняется', () => {
        const first = myIdentity();
        expect(first).toBeTruthy();
        expect(myIdentity()).toBe(first);
    });

    it('у другой вкладки своя: пустое хранилище — новая личность', () => {
        const first = myIdentity();
        cell.clear();
        expect(myIdentity()).not.toBe(first);
    });
});

describe('связка каналов', () => {
    it('помнит по кораблю на канал и не путает их между собой', () => {
        rememberMemberId('ch-demo', 'm-albatros');
        rememberMemberId('ch-north', 'm-groza');
        expect(readMemberId('ch-demo')).toBe('m-albatros');
        expect(readMemberId('ch-north')).toBe('m-groza');
        expect(readMemberId('ch-empty')).toBeNull();
    });

    it('забывает один канал, не трогая остальные', () => {
        rememberMemberId('ch-demo', 'm-albatros');
        rememberMemberId('ch-north', 'm-groza');
        forgetMemberId('ch-demo');
        expect(readMemberId('ch-demo')).toBeNull();
        expect(readMemberId('ch-north')).toBe('m-groza');
    });

    it('вся лежит под личностью: сменилась личность — связка пустая', () => {
        rememberMemberId('ch-demo', 'm-albatros');
        cell.clear();
        expect(readMemberId('ch-demo')).toBeNull();
    });

    it('битую запись считает пустой, а не роняет чтение', () => {
        const identity = myIdentity();
        cell.set(`kilvater.crew.${identity}`, 'не json');
        expect(readMemberId('ch-demo')).toBeNull();
        // И запись после этого проходит: связка собирается заново.
        rememberMemberId('ch-demo', 'm-albatros');
        expect(readMemberId('ch-demo')).toBe('m-albatros');
    });

    it('подбирает запись прежней формы — по ключу на канал', () => {
        cell.set('kilvater.member.ch-demo', 'm-albatros');
        expect(readMemberId('ch-demo')).toBe('m-albatros');
        // Подобранное переезжает в связку, а прежний ключ убирается: подбирать дважды нечего.
        expect(cell.has('kilvater.member.ch-demo')).toBe(false);
        expect(readMemberId('ch-demo')).toBe('m-albatros');
    });

    it('новая запись важнее прежней формы: в связке уже свой корабль', () => {
        rememberMemberId('ch-demo', 'm-groza');
        cell.set('kilvater.member.ch-demo', 'm-albatros');
        expect(readMemberId('ch-demo')).toBe('m-groza');
    });
});

describe('внешность', () => {
    it('ни разу не выходили в море — нечего и подставлять', () => {
        expect(readLastLook()).toBeNull();
    });

    it('помнит силуэт и цвет и отдаёт их следующему каналу', () => {
        rememberLastLook({ shipKind: 'pr1141', color: '#ff8a3d' });
        expect(readLastLook()).toEqual({ shipKind: 'pr1141', color: '#ff8a3d' });
    });

    it('битую и неполную запись считает пустой', () => {
        const identity = myIdentity();
        cell.set(`kilvater.look.${identity}`, 'не json');
        expect(readLastLook()).toBeNull();
        cell.set(`kilvater.look.${identity}`, JSON.stringify({ shipKind: 'pr1141' }));
        expect(readLastLook()).toBeNull();
    });
});
