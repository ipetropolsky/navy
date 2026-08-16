import { Page, expect, test } from '@playwright/test';

import { EDGE_MARGIN } from '@/backend/placement';
import { slotShare } from '@/types/channel';

import {
    ALBATROS,
    DEMO,
    berths,
    clickShip,
    join,
    openChannel,
    openNewChannel,
    openShipForm,
    readState,
    ships,
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

/**
 * Сколько ждать конца манёвра, мс. Мерка не запасная, а расчётная: самый длинный ход в кадре —
 * уход с ближней линии через весь рейд, — идёт на наименьшем ходу по кадру (`MIN_SAIL_PACE`)
 * около 53 с. Отсюда и минута с небольшим: меньше — и проверки начнут падать от того, что
 * корабль ещё в пути, а не от того, что он идёт не туда. Сбавят ход ещё — это число сбавляют
 * вместе с ним, иначе падение будет ждать полторы минуты вместо секунды.
 */
const SAIL_TIMEOUT = 70_000;

/** Насколько боковое место этой линии отстоит от середины кадра, доля его ширины. */
const berthOffset = (slot: number): number => CORRIDOR_STEP + SPREAD_FAR + (SPREAD_NEAR - SPREAD_FAR) * slotShare(slot);

/**
 * Кнопка «Готово» самой формы корабля. Через страницу её не взять: форма выезжает поверх
 * разговора, и у поля ввода под ней тоже кнопка-submit.
 */
const shipFormSubmit = (page: Page) =>
    page
        .locator('form')
        .filter({ has: page.getByPlaceholder('Гром') })
        .locator('button[type=submit]');

/**
 * Уйти с рейда. Выход живёт в шапке и только при открытой форме своего корабля: пока она
 * открыта, значок списка подменён выходом.
 */
const leaveRaid = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: 'Корабли на связи' }).click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();
};

