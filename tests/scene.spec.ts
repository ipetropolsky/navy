import { Locator, Page, expect } from '@playwright/test';

import { SHIP_TAP_MIN } from '@/config/layout';
import { Anchored, EDGE_MARGIN, restingDrift, restingYaw } from '@shared/placement';
import { slotShare } from '@shared/types/channel';

import {
    ALBATROS,
    DEMO,
    SAIL_TIMEOUT,
    TIME_SCALE,
    VYMPEL,
    berths,
    bubbles,
    clickShip,
    forgetLocalTab,
    hasten,
    join,
    leaveRaid,
    myShipParked,
    openChannel,
    openJoinForm,
    openNewChannel,
    openSheet,
    openShipCard,
    openShipForm,
    readState,
    send,
    ships,
    shipsButton,
    takes,
    test,
    unhasten,
} from '@tests/helpers';

/**
 * Сцена: то, на чём уже наступали. Свой корабль однажды вставал на место без анимации,
 * ход считался в «длинах корпуса в секунду» и выходил в сотню узлов, а вода на стыке цикла
 * дёргалась. Проверки ниже — ровно про эти три места.
 */

/**
 * Разметка рейда по ширине, доли ширины кадра: шаг между коридорами и оба конца разбега,
 * на который боковые места отходят от своего коридора (@berth-spread-far и @berth-spread-near
 * в стилях сцены). Разбег продублирован сюда: переменные Less в проверку не дотянуть, а вывести
 * его из самих замеров нельзя — какие места окажутся свободными, решает расстановка.
 *
 * А вот шаг коридоров не дублируется, а считается: оси стоят на трёх пятых воды между полями
 * друг от друга (CORRIDOR_SHARES в placement.ts — 0.2, 0.5 и 0.8), и поле оттуда же. Числом
 * он тут однажды и стоял, и при появлении полей проверка на этом и упала — а упасть должна
 * была расстановка, если бы поле забыли где-нибудь применить.
 *
 * Значения десктопные: проверки этого файла идут в окне 1200×900.
 */
const CORRIDOR_STEP = (0.3 * (100 - 2 * EDGE_MARGIN)) / 100;
const SPREAD_FAR = -0.04;
const SPREAD_NEAR = 0.1;

/** Насколько боковое место этой линии отстоит от середины кадра, доля его ширины. */
const berthOffset = (slot: number): number => CORRIDOR_STEP + SPREAD_FAR + (SPREAD_NEAR - SPREAD_FAR) * slotShare(slot);

/**
 * Сама форма корабля. Через страницу её не взять: список кораблей остаётся под ней нижним
 * слоем (см. App.tsx, `listOpen`), а не закрывается, и в его строчках — тот же текст, что
 * и в самой форме: и позывной, и силуэт. Без этой мерки `getByText` находил бы сразу оба.
 */
const shipForm = (page: Page) => page.locator('form').filter({ has: page.getByPlaceholder('Гром') });

/**
 * Кнопка «Готово» самой формы корабля. Через страницу её не взять: форма выезжает поверх
 * разговора, и у поля ввода под ней тоже кнопка-submit.
 */
const shipFormSubmit = (page: Page) => shipForm(page).locator('button[type=submit]');

/**
 * Горящие огни каждого корабля в кадре: чем является каждый и где он стоит по вертикали.
 *
 * Спрашиваем `data-lit`, а не просто `data-light`: на месте стоят оба набора огней разом —
 * и ходовые, и якорные, — потому что потушенному надо догореть (см. Ship.module.less).
 * Горящие из них те, что помечены.
 */
const lights = (page: Page, within = '[class*="shipSlot"]'): Promise<{ kind: string; top: number }[][]> =>
    page.evaluate(
        (selector) =>
            [...document.querySelectorAll(selector)].map((slot) =>
                [...slot.querySelectorAll<HTMLElement>('[data-lit="true"]')].map((light) => ({
                    kind: light.dataset.light ?? '',
                    top: light.getBoundingClientRect().top,
                }))
            ),
        within
    );

test('свой корабль заплывает в кадр, а не возникает на месте', async ({ page }) => {
    // Свой канал, а не демо: там в кадре только наш корабль и путать его не с кем.
    await openNewChannel(page, 'zahod');
    await join(page, 'Гроза', '777');

    // Своя вкладка узнаёт о корабле дважды: сначала приходит участник, потом myId.
    // Признак «заходит» обязан пережить оба рендера — иначе анимация обрывается на старте.
    const entering = page.locator('[data-motion="entering"]');
    await expect(entering).toHaveCount(1);

    const running = await entering.evaluate((element) => element.getAnimations().length);
    expect(running, 'ход захода не начался').toBeGreaterThan(0);

    // И начинает он ход целиком за кромкой кадра. Иначе из-за края торчит нос стоящего
    // корабля, а трогается он у зрителя на глазах — разгон должен оставаться за кадром.
    // Меряем сам корабль, а не его дорожку: дорожка шириной с кадр, она за кромку не уходит.
    const hidden = await page.evaluate(() => {
        const scene = document.querySelector('[class*="_scene_"]')!.getBoundingClientRect();
        const lane = document.querySelector('[data-motion="entering"]')!;
        lane.getAnimations().forEach((animation) => {
            animation.pause();
            animation.currentTime = 0;
        });
        const box = lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect();
        return Math.min(box.right - scene.left, scene.right - box.left);
    });
    expect(hidden, 'в начале захода корабль виден в кадре').toBeLessThan(0);
});

test('место на рейде выбирается щелчком по воде, и корабль встаёт на выбранное', async ({ page }) => {
    // На главной мест нет вовсе: канала ещё нет, вставать некуда, и рейд там ничего
    // не предлагает — выбор места живёт в форме корабля и только в ней.
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(berths(page)).toHaveCount(0);

    await openNewChannel(page, 'mesto');

    // Свободные места помечены огоньками, и одно из них выбрано заранее: человек, который
    // ничего не трогал, всё равно должен видеть, куда встанет его корабль.
    await expect(berths(page).first()).toBeVisible();
    await expect(page.locator('[aria-pressed="true"][data-berth]')).toHaveCount(1);

    // Выбираем другое место — не то, что предложили. Целиться в сам огонёк не нужно:
    // щелчок по воде достаётся месту с ближайшей точкой, и восемь пикселей ниже огонька —
    // это по-прежнему он: соседняя дальность вдвое дальше.
    const free = page.locator('[data-berth][aria-pressed="false"]').last();
    const chosen = await free.getAttribute('data-berth');
    const spot = (await free.boundingBox())!;
    await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2 + 8);
    await expect(page.locator(`[data-berth="${chosen}"][aria-pressed="true"]`)).toHaveCount(1);
    await join(page, 'Гроза', '777');

    // И корабль оказывается ровно там: место выбирает человек, а не расстановка.
    const state = await readState(page);
    const [member] = Object.values(state.channels).find((item) => item.channel.slug === 'mesto')!.members;
    expect(`${member.place.slot}-${member.place.corridor}`).toBe(chosen);
});

/**
 * Разметка ищется по замеру в пикселях, а стоит в долях кадра, — значит после всякой перемены
 * кадра замер надо повторять. Поводом к повторению была одна высота, а на десктопе меняется
 * ровно ширина: панель разъезжается и съезжается, высота у кадра прежняя. Замер оставался
 * от прежнего, широкого кадра, коридоры в нём разнесены шире — и ближайшим к указателю выходил
 * сосед слева: наводишь на правый коридор, загорается центральный (issue #75).
 *
 * Проверка водит указателем по самим огонькам: подсветиться обязан тот, на который навели.
 * Мимо — это и есть та поломка, других способов её увидеть нет.
 */
test('после перемены ширины кадра подсвечивается место под указателем, а не соседнее', async ({ page }) => {
    await openNewChannel(page, 'shirina');
    await expect(berths(page).first()).toBeVisible();

    // Панель уезжает — кадр становится шире, высота у него та же.
    await page.getByRole('button', { name: 'Убрать панель' }).click();
    await expect(page.getByRole('button', { name: /^Вернуть панель/ })).toBeVisible();
    // Ждём не панель, а тишину после неё: замер разметки идёт с отсрочкой (SETTLE_MS в сцене),
    // и до её конца точки честно стоят от прежнего кадра. Отсрочка эта временем проверок
    // не ускоряется — она про покой размеров, а не про движение в кадре.
    await page.waitForTimeout(300);

    const spots = await berths(page).evaluateAll((dots) =>
        dots.map((dot) => {
            const box = dot.getBoundingClientRect();
            return { berth: dot.getAttribute('data-berth')!, x: box.left + box.width / 2, y: box.top + box.height / 2 };
        })
    );
    expect(spots.length, 'на воде не нашлось свободных мест').toBeGreaterThan(3);

    const missed: string[] = [];
    /* eslint-disable no-await-in-loop -- указатель один, места обходятся по очереди */
    for (const spot of spots) {
        await page.mouse.move(spot.x, spot.y);
        // Подсветка — состояние React, и появляется она кадром позже указателя.
        const lit = await page.evaluate(
            () =>
                new Promise<string | null>((resolve) => {
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() =>
                            resolve(
                                document.querySelector('[class*="berthDotNear"]')?.getAttribute('data-berth-light') ??
                                    null
                            )
                        )
                    );
                })
        );
        if (lit !== spot.berth) {
            missed.push(`${spot.berth} → ${lit ?? 'ничего'}`);
        }
    }
    /* eslint-enable no-await-in-loop */
    expect(missed, 'указатель на месте, а подсвечивается другое').toEqual([]);
});

/**
 * Курс выбирает человек, и выбор этот сквозной: силуэты в форме разворачиваются сразу,
 * корабль встаёт на рейде тем же носом, а заходит с противоположного борта — носом вперёд.
 * Раньше курс доставался кораблю от стороны захода, которую разыгрывал бэкенд, и повлиять
 * на него было нечем.
 */
test('курс выбирается в форме, и корабль встаёт на рейде именно так', async ({ page }) => {
    await openNewChannel(page, 'kurs');

    // Курс уже какой-то выбран — форма открывается с монеткой, а не с пустым местом.
    await expect(page.locator('[aria-pressed="true"][aria-label^="Курс"]')).toHaveCount(1);

    // Ставим курс вправо и смотрим на список кораблей: силуэты в кнопках стоят на этом курсе.
    await page.getByLabel('Курс вправо').click();
    const inForm = page.locator('[class*="portraitShip"] [data-facing]');
    expect(await inForm.count(), 'силуэтов в форме не видно').toBeGreaterThan(1);
    await expect(inForm.first()).toHaveAttribute('data-facing', 'right');
    await expect(inForm.last()).toHaveAttribute('data-facing', 'right');

    // Место берём ближнее: на дальних слева остров, и оттуда зайти нельзя ни при каком курсе.
    await page.locator('[data-berth="9-center"]').click();
    await join(page, 'Гроза', '777');

    await expect(ships(page).locator('[data-facing]')).toHaveAttribute('data-facing', 'right');
    const afterJoin = await readState(page);
    const [joined] = Object.values(afterJoin.channels).find((one) => one.channel.slug === 'kurs')!.members;
    expect(joined.place.facing, 'корабль встал не тем курсом, который выбрали').toBe('right');
    expect(joined.place.enterFrom, 'заход должен быть с противоположного борта, носом вперёд').toBe('left');

    // Переоснащение открывается с тем курсом, которым корабль стоит, — а не с новой монеткой.
    await shipsButton(page).click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.getByLabel('Курс вправо')).toHaveAttribute('aria-pressed', 'true');

    // Курс можно переменить — но это не разворот на якоре: корабль снимается с места
    // и заходит заново, теперь уже с другого борта. Развернуться, стоя на якоре, он не может,
    // а отзеркалить силуэт на глазах — то же самое, что подменить его.
    await page.getByLabel('Курс влево').click();
    await shipFormSubmit(page).click();
    await expect(page.locator('[data-motion="leaving"]'), 'корабль не пошёл на перезаход').toHaveCount(1);

    // Место осталось тем же, а сторона захода переменилась вслед за курсом: заходят
    // носом вперёд, то есть с противоположного борта. Сам перезаход дальше не досматриваем —
    // он такой же, как при перемене места, и проверен там.
    await expect
        .poll(
            async () =>
                Object.values((await readState(page)).channels).find((one) => one.channel.slug === 'kurs')!.members[0]
                    .place,
            { message: 'новый курс не дошёл до состояния' }
        )
        .toMatchObject({ slot: 9, corridor: 'center', facing: 'left', enterFrom: 'right' });
});

