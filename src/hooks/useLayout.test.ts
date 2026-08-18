import { describe, expect, it } from 'vitest';

import { CHAT_SHARE, SCENE_MIN_WIDTH, SHEET_TOP_GAP, SIDE_MIN_WIDTH } from '@/config/layout';
import { LayoutWish, allowedLayout, chatLimits, chatMagnets, chatMode, chatRoom, defaultWish } from '@/hooks/useLayout';
import { MAGNET_GAP } from '@/utils/magnet';

/**
 * Сверка выбранного размера разговора с нынешним окном. Здесь только сама сверка — без окна,
 * без хранилища и без React: всё это чистые функции ровно для того, чтобы их можно было прогнать
 * по краям, а не ловить в браузере, меняя размер окна руками.
 */

/** Окно такой-то формы. Лежачее по умолчанию: раскладку выбирает отношение сторон. */
const view = (width: number, height: number) => ({ width, height });

/** Выбор человека. По умолчанию — умолчание приложения, с точечной правкой одной из раскладок. */
const wish = (patch: Partial<LayoutWish> = {}): LayoutWish => ({ ...defaultWish(), ...patch });

/**
 * Пол разговора под кадром, px: ручка и поле ввода под ней. В приложении его меряют на месте
 * (плашка растёт от ответа над полем и от выреза экрана снизу), здесь берём круглое число —
 * проверяется не оно само, а то, что его слушают.
 */
const FLOOR = 78;

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

    it('не спрашивает про размер окна как про порог сам по себе', () => {
        // Планшет в портрете — окно немаленькое, но высокое: разговору место под кадром.
        // Порог по одной лишь ширине увёл бы его в узкую колонку сбоку при полном экране
        // свободной высоты; отсечка ниже до этого случая не дотягивается — окно и так стоячее.
        expect(chatMode(view(1024, 1366))).toBe('under');
    });

    it('мобильную клавиатуру, ужавшую высоту ниже ширины, в боковую раскладку не пускает', () => {
        // Телефон 390×844, клавиатура забрала высоту до 300: окно формально стало лежачим,
        // но кадру и панели вдвоём в 390px не встать (см. SCENE_MIN_WIDTH + SIDE_MIN_WIDTH),
        // и раскладка не должна превращаться в панель на телефонном экране.
        expect(chatMode(view(390, 300))).toBe('under');
    });

    it('держит отсечку ровно на сумме минимумов кадра и панели', () => {
        const threshold = SCENE_MIN_WIDTH + SIDE_MIN_WIDTH;
        expect(chatMode(view(threshold - 1, threshold - 2))).toBe('under');
        expect(chatMode(view(threshold, threshold - 1))).toBe('side');
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
        // обязаны остаться пригодными к счёту: на них считается и свайп, и подписи у коридора.
        expect(chatLimits('side', view(700, 500))).toEqual({ min: SIDE_MIN_WIDTH, max: SIDE_MIN_WIDTH });
    });

    it('под кадром низом стоит пол, которым разговор торчит из-за кромки', () => {
        // Свёрнутый до упора разговор с экрана не пропадает: внизу от него остаются ручка
        // и поле ввода под ней, и высота их приходит замером снаружи.
        expect(chatLimits('under', view(390, 844), FLOOR)).toEqual({ min: FLOOR, max: 844 - SHEET_TOP_GAP });
    });

    it('сбоку пола нет: панель убирают целиком', () => {
        // Замер поля ввода в боковой раскладке ни при чём — там разговор уходит за правую
        // кромку весь, и полоски от него не остаётся.
        expect(chatLimits('side', view(1400, 900), FLOOR)).toEqual({
            min: SIDE_MIN_WIDTH,
            max: 1400 - SCENE_MIN_WIDTH,
        });
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

    it('под кадром разговор ложится на пол, а не пропадает', () => {
        // Кнопки, возвращающей разговор, под кадром нет вовсе: он всегда снизу, и нулём быть
        // ему нельзя — иначе писать в канал было бы нечем.
        const layout = allowedLayout(wish({ under: { share: 0, back: CHAT_SHARE } }), view(390, 844), FLOOR);
        expect(layout.size).toBe(FLOOR);
        expect(layout.shown).toBe(true);
        expect(layout.folded).toBe(true);
    });

    it('доля ниже пола до пола и дотягивается', () => {
        // Половина ручки с полем ввода — не размер: разговор в неё не сминается, а встаёт
        // на пол целиком.
        const layout = allowedLayout(wish({ under: { share: 0.05, back: CHAT_SHARE } }), view(390, 844), FLOOR);
        expect(layout.size).toBe(FLOOR);
        expect(layout.folded).toBe(true);
    });

    it('разговор выше пола свёрнутым не считается', () => {
        const layout = allowedLayout(defaultWish(), view(390, 844), FLOOR);
        expect(layout.size).toBeGreaterThan(FLOOR);
        expect(layout.folded).toBe(false);
    });

    it('сбоку пол не мешает убрать панель', () => {
        // Пол — мерка нижней раскладки. Сбоку убранная панель остаётся нулём, иначе кнопка
        // в шапке перестала бы что-либо делать.
        const hidden = wish({ side: { share: 0, back: CHAT_SHARE } });
        expect(allowedLayout(hidden, view(1400, 900), FLOOR).size).toBe(0);
        expect(allowedLayout(hidden, view(1400, 900), FLOOR).shown).toBe(false);
    });

    it('размер всегда целый', () => {
        // Дробный размер разговора даёт дробный кадр, а кадр рисует корабли и подписи —
        // половина пикселя там видна размытой кромкой.
        expect(Number.isInteger(allowedLayout(wish(), view(1357, 900)).size)).toBe(true);
    });
});

