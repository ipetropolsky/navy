import { describe, expect, it } from 'vitest';

import { CHAT_SHARE, SCENE_MIN_WIDTH, SHEET_TOP_GAP, SIDE_MIN_WIDTH } from '@/config/layout';
import { LayoutWish, allowedLayout, chatLimits, chatMode, chatRoom, defaultWish } from '@/hooks/useLayout';

/**
 * Сверка выбранного размера разговора с нынешним окном. Здесь только сама сверка — без окна,
 * без хранилища и без React: всё это чистые функции ровно для того, чтобы их можно было прогнать
 * по краям, а не ловить в браузере, меняя размер окна руками.
 */

/** Окно такой-то формы. Лежачее по умолчанию: раскладку выбирает отношение сторон. */
const view = (width: number, height: number) => ({ width, height });

/** Выбор человека. По умолчанию — умолчание приложения, с точечной правкой одной из раскладок. */
const wish = (patch: Partial<LayoutWish> = {}): LayoutWish => ({ ...defaultWish(), ...patch });

describe('chatMode', () => {
    it('в лежачем окне ставит разговор сбоку, в стоячем — под кадром', () => {
        expect(chatMode(view(1200, 900))).toBe('side');
        expect(chatMode(view(390, 844))).toBe('under');
    });

    it('квадратное окно считает стоячим', () => {
        // Сбоку разговор уходит только тогда, когда ширины действительно больше. На ничьей
        // остаётся раскладка под кадром: она работает в любом окне, а боковая — не в любом.
        expect(chatMode(view(800, 800))).toBe('under');
    });

    it('не спрашивает про размер окна вовсе', () => {
        // Планшет в портрете — окно немаленькое, но высокое: разговору место под кадром.
        // Порог по ширине увёл бы его в узкую колонку сбоку при полном экране свободной высоты.
        expect(chatMode(view(1024, 1366))).toBe('under');
    });
});

describe('chatRoom', () => {
    it('сбоку ход разговора — вся ширина окна', () => {
        expect(chatRoom('side', view(1200, 900))).toBe(1200);
    });

    it('под кадром — высота без полоски под шапку', () => {
        // «Во весь рост» у разговора значит «до низа шапки»: кнопками из шапки его и убирают.
        expect(chatRoom('under', view(390, 844))).toBe(844 - SHEET_TOP_GAP);
    });

    it('в окне ниже шапки ход не уходит в минус', () => {
        expect(chatRoom('under', view(390, 40))).toBe(0);
    });
});

describe('chatLimits', () => {
    it('под кадром пределов нет: разговор бывает и в щёлку, и во весь рост', () => {
        expect(chatLimits('under', view(390, 844))).toEqual({ min: 0, max: 844 - SHEET_TOP_GAP });
    });

    it('сбоку снизу держит сам разговор, сверху — кадр', () => {
        expect(chatLimits('side', view(1400, 900))).toEqual({
            min: SIDE_MIN_WIDTH,
            max: 1400 - SCENE_MIN_WIDTH,
        });
    });

    it('в тесном окне потолок не проваливается под пол', () => {
        // Кадру тут не хватает и своего минимума, и потолок вышел бы уже разговора. Пределы
        // обязаны остаться пригодными к счёту: на них считается и потяг, и подписи у коридора.
        expect(chatLimits('side', view(700, 500))).toEqual({ min: SIDE_MIN_WIDTH, max: SIDE_MIN_WIDTH });
    });
});