test('на одной линии помещаются двое, и борта не налезают друг на друга', async ({ page }) => {
    takes(5);
    // Двое на одной дальности были в правилах и раньше, но сходились едва ли не случайно:
    // вместимость линии считалась числом, а не размером кораблей. Теперь это решает геометрия,
    // и два катера расходятся бортами на любой линии — с этого и проверка.
    //
    // Рейд для неё свой, а не демо-канал: там расстановка каждый раз новая, и попадётся ли
    // в ней линия со свободным местом рядом с соседом — как повезёт (замер: в 84% раскладов).
    // Здесь же сосед один и стоит ровно там, где нам нужно.
    await openNewChannel(page, 'para');

    // Силуэт выбираем до того, как смотреть на воду: от размера зависит, куда этот корабль
    // влезет, и точки свободных мест пересчитываются под него.
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    await page.locator('[data-berth="5-center"]').click();
    await join(page, 'Малыш', '111');

    // Возвращаемся тем, кого в канале нет: канал встречает закрытой формой, а сосед остаётся
    // стоять. Открываем форму — и всё, что нужно для выбора места, снова на воде.
    //
    // На той же странице второй раз не встать в строй тем же кораблём (см. forgetLocalTab) —
    // без сброса join() ниже застал бы себя уже на месте «Малыша» и никуда бы не встал вторым.
    await forgetLocalTab(page);
    await openChannel(page, 'para', 'gost');
    await openJoinForm(page);
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();

    // Щёлкаем по воде, а не по самому огоньку: круг света у выбранного места широкий и вполне
    // может лечь поверх соседнего огонька. Место всё равно достанется тому, чья точка ближе.
    const shared = '5-left';
    const spot = await page.locator(`[data-berth="${shared}"]`).boundingBox();
    expect(spot, 'рядом с соседом не нашлось места').toBeTruthy();
    await page.mouse.click(spot!.x + spot!.width / 2, spot!.y + spot!.height / 2);
    await expect(page.locator(`[data-berth="${shared}"][aria-pressed="true"]`)).toHaveCount(1);
    await join(page, 'Гроза', '777');
    // Ждём признак, а не время: борта сравнивать можно только со стоящими кораблями. Заходящий
    // проходит над местом соседа по дороге к своему — застигнутый в этот миг, он с ним и
    // «налезает». Прежде тут стояла пауза в 1200 мс, и держалась она на том, что за это время
    // корабль не успевал дойти даже до середины пути.
    await myShipParked(page);

    const after = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'para')!.members
    );
    const line = Number(shared.split('-')[0]);
    expect(
        after.filter((member) => member.place.slot === line),
        'на линии не оказалось двоих'
    ).toHaveLength(2);

    // И это видно в кадре: борта у двоих на одной дальности не пересекаются. Линию берём
    // из места, написанного на самом корпусе, а не из высоты в кадре: на стоянке корабль
    // отходит от своей линии (restingDrift), и двое на одной линии стоят в кадре чуть
    // по-разному — на глаз это и есть стоянка вместо строя.
    const hulls = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-berth-ship]')].map((slot) => {
            const box = slot.getBoundingClientRect();
            return { line: slot.dataset.berthShip!.split('-')[0], left: box.left, right: box.right };
        })
    );
    // Пара тут одна, но ищем их все — так же, как выше искали место: правило про борта общее.
    const pairs = hulls.flatMap((one, index) =>
        hulls
            .slice(index + 1)
            .filter((other) => other.line === one.line)
            .map((other) => [one, other].sort((first, second) => first.left - second.left))
    );
    expect(pairs.length, 'в кадре не нашлось двух кораблей на одной дальности').toBeGreaterThan(0);
    for (const [near, far] of pairs) {
        expect(near.right, 'корабли на одной линии налезли друг на друга').toBeLessThan(far.left);
    }
});

// Дальше расстановку меряет placement.test.ts: расхождение тесных соседей (кто уступает первым,
// сколько отдаёт и когда отпускает), одинаковость разброса у любого, кто считает то же место.
// Правила эти арифметические, и браузер к ним не добавляет ничего, кроме четверти минуты хода
// по морю; здесь остаётся по одной проверке на тему — той, что правило доходит до экрана.

test('на стоянке корабль отходит от своей линии и разворачивает корпус', async ({ page }) => {
    takes(6);
    // Флот, выставленный точно по линиям и строго вдоль кадра, читается парадом, а не
    // стоянкой: на настоящем рейде корабли разводит ветром и течением. Отход по дальности
    // и малый разворот корпуса — это он и есть.
    //
    // Насколько отходить и насколько разворачиваться, решает расстановка — хешем по участнику
    // и его месту (restingDrift, restingYaw). Участник же заводится при постановке на рейд
    // со случайным идентификатором, и величины эти в каждом прогоне новые: порогом их
    // не проверить — хеш имеет полное право выдать отход в сотую долю пикселя. Сам разброс
    // проверяется в юнитах расстановки, а здесь — что назначенное доезжает до разметки:
    // берём числа из расстановки и сверяем с кадром.
    //
    // Канал свой, а не демо, и корабли в нём расставлены руками: в демо-канале места раздаёт
    // случай — вышло бы, что проверка каждый раз меряет другой рейд. Линии взяты вразбег
    // по всей глубине: у дальних промежуток вчетверо теснее, чем у ближних, и отход обязан
    // укладываться в оба.
    await openNewChannel(page, 'stoyanka');
    // Каждый anchor() — это на одной странице новый корабль, а значит и новая личность
    // (см. forgetLocalTab): без сброса вторая и третья заявки застали бы себя уже стоящими
    // на месте первой и никуда бы не встали.
    const anchor = async (memberId: string, name: string, hullNumber: string, berth: string): Promise<void> => {
        await forgetLocalTab(page);
        await openChannel(page, 'stoyanka', memberId);
        await openJoinForm(page);
        await page.locator(`[data-berth="${berth}"]`).click();
        await join(page, name, hullNumber);
    };
    await anchor('pervyy', 'Гром', '404', '8-center');
    await anchor('vtoroy', 'Вымпел', '303', '5-right');
    await anchor('tretiy', 'Резвый', '202', '2-right');

    // Разметка рейда видна только при открытой форме — точками свободных мест и подписями
    // занятых, — а гостю теперь и открывать нечего: не участнику канал отдаёт пустой снимок
    // (см. needsPreview в localBackend.ts), и рейда для него нет вовсе, открыта форма или нет.
    // Смотрим поэтому не гостем, а последним из своих же трёх: он и так уже в строю, а его
    // собственная форма показывает те же три корабля — два соседних имени да точку на своём
    // месте вместо третьего (о выбранном месте подпись не пишут, см. SeaScene,
    // shownBerths.picked). Сравнивать положение корабля больше не с чем.
    await openShipForm(page);

    const measure = () =>
        page.evaluate(() => {
            // Меряем дорожки, а не то, что на них стоит: дорожка неподвижна, а точка с подписью
            // качаются волной, и разовый замер застал бы их в случайной фазе. Нижняя кромка
            // дорожки — это и есть вода под килем, то самое место стоянки.
            const water = (node: Element): number => Math.round(node.getBoundingClientRect().bottom * 100) / 100;
            // Линии рейда с их местами: подписи занятых да точки свободных. Место нужно,
            // чтобы знать слот — по нему считается и своя линия корабля, и цена доли.
            const lines = [
                ...document.querySelectorAll<HTMLElement>('[data-berth-name]'),
                ...document.querySelectorAll<HTMLElement>('[data-berth]'),
            ].map((mark) => ({
                berth: mark.dataset.berthName ?? mark.dataset.berth!,
                water: water(mark.closest('[class*="Lane"]') ?? mark),
            }));
            const fleet = [...document.querySelectorAll<HTMLElement>('[data-berth-ship]')].map((hull) => {
                const lane = hull.closest<HTMLElement>('[class*="shipLane"]')!;
                return {
                    berth: hull.dataset.berthShip!,
                    water: water(lane),
                    yaw: Number.parseFloat(getComputedStyle(lane.querySelector('[class*="shipYaw"]')!).rotate),
                };
            });
            return { lines, fleet };
        });

    // И ждём, пока рейд устоится: замер тут разовый, а до него сцена успевает пошевелиться
    // трижды. Корабли идут по воде — отход считается от места, и застигнутый на полпути
    // корабль показывает не отход, а остаток дороги. Кадр меняет рост под открытой формой,
    // а отход считается в долях этого роста. Ещё не размеченная сцена и вовсе отдаёт всем
    // дорожкам нулевые коробки, и отход на них выходит ровным нулём.
    // Ждём поэтому не признака готовности — их тут пришлось бы перечислять все, — а покоя:
    // двух одинаковых замеров подряд. Шевелящаяся сцена двух таких не даёт.
    let previous = '';
    await expect
        .poll(
            async () => {
                const now = JSON.stringify(await measure());
                const still = now !== '' && now === previous;
                previous = now;
                return still;
            },
            { message: 'рейд так и не устоялся в кадре', timeout: SAIL_TIMEOUT }
        )
        .toBe(true);

    const raid = await measure();

    // Кто где стоит: в разметке лежит одно место, а хеш отхода считается по участнику,
    // и достать его можно только из хранилища. Расстановке участник нужен целиком, но берёт
    // она из него позывной-идентификатор да место — оттого и приведение: из хранилища
    // приходит он же, только с широкими типами полей.
    const kept = await readState(page);
    const crew = Object.values(kept.channels).find((channel) => channel.channel.slug === 'stoyanka')!.members;
    const anchored = new Map(crew.map((member) => [`${member.place.slot}-${member.place.corridor}`, member]));
    const slotOf = (berth: string): number => Number.parseInt(berth.split('-')[0], 10);

    expect(raid.fleet, 'на рейде не собралось трёх кораблей').toHaveLength(3);

    // Цена доли: сколько пикселей кадра приходится на единицу перспективы. Своей мерки
    // у неё нет — рейд натянут между двумя отступами, и в пикселях они тут неизвестны, —
    // поэтому цена снимается с самих линий: они стоят по слотам, и двух крайних довольно,
    // чтобы получить наклон.
    const marks = raid.lines.map((mark) => ({ share: slotShare(slotOf(mark.berth)), water: mark.water }));
    const far = marks.reduce((one, other) => (other.share < one.share ? other : one));
    const near = marks.reduce((one, other) => (other.share > one.share ? other : one));
    const perShare = (near.water - far.water) / (near.share - far.share);

    for (const ship of raid.fleet) {
        const member = anchored.get(ship.berth);
        expect(member, `на месте ${ship.berth} не нашлось участника`).toBeDefined();
        // Своя линия у корабля одна: подпись его же места. Она достаётся всем, кроме
        // стоящего на выбранном месте, — а выбранное свободно, чужих рейд не предлагает.
        const line = raid.lines.find((mark) => mark.berth === ship.berth);
        expect(line, 'у корабля не нашлось подписи своего места').toBeDefined();

        // Отход назначен расстановкой в слотах, а в кадре он в пикселях: переводим слоты
        // в доли перспективы, доли — в пиксели ценой доли. Пол-пикселя допуска — округление
        // долей в стилях, дальше сотых они не пишутся.
        const drift = restingDrift(member as unknown as Anchored);
        const step = perShare * (slotShare(member!.place.slot + drift) - slotShare(member!.place.slot));
        expect(ship.water - line!.water, `отход на месте ${ship.berth} не доехал до разметки`).toBeCloseTo(step, 0);

        // Разворот приходит в стили градусами и достаётся одному силуэту — сверяем его же.
        const yaw = restingYaw(member as unknown as Anchored);
        expect(ship.yaw, `разворот на месте ${ship.berth} не доехал до разметки`).toBeCloseTo(yaw, 1);
    }

    // И при этом никто не перебрался на чужую линию: отход — пятая часть промежутка,
    // а не половина. Промежуток у каждой линии свой — перспектива сводит дальние теснее, —
    // поэтому меряем его на месте: до ближайшей соседней линии в кадре.
    for (const ship of raid.fleet) {
        const line = raid.lines.find((mark) => mark.berth === ship.berth)!.water;
        const apart = raid.lines.map((other) => Math.abs(other.water - line)).filter((gap) => gap > 0.5);
        expect(Math.abs(ship.water - line), 'корабль ушёл на чужую линию').toBeLessThan(Math.min(...apart) / 2);
    }
});

test('свободные места на рейде зависят от выбранного корабля', async ({ page }) => {
    // Вместимость линии считается размером кораблей, а значит, свободные места у катера
    // и у корабля в полсотни метров разные. Знать об этом должна не форма, а сцена: силуэт
    // выбирают в форме, а огоньки на воде обязаны тут же пересчитаться.
    //
    // Рейд для этого строим сами, а не берём демо-канал: там расстановка каждый раз своя,
    // и попадётся ли в ней линия, где катеру место есть, а кораблю нет, — как повезёт.
    // Здесь же ровно один сосед и ровно на той дальности, где разница и должна быть видна:
    // у самого наблюдателя корпуса написаны крупнее всего, и кадра на двоих хватает не всем.
    //
    // Линия взята предпоследняя, а не самая ближняя: с полями по краям рейда на девятой линии
    // крупному кораблю не разойтись уже ни с кем, даже с катером, — и разница между силуэтами
    // там пропадает, обоим отказано. На восьмой она видна во всей полноте.
    await openNewChannel(page, 'razmer');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    await page.locator('[data-berth="8-center"]').click();
    await join(page, 'Вымпел', '111');

    // Смотрим вторым участником, а не гостем: гостю нечем увидеть даже то, что 8-центр занят, —
    // не участнику канал отдаёт пустой снимок (needsPreview в localBackend.ts), и линия читалась
    // бы свободной целиком. Второй входит по-настоящему, и далеко от восьмой линии, чтобы
    // не путаться с тем, что меряем, — а дальше уже своей формой перебирает силуэты, и выбор
    // корабля снова пересчитывает свободные места, как и раньше.
    await forgetLocalTab(page);
    await openChannel(page, 'razmer', 'nablyudatel');
    await openJoinForm(page);
    await page.locator('[data-berth="1-center"]').click();
    await join(page, 'Наблюдатель', '999');
    await openShipForm(page);

    const offered = async (ship: string): Promise<string[]> => {
        await shipForm(page).getByText(ship, { exact: true }).click();
        return berths(page).evaluateAll((dots) => dots.map((dot) => (dot as HTMLElement).dataset.berth ?? '').sort());
    };

    const forCutter = await offered('Пограничный сторожевой катер');
    const forShip = await offered('Малый ракетный корабль');

    // Рядом с кораблём на восьмой линии катеру место есть — в обоих соседних коридорах:
    // разойдясь по бортам, эти двое в рейд помещаются.
    expect(forCutter, 'катеру не предложили место борт о борт').toContain('8-left');
    expect(forCutter, 'катеру не предложили место борт о борт').toContain('8-right');

    // А второму такому же кораблю — нет: вдвоём они шире кадра, и разводить их некуда.
    // Линия занята ими целиком, в каком бы коридоре стоял первый.
    expect(
        forShip.filter((berth) => berth.startsWith('8-')),
        'крупному кораблю предложили занятую линию'
    ).toHaveLength(0);

    // И это не единственная потеря, но и не произвол: всё, что осталось кораблю, есть и у катера.
    expect(forShip.length, 'крупному кораблю предложили не меньше мест, чем катеру').toBeLessThan(forCutter.length);
    expect(
        forShip.filter((berth) => !forCutter.includes(berth)),
        'кораблю предложили место, которого нет у катера'
    ).toHaveLength(0);
});

