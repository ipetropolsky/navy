import { Page, expect, test } from '@playwright/test';

import { MOBILE_MAX_WIDTH } from '@/config/layout';
import { slotDepth } from '@/types/channel';

import { ALBATROS, DEMO, openChannel, readState, shipNames, ships } from '@tests/helpers';

/**
 * Раскладка на телефоне и на десктопе. Здесь тоже только то, на чём наступали: вода однажды
 * занимала верхнюю треть своей области, а ниже стоял голый фон; месяц уезжал под заголовок;
 * корабли жались к нижней кромке, оставляя у горизонта пустую полосу.
 */

interface Geometry {
    scene: { width: number; height: number };
    /** Линия горизонта: верх воды, px от верха сцены. */
    horizon: number;
    /** Плитка воды: должна закрывать свою область целиком. */
    seaTile: { width: number; height: number };
    seaBox: { width: number; height: number };
    /** Месяц: где он стоит и докуда достаёт шапка чата. */
    moon: { top: number; bottom: number };
    headerBottom: number;
    /** Корабли: самый дальний и самый ближний, px от верха сцены. */
    farShipTop: number;
    nearShipBottom: number;
}

const geometry = (page: Page): Promise<Geometry> =>
    page.evaluate(() => {
        const box = (selector: string): DOMRect => document.querySelector(selector)!.getBoundingClientRect();
        const scene = box('[class*="scene_"]');
        const sea = box('[class*="sea_"]');
        const tile = box('[class*="seaTile"]');
        const moon = box('[class*="moon"]');
        const status = box('[class*="chatStatus"]');
        const slots = [...document.querySelectorAll('[class*="shipSlot"]')].map((el) => el.getBoundingClientRect());
        const tops = slots.map((slot) => slot.top - scene.top);
        const bottoms = slots.map((slot) => slot.bottom - scene.top);
        return {
            scene: { width: Math.round(scene.width), height: Math.round(scene.height) },
            horizon: Math.round(sea.top - scene.top),
            seaTile: { width: Math.round(tile.width), height: Math.round(tile.height) },
            seaBox: { width: Math.round(sea.width), height: Math.round(sea.height) },
            moon: { top: Math.round(moon.top - scene.top), bottom: Math.round(moon.bottom - scene.top) },
            headerBottom: Math.round(status.bottom - scene.top),
            farShipTop: Math.round(Math.min(...tops)),
            nearShipBottom: Math.round(Math.max(...bottoms)),
        };
    });

/** Общее для любой ширины: вода закрывает свою область, корабли целиком в кадре. */
const expectSaneScene = (view: Geometry): void => {
    expect(view.seaTile.height, 'под водой осталась полоса фона').toBeGreaterThanOrEqual(view.seaBox.height);
    expect(view.nearShipBottom, 'ближний корабль вылез за низ сцены').toBeLessThanOrEqual(view.scene.height);
    // Корпус дальнего корабля ниже горизонта; надстройка выше — это нормально, мачты
    // и должны торчать над водой, поэтому сравниваем не верх спрайта, а его нижнюю треть.
    expect(view.farShipTop, 'дальний корабль оторвался от воды').toBeLessThan(view.scene.height);
};

/**
 * Разметка свободного места: во что перспектива превратила круг, лежащий на воде.
 * Ширина здесь своя, до всяких поворотов, а высота — та, что вышла на экране.
 */
interface BerthShape {
    width: number;
    height: number;
    /** Насколько отметка ниже горизонта, px: от этого и зависит, как сильно её сплющило. */
    below: number;
    perspective: number;
    /** Радиус круга в его собственных единицах, px. */
    radius: number;
    /** Разбивка линии на штрихи. Её быть не должно: пунктир в перспективе не читается. */
    dash: string;
}