/** Огни каждого корабля в кадре: чем является каждый и где он стоит по вертикали. */
const lights = (page: Page, within = '[class*="shipSlot"]'): Promise<{ kind: string; top: number }[][]> =>
    page.evaluate(
        (selector) =>
            [...document.querySelectorAll(selector)].map((slot) =>
                [...slot.querySelectorAll<HTMLElement>('[data-light]')].map((light) => ({
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
    await page.getByLabel('Корабли на связи').click();
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

    // Возвращаемся тем, кого в канале нет: форма открывается заново, а сосед остаётся стоять.
    await openChannel(page, 'para', 'gost');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();

    // Щёлкаем по воде, а не по самому огоньку: круг света у выбранного места широкий и вполне
    // может лечь поверх соседнего огонька. Место всё равно достанется тому, чья точка ближе.
    const shared = '5-left';
    const spot = await page.locator(`[data-berth="${shared}"]`).boundingBox();
    expect(spot, 'рядом с соседом не нашлось места').toBeTruthy();
    await page.mouse.click(spot!.x + spot!.width / 2, spot!.y + spot!.height / 2);
    await expect(page.locator(`[data-berth="${shared}"][aria-pressed="true"]`)).toHaveCount(1);
    await join(page, 'Гроза', '777');
    await page.waitForTimeout(1200);

    const after = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'para')!.members
    );
    const line = Number(shared.split('-')[0]);
    expect(
        after.filter((member) => member.place.slot === line),
        'на линии не оказалось двоих'
    ).toHaveLength(2);

    // И это видно в кадре: корабли одной дальности стоят на одной высоте, и борта у них
    // не пересекаются. Высоту сравниваем с допуском — корабли качает.
    const hulls = await page.evaluate(() =>
        [...document.querySelectorAll('[class*="shipSlot"]')].map((slot) => {
            const box = slot.getBoundingClientRect();
            return { bottom: box.bottom, left: box.left, right: box.right };
        })
    );
    // Пара тут одна, но ищем их все — так же, как выше искали место: правило про борта общее.
    const pairs = hulls.flatMap((one, index) =>
        hulls
            .slice(index + 1)
            .filter((other) => Math.abs(one.bottom - other.bottom) < 6)
            .map((other) => [one, other].sort((first, second) => first.left - second.left))
    );
    expect(pairs.length, 'в кадре не нашлось двух кораблей на одной дальности').toBeGreaterThan(0);
    for (const [near, far] of pairs) {
        expect(near.right, 'корабли на одной линии налезли друг на друга').toBeLessThan(far.left);
    }
});

test('на тесной линии первым уступает тот, кто мельче, и он же отпускает резинку', async ({ page }) => {
    // Проверка длиннее общего срока: в ней два захода на рейд подряд, и каждый идёт по морю
    // своим настоящим ходом — ждать приходится дважды почти по минуте.
    test.setTimeout(240_000);

    // Рейд предлагает и такие линии, где двоим не разойтись, стоя каждый в своей полосе: место
    // там есть, просто вставать придётся теснее. Уступает первым тот, кто мельче: ему и ходу
    // меньше. Не хватило его хода — остаток добирает крупный. Ушёл сосед — резинка отпустила,
    // и катер пошёл обратно на свою точку, а сохранённое место всё это время оставалось прежним.
    await openNewChannel(page, 'rezinka');
    await page.getByText('Малый ракетный корабль', { exact: true }).click();
    await page.locator('[data-berth="8-center"]').click();
    await join(page, 'Гром', '404');

    // Корабли по ширине корпуса: катер и корабль в полсотни метров спутать не с чем. Кроме
    // самого корпуса берём и мерки его дорожки: где стоит корабль (--slot-left) и половина
    // его ширины (--slot-half) — обе в процентах кадра. Уступить дальше кромки нельзя,
    // и «уступил всё, что мог» — это ровно --slot-left, равный --slot-half.
    const hulls = (): Promise<
        { left: number; right: number; middle: number; width: number; at: number; half: number }[]
    > =>
        page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[class*="shipLane"]')]
                .map((lane) => {
                    const box = lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect();
                    return {
                        left: box.left,
                        right: box.right,
                        middle: box.left + box.width / 2,
                        width: box.width,
                        at: parseFloat(lane.style.getPropertyValue('--slot-left')),
                        half: parseFloat(lane.style.getPropertyValue('--slot-half')),
                    };
                })
                .sort((one, other) => one.width - other.width)
        );

    // Корпуса, когда они отстоялись. Движений здесь два, и они разной длины: ход по морю
    // у заходящего и подработка у борта у обоих, — поэтому ждём не срок, а приход на место.
    // Куда корабль идёт, известно сразу: расстановка кладёт это в --slot-left на дорожке
    // и меняет одним махом, а по кадру корпус едет переходом. Значит и признак покоя простой —
    // корпус стоит серединой ровно там, куда указывает его же дорожка.
    //
    // Уходящий корабль в счёт не идёт: он виден в кадре ещё полминуты после того, как снялся
    // с рейда, а сосед отпускает резинку сразу, как только тот пропал из списка канала.
    // Помечен уходящий своим классом движения, по нему и отличаем.
    const settled = async (): Promise<Awaited<ReturnType<typeof hulls>>> => {
        await expect
            .poll(
                () =>
                    page.evaluate(() => {
                        const scene = document.querySelector('[class*="_scene_"]')!.getBoundingClientRect();
                        return [...document.querySelectorAll<HTMLElement>('[class*="shipLane"]:not([data-motion])')]
                            .map((lane) => {
                                const box = lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect();
                                const left = parseFloat(lane.style.getPropertyValue('--slot-left'));
                                return Math.abs(box.left + box.width / 2 - scene.left - (left / 100) * scene.width);
                            })
                            .every((off) => off < 1);
                    }),
                { message: 'корабли так и не встали на свои места', timeout: SAIL_TIMEOUT }
            )
            .toBe(true);
        return hulls();
    };

    // Ждём, пока корабль закончит заход: мерить его на ходу — мерить кромку кадра.
    await expect(page.locator('[data-motion]'), 'корабль так и не встал на место').toHaveCount(0, {
        timeout: SAIL_TIMEOUT,
    });
    const [aloneBig] = await settled();

    // Второй встаёт слева от соседа. Куда именно внутри своей полосы — заранее неизвестно:
    // разброс считается по позывному, а позывной выдаёт бэкенд при постановке в строй.
    // Проверять поэтому будем не расстояния в пикселях, а то, что от разброса не зависит:
    // тесная линия у этой пары такая, что воды катеру не хватает при любом разбросе.
    await openChannel(page, 'rezinka', 'gost');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    const spot = await page.locator('[data-berth="8-left"]').boundingBox();
    expect(spot, 'слева от соседа не нашлось места').toBeTruthy();
    await page.mouse.click(spot!.x + spot!.width / 2, spot!.y + spot!.height / 2);
    await join(page, 'Малыш', '111');
    await expect(page.locator('[data-motion]'), 'катер так и не встал на место').toHaveCount(0, {
        timeout: SAIL_TIMEOUT,
    });

    const [tightSmall, tightBig] = await settled();
    expect(tightSmall.right, 'корабли на тесной линии налезли друг на друга').toBeLessThan(tightBig.left);

    // Первым уступает мелкий, и на этой линии ему приходится отдать всё до последнего:
    // он стоит бортом на кромке поля по краю кадра, дальше уступать некуда.
    expect(tightSmall.at, 'катер уступил не всё, что у него было').toBeCloseTo(tightSmall.half + EDGE_MARGIN, 1);

    // А остаток добирает крупный: с середины своего коридора он отходит наружу — сам бы он
    // с места не тронулся, места ему хватало.
    expect(tightBig.at, 'крупный не добрал остаток').toBeGreaterThan(aloneBig.at + 0.05);
    expect(tightBig.middle, 'крупный не тронулся с места в кадре').toBeGreaterThan(aloneBig.middle + 2);

    // Место в канале от расхождения не меняется: разошлись они только в кадре.
    const fleet = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'rezinka')!.members
    );
    const resident = fleet.find((member) => member.name === 'Гром')!;
    expect(`${resident.place.slot}-${resident.place.corridor}`, 'расхождение переписало место').toBe('8-center');

    // Крупный уходит — и катер отпускает резинку. Уходить приходится его же вкладкой: с рейда
    // корабль снимает только свой хозяин.
    await openChannel(page, 'rezinka', resident.memberId);
    await leaveRaid(page);

    // Резинка отпускает не мгновенно: уход соседа сперва доходит до канала, и только потом
    // расстановка переписывает дорожку. Покой сам по себе тут не признак — застать его можно
    // и до перемены, на старом месте, — поэтому сперва ждём саму перемену мерки. Катер узнаём
    // по ширине корпуса: он на этой линии самый узкий, и уходящий сосед этого не меняет.
    await expect
        .poll(
            () =>
                page.evaluate(
                    () =>
                        [...document.querySelectorAll<HTMLElement>('[class*="shipLane"]')]
                            .map((lane) => ({
                                width: lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect().width,
                                at: parseFloat(lane.style.getPropertyValue('--slot-left')),
                            }))
                            .sort((one, other) => one.width - other.width)[0].at
                ),
            { message: 'катер так и не получил новую мерку', timeout: SAIL_TIMEOUT }
        )
        .toBeGreaterThan(tightSmall.at);

    // Насколько именно он отошёл — не проверяем: это его разброс внутри полосы, а он считается
    // по позывному, который выдал бэкенд. Проверяем то, что от разброса не зависит: катер больше
    // не прижат к кромке, и в кадре он стоит правее, чем стоял при соседе.
    const [freeSmall] = await settled();
    expect(freeSmall.at, 'катер так и остался прижатым к кромке').toBeGreaterThan(tightSmall.at);
    expect(freeSmall.middle, 'катер не отошёл от кромки обратно').toBeGreaterThan(tightSmall.middle);
});