test('соседняя линия занятого коридора остаётся на воде', async ({ page }) => {
    takes(4);
    // Теснота по дальности (MIN_SLOT_GAP) была запретом, и один корабль выключал из рейда
    // пять дальностей своего коридора — свою и по две в каждую сторону. Теперь это склонность:
    // соседняя линия человеку видна и доступна, а расстановка берёт её последней. Здесь
    // проверяется первое — то, что доходит до экрана; вторым занят placement.test.ts
    // («куда корабль встаёт сам»), и браузеру там нечего добавить.
    await openNewChannel(page, 'sosedi');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    await page.locator('[data-berth="4-center"]').click();
    await join(page, 'Малыш', '111');

    // Сторона первая: второй участник видит на воде обе соседние линии центрального коридора.
    // А вот сама четвёртая пропала — там место занято, и точка на воде у них была бы одна
    // на двоих. Второй, а не гость: гостю нечем узнать даже то, что четвёртая занята
    // (needsPreview в localBackend.ts отдаёт не участнику пустой снимок), и она читалась бы
    // свободной наравне с соседними. Входит он далеко от испытуемых линий — девятой хватит.
    await forgetLocalTab(page);
    await openChannel(page, 'sosedi', 'nablyudatel');
    await openJoinForm(page);
    await page.locator('[data-berth="9-center"]').click();
    await join(page, 'Наблюдатель', '999');
    await openShipForm(page);
    await shipForm(page).getByText('Пограничный сторожевой катер', { exact: true }).click();
    const offered = await berths(page).evaluateAll((dots) =>
        dots.map((dot) => (dot as HTMLElement).dataset.berth ?? '')
    );
    expect(offered, 'соседняя линия занятого коридора пропала с воды').toContain('3-center');
    expect(offered, 'соседняя линия занятого коридора пропала с воды').toContain('5-center');
    expect(offered, 'занятое место осталось на воде').not.toContain('4-center');
});

test('рейд подсвечивает одно место и только под указателем на воде', async ({ page }) => {
    await openNewChannel(page, 'podskazka');
    const scene = page.locator('[class*="scene_"]').first();
    const frame = (await scene.boundingBox())!;

    // Что где стоит: линия горизонта и точки свободных мест — в координатах страницы,
    // чтобы можно было целиться мышью.
    const view = await page.evaluate(() => ({
        horizon: document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top,
        dots: [...document.querySelectorAll<HTMLElement>('[data-berth]')].map((dot) => {
            const spot = dot.getBoundingClientRect();
            return {
                berth: dot.dataset.berth!,
                x: spot.left + spot.width / 2,
                y: spot.top + spot.height / 2,
            };
        }),
    }));

    // Центральный коридор идёт отвесно: его места стоят на середине кадра на любой дальности.
    const middle = view.dots.filter((dot) => dot.berth.endsWith('center'));
    const columns = new Set(middle.map((dot) => Math.round(dot.x)));
    expect(columns.size, 'центральный коридор разъехался по ширине').toBe(1);

    // Боковые сходятся к горизонту и расходятся к наблюдателю, как рельсы: у дальнего конца
    // рейда место стоит ближе к середине, чем сам коридор, у ближнего — заметно дальше.
    //
    // Считаем это долями ширины кадра, а не пикселями: и шаг коридоров, и оба конца разбега
    // заданы в долях, и на любом окне отношение между ними одно.
    const spread = (corridor: string): [number, number][] =>
        view.dots
            .filter((dot) => dot.berth.endsWith(corridor))
            .map((dot): [number, number] => [Number(dot.berth.split('-')[0]), Math.abs(dot.x - middle[0].x)])
            .sort((one, other) => one[0] - other[0]);

    for (const corridor of ['left', 'right']) {
        const places = spread(corridor);
        expect(places.length, `коридор ${corridor} свободными местами не размечен`).toBeGreaterThan(1);
        for (const [slot, offset] of places) {
            expect(offset / frame.width, `место ${slot}-${corridor} отошло от середины не на свою долю`).toBeCloseTo(
                berthOffset(slot),
                3
            );
        }
        expect(places.at(-1)![1], `коридор ${corridor} не разошёлся к наблюдателю`).toBeGreaterThan(places[0][1]);
    }
    // Симметрию проверять отдельно не нужно: доля выше одна на оба коридора, и меряется
    // она модулем расстояния до середины — значит и сходятся они к ней одинаково.

    // Какие места подсвечены. Подсветка — не отдельное пятно, а сама точка места, выросшая
    // в круг света, поэтому и признак у неё размерный: круг втрое шире точки. Растёт он
    // переходом, поэтому смотреть на него надо ожидающей проверкой.
    //
    // Порог посередине между точкой и кругом: и растущий, и гаснущий огонёк проходят его
    // за 160мс перехода, и ожидающая проверка это переждёт.
    const litMarks = (): Promise<string[]> =>
        page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-berth-light]')]
                .filter((light) => light.getBoundingClientRect().width > light.getBoundingClientRect().height * 1.5)
                .map((light) => light.dataset.berthLight!)
                .sort()
        );

    const picked = (await page.locator('[data-berth][aria-pressed="true"]').getAttribute('data-berth'))!;
    await expect.poll(litMarks, 'до наведения показано не только выбранное место').toEqual([picked]);

    // Указатель по небу: рейд не размечается — там не вода, вставать некуда.
    await page.mouse.move(frame.x + frame.width / 2, view.horizon - 20);
    await expect.poll(litMarks, 'над небом рейд размечает места').toEqual([picked]);

    // Указатель по воде: подсвечивается ровно одно место — ближайшее к указателю,
    // а не весь рейд разом.
    const spot = view.dots.find((dot) => dot.berth !== picked)!;
    await page.mouse.move(spot.x, spot.y);
    await expect
        .poll(litMarks, 'над водой подсвечено не ближайшее место')
        .toEqual(expect.arrayContaining([picked, spot.berth]));
    expect(await litMarks(), 'над водой размечен весь рейд, а не одно место').toHaveLength(2);
});

test('качка идёт по рейду волной, а не вразнобой', async ({ page }) => {
    await openNewChannel(page, 'volna');

    // Фаза качки места — отрицательная задержка его анимации, круг — её длительность.
    // Берём и то и другое из самой сцены: длительность цикла живёт в стилях, и знать её
    // проверке неоткуда.
    const phases = await page.evaluate(() => {
        const seconds = (value: string): number => parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1);
        const dots = [...document.querySelectorAll<HTMLElement>('[data-berth]')];
        const style = getComputedStyle(dots[0].querySelector('span')!);
        return {
            cycle: seconds(style.animationDuration),
            marks: dots.map((dot) => {
                const [slot, corridor] = dot.dataset.berth!.split('-');
                return {
                    slot: Number(slot),
                    corridor,
                    phase: -seconds(getComputedStyle(dot.querySelector('span')!).animationDelay),
                };
            }),
        };
    });

    expect(phases.cycle, 'у качки нет цикла, сдвиг не с чем сравнивать').toBeGreaterThan(0);

    /** Насколько вторая фаза отстаёт от первой, с. По кругу: сдвиг на цикл — это ноль. */
    const lag = (from: number, to: number): number => (((to - from) % phases.cycle) + phases.cycle) % phases.cycle;

    /** Сдвиг между соседями по ряду обязан быть один и тот же, иначе это не волна. */
    const expectEvenLag = (row: { key: number; phase: number }[], what: string): void => {
        const order = [...row].sort((one, other) => one.key - other.key);
        const lags = order
            .slice(1)
            .map((item, index) => lag(order[index].phase, item.phase) / (item.key - order[index].key));
        expect(lags.length, `${what}: сравнивать не с чем`).toBeGreaterThan(0);
        for (const step of lags) {
            expect(step, `${what}: соседи качаются в такт`).toBeGreaterThan(0);
            expect(step, `${what}: сдвиг между соседями неровный`).toBeCloseTo(lags[0], 2);
        }
    };

    // Вдоль коридора: волна идёт с горизонта на наблюдателя, каждая следующая линия
    // повторяет за предыдущей через один и тот же промежуток.
    for (const corridor of ['left', 'center', 'right']) {
        const row = phases.marks.filter((mark) => mark.corridor === corridor);
        expectEvenLag(
            row.map((mark) => ({ key: mark.slot, phase: mark.phase })),
            `коридор ${corridor}`
        );
    }

    // И поперёк: фронт идёт наискось, поэтому у соседних коридоров на одной линии
    // тоже свой постоянный сдвиг.
    const corridors = ['left', 'center', 'right'];
    for (const slot of new Set(phases.marks.map((mark) => mark.slot))) {
        const row = phases.marks.filter((mark) => mark.slot === slot);
        if (row.length === corridors.length) {
            expectEvenLag(
                row.map((mark) => ({ key: corridors.indexOf(mark.corridor), phase: mark.phase })),
                `линия ${slot}`
            );
        }
    }
});

test('качка идёт по одним часам, и пришедший позже попадает в ту же волну', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    // Форма корабля открывает выбор места, и точки на воде появляются много позже кораблей.
    // Вода у них общая, значит и часы общие: начни точка свой круг с нуля — она качалась бы
    // вразрез с корпусом, который на неё же и встанет. Тем же держится качка перезаходящего:
    // он появляется в кадре заново и обязан попасть в ту волну, которая уже идёт по рейду.
    await openShipForm(page);

    const clocks = await page.evaluate(() => {
        const seconds = (value: string): number => parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1);
        return [...document.querySelectorAll<HTMLElement>('[data-wave]')].map((element) => {
            const heave = element
                .getAnimations()
                .find((animation) => (animation as CSSAnimation).animationName?.includes('heave'));
            return {
                phase: Number(element.dataset.wave),
                at: Number(heave?.currentTime ?? 0) / 1000,
                cycle: seconds(getComputedStyle(element).animationDuration),
            };
        });
    });

    expect(clocks.length, 'качающегося в кадре нет вовсе').toBeGreaterThan(3);
    const cycle = clocks[0].cycle;
    expect(cycle, 'у качки нет цикла, сверять не с чем').toBeGreaterThan(0);

    // У каждого своя фаза — тем волна и идёт по рейду, — но часы за этой фазой одни.
    // Отняли фазу и получили точку общих часов: она обязана сойтись у всех.
    const origin = ({ at, phase }: { at: number; phase: number }): number => (((at - phase) % cycle) + cycle) % cycle;
    const first = origin(clocks[0]);
    for (const clock of clocks) {
        const apart = Math.abs(origin(clock) - first);
        expect(Math.min(apart, cycle - apart), 'качка идёт по своим часам у каждого').toBeLessThan(0.05);
    }
});

test('под своим кораблём лежит стрелка курса, а отошёл — место помечено точкой', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const mine = fleet.find((member) => member.memberId === ALBATROS)!;
    const key = `${mine.place.slot}-${mine.place.corridor}`;

    await openShipForm(page);

    // Своё место разметка не прячет: на нём лежит стрелка курса, и под своим кораблём она
    // такая же нужная, как под любым другим местом, — курсом корабль встанет в обе стороны.
    // Отличаем её от точки по вытянутости: стрелка лежит на воде и втрое с лишним шире себя.
    //
    // Меряем собственный размер, а не рамку на экране: стрелка уложена на воду наклоном
    // с перспективой (см. @berth-arrow-lay), и габаритная рамка уложенной трапеции шире
    // и выше её самой — вытянутость по ней выходит совсем не та.
    //
    // Порог поэтому взят по собственной коробке, до укладки: она ниже экранной ровно на
    // косинус наклона, и втрое с лишним — это её запас, а не тот, что видно в кадре.
    // Круг от такого далёк на любом месте рейда: у него стороны равны.
    const stretch = (): Promise<number> =>
        page.locator(`[data-berth-light="${key}"]`).evaluate((mark) => {
            const box = getComputedStyle(mark);
            return parseFloat(box.width) / parseFloat(box.height);
        });
    await expect(page.locator(`[data-berth="${key}"]`), 'под своим кораблём нет разметки').toHaveCount(1);
    await expect.poll(stretch, { message: 'на своём месте лежит не стрелка' }).toBeGreaterThan(2.5);

    // Подписи своего корабля рядом нет: имя прошло бы ровно через стрелку, а под своим
    // кораблём и без подписи понятно, кто здесь стоит.
    await expect(page.locator(`[data-berth-name="${key}"]`), 'своё имя написано поверх стрелки').toHaveCount(0);

    // Переключились на другое — своё стало обычным свободным местом, и точка на нём
    // загорелась: иначе некуда возвращаться. Точка круглая, стрелка — нет.
    await page.locator('[data-berth][aria-pressed="false"]').last().click();
    await expect(page.locator(`[data-berth="${key}"]`), 'на покинутое место некуда вернуться').toHaveCount(1);
    await expect.poll(stretch, { message: 'покинутое место осталось выбранным' }).toBeCloseTo(1, 1);
});

/**
 * Курс переставляют не только кнопками в форме, но и на самом рейде: на выбранном месте лежит
 * стрелка, и повторное нажатие по этому месту её разворачивает. Место при этом остаётся
 * выбранным — уйти с него можно, ткнув в другое.
 */
