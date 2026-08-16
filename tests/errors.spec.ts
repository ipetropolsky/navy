import { expect, test } from '@playwright/test';

import { ALBATROS, DEMO, bubbles, expectWayOut, join, openChannel, openSheet, send, ships } from '@tests/helpers';

/**
 * Что происходит, когда сделано не то. Проверяется не только текст отказа, но и то,
 * что из состояния есть выход: экран, из которого некуда нажать, — тупик.
 */

test('канала по адресу нет: сказано прямо и есть куда уйти', async ({ page }) => {
    await page.goto('/?channel=nesushchestvuyushchiy');

    await expect(page.getByText('Канала по адресу «nesushchestvuyushchiy» нет')).toBeVisible();
    await expectWayOut(page);

    // Кнопка и правда уводит на главную, где канал заводится заново.
    await page.getByRole('button', { name: 'Создать свой канал' }).click();
    await expect(page.getByPlaceholder('Эскадра «Полночь»')).toBeVisible();
});

test('позывной и бортовой номер заняты: отказ показан, форма остаётся рабочей', async ({ page }) => {
    await openChannel(page, DEMO);

    await join(page, 'Альбатрос', '777');
    await expect(page.getByText('Корабль с таким позывным уже на связи')).toBeVisible();

    await join(page, 'Гроза', '317');
    await expect(page.getByText('Этот бортовой номер уже занят')).toBeVisible();

    // Форма никуда не делась: с исправленными данными вход проходит.
    await join(page, 'Гроза', '777');
    // Вошли четвёртыми к трём кораблям демо-канала.
    await expect(page.locator('[class*="chatStatus"]')).toHaveText('4 на связи');
});

test('адрес канала не той формы: отправить нельзя, подсказка на месте', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Эскадра «Полночь»').fill('Полночь');
    await page.locator('input[placeholder="eskadra-polnoch"]').fill('-');

    // Кириллица и знаки в адрес не проходят, а один дефис — не адрес.
    await expect(page.locator('button[type=submit]')).toBeDisabled();
    await expect(page.getByText('латинские буквы, цифры и дефис')).toBeVisible();
});

test('слишком длинное сообщение не уходит, и сказано насколько', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await send(page, 'я'.repeat(505));

    await expect(page.locator('[class*="snackbar"]')).toHaveText('Максимум 500 символов, у вас 505');
    await expect(bubbles(page)).toHaveCount(before);
    // Набранное не потеряно: обрезать чужой текст нельзя.
    await expect(page.getByPlaceholder('Сообщение')).toHaveValue('я'.repeat(505));
});

/**
 * Тот же предел длины и в других полях приложения: правило одно на все — набранное сверх
 * не обрезается, поле краснеет, а по нажатию говорится, насколько перебрали (`@/utils/limit`).
 * Проверяется он на новом курсе: это самое молодое поле с пределом, и в нём заодно видно,
 * что перебор не уводит с рейда.
 */
test('слишком длинный курс не уводит с рейда, и сказано насколько', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();

    const course = page.getByLabel('Задайте новый курс');
    await course.fill('я'.repeat(101));
    await page.getByRole('button', { name: 'Курс верный' }).click();

    await expect(page.locator('[class*="snackbar"]')).toHaveText('Максимум 100 символов, у вас 101');
    // Набранное на месте, корабль тоже: отказ ничего не сделал за человека.
    await expect(course).toHaveValue('я'.repeat(101));
    await expect(ships(page)).toHaveCount(3);
    await expectWayOut(page);
});