test('разброс по коридору у всех вкладок одинаковый', async ({ page }) => {
    // Внутри своей полосы корабль стоит не по оси, а вразброс — иначе строй выглядит
    // построенным. Разброс этот считает сцена, у каждой вкладки свой экран, и потому он
    // обязан быть чистой функцией от того, что пришло с бэкенда: участник и его место.
    // Возьмись он от Math.random — один и тот же рейд у двух собеседников выглядел бы
    // по-разному, и «твой корабль вон тот, слева» перестало бы значить хоть что-нибудь.
    await openNewChannel(page, 'razbros');
    await join(page, 'Гром', '404');
    await openChannel(page, 'razbros', 'vtoroy');
    await join(page, 'Вымпел', '303', 'Пограничный сторожевой катер');
    await openChannel(page, 'razbros', 'tretiy');
    await join(page, 'Резвый', '202', 'Ракетный катер');

    // Смотрим глазами двух участников: у каждого свой корабль и своя вкладка. Соседняя
    // вкладка того же контекста делит с этой хранилище, то есть видит тот же рейд.
    const fleet = await readState(page).then(
        (state) => Object.values(state.channels).find((item) => item.channel.slug === 'razbros')!.members
    );
    expect(fleet, 'на рейде не собралось трёх кораблей').toHaveLength(3);

    // Что сравнивать: дальность корабля и середину его корпуса по ширине кадра. Дальность
    // берём из порядка наложения — он и есть номер линии, — а середина и есть то число,
    // которое двигает разброс. Подписей в обычном кадре нет, они живут в разметке выбора,
    // поэтому корабли различаем линией и шириной корпуса, а не именем.
    const picture = (tab: Page): Promise<{ slot: number; middle: number; width: number }[]> =>
        tab.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[class*="shipLane"]')]
                .map((lane) => {
                    const box = lane.querySelector('[class*="shipSlot"]')!.getBoundingClientRect();
                    return {
                        slot: Number(lane.style.zIndex) - 1,
                        middle: Math.round((box.left + box.width / 2) * 100) / 100,
                        width: Math.round(box.width * 100) / 100,
                    };
                })
                .sort((one, other) => one.slot - other.slot || one.middle - other.middle)
        );

    await openChannel(page, 'razbros', fleet[0].memberId);
    const mine = await picture(page);

    const other = await page.context().newPage();
    await other.setViewportSize(page.viewportSize()!);
    await openChannel(other, 'razbros', fleet[2].memberId);
    const theirs = await picture(other);
    await other.close();

    expect(theirs, 'у второй вкладки рейд оказался другим').toEqual(mine);
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

    // Возвращаемся тем, кого в канале нет: форма открывается заново, а корабль остаётся стоять.
    await openChannel(page, 'razmer', 'gost');

    const offered = async (ship: string): Promise<string[]> => {
        await page.getByText(ship, { exact: true }).click();
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

test('соседняя линия занятого коридора остаётся на воде, а расстановка её обходит', async ({ page }) => {
    // Теснота по дальности (MIN_SLOT_GAP) была запретом, и один корабль выключал из рейда
    // пять дальностей своего коридора — свою и по две в каждую сторону. Теперь это склонность,
    // и у неё две стороны, которые надо проверять порознь: человеку соседняя линия видна
    // и доступна, а расстановка берёт её последней.
    await openNewChannel(page, 'sosedi');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    await page.locator('[data-berth="4-center"]').click();
    await join(page, 'Малыш', '111');

    // Сторона первая: гость видит на воде обе соседние линии центрального коридора. А вот
    // сама четвёртая пропала — там место занято, и точка на воде у них была бы одна на двоих.
    await openChannel(page, 'sosedi', 'gost');
    await page.getByText('Пограничный сторожевой катер', { exact: true }).click();
    const offered = await berths(page).evaluateAll((dots) =>
        dots.map((dot) => (dot as HTMLElement).dataset.berth ?? '')
    );
    expect(offered, 'соседняя линия занятого коридора пропала с воды').toContain('3-center');
    expect(offered, 'соседняя линия занятого коридора пропала с воды').toContain('5-center');
    expect(offered, 'занятое место осталось на воде').not.toContain('4-center');

    // Сторона вторая: те, кто места не выбирал, встали сами — и ни один не оказался в чужом
    // коридоре ближе трёх линий. Свободных мест на рейде из четверых хватает с избытком,
    // так что тесное место — последнее, что берётся, и до него дело не доходит.
    const arrive = async (name: string, hullNumber: string, expected: number): Promise<void> => {
        await openChannel(page, 'sosedi', `gost-${hullNumber}`);
        await join(page, name, hullNumber);
        await expect(ships(page)).toHaveCount(expected);
    };
    await arrive('Ветер', '201', 2);
    await arrive('Гроза', '202', 3);
    await arrive('Заря', '203', 4);

    // Свой канал заводится со случайным id, поэтому ищем его по адресу, а не по ключу.
    const state = await readState(page);
    const raid = Object.values(state.channels).find((one) => one.channel.slug === 'sosedi')!;
    const fleet = raid.members.map((member) => member.place);
    expect(fleet, 'на рейде оказались не все').toHaveLength(4);
    for (const one of fleet) {
        const tight = fleet.filter(
            (other) => other !== one && other.corridor === one.corridor && Math.abs(other.slot - one.slot) < 3
        );
        expect(tight, `расстановка поставила корабль вплотную к соседу по коридору ${one.corridor}`).toHaveLength(0);
    }
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
            [...document.querySelectorAll<HTMLElement>('[data-lit]')]
                .filter((light) => light.getBoundingClientRect().width > light.getBoundingClientRect().height * 1.5)
                .map((light) => light.dataset.lit!)
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
        page.locator(`[data-lit="${key}"]`).evaluate((mark) => {
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
        page.locator(`[data-lit="${key}"]`).evaluate((mark) => new DOMMatrix(getComputedStyle(mark).transform).a < 0);
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
    // кадры расходятся на восьмую пути, и проверка сыпалась на ровном месте. Полсотни
    // миллисекунд запаса кадровый разнобой покрывают с лихвой, а перепутанное движение — нет:
    // разъедься разметка с флотом на длительность кадра (@expand-seconds вдвое дольше), середина
    // разошлась бы на добрую сотню.
    //
    // Призрака берём самым тёмным кадром, а не первым: корабль только светлеет, и если первый
    // замер пришёлся уже на движение, доли считались бы от полпути.
    const ghost = Math.min(...frames.map((frame) => frame.ship));
    const gone = frames.map((frame) => ({ ms: frame.ms, part: 1 - frame.field }));
    const back = frames.map((frame) => ({ ms: frame.ms, part: (frame.ship - ghost) / (1 - ghost) }));
    for (const mark of [0.25, 0.5, 0.75]) {
        const apart = Math.abs(crossed(gone, mark) - crossed(back, mark));
        expect(apart, `разметка и флот идут вразнобой на доле ${mark}`).toBeLessThan(50);
    }

    // И уходит из кадра совсем: иначе прозрачный слой навсегда остался бы поверх сцены.
    expect(frames.at(-1)!.field, 'догоревшая разметка осталась в кадре').toBe(0);
    await expect(page.locator('[class*="berthField"]'), 'догоревшая разметка осталась в кадре').toHaveCount(0);
});

test('подпись стоит на точке своего места, даже когда корабль отведён от края кадра', async ({ page }) => {
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
    // всегда его.
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
        .locator('[class*="shipRock"] [data-light]')
        .evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).opacity));
    expect(lights.length, 'огней в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        lights.every((opacity) => Number.parseFloat(opacity) === 1),
        'огни погасли вместе с корпусом'
    ).toBe(true);

    // Высветляется корпус, а не тень: тень тёмная, и то же осветление вывернуло бы её
    // в светлое пятно под кораблём. Свой размывающий фильтр у тени есть всегда, поэтому
    // сравнивать не с «none», а с отсутствием осветления.
    const shadows = await page
        .locator('[class*="shipShadow"]')
        .evaluateAll((marks) => marks.map((mark) => getComputedStyle(mark).filter));
    expect(shadows.length, 'теней в кадре не нашлось, проверять нечего').toBeGreaterThan(0);
    expect(
        shadows.every((filter) => !filter.includes('brightness')),
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
        const page = await context.newPage();
        await openNewChannel(page, `hod${kind.length}`);
        await join(page, `Гость${kind.length}`, String(100 + kind.length), kind);
        const slot = page.locator('[data-motion="entering"]');
        await expect(slot).toHaveCount(1);
        const value = await slot.evaluate((element) => getComputedStyle(element).getPropertyValue('--enter-seconds'));
        await context.close();
        return Number.parseFloat(value);
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
            // Корабли различаем по подписи спрайта: своего имени у дорожки нет.
            const name = lane.querySelector('img')?.alt ?? '?';
            window.__flashes[name] = 0;
            new MutationObserver(() => {
                if (lamp.className.includes('lampOn')) {
                    window.__flashes[name] += 1;
                }
            }).observe(lamp, { attributes: true, attributeFilter: ['class'] });
        }
    }, within);

const flashes = (page: Page): Promise<Record<string, number>> => page.evaluate(() => window.__flashes);

test('карточка чужого корабля открывается и из кадра, и из ленты', async ({ page }) => {
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

    // Закрыли — и открыли заново из ленты, тычком по аватарке. Это те же три цифры на борту,
    // и приводить они должны к тому же кораблю.
    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card).toBeHidden();
    await page.locator(`button[title="Корабль «${other.name}»"]`).first().click();
    await expect(page.getByRole('region', { name: 'Корабль' })).toContainText(`Бортовой номер ${other.hullNumber}`);
});