test('повторное нажатие по выбранному месту разворачивает курс', async ({ page }) => {
    await openNewChannel(page, 'razvorot');

    await page.getByLabel('Курс вправо').click();
    const picked = page.locator('[data-berth][aria-pressed="true"]');
    const key = await picked.getAttribute('data-berth');

    // Стрелка смотрит туда же, куда кнопка курса: отражением, а не второй картинкой.
    //
    // Зеркало ловим по знаку горизонтального множителя матрицы, а не по её началу: стрелка
    // уложена на воду наклоном с перспективой (см. @berth-arrow-lay), матрица от этого выходит
    // объёмной, и начинается она уже не с «matrix(-1». Знак же от укладки не зависит: наклон
    // идёт вокруг поперечной оси и горизонтального множителя не трогает вовсе, так что в минус
    // его уводит зеркало и только оно.
    //
    // Разбираем строку DOMMatrix'ем, а не регуляркой: у объёмной матрицы само слово «matrix3d»
    // содержит цифру, и первое число, выуженное из строки, — это тройка из названия.
    const mirrored = (): Promise<boolean> =>
        page
            .locator(`[data-berth-light="${key}"]`)
            .evaluate((mark) => new DOMMatrix(getComputedStyle(mark).transform).a < 0);
    await expect.poll(mirrored, { message: 'стрелка смотрит не туда, куда курс' }).toBe(false);

    // Нажали по тому же месту — курс развернулся, и форма показывает то же самое: и стрелка,
    // и кнопки берут его из одних рук.
    await picked.click();
    await expect(page.getByLabel('Курс влево')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(mirrored, { message: 'стрелка не развернулась вслед за курсом' }).toBe(true);
    await expect(page.locator(`[data-berth="${key}"]`), 'разворот увёл корабль с места').toHaveAttribute(
        'aria-pressed',
        'true'
    );

    // И обратно: разворот — это переключатель, а не одноразовый ход.
    await picked.click();
    await expect(page.getByLabel('Курс вправо')).toHaveAttribute('aria-pressed', 'true');
});

/**
 * Когда доля пройденного пути перевалила за `mark`, мс. Между кадрами — по прямой: кадр идёт
 * 16 мс, а расхождение, которое ищут этой меркой, — в разы больше.
 *
 * Берём первый переход снизу вверх, а не первый кадр за меркой: на кадре, где браузер только
 * назначил анимацию, прозрачность успевает мигнуть концом, и без взгляда на предыдущий кадр
 * замер попадал бы в этот блик.
 */
const crossed = (path: { ms: number; part: number }[], mark: number): number => {
    const at = path.findIndex((point, i) => i > 0 && point.part >= mark && path[i - 1].part < mark);
    expect(at, `доля ${mark} не пройдена ни на одном кадре`).toBeGreaterThan(0);
    const was = path[at - 1];
    const now = path[at];
    return was.ms + ((now.ms - was.ms) * (mark - was.part)) / (now.part - was.part);
};

test('разметка гаснет вместе с флотом, а не кадром', async ({ page }) => {
    // Время тут обычное: замер идёт покадрово и с запасом в полсотни миллисекунд, а ускоренное
    // высветление целиком короче этого запаса.
    await unhasten(page);
    await openChannel(page, DEMO, ALBATROS);
    await openShipForm(page);
    // Ждём, пока флот договорит своё: замер идёт по долям пути, и начинать его посреди
    // предыдущего движения нельзя — доли считались бы от полпути.
    // Смотрим на сам корпус: в призрак уходит он, а не весь корабль — огни на нём горят
    // по-прежнему (см. GHOST в Ship).
    const hull = page.locator('[class*="shipRock"] img').first();
    await expect
        .poll(() => hull.evaluate((one) => Number.parseFloat(getComputedStyle(one).opacity)), {
            message: 'флот так и не ушёл в призрак',
        })
        .toBeLessThan(0.51);

    // Точки и подписи стоят у самых кораблей, и пропади они разом, пока корпуса возвращаются
    // из призрака, — на корабле это читалось бы вспышкой. Поэтому после закрытия формы слой
    // ещё в кадре и догорает: он уходит тем же движением и за то же время, что и высветление.
    //
    // Смотрим на это покадрово, а не одним замером: слой однажды уже пропадал первым же кадром
    // и потом свои двести миллисекунд висел в кадре невидимым. Замер «прозрачность меньше
    // единицы» такое пропускал — ноль тоже меньше единицы, — и поймать это можно только тем,
    // что слой проходит через середину, а не перескакивает её.
    const frames = await page.evaluate(async () => {
        const ship = document.querySelector('[class*="shipRock"] img')!;
        const out: { ms: number; field: number; ship: number }[] = [];
        const step = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
        const cancel = [...document.querySelectorAll('button')].find((one) => one.textContent === 'Отмена');
        const at = performance.now();
        cancel!.click();
        const sample = async (): Promise<void> => {
            await step();
            const field = document.querySelector('[class*="berthField"]');
            out.push({
                ms: performance.now() - at,
                field: field ? Number.parseFloat(getComputedStyle(field).opacity) : 0,
                ship: Number.parseFloat(getComputedStyle(ship).opacity),
            });
        };
        for (let i = 0; i < 24; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await sample();
        }
        return out;
    });

    const midway = frames.filter((frame) => frame.field > 0.2 && frame.field < 0.8);
    expect(midway.length, 'разметка не гасла, а пропала кадром').toBeGreaterThan(2);

    // И гаснет она ровно тогда, когда светлеет флот. Считаем обоих в долях пройденного пути:
    // разметка идёт от единицы к нулю, корабль — от призрака к себе, — и сверяем, когда каждый
    // прошёл четверть, половину и три четверти. Так проверяется не длительность в стилях,
    // а то, что видно глазом.
    //
    // Сверяем по времени, а не кадр в кадр, потому что кадр в кадр они и не совпадают: разметка
    // уходит анимацией, корабль — переходом, и браузер заводит их с разных кадров. Глазу эти
    // 16 мс не видны, а покадровому замеру видны отлично — на крутом начале ease-out соседние
    // кадры расходятся на восьмую пути, и проверка сыпалась на ровном месте. Порог тут стоит
    // между тем, что даёт кадровый разнобой, и тем, что даёт перепутанное движение: разъедься
    // разметка с флотом на длительность кадра (@expand-seconds вдвое дольше), середина
    // разошлась бы на добрую сотню. Полсотни на этой шкале оказалось мало — на четверти пути
    // ловилось 50.9, — и семьдесят взяты как раз посередине: разнобой покрывают, а сотню нет.
    //
    // Призрака берём самым тёмным кадром, а не первым: корабль только светлеет, и если первый
    // замер пришёлся уже на движение, доли считались бы от полпути.
    const ghost = Math.min(...frames.map((frame) => frame.ship));
    const gone = frames.map((frame) => ({ ms: frame.ms, part: 1 - frame.field }));
    const back = frames.map((frame) => ({ ms: frame.ms, part: (frame.ship - ghost) / (1 - ghost) }));
    for (const mark of [0.25, 0.5, 0.75]) {
        const apart = Math.abs(crossed(gone, mark) - crossed(back, mark));
        expect(apart, `разметка и флот идут вразнобой на доле ${mark}`).toBeLessThan(70);
    }

    // И уходит из кадра совсем: иначе прозрачный слой навсегда остался бы поверх сцены.
    expect(frames.at(-1)!.field, 'догоревшая разметка осталась в кадре').toBe(0);
    await expect(page.locator('[class*="berthField"]'), 'догоревшая разметка осталась в кадре').toHaveCount(0);
});

test('подпись стоит на точке своего места, даже когда корабль отведён от края кадра', async ({ page }) => {
    takes(6);
    // Подпись подписывает место, а не корпус. Корабль над ней почти никогда не стоит ровно:
    // внутри своего коридора он разбросан по хешу, у края кадра его отодвигает внутрь
    // собственная ширина, а на тесной линии он уступает воду соседу. Возьми подпись мерки
    // корпуса — у ближних боковых мест имя уехало бы вместе с ним и повисло между стоянками.
    //
    // Берём для этого самый крупный корабль на ближней боковой линии: он там шире своего
    // коридора, кадр вдавливает его внутрь целиком, и с точкой они расходятся заведомо.
    await openNewChannel(page, 'podpis');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    const mine = '9-left';
    await page.locator(`[data-berth="${mine}"]`).click();
    await join(page, 'Гром', '404');

    // Открываем форму заново и переносим выбор на другое место: своё становится обычным
    // свободным, и точка на нём загорается — с ней и сверяем подпись. Сам корабль никуда
    // не идёт, место меняется только отправкой.
    //
    // Открываем её щелчком по своему кораблю: на рейде он один, и ближайшая стоянка тут
    // всегда его. Сперва дожидаемся, пока он встанет: идущий корабль формы не открывает,
    // и метки `shipMine` на нём в это время нет (см. `canEdit` в SeaScene).
    await myShipParked(page);
    await clickShip(page, page.locator('[class*="shipMine"]'));
    await expect(berths(page).first()).toBeVisible();
    await page.locator('[data-berth][aria-pressed="false"]').last().click();

    const axes = await page.evaluate((key) => {
        // Ось — середина самой отметки: и точка, и надпись, и корпус стоят серединой
        // на своём месте, а дорожки под ними — полосы во весь кадр.
        const middle = (node: Element): number => {
            const box = node.getBoundingClientRect();
            return box.left + box.width / 2;
        };
        return {
            dot: middle(document.querySelector(`[data-berth="${key}"]`)!),
            name: middle(document.querySelector(`[data-berth-name="${key}"] [class*="shipName_"]`)!),
            hull: middle(document.querySelector('[class*="shipSlot"]')!),
        };
    }, mine);
    expect(Math.abs(axes.name - axes.dot), 'подпись сошла с точки своего места').toBeLessThan(1);
    expect(Math.abs(axes.hull - axes.dot), 'корабль не отошёл от края кадра, и проверять нечего').toBeGreaterThan(20);
});

test('пока выбирают место, призраками становятся все корабли, а подписи не кренятся', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);
    await openShipForm(page);

    // Свой корабль высветляется наравне с чужими: место под ним закрыто им же, и, останься
    // он плотным, единственной невидимой стоянкой на рейде была бы как раз его собственная.
    //
    // Опознаём призрака по saturate: дымка дальности даёт корпусу яркость всегда, а цвет
    // из него выбирает только высветление. Берём корабли из кадра, а не со всей страницы:
    // в открытой форме нарисован ещё один — тот, которого выбирают, — и он плотный.
    const hulls = await page
        .locator('[class*="shipRock"] img')
        .evaluateAll((bodies) => bodies.map((body) => getComputedStyle(body).filter));
    expect(hulls.length, 'кораблей в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        hulls.every((filter) => filter.includes('saturate')),
        'кто-то из кораблей остался плотным'
    ).toBe(true);

    // Огни на призраке горят в полную силу: по ним и видно, что на месте кто-то стоит.
    const lights = await page
        .locator('[class*="shipRock"] [data-lit="true"]')
        .evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).opacity));
    expect(lights.length, 'огней в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        lights.every((opacity) => Number.parseFloat(opacity) === 1),
        'огни погасли вместе с корпусом'
    ).toBe(true);

    // Высветляется корпус, а не тень: тень тёмная, и то же осветление вывернуло бы её
    // в светлое пятно под кораблём. Свой фильтр (brightness+blur) у тени есть всегда, поэтому
    // сравниваем не с «none», а с отсутствием именно призрачного фильтра — GHOST добавляет
    // contrast и saturate, которых больше нигде в проекте нет.
    // Подчёркивание в селекторе не для красоты: внутри .shipShadow лежит .shipShadowShape
    // (маска густоты, см. SeaScene.module.less), и без него сюда попадал бы и внутренний
    // короб — а фильтр стоит на внешнем.
    const shadows = await page
        .locator('[class*="shipShadow_"]')
        .evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).filter));
    expect(shadows.length, 'теней в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        shadows.every((filter) => !filter.includes('contrast')),
        'тень на воде высветлилась вместе с кораблём'
    ).toBe(true);

    // Имя написано на воде: волна поднимает и опускает его вместе с корпусом, но крена ему
    // не передаёт — тангаж качает корабль, а не надпись под ним.
    const motion = await page.evaluate(() => {
        const styles = (selector: string): CSSStyleDeclaration => getComputedStyle(document.querySelector(selector)!);
        return {
            hull: styles('[class*="shipRock"]').animationName,
            name: styles('[class*="shipName_"]').animationName,
            tilt: styles('[class*="shipName_"]').rotate,
        };
    });
    expect(motion.hull, 'корабль перестал качаться').toContain('pitch');
    expect(motion.name, 'подпись перестала ходить с волной').toContain('heave');
    expect(motion.name, 'подпись кренится вместе с кораблём').not.toContain('pitch');
    expect(motion.tilt, 'подпись наклонена').toBe('none');
});

test('ход корабля идёт с правдоподобной скоростью и зависит от корабля', async ({ browser }) => {
    // Каждый замер — своя вкладка со своим хранилищем: во второй раз форма постановки
    // в строй в той же вкладке уже не покажется, вкладка помнит, что корабль у неё есть.
    const seconds = async (kind: string): Promise<number> => {
        const context = await browser.newContext();
        // Контекст свой, а значит и ускорение времени в нём своё: фикстура достаётся только
        // тому контексту, который выдаёт сам `test`.
        await hasten(context);
        const page = await context.newPage();
        await openNewChannel(page, `hod${kind.length}`);
        await join(page, `Гость${kind.length}`, String(100 + kind.length), kind);
        const slot = page.locator('[data-motion="entering"]');
        await expect(slot).toHaveCount(1);
        const value = await slot.evaluate((element) => getComputedStyle(element).getPropertyValue('--enter-seconds'));
        await context.close();
        // Обратно к обычному времени: проверяется правило, а правило записано в настоящих
        // секундах хода, а не в тех, за которые его отыгрывают под ускорением.
        return Number.parseFloat(value) * TIME_SCALE;
    };

    const cutter = await seconds('Пограничный сторожевой катер');
    const sweeper = await seconds('Рейдовый тральщик');

    // Скорость манёвра теперь одна на всех — на рейде маневрируют самым малым независимо
    // от паспорта, — поэтому корабли между собой уже не сравниваем. Проверяем другое:
    // что длительность вообще считается, а не берётся из воздуха. Мгновенных прыжков
    // и получасовых прогонов быть не должно.
    //
    // Верхняя мерка — это ход через весь кадр на самом малом: она идёт за MIN_SAIL_PACE
    // и меняется вместе с ним, поэтому и стоит с запасом, а не впритык к замеру.
    for (const value of [cutter, sweeper]) {
        expect(value).toBeGreaterThan(2);
        expect(value).toBeLessThanOrEqual(60);
    }
});

test('вода замыкает круг без скачка', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const scene = page.locator('[class*="scene_"]').first();

    const frameAt = async (time: number): Promise<Uint8Array> => {
        await page.evaluate((currentTime) => {
            // Останавливаем всё, что движется, и ставим воду в нужную точку круга: иначе
            // кадры разойдутся из-за качки кораблей, а не из-за воды.
            document.getAnimations().forEach((animation) => {
                animation.pause();
                if ((animation as CSSAnimation).animationName?.includes('sea-mirror')) {
                    animation.currentTime = currentTime;
                }
            });
        }, time);
        return new Uint8Array(await scene.screenshot());
    };

    const same = (one: Uint8Array, other: Uint8Array): boolean =>
        one.length === other.length && one.every((byte, index) => byte === other[index]);

    // На нуле и в конце круга прозрачность зеркальной копии одна и та же, значит и кадр
    // обязан быть тем же. Разошлись — на стыке будет видимый скачок.
    const start = await frameAt(0);
    const end = await frameAt(9999);
    expect(same(start, end), 'кадры на стыке цикла разошлись').toBe(true);

    // А на середине круга — уже другая рябь, иначе анимации попросту нет.
    const middle = await frameAt(5000);
    expect(same(start, middle), 'на середине круга рябь та же — анимации нет').toBe(false);
});