const berthShapes = (page: Page): Promise<BerthShape[]> =>
    page.evaluate(() => {
        // Сцена — родитель слоя воды: под этот же класс попадает обёртка в шапке приложения.
        const sea = document.querySelector('[class*="sea_"]')!;
        const horizon = sea.getBoundingClientRect().top;
        return [...document.querySelectorAll<HTMLElement>('[class*="berthMark"]')].map((mark) => {
            // Дорожка тянется от горизонта до точки стоянки: её верх — точка схода для овала,
            // её низ — само место. Перспектива живёт на ней же, у каждого коридора своя.
            const lane = mark.parentElement!;
            const ring = mark.querySelector('circle')!;
            return {
                width: mark.offsetWidth,
                height: mark.getBoundingClientRect().height,
                below: lane.getBoundingClientRect().bottom - horizon,
                perspective: parseFloat(getComputedStyle(lane).perspective),
                radius: ring.r.baseVal.value,
                dash: getComputedStyle(ring).strokeDasharray,
            };
        });
    });

/** Где стоят линии рейда: номер линии и насколько её точка ниже горизонта, px. */
const slotLines = (page: Page): Promise<[number, number][]> =>
    page.evaluate(() => {
        const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
        const lines = new Map<number, number>();
        for (const dot of document.querySelectorAll<HTMLElement>('[data-berth]')) {
            const spot = dot.getBoundingClientRect();
            lines.set(Number(dot.dataset.berth!.split('-')[0]), spot.top + spot.height / 2 - horizon);
        }
        return [...lines.entries()].sort((one, other) => one[0] - other[0]);
    });

/**
 * Всё, что стоит на рейде, стоит по глубине слота: высота под горизонтом идёт за ней, а не
 * за номером линии. Сверху на это ложится подъём рейда в пикселях, один на все линии, поэтому
 * сравниваем не сами высоты, а их доли пройденного пути от дальней линии к ближней: подъём
 * из такой доли уходит сам, а перспектива в ней остаётся.
 *
 * Так проверка не зависит ни от высоты воды, ни от подъёма, ни от того, какие именно линии
 * ей достались, — и ловит то, ради чего заведена: лесенку, разъехавшуюся с перспективой.
 */
const expectFollowsDepth = (points: [number, number][], what: string): void => {
    const first = points[0];
    const last = points[points.length - 1];
    const span = slotDepth(last[0]) - slotDepth(first[0]);
    // Линии могли достаться все с одной дальности — тогда и разойтись им не по чему.
    if (span === 0) {
        for (const [slot, below] of points) {
            expect(below, `${what} ${slot} на общей дальности стоит не там же, где остальные`).toBeCloseTo(first[1], 0);
        }
        return;
    }
    for (const [slot, below] of points) {
        expect((below - first[1]) / (last[1] - first[1]), `${what} ${slot} стоит не на своей глубине`).toBeCloseTo(
            (slotDepth(slot) - slotDepth(first[0])) / span,
            1
        );
    }
};

/**
 * Линии рейда: стоят по глубине, и перспектива в них именно перспектива, но смягчённая —
 * ближние разнесены заметно шире дальних и всё же не настолько, чтобы дальняя половина рейда
 * слиплась в кашу. Обе границы здесь по делу: без нижней разметка становится лесенкой
 * в таблице, без верхней — пятачком у горизонта, каким рейд однажды и был.
 */
const expectSlotsFollowDepth = (lines: [number, number][]): void => {
    expect(lines.length, 'свободных линий слишком мало, шаг не проверить').toBeGreaterThan(3);
    expectFollowsDepth(lines, 'линия');

    const gaps = lines.slice(1).map(([slot, below], index) => (below - lines[index][1]) / (slot - lines[index][0]));
    expect(gaps.at(-1)!, 'ближние линии не разнесены шире дальних').toBeGreaterThan(gaps[0] * 1.8);
    expect(gaps.at(-1)!, 'дальние линии сбиты в кучу у горизонта').toBeLessThan(gaps[0] * 6);
};

/** Насколько ниже горизонта стоят корабли, px, от дальнего к ближнему. */
const shipWaterlines = (page: Page): Promise<number[]> =>
    page.evaluate(() => {
        const horizon = document.querySelector('[class*="sea_"]')!.getBoundingClientRect().top;
        // Нижняя кромка дорожки — сама точка стоянки: по ней корабль и поставлен.
        return [...document.querySelectorAll('[class*="shipLane"]')]
            .map((lane) => lane.getBoundingClientRect().bottom - horizon)
            .sort((one, other) => one - other);
    });