/**
 * Целиться в корпус не надо: нажатие ловит вода поверх всего флота, а достаётся оно ближайшей
 * занятой стоянке.
 *
 * Так это сделано не для удобства, а потому что иначе до половины рейда не дотянуться вовсе.
 * Дорожка корабля — прямоугольник во всю его ширину и высоту; ближний корабль накрывает им
 * дальнего целиком, и щелчок по видимому в кадре дальнему корпусу доставался бы ближнему.
 *
 * Жмём по открытой воде под самым килем дальнего корабля — в корпус такое нажатие не попадает
 * вовсе, а карточка обязана открыться его: ближе его стоянки к этой точке ничего нет.
 */
test('нажатие по воде достаётся ближайшему кораблю, а не тому, в чей корпус попали', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const fleet = Object.values((await readState(page)).channels)[0].members;
    // Самый дальний из чужих: под ним больше всего свободной воды, а до соседней линии оттуда
    // всё равно дальше, чем до него самого.
    const other = fleet
        .filter((member) => member.memberId !== ALBATROS)
        .sort((one, two) => one.place.slot - two.place.slot)[0];
    const hull = (await page.locator(`[data-berth-ship="${other.place.slot}-${other.place.corridor}"]`).boundingBox())!;

    await page.mouse.click(hull.x + hull.width / 2, hull.y + hull.height + 10);
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

test('«Сигнал» зажигает лампу на портрете, а рейд остаётся тёмным', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    // Аватарка в ленте открывает карточку, а сигнал просят уже из неё.
    await page.locator('button[title^="Корабль «"]').first().click();
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

test('«Ход» и «Якорь» переключают огни портрета, не меняя ширины кнопки', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.locator('button[title^="Корабль «"]').first().click();
    const card = page.getByRole('region', { name: 'Корабль' });
    const portrait = '[class*="portraitShip"]';

    // На рейде корабль стоит на якоре — с этого карточка и начинается.
    const anchored = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        anchored.some((kind) => kind.startsWith('anchor')),
        'на якоре не горят якорные огни'
    ).toBe(true);

    // Кнопка подписана действием, а не положением: пока корабль на якоре, она предлагает ход.
    const toggle = card.getByRole('button', { name: 'Ход', exact: true });
    const width = (await toggle.boundingBox())!.width;
    await toggle.click();

    const underway = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        underway.some((kind) => kind.startsWith('masthead')),
        'под парами не зажглись ходовые огни'
    ).toBe(true);
    expect(
        underway.some((kind) => kind.startsWith('anchor')),
        'под парами остались якорные огни'
    ).toBe(false);

    // Подпись сменилась, ширина — нет: обе подписи лежат в кнопке разом, и место занимает
    // более длинная из них. Иначе на каждом переключении дёргалась бы и она, и соседняя.
    const back = card.getByRole('button', { name: 'Якорь', exact: true });
    await expect(back).toBeVisible();
    expect((await back.boundingBox())!.width, 'кнопка сменила ширину вместе с подписью').toBe(width);

    // И обратно: якорь гасит ходовые.
    await back.click();
    const again = (await lights(page, portrait))[0].map((light) => light.kind);
    expect(
        again.some((kind) => kind.startsWith('anchor')),
        'якорь не вернул якорные огни'
    ).toBe(true);
});