test('корабль уходит за кромку и пропадает из кадра', async ({ page }) => {
    takes(6);
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await leaveRaid(page);

    // Сразу после выхода корабль ещё в кадре: он выбирается за кромку своим ходом.
    await expect(page.locator('[data-motion="leaving"]')).toHaveCount(1);
    // И через отведённое ему время исчезает — иначе уходящие копились бы в разметке.
    await expect(ships(page)).toHaveCount(2, { timeout: SAIL_TIMEOUT });
});

test('огни на рейде якорные, на ходу ходовые, и от 50 метров их по два', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // В демо-канале три корабля, и только «Вымпел» длиннее 50 метров: ему положены
    // два якорных огня, носовой выше кормового, остальным хватает одного.
    const anchored = await lights(page);
    expect(anchored.every((ship) => ship.every((light) => light.kind.startsWith('anchor')))).toBe(true);
    const pairs = anchored.filter((ship) => ship.length === 2);
    expect(pairs, 'два якорных огня должны быть ровно у одного корабля').toHaveLength(1);
    const [fore, aft] = pairs[0];
    expect(fore.kind).toBe('anchor-fore');
    expect(fore.top, 'носовой якорный должен быть выше кормового').toBeLessThan(aft.top);

    // Тронулись — якорные погасли, зажглись ходовые. Снимает корабль с места смена стоянки:
    // в форме своего корабля выбирается другое место, и корабль уходит.
    await openShipForm(page);
    await page.locator('[data-berth][aria-pressed="false"]').last().click();
    await shipFormSubmit(page).click();
    await expect(page.locator('[data-motion]')).toHaveCount(1);
    const underway = await lights(page, '[data-motion]');
    const kinds = underway[0].map((light) => light.kind);
    expect(kinds).toContain('stern');
    expect(kinds.filter((kind) => kind.startsWith('masthead'))).toHaveLength(1);
    expect(kinds.some((kind) => kind === 'port' || kind === 'starboard')).toBe(true);
    expect(kinds.some((kind) => kind.startsWith('anchor'))).toBe(false);
});

/**
 * Вспышки сигнальных ламп, по кораблям. Считаем не состояние в момент замера, а сами
 * включения: буква Морзе — это несколько коротких вспышек, и застать лампу горящей
 * ожидающей проверкой можно, а вот отличить «мигнула трижды» от «мигнула однажды» — нет.
 */
declare global {
    interface Window {
        __flashes: Record<string, number>;
    }
}

const watchLamps = (page: Page, within = '[class*="shipLane"]'): Promise<void> =>
    page.evaluate((selector) => {
        window.__flashes = {};
        for (const lane of document.querySelectorAll(selector)) {
            const lamp = lane.querySelector('[class*="lamp"]')!;
            // Корабли различаем по подписи спрайта: своего имени у дорожки нет. Спрайтов
            // на дорожке теперь два — сам корпус и его тень (см. GH-60), а у тени подпись
            // пустая и нарочно скрыта от читалки экрана (alt=""), — поэтому берём картинку
            // с непустой подписью, а не первую попавшуюся.
            const name = lane.querySelector('img[alt]:not([alt=""])')?.getAttribute('alt') ?? '?';
            window.__flashes[name] = 0;
            new MutationObserver(() => {
                if (lamp.className.includes('lampOn')) {
                    window.__flashes[name] += 1;
                }
            }).observe(lamp, { attributes: true, attributeFilter: ['class'] });
        }
    }, within);

const flashes = (page: Page): Promise<Record<string, number>> => page.evaluate(() => window.__flashes);

test('карточка чужого корабля открывается и из кадра, и из списка кораблей', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    const other = fleet.find((member) => member.memberId !== ALBATROS)!;

    // Из кадра: тычок по чужому корпусу. В карточке — тот самый корабль, а не первый попавшийся:
    // сверяем по бортовому номеру, он на рейде у каждого свой.
    await clickShip(page, page.locator(`[data-berth-ship="${other.place.slot}-${other.place.corridor}"]`));
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toContainText(`Бортовой номер ${other.hullNumber}`);
    await expect(card).toContainText(other.name);
    // Свой корабль карточки не открывает: по нему открывается форма.
    await expect(card).not.toContainText('Альбатрос');

    // Закрыли — и открыли заново из списка кораблей, тычком по строчке. Это тот же корабль,
    // и приводить строчка должна к той же карточке.
    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card).toBeHidden();
    await openShipCard(page, other.name);
    await expect(page.getByRole('region', { name: 'Корабль' })).toContainText(`Бортовой номер ${other.hullNumber}`);
});

/**
 * Оклик — не карточка. Тычок в аватарку окликает корабль, и тот отвечает лампой со своего
 * места на рейде: это и есть ответ на вопрос «который из них». Карточка отвечала бы на него
 * хуже — она накрывает собой ровно тот кадр, в котором корабль и надо было увидеть.
 *
 * Аватарку берём по подсказке, а не по роли: внутри у неё бортовой номер, и именем кнопки
 * для проверки по роли оказался бы он, а не то, что кнопка делает.
 */
test('аватарка в ленте окликает корабль, а карточку не открывает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await watchLamps(page);

    await page.locator('button[title="Окликнуть «Вымпел»"]').first().click();

    // К — «−·−», три вспышки. Ждём именно трёх: одной хватило бы и на случайное мигание.
    await expect
        .poll(async () => (await flashes(page))['Корабль «Вымпел»'], 'корабль не отозвался на оклик')
        .toBeGreaterThanOrEqual(3);
    // И мигнул один он: оклик — обращение к кораблю, а не общий сигнал по рейду.
    const all = await flashes(page);
    expect(
        Object.entries(all).filter(([name, count]) => name !== 'Корабль «Вымпел»' && count > 0),
        'на оклик отозвался кто-то ещё'
    ).toHaveLength(0);
    await expect(page.getByRole('region', { name: 'Корабль' }), 'оклик открыл карточку').toBeHidden();
});

/**
 * То же самое в списке кораблей: строчка целиком открывает корабль, а аватарка в ней держит
 * своё дело — оклик. Открывается по строчке свой корабль формой, чужой — карточкой: правило
 * одно на всё приложение, и в кадре оно то же самое.
 */
test('строчка списка открывает корабль, а аватарка в ней окликает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await watchLamps(page);
    await openSheet(page);
    const list = page.getByRole('region', { name: 'Корабли на связи' });

    // Аватарка: корабль отзывается лампой, карточка не открывается, список остаётся на месте.
    await list.locator('button[title="Окликнуть «Вымпел»"]').click();
    await expect
        .poll(async () => (await flashes(page))['Корабль «Вымпел»'], 'корабль не отозвался на оклик из списка')
        .toBeGreaterThanOrEqual(3);
    await expect(page.getByRole('region', { name: 'Корабль' }), 'оклик из списка открыл карточку').toBeHidden();
    await expect(list, 'оклик закрыл список').toBeVisible();

    // Строчка чужого — карточка, и того самого корабля.
    await list.getByRole('button', { name: 'Корабль «Вымпел»' }).click();
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toContainText('Вымпел');
    // Закрыли карточку — и вернулись в список, из которого её открыли: она лежала поверх него,
    // а не вместо него.
    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card).toBeHidden();
    await expect(list, 'карточка закрылась не в список').toBeVisible();

    // Строчка своего — форма настройки, та же, что и по щелчку по своему кораблю в кадре.
    await list.getByRole('button', { name: 'Корабль «Альбатрос»' }).click();
    await expect(page.getByPlaceholder('Гром'), 'своя строчка не открыла форму').toBeVisible();
});

/**
 * Кружок аватарки маленький, и попадать в него надо пальцем. Расти ему некуда — он стоит
 * в ряду и задаёт ритм строки, — поэтому вокруг него оставлено невидимое поле нажатия.
 * Жмём заведомо мимо кружка: на пару пикселей от его угла наружу по диагонали. В сам кружок
 * такая точка не попадает вовсе — он круглый, и до его края от угла ещё далеко.
 */
test('в аватарку попадает нажатие рядом с ней, а не только в самый кружок', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await watchLamps(page);
    // Последняя в ленте: она заведомо в поле зрения. Первая стоит выше начала прокрутки,
    // и мерка у неё честная, а нажатие по ней досталось бы кадру, лежащему над лентой.
    const avatar = page.locator('button[title="Окликнуть «Вымпел»"]').last();
    const circle = (await avatar.locator('span').first().boundingBox())!;

    await page.mouse.click(circle.x - 2, circle.y - 2);

    await expect
        .poll(async () => (await flashes(page))['Корабль «Вымпел»'], 'нажатие рядом с кружком не дошло до аватарки')
        .toBeGreaterThanOrEqual(3);
});

/**
 * Целиться в корпус не надо: нажатие ловит вода поверх всего флота, а достаётся оно тому,
 * в чью область оно попало (см. `shipPick`).
 *
 * Так это сделано не для удобства, а потому что иначе до половины рейда не дотянуться вовсе.
 * Коробка корабля — прямоугольник во всю его ширину и высоту; ближний корабль накрывает им
 * дальнего целиком, и щелчок по видимому в кадре дальнему корпусу доставался бы ближнему.
 *
 * Жмём по открытой воде под самым килем дальнего корабля — в корпус такое нажатие не попадает
 * вовсе, а карточка обязана открыться его: на дальней линии силуэт мельче наименьшей мерки,
 * и область у него раздута вокруг корпуса (`SHIP_TAP_MIN`), — эта вода под килем как раз её.
 */
test('нажатие рядом с корпусом достаётся кораблю, а не тому, в чей корпус попали', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    // Самый дальний из чужих: под ним больше всего свободной воды, а до соседней линии оттуда
    // всё равно дальше, чем до него самого.
    const other = fleet
        .filter((member) => member.memberId !== ALBATROS)
        .sort((one, two) => one.place.slot - two.place.slot)[0];
    const hull = (await page.locator(`[data-berth-ship="${other.place.slot}-${other.place.corridor}"]`).boundingBox())!;

    // Целимся под самый киль, в тень на воде: в пиксели силуэта такое нажатие не попадает,
    // а в область корабля попадает — областью ему служит вся коробка.
    await page.mouse.click(hull.x + hull.width / 2, hull.y + hull.height - 2);
    await expect(
        page.getByRole('region', { name: 'Корабль' }),
        'нажатие по воде под килем не открыло карточку этого корабля'
    ).toContainText(`Бортовой номер ${other.hullNumber}`);

    // А над горизонтом воды нет, и нажимать там не на что: небо кораблей не открывает.
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    const scene = (await page.locator('header').boundingBox())!;
    await page.mouse.click(scene.x + scene.width / 2, scene.y + 12);
    await expect(page.getByRole('region', { name: 'Корабль' }), 'нажатие по небу открыло карточку').toBeHidden();
});

/**
 * Пустая вода — ничья, а нажатие у самой кромки — всё же нажатие по воде.
 *
 * Про кромку. Полоска в полпикселя вдоль горизонта достаётся водяному слою по попаданию,
 * а `clientY` приходит в событии обрезанным до целого — то есть на пиксель выше кромки. Пока
 * нажатия с такой координатой отсеивались как «это небо», каждый пятый щелчок по кораблю
 * у дальней кромки рейда пропадал впустую: подпись под указателем обещала форму, а не
 * открывалось ничего. Целимся ровно в полпикселя над кромкой: попадание округляется вниз,
 * до воды, а координата события обрезается вверх, за горизонт, — ровно та точка, на которой
 * всё и ломалось. Корабль ставим на дальнюю линию: только там область нажатия дотягивается
 * до самого горизонта.
 *
 * Про пустую воду. Дальний угол кадра не принадлежит никому, и открывать по нему нечего.
 * Проверяется это дважды: подписи и пальца под указателем там нет, и нажатие ничего
 * не открывает. Одного отрицания мало — оно сходится и на сломанном кадре, где не открывается
 * ничего и нигде, — поэтому следом жмём по кораблю, и форма обязана открыться.
 *
 * Выбор места живёт на таком же водяном слое, но меряется по-своему (`berthNearest`): там
 * ничьей воды нет вовсе, любая точка достаётся ближайшей отметке. Поэтому кромка проверяется
 * и на нём: у горизонта ближе всего дальняя линия, её и должно выбрать.
 */
test('пустая вода не открывает ничего, а нажатие у самой кромки достаётся кораблю', async ({ page }) => {
    takes(8);
    // Телефон и самый мелкий катер на дальней линии: только у такого силуэта область
    // и оказывается шире его самого.
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewChannel(page, 'kromka');
    await page.locator('[data-berth="0-center"]').click();
    await join(page, 'Гроза', '319', 'Пограничный сторожевой катер');
    await myShipParked(page);

    const water = page.locator('[class*="shipWater"]');
    const sea = (await water.boundingBox())!;
    // Ближний угол кадра: корабль стоит на дальней линии по центру, дальше этого угла от него
    // в кадре места нет.
    await page.mouse.click(sea.x + 4, sea.y + sea.height - 4);
    await expect(water, 'пустая вода прикинулась нажимаемой').not.toHaveClass(/shipWaterHit/);
    await expect(berths(page), 'нажатие по пустой воде открыло форму').toHaveCount(0);

    const slot = (await page.locator('[data-berth-ship="0-center"]').boundingBox())!;
    // Катер у горизонта — полоска в несколько точек высотой, и область ему раздута до мерки
    // вокруг корпуса: нажатие под килем, в стороне от коробки, — всё ещё нажатие по кораблю.
    expect(slot.height, 'дальний силуэт вырос выше мерки, и прибавка ему уже не нужна').toBeLessThan(SHIP_TAP_MIN);
    await page.mouse.click(slot.x + slot.width / 2, slot.y + slot.height + 6);
    await expect(berths(page).first(), 'нажатие рядом с мелким кораблём до него не дошло').toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(berths(page), 'форма не закрылась').toHaveCount(0);

    await page.mouse.move(slot.x + slot.width / 2, sea.y - 0.5);
    await expect(water, 'над кораблём вода не назвалась нажимаемой').toHaveClass(/shipWaterHit/);
    await page.mouse.click(slot.x + slot.width / 2, sea.y - 0.5);
    await expect(berths(page).first(), 'нажатие у кромки воды не открыло форму своего корабля').toBeVisible();

    const field = (await page.locator('[class*="berthWater"]').boundingBox())!;
    await page.mouse.click(field.x + field.width / 2, field.y - 0.5);
    await expect(
        page.locator('[data-berth^="0-"][aria-pressed="true"]'),
        'нажатие у кромки воды не выбрало место на дальней линии'
    ).toHaveCount(1);
});