/**
 * Корабли стоят по тому же закону, что и разметка, и проверяются тем же счётом. Слоты
 * демо-эскадре раздаёт бэкенд и раздаёт случайно, поэтому какие именно линии достанутся,
 * известно только из хранилища — оттуда их и берём. Так проверка и не зависит от расстановки,
 * и ловит то, ради чего заведена: собранный в кучу флот или лесенку, разъехавшуюся
 * с перспективой.
 */
const expectFleetStandsByDepth = (waterlines: number[], slots: number[]): void => {
    expect(waterlines.length, 'кораблей в кадре нет').toBe(slots.length);
    const order = [...slots].sort((one, other) => one - other);
    expectFollowsDepth(
        order.map((slot, index) => [slot, waterlines[index]]),
        'корабль на линии'
    );
};

/**
 * Места на рейде должны лежать на воде, а не стоять в кадре. Проверяем это счётом, а не
 * на глаз: круг радиуса r, уложенный плашмя на расстоянии below ниже точки схода, проекция
 * с камерой на perspective сплющивает ровно до below * P * w / (P² − r²). Сойдётся — значит
 * перспектива дошла до отметки: и сцена раздаёт её, и дорожка не расплющила её обратно
 * в плоскость экрана.
 *
 * Числа для обеих раскладок свои: воды в кадре на телефоне больше, и камера отодвинута дальше.
 */
const expectBerthsLieOnWater = (marks: BerthShape[]): void => {
    expect(marks.length, 'свободных мест на рейде не показано вовсе').toBeGreaterThan(3);
    for (const mark of marks) {
        const radius = mark.width / 2;
        const lying = (mark.below * mark.perspective * mark.width) / (mark.perspective ** 2 - radius ** 2);
        expect(Math.abs(mark.height - lying), 'отметка не легла на воду перспективой').toBeLessThan(1.5);
    }

    // И перспектива именно перспектива: ближнее место раскрыто заметно шире дальнего.
    const byDepth = [...marks].sort((one, other) => one.below - other.below);
    const far = byDepth[0];
    const near = byDepth[byDepth.length - 1];
    expect(near.height / near.width, 'ближнее место сплющено как дальнее').toBeGreaterThan(
        (far.height / far.width) * 1.5
    );

    // Но и не вид сверху: корабли в сцене нарисованы строго сбоку, то есть с высоты собственной
    // ватерлинии, — а раскрытый овал говорит, что на рейд смотрят с высоты. Верхняя граница
    // и держит эти две высоты в одной сцене.
    expect(near.height / near.width, 'на рейд смотрят сверху, а на корабли сбоку').toBeLessThan(0.2);

    // Круг у каждого места свой не по масштабу, а по размеру: его радиус в собственных
    // единицах разметки равен половине ширины отметки в пикселях экрана. Разъедутся — значит
    // разметку опять растягивают масштабом, а вместе с кругом растянется и линия.
    for (const mark of marks) {
        expect(mark.radius * 2, 'круг нарисован масштабом, а не размером').toBeCloseTo(mark.width * 0.98, 0);
        expect(mark.dash, 'линия разбита на штрихи, а пунктир в перспективе не читается').toBe('none');
    }
};

/** Плашка формы: её ширина и скругление и отличают мобильный вид от десктопного. */
const panelBox = (page: Page): Promise<{ width: number; radius: number; parentWidth: number }> =>
    page.evaluate(() => {
        const panel = document.querySelector('[class*="card"]')!;
        return {
            width: Math.round(panel.getBoundingClientRect().width),
            radius: parseFloat(getComputedStyle(panel).borderTopLeftRadius),
            parentWidth: Math.round(panel.parentElement!.getBoundingClientRect().width),
        };
    });