describe('allowedLayout', () => {
    it('доля переводится в пиксели по нынешнему ходу', () => {
        // Одна и та же треть на разных окнах даёт разный разговор — в этом весь смысл доли.
        expect(allowedLayout(wish({ side: { share: 1 / 3, back: 1 / 3 } }), view(1200, 900)).size).toBe(400);
        expect(allowedLayout(wish({ side: { share: 1 / 3, back: 1 / 3 } }), view(1800, 900)).size).toBe(600);
    });

    it('под кадром доля считается от места под шапкой, а не от всего окна', () => {
        const layout = allowedLayout(wish({ under: { share: 1 / 2, back: 1 / 2 } }), view(390, 864));
        expect(layout.mode).toBe('under');
        expect(layout.size).toBe((864 - SHEET_TOP_GAP) / 2);
    });

    it('сбоку не даёт разговору стать уже своего минимума', () => {
        expect(allowedLayout(wish({ side: { share: 0.05, back: 0.05 } }), view(1400, 900)).size).toBe(SIDE_MIN_WIDTH);
    });

    it('сбоку не даёт разговору отнять у кадра его минимум', () => {
        const layout = allowedLayout(wish({ side: { share: 0.9, back: 0.9 } }), view(1400, 900));
        expect(layout.size).toBe(1400 - SCENE_MIN_WIDTH);
        expect(layout.max).toBe(1400 - SCENE_MIN_WIDTH);
    });

    it('убранный разговор остаётся убранным в любом окне', () => {
        // Ноль не зажимается до минимума: иначе просторное окно само возвращало бы на экран то,
        // что с него убрали.
        const hidden = wish({ side: { share: 0, back: CHAT_SHARE }, under: { share: 0, back: CHAT_SHARE } });
        expect(allowedLayout(hidden, view(1400, 900)).shown).toBe(false);
        expect(allowedLayout(hidden, view(1400, 900)).size).toBe(0);
        expect(allowedLayout(hidden, view(390, 844)).shown).toBe(false);
    });

    it('убранный разговор не возвращается сменой раскладки', () => {
        // Убирают не «разговор сбоку», а разговор вообще: доля в нуле стоит сразу в обеих
        // раскладках — так её и пишет `hide`. Иначе поворот телефона отменял бы нажатие кнопки.
        const hidden = wish({ under: { share: 0, back: 0.5 }, side: { share: 0, back: 0.25 } });
        expect(allowedLayout(hidden, view(1200, 900)).shown).toBe(false);
        expect(allowedLayout(hidden, view(900, 1200)).shown).toBe(false);
    });

    it('размер каждой раскладки живёт своей жизнью', () => {
        // Треть высоты, выбранная на телефоне, не должна становиться третью ширины после
        // поворота: число то же, место совсем другое.
        const chosen = wish({ under: { share: 0.75, back: 0.75 }, side: { share: 0.25, back: 0.25 } });
        expect(allowedLayout(chosen, view(900, 1200)).size).toBe(Math.round((1200 - SHEET_TOP_GAP) * 0.75));
        expect(allowedLayout(chosen, view(1200, 900)).size).toBe(300);
    });

    it('тесное окно урезает выбор, но не переписывает его', () => {
        const chosen = wish({ side: { share: 0.6, back: 0.6 } });
        expect(allowedLayout(chosen, view(1000, 900)).size).toBe(1000 - SCENE_MIN_WIDTH);
        // То же самое в просторном окне — снова три пятых: урезает окно, а не выбор.
        expect(allowedLayout(chosen, view(2000, 900)).size).toBe(1200);
    });

    it('размер всегда целый', () => {
        // Дробный размер разговора даёт дробный кадр, а кадр рисует корабли и подписи —
        // половина пикселя там видна размытой кромкой.
        expect(Number.isInteger(allowedLayout(wish(), view(1357, 900)).size)).toBe(true);
    });
});

describe('defaultWish', () => {
    it('открывает разговор третью в обеих раскладках', () => {
        expect(allowedLayout(defaultWish(), view(1200, 900)).size).toBe(Math.round(1200 * CHAT_SHARE));
        expect(allowedLayout(defaultWish(), view(390, 844)).size).toBe(Math.round((844 - SHEET_TOP_GAP) * CHAT_SHARE));
    });

    it('открывается с разговором на экране', () => {
        expect(allowedLayout(defaultWish(), view(1200, 900)).shown).toBe(true);
        expect(allowedLayout(defaultWish(), view(390, 844)).shown).toBe(true);
    });
});