test('«Сигнал» зажигает лампу на портрете, а рейд остаётся тёмным', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Карточку берём из списка кораблей, а сигнал просят уже из неё.
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toBeVisible();

    // Смотрим разом за лампами всего рейда и за лампой на портрете: сигнал — дело карточки,
    // и до рейда он доходить не должен. Различаются они подписью спрайта: в кадре корабли
    // подписаны позывными, портрет — названием типа.
    await watchLamps(page, '[class*="shipLane"], [class*="portraitShip"]');
    await card.getByRole('button', { name: 'Сигнал' }).click();

    // K — это «−·−», три вспышки. Ждём именно трёх: одной хватило бы и на случайное мигание.
    const portrait = await card.locator('[class*="portraitShip"] img').getAttribute('alt');
    await expect
        .poll(async () => (await flashes(page))[portrait!], 'портрет не ответил лампой')
        .toBeGreaterThanOrEqual(3);

    // А в кадре не мигнул никто: чужим кораблём с его же карточки не распоряжаются.
    const all = await flashes(page);
    const onRaid = Object.entries(all).filter(([name, count]) => name !== portrait && count > 0);
    expect(onRaid, 'сигнал из карточки дошёл до рейда').toHaveLength(0);
});

/**
 * Переключатель огней в карточке: и что он делает с портретом, и что по нему видно.
 *
 * Второе тут не придирка. Прежде на этом месте стояла кнопка, а кнопка подписана тем,
 * что случится по нажатию, — то есть в каждом положении показывала обратное нынешнему:
 * на якоре предлагала ход. Прочесть по ней, как корабль стоит сейчас, было нельзя вовсе.
 * Поэтому и смотрим на пару разом: что помечено на дорожке и что горит на портрете.
 * Разойдись они — и переключатель врёт.
 */
test('переключатель огней меняет огни портрета и показывает положение', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });
    const portrait = '[class*="portraitShip"]';
    const switcher = card.getByRole('group', { name: 'Огни' });
    // Пилюля одна на оба положения и ездит между ними — потому и спрашиваем её место.
    // Спрашиваем в пикселях и округлённо: посреди переезда сдвиг идёт долями, и сравнивать
    // на них нечего — важно, у какого положения пилюля встала. Меряем саму коробку, а не сдвиг
    // в стилях: сдвиг записан долями (`translate` в ui/Switch), и в вычисленном виде долями
    // и остаётся — сравнивать по нему, у какого положения пилюля, нечего.
    const pill = switcher.locator('[class*="pill_"]');
    const pillAt = () =>
        pill.evaluate((el) =>
            Math.round(el.getBoundingClientRect().left - el.parentElement!.getBoundingClientRect().left)
        );

    // На рейде корабль стоит на якоре — с этого карточка и начинается, и это же помечено.
    const anchored = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        anchored.some((kind) => kind.startsWith('anchor')),
        'на якоре не горят якорные огни'
    ).toBe(true);
    await expect(switcher.getByRole('radio', { name: 'Якорь' }), 'корабль на якоре, а помечен ход').toBeChecked();
    const wasAt = await pillAt();

    await switcher.getByText('Ход').click();

    const underway = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        underway.some((kind) => kind.startsWith('masthead')),
        'под парами не зажглись ходовые огни'
    ).toBe(true);
    expect(
        underway.some((kind) => kind.startsWith('anchor')),
        'под парами остались якорные огни'
    ).toBe(false);
    await expect(switcher.getByRole('radio', { name: 'Ход' }), 'нажатый ход не пометился').toBeChecked();

    // Обе подписи на дорожке и в обоих положениях: у переключателя видны все — в этом и смысл.
    await expect(switcher, 'с дорожки пропала подпись положения').toContainText('Якорь');

    // Пилюля переехала, а не зажглась на новом месте: это та же самая пилюля, у неё сменился
    // сдвиг, и меняется он переходом. Ждём пробой: сам переезд глазами не ловим — под
    // проверками время идёт вдесятеро быстрее, и на него приходится кадр-другой.
    await expect.poll(pillAt, { message: 'пилюля не переехала к нажатому положению' }).not.toBe(wasAt);
    expect(
        await pill.evaluate((el) => getComputedStyle(el).transitionProperty),
        'пилюля меняет место скачком, без перехода'
    ).toContain('translate');

    // И обратно: якорь гасит ходовые.
    await switcher.getByText('Якорь').click();
    const again = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        again.some((kind) => kind.startsWith('anchor')),
        'якорь не вернул якорные огни'
    ).toBe(true);
    await expect.poll(pillAt, { message: 'пилюля не вернулась на прежнее место' }).toBe(wasAt);
});

/** Накал огня на портрете: сама лампочка и ореол вокруг неё. */
interface Burn {
    /** Мс от начала записи. */
    t: number;
    /** Накал зажигающегося ходового огня, 0…1. */
    on: number;
    /** Накал гаснущего якорного, 0…1. */
    off: number;
}

/**
 * Записать покадрово, как на портрете меняются огни. Заводят запись до нажатия и ждут после:
 * первые кадры разгорания иначе уходят в дорогу до браузера и обратно.
 */
const burnRun = (page: Page, span = 1500): Promise<Burn[]> =>
    page.evaluate(
        (ms: number) =>
            new Promise<Burn[]>((resolve, reject) => {
                const started = performance.now();
                const frames: Burn[] = [];
                const dim = (kind: string): number | null => {
                    const light = document.querySelector(`[class*="portraitShip"] [data-light="${kind}"]`);
                    return light ? Number.parseFloat(getComputedStyle(light).opacity) : null;
                };
                const tick = () => {
                    const on = dim('masthead');
                    const off = dim('anchor-fore');
                    if (on === null || off === null) {
                        reject(new Error('огней на портрете не нашлось: мерить накал не на чем'));
                        return;
                    }
                    const t = performance.now() - started;
                    frames.push({ t, on, off });
                    if (t < ms) {
                        requestAnimationFrame(tick);
                    } else {
                        resolve(frames);
                    }
                };
                tick();
            }),
        span
    );

/**
 * Огни хода и якоря не щёлкают, а разгораются и гаснут — как лампы накаливания.
 *
 * Мгновенная подмена читалась не сменой огней, а сменой картинки: якорные исчезали, ходовые
 * возникали на других местах, и что именно поменялось, разобрать было нельзя. Гореть при этом
 * они обязаны по-разному: нить набирает накал быстро и упирается в предел, а остывает долго —
 * потому разгорание и короче затухания, и спад идёт не поровну на каждый кадр.
 *
 * Меряем на обычной скорости времени: под ускоренной вдесятеро всё движение занимает шесть
 * сотых секунды, и кадров в нём не остаётся вовсе.
 */
test('огни хода и якоря разгораются и гаснут, а не щёлкают', async ({ page }) => {
    takes(9);
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const switcher = page.getByRole('region', { name: 'Корабль' }).getByRole('group', { name: 'Огни' });
    await page.evaluate(() => document.documentElement.style.setProperty('--time-scale', '1'));

    const burning = burnRun(page);
    await switcher.getByText('Ход').click();
    const frames = await burning;

    // Оба огня прошли через промежуточный накал, а не перескочили из нуля в единицу.
    const between = (value: number) => value > 0.02 && value < 0.98;
    expect(frames.filter((frame) => between(frame.on)).length, 'ходовой огонь зажёгся щелчком').toBeGreaterThan(2);
    expect(frames.filter((frame) => between(frame.off)).length, 'якорный огонь погас щелчком').toBeGreaterThan(2);

    // Разгорание короче затухания. Отсчёт у каждого свой — от кадра, в котором огонь тронулся
    // с места: запись заводится до нажатия, и до него оба стоят.
    const at = (hit: (frame: Burn) => boolean, what: string): number => {
        const frame = frames.find(hit);
        expect(frame, what).toBeDefined();
        return frame!.t;
    };
    const rise = at((frame) => frame.on >= 0.99, 'ходовой огонь не разгорелся до полного накала');
    const rose = rise - at((frame) => frame.on > 0.01, 'ходовой огонь не тронулся с места');
    const fall = at((frame) => frame.off <= 0.01, 'якорный огонь не погас до конца');
    const fell = fall - at((frame) => frame.off < 0.99, 'якорный огонь не тронулся с места');
    expect(rose, 'огонь разгорается не быстрее, чем гаснет').toBeLessThan(fell);

    // И гаснет он не поровну на каждый кадр: к середине пути накала остаётся меньше трети —
    // свет обваливается сразу, а последняя четверть тянется дольше всего.
    const half = frames.find((frame) => frame.t >= fall - fell / 2);
    expect(half, 'середины затухания в записи не нашлось').toBeDefined();
    expect(half!.off, 'якорный огонь гаснет ровно, как по линейке').toBeLessThan(0.3);

    // Ореол меняется вместе с накалом, а не только заливка лампочки: у горящего огня он
    // разошёлся на полный размер, у потушенного ужат к лампочке.
    const halo = (kind: string) =>
        page
            .locator(`[class*="portraitShip"] [data-light="${kind}"]`)
            .evaluate((light) => new DOMMatrix(getComputedStyle(light, '::after').transform).a);
    expect(await halo('masthead'), 'ореол горящего огня не разошёлся').toBeCloseTo(1, 1);
    expect(await halo('anchor-fore'), 'ореол потушенного огня остался прежним').toBeLessThan(0.9);
});

/**
 * Кому движение мешает, тому огни просто меняются: гореть они всё равно обязаны — по ним
 * и видно, стоит корабль или идёт, — а вот разгораться и тлеть уже незачем.
 */
test('с отключённым движением огни меняются без разгорания', async ({ page }) => {
    takes(6);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const portrait = '[class*="portraitShip"]';

    const pace = (kind: string) =>
        page.locator(`${portrait} [data-light="${kind}"]`).evaluate((light) => ({
            lamp: getComputedStyle(light).transitionDuration,
            halo: getComputedStyle(light, '::after').transitionDuration,
        }));
    expect(await pace('anchor-fore'), 'у огня остался переход').toEqual({ lamp: '0s', halo: '0s' });

    // Переключились — и огни на месте сразу, без промежуточного накала.
    await page.getByRole('region', { name: 'Корабль' }).getByRole('group', { name: 'Огни' }).getByText('Ход').click();
    const kinds = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        kinds.some((kind) => kind.startsWith('masthead')),
        'ходовые огни не зажглись'
    ).toBe(true);
    expect(await pace('masthead'), 'у зажжённого огня появился переход').toEqual({ lamp: '0s', halo: '0s' });
});

/**
 * Углы переключателя. Стоит он в одном ряду с кнопкой, одного с ней роста и набран той же
 * строкой — и скруглён обязан быть так же, иначе рядом с кнопкой читается плашкой другого
 * сорта. А пилюля внутри отступает от кромки дорожки со всех сторон и угол держит почти
 * прямой: заливка у неё светлая, дуга видна вся целиком, и кнопочное скругление читалось бы
 * второй кнопкой внутри первой.
 */
test('переключатель скруглён как соседняя кнопка, а пилюля внутри — почти прямоугольная', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });
    const switcher = card.getByRole('group', { name: 'Огни' });

    const radius = (locator: Locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    // Подпись у кнопки своя на широкой карточке и на узкой (см. ShipCard) — ловим по общему.
    const button = await radius(card.getByRole('button', { name: /сигнал/i }));
    const track = await radius(switcher);
    const pill = switcher.locator('[class*="pill_"]');

    expect(track, 'дорожка скруглена не так, как соседняя кнопка').toBeCloseTo(button, 1);

    // Поле дорожки — просвет между её кромкой и кромкой пилюли, и с обеих сторон он один.
    const boxes = await Promise.all([switcher.boundingBox(), pill.boundingBox()]);
    const [trackBox, pillBox] = boxes.map((box) => box!);
    const inset = pillBox.y - trackBox.y;
    expect(inset, 'пилюля прижата к дорожке').toBeGreaterThan(0);

    const pillRadius = await radius(pill);
    expect(pillRadius, 'у пилюли нет скругления вовсе').toBeGreaterThan(0);
    expect(pillRadius, 'пилюля скруглена не строже дорожки').toBeLessThan(track);
});

test('позывной в карточке стоит вровень с крестиком', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });

    await expect(card).toBeVisible();

    // Заголовка у шторки своего нет — его рисует содержимое, и встать вровень с крестиком
    // оно может только по меркам, которые шторка отдаёт наружу. Сверяем середины: строка
    // с позывным ростом с крестик и центрирована по нему.
    //
    // Меряем обоих одним заходом в страницу, а не двумя boundingBox подряд: шторка в этот
    // момент ещё выезжает, и два замера пришлись бы на разные кадры выезда — крестик оказался
    // бы ниже позывного на весь пройденный за это время путь. Взаимное положение внутри
    // шторки от выезда не зависит: едет она целиком.
    const gap = await card.evaluate((shade) => {
        const middle = (node: Element): number => {
            const rect = node.getBoundingClientRect();
            return rect.top + rect.height / 2;
        };
        const close = shade.querySelector('[class*="close"] button')!;
        const name = shade.querySelector('[class*="large"]')!;
        return {
            level: middle(name) - middle(close),
            overlap: name.getBoundingClientRect().right - close.getBoundingClientRect().left,
        };
    });
    expect(Math.abs(gap.level), 'позывной не на одном уровне с крестиком').toBeLessThanOrEqual(1);

    // И под крестик он не заезжает: справа в строке оставлено место ровно под кнопку.
    expect(gap.overlap, 'позывной заехал под крестик').toBeLessThanOrEqual(0);
});