describe('chatMagnets', () => {
    /** Точки той раскладки, в которую попадает окно такой формы. */
    const points = (width: number, height: number, floor = 0) =>
        chatMagnets(allowedLayout(defaultWish(), view(width, height), floor));

    it('под кадром это пол и три записанные доли хода', () => {
        // Ход тут — окно без полоски под шапку, и доли считаются от него: 780 = 844 − 64.
        expect(points(390, 844)).toEqual([0, 260, 520, 780]);
    });

    it('нижней точкой стоит пол, а не ноль', () => {
        // Разговор под кадром неубираемый: самое малое, во что он сворачивается, — ручка
        // с полем ввода. Доли при этом остаются теми же самыми.
        expect(points(390, 844, FLOOR)).toEqual([FLOOR, 260, 520, 780]);
    });

    it('сбоку доли за пределом прижимаются к упору, а не пропадают', () => {
        // Окно 1200: треть — 400, а вот две трети (800) и весь ход (1200) кадру не оставили бы
        // и шестисот. Обе встают на упор, и точек остаётся три: убрать, треть, до упора.
        expect(points(1200, 900)).toEqual([0, 400, 600]);
    });

    it('сбоку широкому окну хватает и трёх долей, и всех четырёх', () => {
        // Окно 2400: упор — 1800, и под ним умещаются обе доли. Точек четыре, как и записано.
        expect(points(2400, 1000)).toEqual([0, 800, 1600, 1800]);
    });

    it('сошедшиеся у упора точки не остаются обеими', () => {
        // Окно 950: упор — 350, треть — 317. Между ними 33px, а различить человек может
        // не ближе `MAGNET_GAP`; ближняя к упору и уходит.
        const settled = points(950, 700);
        expect(settled).toEqual([0, 350]);
        expect(Math.min(...settled.slice(1).map((point, index) => point - settled[index]))).toBeGreaterThanOrEqual(
            MAGNET_GAP
        );
    });

    it('ноль остаётся нулём и там, где у размера есть свой минимум', () => {
        // Сбоку разговор уже 300px не бывает, но это про разговор на экране. Ноль — его
        // отсутствие, и без этой точки убрать разговор свайпом было бы нечем.
        expect(points(1200, 900)[0]).toBe(0);
        expect(points(390, 844)[0]).toBe(0);
    });

    it('под кадром слой отнимает пол, а доли оставляет', () => {
        // Пол под кадром — это разговор, свёрнутый до ручки с плашкой ввода, и держится он
        // на плашке. У формы и списка плашки нет, и в ту же полоску они сминаются мусором.
        // Точки — те же самые доли, только без нижней: и ручке, и свайпу, и стрелкам.
        expect(chatMagnets(allowedLayout(defaultWish(), view(390, 844), FLOOR), true)).toEqual([260, 520, 780]);
    });

    it('сбоку слой пола не отнимает', () => {
        // Сбоку ноль значит «убрать панель за кромку», а не «смять до полоски»: панель убирают
        // вместе с тем, что в ней стоит, и слой этому не помеха.
        expect(chatMagnets(allowedLayout(defaultWish(), view(1200, 900)), true)).toEqual(points(1200, 900));
    });

    it('в тесном окне остаются хотя бы две точки', () => {
        // 900 — ровно порог, на котором чатМод ещё пускает в боковую раскладку (см. описание
        // `chatMode`): кадру там не хватает и своего минимума, упор совпал с полом, и все три
        // доли встали на одно число. Убрать и вернуть — то немногое, что должно работать всегда.
        expect(points(900, 800)).toEqual([0, SIDE_MIN_WIDTH]);
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
