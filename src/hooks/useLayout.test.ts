import { describe, expect, it } from 'vitest';

import { SCENE_MIN_WIDTH, SIDE_MIN_WIDTH, SIDE_MIN_WINDOW, SIDE_WIDTH } from '@/config/layout';
import { LayoutWish, allowedLayout } from '@/hooks/useLayout';

/**
 * Сверка выбранной раскладки с окном. Здесь только сама проверка — без окна, без хранилища
 * и без React: она чистая функция ровно для того, чтобы её можно было прогнать по краям,
 * а не ловить в браузере, меняя размер окна руками.
 */

const wish = (patch: Partial<LayoutWish> = {}): LayoutWish => ({
    expanded: true,
    side: true,
    sideWidth: SIDE_WIDTH,
    ...patch,
});

describe('allowedLayout', () => {
    it('в просторном окне отдаёт выбранное как есть', () => {
        const layout = allowedLayout(wish(), 1400);
        expect(layout.side).toBe(true);
        expect(layout.sideWidth).toBe(SIDE_WIDTH);
        expect(layout.sideFits).toBe(true);
    });

    it('сбоку разговор стоит только в развёрнутой раскладке', () => {
        // Сбоку панель во всю высоту окна, и сжатому кадру рядом с ней не остаётся ничего.
        expect(allowedLayout(wish({ expanded: false }), 1400).side).toBe(false);
    });

    it('в тесном окне боковой раскладки нет, и выбор от этого не стирается', () => {
        const chosen = wish();
        expect(allowedLayout(chosen, SIDE_MIN_WINDOW - 1).side).toBe(false);
        expect(allowedLayout(chosen, SIDE_MIN_WINDOW - 1).sideFits).toBe(false);
        // Тот же выбор в просторном окне снова сбоку: урезает его окно, а не переписывает.
        expect(allowedLayout(chosen, 1400).side).toBe(true);
    });

    it('порог стоит там, где самая узкая панель встаёт рядом с самым узким кадром', () => {
        expect(allowedLayout(wish(), SIDE_MIN_WINDOW).side).toBe(true);
        expect(allowedLayout(wish(), SIDE_MIN_WINDOW).sideWidth).toBe(SIDE_MIN_WIDTH);
    });

    it('ширина не уходит ниже своего минимума', () => {
        expect(allowedLayout(wish({ sideWidth: 40 }), 1400).sideWidth).toBe(SIDE_MIN_WIDTH);
    });

    it('ширина не отнимает у кадра его минимум', () => {
        const layout = allowedLayout(wish({ sideWidth: 1200 }), 1400);
        expect(layout.sideWidth).toBe(1400 - SCENE_MIN_WIDTH);
        expect(layout.maxWidth).toBe(1400 - SCENE_MIN_WIDTH);
    });

    it('в тесном окне потолок не проваливается под пол', () => {
        // Кадру тут не хватает и своего минимума, и потолок вышел бы отрицательным. Панель
        // в таком окне не показывают вовсе, но пределы обязаны остаться пригодными к счёту:
        // на них считается и потяг, и подписи у коридора.
        const layout = allowedLayout(wish({ sideWidth: SIDE_WIDTH }), 400);
        expect(layout.maxWidth).toBe(SIDE_MIN_WIDTH);
        expect(layout.sideWidth).toBe(SIDE_MIN_WIDTH);
        expect(layout.side).toBe(false);
    });

    it('раскладку «больше сцены» окно не отменяет', () => {
        // Разворот кадра — про высоту, а не про ширину: на телефоне он такой же законный.
        expect(allowedLayout(wish({ expanded: true, side: false }), 320).expanded).toBe(true);
    });
});