test('бортовой номер в карточке стоит под позывным, а не поодаль', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipCard(page, 'Вымпел');
    const card = page.getByRole('region', { name: 'Корабль' });

    await expect(card).toBeVisible();

    // Строка позывного ростом с крестик, и её нижняя половина запаса — пустое место: без
    // поправки номер отъезжал от заголовка на полтора десятка пикселей. Меряем по буквам,
    // а не по блокам: пустое место внутри строки заголовка блоку не видно.
    //
    // Одним заходом в страницу и здесь: шторка в этот момент ещё выезжает, и два замера
    // пришлись бы на разные кадры (см. соседнюю проверку).
    const gap = await card.evaluate((shade) => {
        const name = shade.querySelector('[class*="large"]')!;
        const hull = shade.querySelector('[class*="hullNumber"]')!;
        const range = document.createRange();
        range.selectNodeContents(name);
        const letters = range.getBoundingClientRect();
        range.selectNodeContents(hull);
        return range.getBoundingClientRect().top - letters.bottom;
    });

    // Строки соседние: между буквами позывного и буквами номера — считанные пиксели.
    // Верхняя граница взята с запасом на округление кегля, нижняя следит, чтобы номер
    // не залез на позывной.
    expect(gap, 'бортовой номер оторвался от позывного').toBeLessThanOrEqual(8);
    expect(gap, 'бортовой номер налез на позывной').toBeGreaterThanOrEqual(0);
});

test('лампа передаёт и то, что набрано поверх выделения', async ({ page }) => {
    takes(5);
    await openChannel(page, DEMO, ALBATROS);
    const mine = 'Корабль «Альбатрос»';
    await watchLamps(page);

    // Набираем и ждём, пока лампа отработает набранное: А — две вспышки, Б — четыре.
    const input = page.getByPlaceholder('Сообщение');
    await input.pressSequentially('аб');
    await expect.poll(async () => (await flashes(page))[mine], 'лампа не передала набранное').toBe(6);

    // Теперь выделяем всё и набираем поверх. Так правят текст постоянно, и передавать это
    // надо: раньше правка поверх выделения не доходила до лампы вовсе — строка стала короче,
    // значит стёрли, — и корабль на неё молчал.
    await page.keyboard.press('ControlOrMeta+a');
    await input.pressSequentially('ш');
    // Ш — «−−−−», ровно четыре вспышки. Их и ждём: лишние две означали бы, что вместо буквы
    // передан знак стирания, а он тут ни при чём — человек не стёр, а переписал.
    await expect.poll(async () => (await flashes(page))[mine], 'набранное поверх выделения не ушло в лампу').toBe(10);
});

test('во время набора на рейд не уходит ничего', async ({ page }) => {
    takes(5);
    await openChannel(page, DEMO, ALBATROS);
    await watchLamps(page);

    // Слушаем тот самый провод, по которому бэкенд разносит события между вкладками. Набор
    // на нём не должен оставлять следа вовсе: событие на букву — это запись документа на букву
    // в тот день, когда за подпиской окажется настоящий сервер.
    await page.evaluate(() => {
        const heard: string[] = [];
        (window as unknown as { heard: string[] }).heard = heard;
        new BroadcastChannel('kilvater').addEventListener('message', (message: MessageEvent<{ type: string }>) => {
            heard.push(message.data.type);
        });
    });

    const input = page.getByPlaceholder('Сообщение');
    await input.pressSequentially('проверка бодрости');
    // Свою лампу набранное всё-таки зажигает — она живёт в этой же вкладке и по проводу
    // не ходит. Ждём её: если бы набор куда-то уходил, ушёл бы он к этому мигу.
    await expect.poll(async () => (await flashes(page))['Корабль «Альбатрос»']).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { heard: string[] }).heard), 'набор ушёл на рейд').toEqual(
        []
    );

    // А отправленное уходит — и ровно одним событием на всю реплику.
    await input.press('Enter');
    await expect
        .poll(async () => page.evaluate(() => (window as unknown as { heard: string[] }).heard))
        .toEqual(['message-added']);
});

test('пришедшая реплика печатается по буквам, и корабль отправителя мигает лампой', async ({ context }) => {
    takes(20);
    const mine = await context.newPage();
    const theirs = await context.newPage();
    // Обычное время: печать идёт со скоростью человека за клавиатурой, и на ускоренном ходу
    // реплика допечатывалась бы раньше, чем проверка успеет застать её недопечатанной.
    await unhasten(mine);
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);
    await watchLamps(mine);

    const text = 'Швартовы отданы, выхожу на рейд к полуночи';
    await send(theirs, text);

    // Шапка говорит, кто передаёт. Это и есть признак идущего приёма: реплика уже доехала
    // и лежит в канале целиком, но показывается она так, будто её набирают прямо сейчас.
    const status = mine.locator('[class*="chatStatus"]');
    await expect(status, 'приём не начался').toHaveText('«Вымпел» передаёт…');
    expect(await bubbles(mine).last().innerText(), 'реплика показалась целиком, минуя печать').not.toContain(text);

    // Лампа мигает всё это время — по кускам того же текста (см. `hooks/reception`).
    await expect
        .poll(async () => (await flashes(mine))['Корабль «Вымпел»'], 'корабль отправителя не мигал лампой')
        .toBeGreaterThan(0);

    // Допечаталось — реплика стоит целиком, а шапка вернулась к обычной строчке.
    await expect(bubbles(mine).last()).toContainText(text);
    await expect(status).toHaveText('3 на связи');
});

test('в списке кораблей выбранный стоит под парами и отзывается лампой', async ({ page }) => {
    // Плашка корабля — `div` с ролью кнопки, а не `button`: из настоящей кнопки не выделишь
    // текст, а он в плашке главное (см. проверку про характеристики в channel.spec).
    const KINDS = '[class*="kinds_"] > [role="button"]';
    // Канал открываем, но в строй не встаём: список кораблей — это и есть форма входа.
    await openChannel(page, DEMO);
    await openJoinForm(page);
    const buttons = page.locator(KINDS);
    await expect(buttons.first()).toBeVisible();
    await watchLamps(page, KINDS);

    // Тычок в третий силуэт: не в первый, который выбран и так, — иначе выбор ничего не менял бы,
    // и проверка прошла бы на неподвижной картинке.
    const picked = 2;
    const label = (await buttons.nth(picked).locator('img').getAttribute('alt'))!;
    await buttons.nth(picked).click();

    // Выбранный корабль стоит под парами: у него ходовые огни, у остальных якорные. Так видно,
    // который из них твой, и сразу показана разница между двумя наборами огней.
    const sets = await lights(page, KINDS);
    expect(sets.length, 'список кораблей пуст').toBeGreaterThan(1);
    const kinds = (index: number): string[] => sets[index].map((light) => light.kind);
    expect(kinds(picked), 'у выбранного корабля не горит топовый').toContain('masthead');
    expect(kinds(picked), 'у выбранного корабля не горит кормовой').toContain('stern');
    expect(
        kinds(picked).some((kind) => kind.startsWith('anchor')),
        'выбранный корабль остался на якоре'
    ).toBe(false);
    const others = sets.filter((_, index) => index !== picked);
    expect(
        others.every((set) => set.length > 0 && set.every((light) => light.kind.startsWith('anchor'))),
        'невыбранный корабль пошёл ходом'
    ).toBe(true);

    // И отзывается он тем же сигналом, что корабль в кадре на оклик: K — «−·−», три вспышки.
    await expect.poll(async () => (await flashes(page))[label], 'выбранный корабль не мигнул лампой').toBe(3);
    const all = await flashes(page);
    expect(
        Object.values(all).filter((count) => count > 0),
        'на выбор мигнул не один корабль'
    ).toHaveLength(1);
});

/**
 * Перемена коридора на своей же дальности — переход по воде, а не перезаход. Раньше всякая
 * перемена места отыгрывалась одинаково: корабль уходил за кромку кадра, пропадал на паузу
 * и заплывал заново. На соседнюю точку той же линии это и неправда, и долго — полкадра туда,
 * полкадра сюда да три секунды пустого рейда между ними, — а идти там меньше трети кадра.
 *
 * Правило самого манёвра проверяется юнитами (shipMotion.test.ts): куда идти, задним ли ходом
 * и сколько это секунд — счёт чистый. Браузеру достаётся то, чего в счёте нет: что корабль
 * и правда никуда не пропадал.
 */
test('на соседний коридор своей линии корабль переходит по воде, не уходя из кадра', async ({ page }) => {
    takes(12);
    // Рейд свой и корабль на нём один: в демо-канале расстановка каждый раз новая, и попадётся
    // ли свободный коридор рядом со своим кораблём — как повезёт.
    await openNewChannel(page, 'perehod');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    // Курс вправо, а переходить будем влево: задний ход тут в порядке вещей, и проверить надо
    // именно его — разворачиваться ради трети кадра корабль не должен.
    await page.getByLabel('Курс вправо').click();
    await page.locator('[data-berth="8-center"]').click();
    await join(page, 'Стриж', '111');

    // Заход должен отыграться до конца: пока он идёт, у корабля свой вид движения, и новый
    // на него не наложить.
    await myShipParked(page);
    const scene = (await page.locator('[class*="scene"]').first().boundingBox())!;
    const before = (await ships(page).first().boundingBox())!;

    await shipsButton(page).click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.locator('[data-berth="8-left"]').click();
    await page.getByRole('button', { name: 'Готово' }).click();

    // Ход именно переходный: уходящий отсюда пометился бы leaving и через паузу зашёл заново.
    const lane = page.locator('[data-motion]');
    await expect(lane, 'корабль не тронулся с места').toHaveCount(1);
    await expect(lane, 'корабль пошёл на новое место перезаходом').toHaveAttribute('data-motion', 'shifting');

    // И весь он на глазах: корабль не касается кромок кадра ни в одно из мгновений хода.
    // Заодно это и проверка на пропажу — за кромкой его не было бы в разметке вовсе.
    // Замер идёт в самой вкладке: со стороны Playwright каждый снимок — свой круг обмена,
    // и на быстром ходу между ними успевает пройти полкадра.
    //
    // Снимаем каждый кадр и ровно до конца перехода — не по часам. Прежде тут стояли 24 снимка
    // через 300 мс: срок брался с запасом на самый долгий переход и держал проверку семь лишних
    // секунд, а между снимками корабль успевал пройти изрядный кусок пути. Признак конца
    // у перехода свой — с корабля пропадает пометка движения; на неё и смотрим, а счётчик
    // кадров оставлен единственно затем, чтобы застрявшее движение кончилось ошибкой,
    // а не зависанием.
    const track = await page.evaluate(
        () =>
            new Promise<{ from: number; to: number }[]>((resolve) => {
                const seen: { from: number; to: number }[] = [];
                const snap = (): void => {
                    const box = document.querySelector('[class*="shipSlot"]')?.getBoundingClientRect();
                    seen.push(box ? { from: box.left, to: box.right } : { from: NaN, to: NaN });
                    if (!document.querySelector('[data-motion]') || seen.length >= 1200) {
                        resolve(seen);
                        return;
                    }
                    requestAnimationFrame(snap);
                };
                requestAnimationFrame(snap);
            })
    );
    expect(track.length, 'переход кончился, не начавшись').toBeGreaterThan(1);
    const overboard = track.filter((box) => !(box.from > scene.x && box.to < scene.x + scene.width));
    expect(overboard, 'посреди перехода корабль пропал из кадра или вышел за кромку').toHaveLength(0);

    // Пришёл он туда, куда шёл: место переменилось, курс — нет.
    await expect(page.locator('[data-motion]'), 'переход не кончился').toHaveCount(0, { timeout: SAIL_TIMEOUT });
    const after = (await ships(page).first().boundingBox())!;
    expect(after.x, 'корабль не сдвинулся влево').toBeLessThan(before.x);
    await expect(ships(page).locator('[data-facing]'), 'корабль развернулся вместо заднего хода').toHaveAttribute(
        'data-facing',
        'right'
    );
    const state = await readState(page);
    const [moved] = Object.values(state.channels).find((one) => one.channel.slug === 'perehod')!.members;
    expect(`${moved.place.slot}-${moved.place.corridor}`, 'корабль встал не на выбранное место').toBe('8-left');
});

/**
 * Смена раскладки посреди хода не должна сбивать корабль с курса.
 *
 * Место на рейде от кадра не зависит вовсе, а вот проекция зависит: чем уже окно, тем сильнее
 * рейд разложен трапецией (см. `--raid-reach` в SeaScene.module.less). Значит, смена раскладки
 * двигает точку на экране — и, если двинуть её под килём у идущего, переход в CSS начнётся
 * заново: с того места, где корабль сейчас, и на всю длительность целиком. На глаз это
 * остановка на полпути. Оттого идущему проекция и замирает такой, какой была на старте.
 *
 * Меряется здесь само правило, а не время: пока у корабля стоит пометка хода, и точка на рейде
 * (`--slot-left`), и её место на экране (`translate`) обязаны быть одни и те же. Часы для такой
 * проверки — мерка ненадёжная: разброс машины в ускоренный ход укладывается целиком.
 *
 * Ход берётся самый долгий из тех, что есть, — уход с ближней линии через весь кадр: в него
 * успевает уложиться и смена окна, и десяток снимков до неё и после. Стоит корабль в боковом
 * коридоре: в среднем точка от кромок не зависит вовсе, и ловить там было бы нечего.
 *
 * Двух ловушек проверка избегает нарочно. Кадр в ней и правда должен перемениться посреди хода —
 * об этом говорит ширина дорожки, снятая в тех же кадрах. А проекция от такой перемены должна
 * и правда разъезжаться — иначе двигать под килём было бы нечего.
 */
