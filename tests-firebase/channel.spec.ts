import { expect } from '@playwright/test';

import {
    berths,
    clickShip,
    createChannel,
    join,
    newTab,
    openChannel,
    ships,
    shipsButton,
    signIn,
    systemLines,
    takes,
    test,
} from '@tests-firebase/helpers';

/**
 * Две вещи, которых у местного набора нет и быть не может: настоящая личность на два браузерных
 * контекста и настоящий гость, которого сервер не узнаёт вовсе, — обе разбираются в
 * docs/FIREBASE.md, «Проверки».
 */

/**
 * memberId === userId (см. `useChannel.ts`, «третий кандидат»): участие на Firebase адресуется
 * личностью, а не вкладкой, и вторая вкладка того же человека — это тот же корабль на рейде,
 * а не приглашение встать в строй заново. У местного бэкенда такого узнавания нет и не может
 * быть: там userId один на всех ('local'), а вкладки различают себя сами через localStorage.
 *
 * uid у обеих вкладок нарочно один и тот же — это и есть предмет проверки, а не оплошность.
 */
test('та же личность в новой вкладке видит свой корабль, а не встаёт в строй заново', async ({ browser }) => {
    // Идёт она секунд четырнадцать, но срок стоит не по этому замеру, а поверх собственных
    // ожиданий — захода в строй (WRITE_TIMEOUT + SAIL_TIMEOUT) и двух выходов сцены
    // по десять секунд, — по той же причине, что и в e2e.spec.ts: поставь срок по замеру,
    // и затянувшийся заход упёрся бы не в себя, а в общий срок, оставив в отчёте безличное
    // «Test timeout» вместо «свой корабль так и не встал на рейд».
    takes(35);

    const slug = `two-tabs-${Date.now()}`;
    const uid = 'two-tabs-uid';

    const pageA = await newTab(browser);
    await signIn(pageA, uid, 'Тот же человек');
    await createChannel(pageA, 'Один и тот же', slug);
    await join(pageA, 'Гроза', '101');
    await expect(ships(pageA)).toHaveCount(1);

    // Тот же человек, новый контекст браузера — своя личность, но не своя вкладка.
    const pageB = await newTab(browser);
    await signIn(pageB, uid, 'Тот же человек');
    await openChannel(pageB, slug);

    // Разговор открыт сразу: вторую вкладку не встречает форма постановки в строй.
    await expect(
        pageB.getByPlaceholder('Сообщение'),
        'вторая вкладка не узнала свой корабль и не открыла разговор'
    ).toBeVisible();
    await expect(
        pageB.getByRole('button', { name: 'Встать на рейд' }),
        'вторую вкладку той же личности встретило приглашение встать в строй заново'
    ).toHaveCount(0);

    // И корабль на рейде ровно один — не два одинаковых борта на одну и ту же личность.
    await expect(ships(pageB), 'на рейде оказался второй корабль той же личности').toHaveCount(1);
    await expect(pageB.locator('[class*="chatStatus"]')).toHaveText('1 на связи');

    // Тем же видит рейд и первая вкладка: второго входа не случилось и на сервере — строчка
    // о постановке в строй ровно одна, а не две подряд на одного и того же человека.
    await expect(ships(pageA)).toHaveCount(1);
    await expect(systemLines(pageA).filter({ hasText: 'встал на рейд' })).toHaveCount(1);

    await pageA.context().close();
    await pageB.context().close();
});

/**
 * «Гость» здесь — не тот, кто просто не встал в строй (этот случай для местного бэкенда
 * проверен в tests/channel.spec.ts), а тот, кого сервер не знает вовсе: вкладка без единого
 * входа. Документ канала правила читают открыто (allow get: if true) — рейд виден кому угодно
 * по ссылке, — а вот участников без входа не отдают (allow read: if signedIn()): вместо
 * настоящих позывных гостю приходит редактированный список через отдельную функцию
 * (previewChannel, см. functions/src/preview.ts) — тот же рейд, но бортовыми номерами вместо
 * имён. Разговор до входа не открывается ни при каких обстоятельствах: встать на рейд,
 * не назвавшись, нельзя (см. docs/FIREBASE.md, «Что видит гость»).
 *
 * Разница с местным набором не в бэкенде, а в том, что у входа состояний три, а не два: гость,
 * закрытая форма, открытая форма. Местная вкладка всегда вошедшая (`createLocalEntrance`
 * заводит личность сама), первое состояние ей недостижимо — и в `tests/channel.spec.ts`
 * «пришедший по ссылке» это второе, с кнопкой «Встать на рейд». Здесь на её месте вход.
 *
 * Ради этой разницы проверка и написана — и первым же прогоном нашла, что состояние это
 * приложение теряло: `atGate` в App.tsx спрашивал заодно и вход, гость под него не подходил,
 * и нажатия по кораблям доставались ему наравне с теми, кто в строю. Тычок по чужому открывал
 * его карточку — последняя строка этой проверки ровно об этом.
 */
test('канал по ссылке без входа: рейд и корабли видны, а разговор — только через вход', async ({ browser }) => {
    // Шесть секунд по замеру, а срок — поверх ожиданий, как и у соседней проверки выше.
    takes(35);

    const slug = `guest-view-${Date.now()}`;

    const owner = await newTab(browser);
    await signIn(owner, 'guest-view-uid', 'Хозяин рейда');
    await createChannel(owner, 'Гостю сюда', slug);
    await join(owner, 'Маяк', '404');

    // Гость: свежий контекст, ни разу не входивший.
    const guest = await newTab(browser);
    await openChannel(guest, slug);

    // Рейд виден целиком — за ним по ссылке и идут.
    await expect(ships(guest), 'гостю не показали рейд').toHaveCount(1);

    // Но не по-настоящему: вместо позывного «Маяк» — бортовой номер, как и отдаёт previewChannel.
    // getByRole('img'), а не locator('img'): у борта своя тень и вымпелы (ShipShadow, Pennant,
    // CodePennant) — тоже <img>, но aria-hidden и с пустым alt, так что из доступных для
    // ассистивных технологий там ровно один — сам спрайт корабля.
    await expect(
        ships(guest).first().getByRole('img'),
        'гостю достался настоящий позывной вместо бортового номера'
    ).toHaveAttribute('alt', 'Корабль «404»');

    // А разговора нет: на его месте стоит вход, а не форма постановки в строй и не разговор.
    await expect(guest.getByPlaceholder('Сообщение'), 'гостю открыли разговор без входа').toHaveCount(0);
    await expect(guest.getByRole('button', { name: 'Встать на рейд' }), 'гостю предложили встать в строй').toHaveCount(
        0
    );
    await expect(
        guest.getByText('Рейд перед вами. Войдите, чтобы поставить на него свой корабль.'),
        'вход для гостя не показан'
    ).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Войти' })).toBeVisible();

    // Списка кораблей гостю тоже нет, и мест на рейде не видно: смотреть на них не из чего.
    await expect(shipsButton(guest), 'гостю достался список кораблей').toHaveCount(0);
    await expect(berths(guest), 'гостю показали свободные места на рейде').toHaveCount(0);

    // И корабли не нажимаются: тычок по чужому не открывает его карточку.
    await clickShip(guest, ships(guest).first());
    await guest.waitForTimeout(300);
    await expect(guest.getByRole('region', { name: 'Корабль' }), 'корабль открылся гостю').toHaveCount(0);

    await owner.context().close();
    await guest.context().close();
});