test.describe('телефон', () => {
    // Ширина заведомо мобильная: точка перехода одна на стили и на код, и берём мы её оттуда же.
    test.use({ viewport: { width: MOBILE_MAX_WIDTH - 90, height: 844 } });

    test('форма занимает ширину целиком и без скруглений', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'форма не дотянулась до краёв').toBe(panel.parentWidth);
        expect(panel.radius, 'на всю ширину скругления не нужны').toBe(0);
    });

    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        expectBerthsLieOnWater(await berthShapes(page));
        expectSlotsFollowDepth(await slotLines(page));
        // Занятые места подписаны все: рейд читается целиком — где свободно, а где «Вымпел».
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
    });

    test('вода закрывает своё место, месяц не под текстом, корабли по всей воде', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // Месяц стоит в просвете между нижней строкой шапки и горизонтом.
        expect(view.moon.top, 'месяц заехал под заголовок').toBeGreaterThan(view.headerBottom);
        expect(view.moon.bottom, 'месяц ушёл в воду').toBeLessThan(view.horizon);

        // Корабли разнесены по воде перспективой, а не собраны в кучу.
        const fleet = Object.values((await readState(page)).channels)[0].members;
        expectFleetStandsByDepth(
            await shipWaterlines(page),
            fleet.map((member) => member.place.slot)
        );
    });
});

test.describe('десктоп', () => {
    test.use({ viewport: { width: 1200, height: 900 } });

    test('колонка ограничена по ширине, сцена собрана так же', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // Приложение — колонка по центру, а не во весь экран.
        expect(view.scene.width).toBeLessThanOrEqual(760);
        // На широком экране небо выше: воде отдано меньше половины сцены.
        expect(view.horizon / view.scene.height).toBeGreaterThan(0.5);
    });

    // Масштаб в списке один на всех, и линейка — единственное, что переводит его в метры.
    // Ошибись тут на шаг — и катер молча станет корветом.
    test('места на рейде лежат на воде, а занятые подписаны', async ({ page }) => {
        await openChannel(page, DEMO);
        expectBerthsLieOnWater(await berthShapes(page));
        expectSlotsFollowDepth(await slotLines(page));
        await expect(shipNames(page)).toHaveCount(await ships(page).count());
    });

    test('масштабная линейка не врёт: метр на ней и метр корабля — один и тот же', async ({ page }) => {
        await openChannel(page, DEMO);
        const drawings = await page.evaluate(() =>
            [...document.querySelectorAll('[class*="kind_"], [class*="kindActive"]')].map((button) => ({
                // Длину корабля берём из его же подписи: «71,2 м · 1 070 т · 32 узла».
                shipMetres: parseFloat(button.querySelector('[class*="kindSpec"]')!.textContent.replace(',', '.')),
                scaleMetres: parseFloat(button.querySelector('[class*="scaleLabel"]')!.textContent),
                shipWidth: button.querySelector('img')!.getBoundingClientRect().width,
                scaleWidth: button.querySelector('[class*="scaleBar"]')!.getBoundingClientRect().width,
                buttonWidth: button.querySelector('[class*="kindImageBox"]')!.getBoundingClientRect().width,
            }))
        );

        expect(drawings.length).toBeGreaterThan(1);
        // У каждого корабля масштаб свой — размеры в списке поджаты, чтобы катер было видно, —
        // и линейка под ним обязана быть в этом же масштабе. Точность до третьего знака:
        // доли процента съедают округление процентов в разметке и пиксельная сетка браузера.
        for (const drawing of drawings) {
            expect(drawing.shipMetres / drawing.shipWidth, 'линейка и корабль в разных масштабах').toBeCloseTo(
                drawing.scaleMetres / drawing.scaleWidth,
                3
            );
            expect(drawing.shipWidth).toBeLessThanOrEqual(drawing.buttonWidth);
        }

        // Поджато, но не перевёрнуто: длиннее корабль — шире силуэт, а самый короткий занимает
        // не меньше половины кнопки, иначе его не разглядеть.
        const bySize = [...drawings].sort((a, b) => a.shipMetres - b.shipMetres);
        for (let i = 1; i < bySize.length; i++) {
            expect(bySize[i].shipWidth, 'корабль длиннее, а нарисован уже').toBeGreaterThanOrEqual(
                bySize[i - 1].shipWidth
            );
        }
        expect(bySize[0].shipWidth / bySize[0].buttonWidth, 'самый маленький корабль потерялся').toBeGreaterThanOrEqual(
            0.5
        );
        expect(bySize.at(-1)!.shipWidth).toBeCloseTo(bySize.at(-1)!.buttonWidth, 0);
    });

    test('форма — карточка, а не полоса во всю панель', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'карточка растеклась по всей панели').toBeLessThan(panel.parentWidth);
        expect(panel.radius, 'у карточки должны быть скруглённые края').toBeGreaterThan(0);
    });
});