test('корабль доходит до места, даже если посреди хода сменилась раскладка', async ({ page }) => {
    takes(20);
    // Рейд свой и корабль на нём один: точка на ближней линии бокового коридора уезжает
    // от кромки сильнее всего, и крупному силуэту достаётся весь этот отход.
    await page.setViewportSize({ width: 800, height: 844 });
    await openNewChannel(page, 'perehod-raskladka');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    // Курс влево из правого коридора: уходить корабль будет носом вперёд, а значит — через
    // весь кадр. Ход этот самый долгий из возможных, и только в него смена окна успевает
    // попасть посередине.
    await page.getByLabel('Курс влево').click();
    await page.locator('[data-berth="9-right"]').click();
    await join(page, 'Стриж', '111');
    await myShipParked(page);

    // Перемена дальности — это уход с рейда и заход обратно: сперва корабль уходит за кромку
    // со старого места, и вот этот-то уход и меряется.
    await openShipForm(page);
    await page.locator('[data-berth="0-center"]').click();
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect(page.locator('[data-motion="leaving"]'), 'корабль не снялся с места').toHaveCount(1);

    // Замер идёт в самой вкладке и каждый кадр: со стороны Playwright между снимками успевает
    // пройти половина хода. Наружу отдаются только перемены — их за ход должно быть по пальцам.
    await page.evaluate(() => {
        const seen: { motion: string; slot: string; at: string; lane: number }[] = [];
        (window as unknown as { __seen: typeof seen }).__seen = seen;
        const snap = (): void => {
            const lane = document.querySelector<HTMLElement>('[data-motion="leaving"]');
            if (!lane) {
                // Ход или ещё не начался, или уже кончился: во втором случае снимать больше нечего.
                if (seen.length) {
                    return;
                }
                requestAnimationFrame(snap);
                return;
            }
            const now = {
                motion: lane.dataset.motion ?? '',
                slot: lane.style.getPropertyValue('--slot-left'),
                // Куда точка рейда легла на экран. Снимается именно --slot-x, а не translate:
                // translate посреди хода показывает, где корабль сейчас, и меняется каждый кадр.
                at: getComputedStyle(lane).getPropertyValue('--slot-x'),
                lane: Math.round(lane.clientWidth),
            };
            const last = seen[seen.length - 1];
            if (last?.slot !== now.slot || last.at !== now.at || last.lane !== now.lane) {
                seen.push(now);
            }
            requestAnimationFrame(snap);
        };
        requestAnimationFrame(snap);
    });
    // Хотя бы один снимок до перемены: без него менять окно не с чем сравнивать, а первый
    // кадр после установки замера приходит не в тот же миг.
    await page.waitForFunction(() => (window as unknown as { __seen: unknown[] }).__seen.length > 0);
    // Проекция до смены окна: с ней и сверяется, было ли под килём чему разъезжаться.
    const reachWide = await page
        .locator('[class*="raid_"]')
        .first()
        .evaluate((raid) => Number(getComputedStyle(raid).getPropertyValue('--raid-reach-far')));
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-motion="leaving"]'), 'уход не кончился').toHaveCount(0, {
        timeout: SAIL_TIMEOUT,
    });

    const seen = await page.evaluate(
        () => (window as unknown as { __seen: { motion: string; slot: string; at: string; lane: number }[] }).__seen
    );
    expect(
        new Set(seen.map((frame) => frame.lane)).size,
        'кадр не переменился посреди хода — ловить было нечего'
    ).toBeGreaterThan(1);
    expect([...new Set(seen.map((frame) => frame.slot))], 'у идущего корабля переменилась точка на рейде').toHaveLength(
        1
    );
    expect(
        [...new Set(seen.map((frame) => frame.at))],
        'у идущего корабля переменилась точка, от которой он отсчитывает ход'
    ).toHaveLength(1);

    // И перезаход отыгрался до конца: корабль пришёл туда, куда его послали.
    await expect(page.locator('[data-motion]'), 'перезаход не кончился').toHaveCount(0, { timeout: SAIL_TIMEOUT });
    // А двигать под килём было что: от новой ширины окна проекция разъехалась — на узком
    // экране рейд ложится трапецией круче, чем на широком.
    const reachNarrow = await page
        .locator('[class*="raid_"]')
        .evaluate((raid) => Number(getComputedStyle(raid).getPropertyValue('--raid-reach-far')));
    expect(reachNarrow, 'проекция от смены окна не переменилась — проверять было нечего').toBeLessThan(
        reachWide - 0.05
    );
    const state = await readState(page);
    const [moved] = Object.values(state.channels).find((one) => one.channel.slug === 'perehod-raskladka')!.members;
    expect(`${moved.place.slot}-${moved.place.corridor}`, 'корабль встал не на выбранное место').toBe('0-center');
});

/**
 * Качка — единственное движение в кадре, которое не кончается: корабль на якоре ходит вверх-вниз
 * и переваливается носом, пока стоит. Ломается такое молча — анимация может не завестись вовсе
 * или замереть на кадре, — и увидеть это можно только покадрово.
 *
 * Замер идёт ровно полцикла волны. За это время корабль обязан пройти путь в размах туда
 * и обратно — то есть двойную амплитуду: вверх-вниз по кривой волны укладывается ровно
 * в половину цикла, откуда бы ни начали. Меньше — где-то замерло, больше — цикл идёт быстрее
 * своей мерки.
 */
test('корабль качается сам и не замирает', async ({ page }) => {
    takes(6);
    await openChannel(page, DEMO, ALBATROS);
    await expect(page.locator('[data-motion]'), 'корабли так и не встали на места').toHaveCount(0, {
        timeout: SAIL_TIMEOUT,
    });

    // Полцикла волны: WAVE_SECONDS в компоненте сцены — 10 секунд.
    const swing = await page.evaluate(async () => {
        // Подъём и спуск (--heave, translate) держит .shipWave — общий предок корпуса и тени,
        // качка которого разведена с наклоном (.shipRock) на отдельные блоки.
        const wave = document.querySelector('[class*="shipLane"] [class*="shipWave"]')!;
        // Размах приходит инлайном от компонента: он свой у каждой дальности — дальние
        // качаются меньше ближних.
        const heave = parseFloat(getComputedStyle(wave).getPropertyValue('--heave'));
        const seen: number[] = [];
        await new Promise<void>((resolve) => {
            const started = performance.now();
            const tick = (): void => {
                // Вторым числом в translate идёт подъём: по горизонтали качка корабль не носит.
                seen.push(parseFloat(getComputedStyle(wave).translate.split(' ')[1] ?? '0'));
                if (performance.now() - started < 5000) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(tick);
        });
        const steps = seen.slice(1).map((value, at) => value - seen[at]);
        return {
            heave,
            frames: seen.length,
            travel: steps.reduce((sum, step) => sum + Math.abs(step), 0),
            biggest: Math.max(...steps.map(Math.abs)),
        };
    });

    expect(swing.frames, 'кадров не набралось — мерить нечего').toBeGreaterThan(60);
    expect(swing.heave, 'размах качки не задан').toBeGreaterThan(0);
    // Допуск на то, что в самой верхней и нижней точке между кадрами теряются доли пикселя.
    expect(swing.travel, 'качка замерла или идёт не весь цикл').toBeGreaterThan(swing.heave * 1.7);
    expect(swing.travel, 'качка проходит больше своего размаха за полцикла').toBeLessThan(swing.heave * 2.3);
    // И идёт она плавно: рывком тут был бы шаг в добрую долю размаха за один кадр.
    expect(swing.biggest, 'качка дёрнулась вместо плавного хода').toBeLessThan(swing.heave / 4);
});

/**
 * Как рейд ложится на экран телефона. Кадр там почти квадратный, и рейду в нём тесно: коридоры
 * сходятся к середине, перспективе негде разбежаться. Сам рейд от этого не меняется — он один
 * и тот же на любом экране, — а меняется проекция: передний край раздаётся шире окна, дальний
 * поджимается внутрь (RAID_SPREAD_NEAR и RAID_SPREAD_FAR), и окно обрезает то, что вышло.
 *
 * Числа расстановки проверены юнитом (см. placement.test.ts): поля по краям рейда там одни и те
 * же на любом экране. Браузеру остаётся то, чего в них не увидеть: что дальний край и правда
 * остался в окне с запасом, что рейд стоит по середине окна, а не прижат к одной кромке,
 * и что от лишней ширины не завелась горизонтальная прокрутка страницы.
 *
 * Замер на окне 390px: передний край 484px — на 94px шире окна, — дальний 359px, то есть
 * на 15px внутрь от каждой кромки. Ближним кораблям кромка теперь и правда режет нос вместе
 * с бортовым номером: так и задумано, к самой кромке они попадают редко (см. issue #41).
 */
test.describe('рейд ложится на телефон трапецией', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('передний край выходит за окно, дальний остаётся внутри, рейд — по середине', async ({ page }) => {
        takes(6);
        // Своим же демо-кораблём, а не гостем: гостю теперь пустой снимок, и мерить нечего
        // (needsPreview в localBackend.ts). Альбатрос уже стоит в демо-составе — этим не прибавляем
        // рейду четвёртый корабль, а лишь смотрим на те же три от лица одного из них.
        await openChannel(page, DEMO, ALBATROS);
        await expect(page.locator('[data-motion]'), 'корабли так и не встали на места').toHaveCount(0, {
            timeout: SAIL_TIMEOUT,
        });

        const seen = await page.evaluate(() => {
            const water = document.querySelector('[class*="raid_"]')!;
            const raid = water.getBoundingClientRect();
            // Во сколько раз дальний край уже переднего: по нему и считается, где он лёг.
            const reachFar = Number(getComputedStyle(water).getPropertyValue('--raid-reach-far'));
            const middle = (raid.left + raid.right) / 2;
            const halfFar = (raid.width * reachFar) / 2;
            return {
                window: window.innerWidth,
                // Прокрутка страницы: рейд лежит внутри кадра, а кадр обрезает всё за краями.
                page: document.documentElement.scrollWidth,
                raid: raid.width,
                // Насколько рейд выступает за левую и за правую кромку окна.
                past: [-raid.left, raid.right - window.innerWidth],
                // Где оказались кромки дальнего края.
                far: [middle - halfFar, window.innerWidth - (middle + halfFar)],
                // Корабли дальней трети рейда: демо-флот ставит туда одного наверняка
                // (см. DEMO_BANDS в seed.ts). Им кромка не грозит вовсе.
                offshore: [...document.querySelectorAll<HTMLElement>('[data-facing]')]
                    .filter(
                        (hull) => Number(hull.closest('[data-berth-ship]')!.getAttribute('data-berth-ship')![0]) <= 2
                    )
                    .map((hull) => {
                        const box = hull.getBoundingClientRect();
                        const number = hull.querySelector('[class*="hullNumber"]')!.getBoundingClientRect();
                        return {
                            hull: [box.left, window.innerWidth - box.right],
                            number: [number.left, window.innerWidth - number.right],
                        };
                    }),
            };
        });

        expect(seen.raid, 'передний край не вышел за кромки окна — мерить нечего').toBeGreaterThan(seen.window);
        expect(seen.page, 'от вылета завелась горизонтальная прокрутка страницы').toBe(seen.window);
        expect(seen.past[0], 'рейд встал не по середине кадра').toBeCloseTo(seen.past[1], 0);
        // Дальний край не просто в окне, а отодвинут от кромки: столько же, на сколько сходятся
        // к нему оси коридоров, — иначе дальний корабль стоял бы вплотную к обрезу.
        expect(seen.far[0], 'дальний край рейда вышел за левую кромку окна').toBeGreaterThan(10);
        expect(seen.far[1], 'дальний край рейда вышел за правую кромку окна').toBeGreaterThan(10);
        expect(seen.offshore.length, 'в дальней трети рейда нет кораблей').toBeGreaterThan(0);
        for (const ship of seen.offshore) {
            expect(Math.min(...ship.hull), 'дальний корабль обрезан кромкой окна').toBeGreaterThan(0);
            expect(Math.min(...ship.number), 'у дальнего корабля обрезан бортовой номер').toBeGreaterThan(0);
        }
    });

    /**
     * Смена ширины окна корабли по воде не возит. Место на рейде у них от окна не зависит вовсе,
     * меняется только проекция — а она считается в тот же кадр, в который кадр стал другим.
     * Иначе выходит нелепое: никто никуда не плыл, а четыре корабля разом трогаются с места
     * и пару секунд подъезжают на новые точки.
     *
     * Меряется покадрово и по самой дорожке: её рамка — это и есть спроецированная точка, и,
     * в отличие от корпуса, она не качается. Ширина рейда снимается теми же кадрами и служит
     * отметкой момента: кадр, в котором рейд принял новую ширину, обязан быть тем же самым,
     * в котором корабли встали на свои новые места. Ждём при этом целую длительность подработки
     * у борта (@ship-aside-seconds, снимается с дорожки): подъезд, если он есть, укладывается
     * ровно в неё.
     *
     * Оба окна телефонные: перестановка внутри одной раскладки, безо всяких разворотов.
     */
    test('смена ширины окна переставляет корабли сразу, а не подвозит', async ({ page }) => {
        takes(12);
        await page.setViewportSize({ width: 738, height: 844 });
        // Своим же демо-кораблём — см. комментарий у соседней проверки трапеции выше.
        await openChannel(page, DEMO, ALBATROS);
        await expect(page.locator('[data-motion]'), 'корабли так и не встали на места').toHaveCount(0, {
            timeout: SAIL_TIMEOUT,
        });

        // Замер идёт в самой вкладке: со стороны Playwright между снимками успевает пройти
        // половина подъезда. Наружу отдаются только перемены.
        await page.evaluate(() => {
            const seen: { raid: number; ships: string }[] = [];
            (window as unknown as { __seen: typeof seen }).__seen = seen;
            const snap = (): void => {
                const raid = Math.round(document.querySelector('[class*="raid_"]')!.getBoundingClientRect().width);
                const ships = [...document.querySelectorAll('[class*="shipLane"]')]
                    .map((lane) => lane.getBoundingClientRect().left.toFixed(1))
                    .join(' ');
                const last = seen[seen.length - 1];
                if (last?.raid !== raid || last.ships !== ships) {
                    seen.push({ raid, ships });
                }
                requestAnimationFrame(snap);
            };
            snap();
        });
        const aside = await page
            .locator('[class*="shipLane"]')
            .first()
            .evaluate((lane) => Number.parseFloat(getComputedStyle(lane).transitionDuration) || 0);
        expect(aside, 'у дорожки нет перехода — ждать нечего и проверять нечего').toBeGreaterThan(0);

        await page.setViewportSize({ width: 317, height: 844 });
        await page.waitForTimeout(aside * 1000);

        const seen = await page.evaluate(
            () => (window as unknown as { __seen: { raid: number; ships: string }[] }).__seen
        );
        const last = seen[seen.length - 1];
        expect(seen[0].raid, 'рейд не переменился от смены окна — мерить нечего').not.toBe(last.raid);
        expect(seen[0].ships, 'проекция не переставила корабли — мерить нечего').not.toBe(last.ships);
        expect(
            seen.findIndex((frame) => frame.ships === last.ships),
            'корабли встали на свои места не в том кадре, в котором рейд принял новую ширину'
        ).toBe(seen.findIndex((frame) => frame.raid === last.raid));
    });
});
