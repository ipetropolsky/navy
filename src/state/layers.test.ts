import { describe, expect, it } from 'vitest';

import { Intent, Layers, NOTHING_OPEN, reduce } from '@/state/layers';

/** Последовательность ходов от пустого экрана: доска после них и есть то, что проверяем. */
const after = (...intents: Intent[]): Layers => intents.reduce(reduce, NOTHING_OPEN);

/** Разговор на экране: слой поедет сам, панель поднимать не надо. */
const ships = (talking = true): Intent => ({ type: 'ships', talking });
const editShip = (talking = true): Intent => ({ type: 'edit-ship', talking });

describe('слои коробки', () => {
    it('название канала открывает список и оно же закрывает', () => {
        expect(after(ships()).list).toBe(true);
        expect(after(ships(), ships()).list).toBe(false);
    });

    it('поверх списка форма его не разбирает', () => {
        const both = after(ships(), editShip());
        expect(both.list, 'список закрылся под формой').toBe(true);
        expect(both.form).toBe(true);
    });

    it('закрытая форма возвращает к списку, из которого её позвали', () => {
        const back = after(ships(), editShip(), { type: 'close-form' });
        expect(back.form).toBe(false);
        expect(back.list, 'список ушёл вместе с формой').toBe(true);
    });

    it('название канала при открытой форме снимает форму, а список оставляет', () => {
        const back = after(ships(), editShip(), ships());
        expect(back.form).toBe(false);
        expect(back.list, 'закрылись оба слоя разом').toBe(true);
    });

    // Форму зовут и из кадра, минуя список: тогда закрывать под ней нечего.
    it('форма из кадра открывается без списка и закрывается в пустоту', () => {
        expect(after(editShip()).list).toBe(false);
        expect(after(editShip(), { type: 'close-form' })).toEqual(NOTHING_OPEN);
    });
});

describe('шторки поверх всего', () => {
    it('карточка чужого корабля список под собой не трогает', () => {
        const card = after(ships(), { type: 'show-ship', memberId: 'm-1' });
        expect(card.shownId).toBe('m-1');
        expect(card.list, 'список закрылся под карточкой').toBe(true);
    });

    it('закрытая карточка возвращает в список', () => {
        const back = after(ships(), { type: 'show-ship', memberId: 'm-1' }, { type: 'close-card' });
        expect(back.shownId).toBe(null);
        expect(back.list).toBe(true);
    });

    // Иначе затемнение шторки накрыло бы ровно то, ради чего по кораблю и нажали.
    it('форма своего корабля снимает открытую карточку чужого', () => {
        const form = after({ type: 'show-ship', memberId: 'm-1' }, editShip());
        expect(form.shownId, 'карточка осталась поверх формы').toBe(null);
        expect(form.form).toBe(true);
    });

    it('уход с рейда спрашивает курс и закрывает форму под собой', () => {
        const asking = after(editShip(), { type: 'ask-course' });
        expect(asking.leaving).toBe(true);
        expect(asking.form, 'форма осталась под шторкой прощания').toBe(false);
    });

    it('передумавший уходить возвращается в список', () => {
        const back = after(ships(), { type: 'ask-course' }, { type: 'close-course' });
        expect(back.leaving).toBe(false);
        expect(back.list).toBe(true);
    });

    it('ушедший уносит с собой и шторку, и список', () => {
        expect(after(ships(), { type: 'ask-course' }, { type: 'left' })).toEqual(NOTHING_OPEN);
    });
});

describe('постановка в строй', () => {
    it('свой канал встречает открытой формой, чужой — закрытой', () => {
        expect(after({ type: 'arrive', own: true }).joining).toBe(true);
        expect(after({ type: 'arrive', own: false }).joining).toBe(false);
    });

    // Из своего канала уходят на главную и оттуда открывают чужой — и его встречают уже гостем.
    it('переход в чужой канал закрывает форму, открытую в своём', () => {
        expect(after({ type: 'arrive', own: true }, { type: 'arrive', own: false }).joining).toBe(false);
    });

    it('вставший в строй форму больше не видит', () => {
        expect(after({ type: 'open-join' }, { type: 'joined' }).joining).toBe(false);
    });

    it('передумавший вставать возвращается к рейду', () => {
        expect(after({ type: 'open-join' }, { type: 'close-join' })).toEqual(NOTHING_OPEN);
    });
});

describe('панель под слоем', () => {
    it('при показанном разговоре слой едет сам', () => {
        const own = after(ships(true));
        expect(own.brought, 'панель подняли ради слоя, который и так на экране').toBe(false);
        expect(own.bringing).toBe(false);
    });

    it('при убранном — панель выдвигается вместе с готовым слоем внутри', () => {
        const carried = after(ships(false));
        expect(carried.brought).toBe(true);
        expect(carried.bringing, 'слой не стал дожидаться кадра').toBe(true);
    });

    it('дождавшись кадра, панель трогается и ждать больше нечего', () => {
        const moved = after(ships(false), { type: 'panel-moved' });
        expect(moved.bringing).toBe(false);
        expect(moved.brought, 'память о поднятой панели пропала раньше времени').toBe(true);
    });

    // Панель уже на экране, и второй слой её не поднимал: задвинуть её за человека не за что.
    it('слой, открытый в поднятую панель, её себе не присваивает', () => {
        const second = after(ships(false), { type: 'panel-moved' }, editShip(true));
        expect(second.brought).toBe(false);
    });

    it('человек сам выбрал размер разговора — панель больше не за слоем', () => {
        expect(after(ships(false), { type: 'chose' }).brought).toBe(false);
    });

    it('уехавший с экрана слой память о панели уносит', () => {
        expect(after(ships(false), { type: 'close-list' }, { type: 'layers-gone' }).brought).toBe(false);
    });
});

describe('ходы, которых доска не путает', () => {
    // Открытость — это про намерение человека; данные канала её не переписывают, и приход
    // сообщения посреди набранного в форме ничего не закрывает.
    it('намерения не мешают друг другу: список, карточка и постановка в строй порознь', () => {
        const busy = after({ type: 'open-join' }, ships(), { type: 'show-ship', memberId: 'm-2' });
        expect(busy).toEqual({
            ...NOTHING_OPEN,
            joining: true,
            list: true,
            shownId: 'm-2',
        });
    });

    it('одно и то же намерение подряд ничего не ломает', () => {
        const twice = after(editShip(), editShip());
        expect(twice).toEqual(after(editShip()));
    });

    it('закрывать закрытое можно сколько угодно', () => {
        expect(
            after(
                { type: 'close-form' },
                { type: 'close-list' },
                { type: 'close-card' },
                { type: 'close-course' },
                { type: 'close-join' }
            )
        ).toEqual(NOTHING_OPEN);
    });
});
