import { expect } from '@playwright/test';

import { createChannel, join, leaveRaid, newTab, sceneReady, signIn, takes, test } from '@tests-firebase/helpers';

/**
 * Список своих каналов на настоящем сервере. Местный набор (tests/home.spec.ts) проверяет то же
 * самое поверх localStorage — и потому не проверяет главного: что этот список вообще
 * прочитывается из Firestore при действующих правилах доступа.
 *
 * Читается он из личного реестра `users/{userId}/channels` (см. `listMyChannels`
 * в firebaseBackend.ts), а правила пускают в него только самого хозяина
 * (`allow read: if isMe(userId)` в firestore.rules). Проверка на местном бэкенде такого
 * не поймала бы вовсе: там правил нет, и любой запрет прошёл бы мимо неё незамеченным.
 *
 * Реестр этот ведут Cloud Functions в той же транзакции, что и постановку в строй с уходом
 * (functions/src/raid.ts), — поэтому и здесь каналы заводятся и покидаются по-настоящему,
 * через приложение, а не подкладыванием записей в эмулятор.
 */

test('в списке — свои каналы, и только свои', async ({ browser }) => {
    // Срок поверх собственных ожиданий, а не по замеру (см. `takes`): внутри стоят два входа,
    // заведение канала и заход в строй, у каждого свой срок и своё внятное объяснение отказа.
    takes(45);

    const stamp = Date.now();
    const slug = `moi-kanaly-${stamp}`;
    const title = `Свой рейд ${stamp}`;

    const mine = await newTab(browser);
    await signIn(mine, `my-channels-owner-${stamp}`, 'Хозяин');
    await createChannel(mine, title, slug);
    // Заведённый канал становится своим не от заведения, а от корабля на рейде: реестр ведёт
    // постановка в строй, и до неё в списке взяться нечему.
    await join(mine, 'Гроза', '101');

    await mine.goto('/', { waitUntil: 'domcontentloaded' });
    const row = mine.getByRole('button', { name: `Канал «${title}»` });
    await expect(row, 'свой канал не пришёл с сервера в список').toBeVisible({ timeout: 15_000 });
    // Под названием — адрес: по нему канал и открывают, и по нему же его узнают среди тёзок.
    await expect(row).toContainText(slug);

    // Строчка ведёт в канал — тем же адресом, каким он заведён.
    await row.click();
    await expect(mine).toHaveURL(new RegExp(`\\?channel=${slug}`));
    await sceneReady(mine);

    // Другой человек — другая личность, и чужой реестр ему правилами закрыт. Пустой список
    // здесь значит именно это: не «не показали», а «не дали прочитать».
    const stranger = await newTab(browser);
    await signIn(stranger, `my-channels-stranger-${stamp}`, 'Посторонний');
    await expect(stranger.getByRole('button', { name: `Канал «${title}»` })).toHaveCount(0);
    await expect(stranger.getByText('Пока ни одного'), 'чужому показали не пустой список').toBeVisible();
});

test('ушёл с рейда — канал уходит и из списка', async ({ browser }) => {
    takes(45);

    const stamp = Date.now();
    const slug = `ushel-s-reyda-${stamp}`;
    const title = `Брошенный рейд ${stamp}`;

    const page = await newTab(browser);
    await signIn(page, `my-channels-leaver-${stamp}`, 'Уходящий');
    await createChannel(page, title, slug);
    await join(page, 'Шторм', '202');

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: `Канал «${title}»` })).toBeVisible({ timeout: 15_000 });

    // Уход с рейда чистит реестр в той же транзакции, что и снимает корабль с места
    // (functions/src/raid.ts). Если бы список собирался из заведённых каналов, а не из участий,
    // брошенный рейд остался бы в нём навсегда.
    await page.goto(`/?channel=${slug}`, { waitUntil: 'domcontentloaded' });
    await sceneReady(page);
    await leaveRaid(page);
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toBeVisible({ timeout: 15_000 });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: `Канал «${title}»` })).toHaveCount(0);
    await expect(page.getByText('Пока ни одного'), 'брошенный рейд остался в списке').toBeVisible();
});
