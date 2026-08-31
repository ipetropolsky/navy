import { expect } from '@playwright/test';

import { WRITE_TIMEOUT } from '@/config/network';

import {
    berths,
    bubbles,
    clickShip,
    createChannel,
    join,
    newTab,
    openChannel,
    pendingIcon,
    send,
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

/**
 * У местного бэкенда «вошедший не с этого рейда» — это состояние вкладки (localBackend.test.ts,
 * «вошедший не с этого рейда»); здесь же это состояние сервера. Второй настоящий аккаунт
 * получает от Firestore ровно тот же отказ, что и вовсе не вошедший гость выше, — не сам факт
 * входа решает, что видно (`isMember(channelId)` в firestore.rules), а участие именно в этом
 * канале (см. docs/FIREBASE.md, «Кто ещё может прийти»).
 *
 * Отдельно проверяем две вещи, которых по одной только редактуре списка не увидеть: что отказ
 * на участниках и ленте не путается с обрывом связи (строка «N на связи» жива, полоски «нет
 * связи» нет — см. `firebaseBackend.ts`, комментарий у подписки на участников, и
 * docs/FIREBASE.md, «Состояние связи»), и что «Встать на рейд» открывает весь рейд без
 * перезагрузки страницы: настоящий позывной хозяина и реплику, написанную ещё до входа,
 * донашивает не подписка (её первый снимок — это состояние, а не события), а отдельный запрос
 * в `join()` (`hooks/useChannel.ts`).
 */
test('вошедший чужим аккаунтом видит рейд как гость, а встав в строй — как участник, без перезагрузки', async ({
    browser,
}) => {
    // Замер — секунд двадцать: два настоящих входа, один настоящий заход в строй (WRITE_TIMEOUT
    // + SAIL_TIMEOUT) и подтверждение записи сообщения сервером. Срок — поверх этой суммы,
    // а не по общему замеру набора, по той же причине, что и у соседних проверок файла.
    takes(45);

    const slug = `stranger-in-${Date.now()}`;

    const owner = await newTab(browser);
    await signIn(owner, 'stranger-in-owner', 'Хозяин рейда');
    await createChannel(owner, 'Не для чужого', slug);
    await join(owner, 'Маяк', '404');

    await send(owner, 'Есть кто на связи?');
    // Ждём подтверждения с сервера, а не только своей отрисовки: сообщению предстоит доехать
    // до вошедшего чужим аккаунтом через довыгрузку после входа в строй, а не через подписку
    // (см. JSDoc выше), и эта довыгрузка должна найти его уже в настоящем Firestore.
    await expect(pendingIcon(owner), 'сообщение хозяина так и не подтвердилось сервером').toHaveCount(0, {
        timeout: WRITE_TIMEOUT + 5_000,
    });

    // Другой человек, настоящий вход — но не на этот рейд.
    const stranger = await newTab(browser);
    await signIn(stranger, 'stranger-in-uid', 'Не с этого рейда');
    await openChannel(stranger, slug);

    // Рейд виден, но обезличен — тем же самым способом, что и вовсе не вошедшему гостю выше.
    await expect(ships(stranger), 'вошедшему чужим аккаунтом не показали рейд').toHaveCount(1);
    await expect(
        ships(stranger).first().getByRole('img'),
        'вошедшему чужим аккаунтом достался настоящий позывной вместо бортового номера'
    ).toHaveAttribute('alt', 'Корабль «404»');

    // Строка связи жива и говорит о рейде, а не об обрыве: отказ Firestore на участниках
    // и ленте (permission-denied) — не то же самое, что обрыв сети, и не должен читаться как он.
    await expect(stranger.locator('[class*="chatStatus"]')).toHaveText('1 на связи');
    await expect(
        stranger.locator('[class*="connectionStrip"]'),
        'отказ в чтении чужого рейда показали как обрыв связи'
    ).toHaveCount(0);

    // В отличие от вовсе не вошедшего гостя, входить второй раз не просят — сразу приглашение
    // встать в строй: аккаунт уже есть, не хватает только участия в этом канале.
    await expect(
        stranger.getByRole('button', { name: 'Войти' }),
        'уже вошедшему чужим аккаунтом предложили войти ещё раз'
    ).toHaveCount(0);
    await expect(
        stranger.getByRole('button', { name: 'Встать на рейд' }),
        'вошедшему чужим аккаунтом не предложили встать в строй'
    ).toBeVisible();

    // Разговора не видно вовсе: ни поля ввода, ни реплики, написанной до входа в этот строй.
    await expect(
        stranger.getByPlaceholder('Сообщение'),
        'вошедшему чужим аккаунтом открыли разговор до входа на этот рейд'
    ).toHaveCount(0);
    await expect(bubbles(stranger), 'вошедшему чужим аккаунтом видна чужая лента').toHaveCount(0);
    await expect(shipsButton(stranger), 'вошедшему чужим аккаунтом достался список кораблей чужого рейда').toHaveCount(
        0
    );

    // Встаём в строй — и без перезагрузки страницы открывается всё как есть.
    await join(stranger, 'Секстант', '512');

    await expect(ships(stranger), 'после входа на рейд видны не все корабли').toHaveCount(2);
    await expect(
        stranger.locator('img[alt="Корабль «Маяк»"]'),
        'после входа на рейд бортовой номер хозяина так и не сменился на настоящий позывной'
    ).toBeVisible();
    await expect(
        bubbles(stranger).filter({ hasText: 'Есть кто на связи?' }),
        'сообщение, написанное до входа на этот рейд, не подгрузилось после «Встать на рейд»'
    ).toBeVisible();

    await owner.context().close();
    await stranger.context().close();
});
