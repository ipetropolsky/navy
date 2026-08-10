import { Page, expect, test } from '@playwright/test';

import { MOBILE_MAX_WIDTH } from '@/config/layout';

import { ALBATROS, DEMO, openChannel } from '@tests/helpers';

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

    test('вода закрывает своё место, месяц не под текстом, корабли по всей воде', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        const view = await geometry(page);
        expectSaneScene(view);

        // Месяц стоит в просвете между нижней строкой шапки и горизонтом.
        expect(view.moon.top, 'месяц заехал под заголовок').toBeGreaterThan(view.headerBottom);
        expect(view.moon.bottom, 'месяц ушёл в воду').toBeLessThan(view.horizon);

        // Корабли разнесены по всей воде, а не собраны у нижней кромки: от горизонта
        // до ближнего корабля должно быть занято больше половины высоты воды.
        const band = view.scene.height - view.horizon;
        const used = view.nearShipBottom - Math.max(view.farShipTop, view.horizon);
        expect(used / band, 'флот толпится в части воды').toBeGreaterThan(0.5);
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

    test('форма — карточка, а не полоса во всю панель', async ({ page }) => {
        await openChannel(page, DEMO);
        const panel = await panelBox(page);
        expect(panel.width, 'карточка растеклась по всей панели').toBeLessThan(panel.parentWidth);
        expect(panel.radius, 'у карточки должны быть скруглённые края').toBeGreaterThan(0);
    });
});