test('позывной в карточке стоит вровень с крестиком', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await page.locator('button[title^="Корабль «"]').first().click();
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

test('лампа передаёт и то, что набрано поверх выделения', async ({ page }) => {
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

test('в списке кораблей выбранный стоит под парами и отзывается лампой', async ({ page }) => {
    // Плашка корабля — `div` с ролью кнопки, а не `button`: из настоящей кнопки не выделишь
    // текст, а он в плашке главное (см. проверку про характеристики в channel.spec).
    const KINDS = '[class*="kinds_"] > [role="button"]';
    // Канал открываем, но в строй не встаём: список кораблей — это и есть форма входа.
    await openChannel(page, DEMO);
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
    await expect(page.locator('[data-motion]'), 'корабль так и не встал на рейде').toHaveCount(0, {
        timeout: SAIL_TIMEOUT,
    });
    const scene = (await page.locator('[class*="scene"]').first().boundingBox())!;
    const before = (await ships(page).first().boundingBox())!;

    await page.getByLabel('Корабли на связи').click();
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
    const track = await page.evaluate(
        () =>
            new Promise<{ from: number; to: number }[]>((resolve) => {
                const seen: { from: number; to: number }[] = [];
                const tick = window.setInterval(() => {
                    const box = document.querySelector('[class*="shipSlot"]')?.getBoundingClientRect();
                    seen.push(box ? { from: box.left, to: box.right } : { from: NaN, to: NaN });
                    if (seen.length >= 24) {
                        window.clearInterval(tick);
                        resolve(seen);
                    }
                }, 300);
            })
    );
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
