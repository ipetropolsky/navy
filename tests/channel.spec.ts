import { Locator, Page, expect } from '@playwright/test';

import {
    ALBATROS,
    DEMO,
    SAIL_TIMEOUT,
    VYMPEL,
    berths,
    bubbles,
    clickShip,
    closeSheet,
    join,
    leaveButton,
    leaveRaid,
    openChannel,
    openJoinForm,
    openNewChannel,
    openSheet,
    openShipCard,
    readState,
    send,
    ships,
    shipsButton,
    systemLines,
    takes,
    test,
} from '@tests/helpers';

/**
 * Основные дороги через приложение: завести канал, встать в строй, поговорить, уйти.
 * Здесь проверяется, что путь проходится целиком, а не что каждая кнопка на месте.
 */

test('канал заводится с главной, и в него можно встать в строй', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Эскадра «Полночь»').fill('Отряд 7');

    // Адрес предлагается из названия, транслитерацией, и цифры в нём разрешены.
    await expect(page.locator('input[placeholder="eskadra-polnoch"]')).toHaveValue('otryad-7');
    await page.locator('button[type=submit]').click();

    await expect(page).toHaveURL(/\?channel=otryad-7/);
    await join(page, 'Буря', '321');

    // Корабль в кадре, и канал знает, кто это.
    await expect(ships(page)).toHaveCount(1);
    await expect(page.locator('[class*="chatStatus"]')).toHaveText('1 на связи');
    // В самой фразе один силуэт: позывной написан над ней, номер стоит на аватарке рядом
    // и на борту в кадре, — называть корабль трижды подряд незачем.
    await expect(systemLines(page)).toContainText(['Малый противолодочный корабль встал на рейд']);
    await expect(systemLines(page).first().locator('[class*="text"]')).not.toContainText('Буря');
    // А над фразой позывной стоит — и стоит всегда, даже над своей строчкой.
    await expect(systemLines(page).first().locator('[class*="name_"]')).toHaveText('Буря');
});

/**
 * Закрытое состояние формы корабля. Пришедший по ссылке — ещё никто в этом канале, и канал
 * ведёт себя с ним соответственно: рейд ему виден как обычно — за ним по ссылке и идут, —
 * а больше не видно ничего. Ни разговора, ни списка кораблей, и корабли в кадре не нажимаются:
 * пока человек не встал в строй, канал о нём не знает ничего, и он о канале ровно столько же.
 * Вопрос к нему на экране один и стоит одной кнопкой посреди пустой плашки.
 */
test('канал по ссылке встречает закрытой формой: рейд видно, а трогать нечего', async ({ page }) => {
    await openChannel(page, DEMO);

    // Одна кнопка, и никакой анкеты под ней.
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toBeVisible();
    await expect(page.getByPlaceholder('Гром'), 'форма открылась сама').toHaveCount(0);
    // Рейд при этом на месте и виден целиком: три корабля демо-эскадры.
    await expect(ships(page)).toHaveCount(3);
    // А выбирать место ещё не из чего: свободные места показывает открытая форма.
    await expect(berths(page), 'закрытая форма показала свободные места').toHaveCount(0);
    // Списка кораблей гостю тоже нет: название канала осталось строчкой, а не кнопкой.
    await expect(shipsButton(page), 'гостю досталась кнопка списка кораблей').toHaveCount(0);

    // И корабли не нажимаются: тычок по чужому не открывает его карточку.
    await clickShip(page, ships(page).first());
    await page.waitForTimeout(300);
    await expect(page.getByRole('region', { name: 'Корабль' }), 'корабль открылся гостю').toHaveCount(0);

    // Кнопка открывает ту самую форму — с полями и со свободными местами на рейде.
    await openJoinForm(page);
    await expect(berths(page).first(), 'открытая форма не показала места на рейде').toBeVisible();
});

/**
 * GH-52: закрытая форма — одна кнопка посреди плашки, и коробка под неё не обязана стоять
 * долей хода, как настоящий разговор: смотреть там больше не на что. Коробка встаёт по самой
 * кнопке (см. `gateHeight` в App), и тянуть её не за что — ни ручки, ни коридора у кромки нет.
 */
test('закрытая форма стоит по кнопке, а не долей хода, и её нечем тянуть', async ({ page }) => {
    await openChannel(page, DEMO);
    // Под кадром: сбоку разговор и так стоит во весь рост окна, мерить там нечего.
    await page.setViewportSize({ width: 420, height: 900 });

    const gate = page.getByRole('button', { name: 'Встать на рейд' });
    await expect(gate).toBeVisible();
    const gateBox = (await gate.boundingBox())!;
    const contentBox = (await page.locator('main').boundingBox())!;

    // Коробка выше кнопки — на поле плашки сверху и снизу, — и никак не на треть окна:
    // до открытой формы (её пришлось бы открыть, чтобы сверить) тут в разы меньше.
    expect(contentBox.height).toBeGreaterThan(gateBox.height);
    expect(contentBox.height).toBeLessThan(gateBox.height + 100);

    // Тянуть коробку нечем: ни ручки снизу кадра, ни коридора вдоль кромки разговора.
    await expect(page.locator('[class*="sheetHandle"]')).toHaveCount(0);
    await expect(page.locator('[class*="grip_"]')).toHaveCount(0);
});

test('свой, только что заведённый канал открывается сразу формой', async ({ page }) => {
    // Исключение из закрытого состояния: заводивший канал только что отвечал на вопросы о нём,
    // и спрашивать его же, хочет ли он встать на собственный рейд, незачем.
    await openNewChannel(page, 'svoy-reyd');
    await expect(page.getByPlaceholder('Гром'), 'на своём рейде спросили дважды').toBeVisible();
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toHaveCount(0);
});

/** Цвет, который сам по себе форме не достанется: по умолчанию она берёт первый свободный. */
const OWN_COLOR = '#d8b4f8';

/** Силуэт не по умолчанию — умолчание у формы «Малый противолодочный корабль». */
const OWN_SHIP = 'Ракетный катер';

/**
 * Личность у человека одна, а корабли у неё в каждом канале свои. Вкладка помнит и то,
 * и другое: в какой канал каким кораблём ходит — чтобы возврат был возвратом на своё место,
 * а не новой постановкой в строй, — и чем эта личность выходила в море в последний раз,
 * чтобы в новом канале не собирать корабль заново.
 *
 * Позывной с номером при этом не подставляются нарочно: они на каждом рейде свои, номер вдобавок
 * может оказаться занят, и подставленный требовал бы не подтверждения, а исправления.
 */
test('в новом канале форма открывается прошлым кораблём, а в прежнем — своим', async ({ page }) => {
    takes(12);
    await openNewChannel(page, 'pamyat-odin');
    await page.getByLabel(`Цвет ${OWN_COLOR}`).click();
    await join(page, 'Гроза', '101', OWN_SHIP);
    await expect(page.getByPlaceholder('Сообщение'), 'корабль не встал в строй').toBeVisible();

    // Другой канал той же вкладкой: корабля тут ещё нет, но внешность прошлого форма помнит.
    await openNewChannel(page, 'pamyat-dva');
    await expect(page.locator('[class*="kindActive"]'), 'силуэт не достался от прошлого корабля').toContainText(
        OWN_SHIP
    );
    await expect(page.locator('[class*="colorActive"]'), 'цвет не достался от прошлого корабля').toHaveAttribute(
        'aria-label',
        `Цвет ${OWN_COLOR}`
    );
    // А позывной с номером — свои: подставленный чужой номер пришлось бы стирать.
    await expect(page.getByPlaceholder('Гром'), 'позывной подставился из прошлого канала').toHaveValue('');

    // Возврат в первый канал — возврат на своё место: форма о постановке в строй не спрашивает.
    await openChannel(page, 'pamyat-odin');
    await expect(page.getByPlaceholder('Сообщение'), 'своя личность в канале забылась').toBeVisible();
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toHaveCount(0);
});

test('реплика уходит и привязывается ответом', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await bubbles(page).count();

    await send(page, 'Курс норд');
    await expect(bubbles(page)).toHaveCount(before + 1);

    // Тап по чужому сообщению — ответ на него. Отвечаем на самое верхнее, и щёлкнуть по нему
    // мало: лента сама прыгает к последнему сообщению (см. MessageList), а щелчок по верхнему
    // пузырю приходится как раз на этот прыжок. Промахнувшись, он достаётся соседнему пузырю
    // или своему собственному — и цитата над строкой ввода не появляется вовсе. Ловится это
    // только на неспешной машине и без окна на экране, поэтому щёлкаем с повтором: попытка
    // засчитана, когда над строкой ввода встала цитата того самого сообщения. Подходов три:
    // прыжок ленты кончается за первый, и если цитата не встала и с третьего, дело не в прыжке.
    // Первая реплика, а не первое сообщение: лента начинается со строчек канала о входе,
    // и пузырей среди них нет — щёлкать в них не по чему.
    const target = (await readState(page)).channels['ch-demo'].messages.find((message) => message.text)!;
    await expect(async () => {
        await bubbles(page).first().click();
        await expect(page.locator('[class*="replyBar"]')).toContainText(target.text!, { timeout: 1_000 });
    }, 'лента так и не показала, на что отвечает').toPass({ timeout: 3_000 });
    await send(page, 'Идём следом');

    // Ждём, а не читаем сразу: запись в состояние идёт через общую очередь (см. exclusive
    // в localBackend), и к возврату из send реплика ещё в пути.
    await expect
        .poll(async () => (await readState(page)).channels['ch-demo'].messages.at(-1)!.text, {
            message: 'реплика не дошла до состояния',
        })
        .toBe('Идём следом');
    const state = await readState(page);
    const messages = state.channels['ch-demo'].messages;
    const reply = messages.at(-1)!;
    expect(reply.thread?.messageId).toBe(target.messageId);
    expect(reply.author.memberId).toBe(ALBATROS);
});

/**
 * Выделение и ответ — разные дела, и одно нажатие не должно делать оба. Тычок по плашке
 * отвечает, протяжка по ней выделяет; ответ на выделении не срабатывает, иначе скопировать
 * чужую реплику было бы нельзя — панель ответа перехватывала бы каждую попытку.
 */
test('протяжка по реплике выделяет текст, а не отвечает', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const bubble = bubbles(page).last();
    const box = (await bubble.boundingBox())!;
    const middle = box.y + box.height / 2;

    // Тянем по самой строке, изнутри полей плашки: снаружи выделять было бы нечего.
    await page.mouse.move(box.x + 14, middle);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 14, middle, { steps: 12 });
    await page.mouse.up();

    expect(await page.evaluate(() => window.getSelection()?.toString() ?? ''), 'текст не выделился').not.toBe('');
    await expect(page.locator('[class*="replyBar"]'), 'протяжка обернулась ответом').toHaveCount(0);

    // Обычный тычок по той же плашке — по-прежнему ответ, и курсор сразу в поле.
    await bubble.click();
    await expect(page.locator('[class*="replyBar"]')).toHaveCount(1);
    await expect(page.getByPlaceholder('Сообщение')).toBeFocused();
});

/**
 * Плашка утапливается, пока её держат, — так видно, что она нажимается. Но утопление обещает
 * ответ, и обещание должно быть честным в обе стороны: не утапливаться там, где ответа не будет,
 * и отжиматься сразу, как только нажатие перестало быть ответом.
 *
 * Обе беды достались от `:active`, которым это делалось раньше: он зажигается на всей цепочке
 * предков (тычок по вымпелу утапливал и плашку под ним) и держится до отпускания (плашка стояла
 * нажатой всю протяжку по тексту, хотя ответ на выделении не срабатывает).
 */
test('плашка утоплена только пока нажатие остаётся ответом', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const bubble = bubbles(page).last();
    const box = (await bubble.boundingBox())!;
    const middle = box.y + box.height / 2;

    // Держим плашку на месте — это ответ, и она утоплена.
    await page.mouse.move(box.x + 14, middle);
    await page.mouse.down();
    await expect(bubble, 'плашка не утопилась под нажатием').toHaveClass(/pressed/);

    // Повели курсор — пошло выделение, ответа уже не будет, и плашка отжимается сразу,
    // не дожидаясь конца протяжки.
    await page.mouse.move(box.x + box.width - 14, middle, { steps: 12 });
    await expect(bubble, 'плашка осталась нажатой на выделении').not.toHaveClass(/pressed/);
    await page.mouse.up();

    // Вымпел у служебной строчки — своя кнопка, и плашку под собой она не утапливает:
    // нажатие по вымпелу до ответа не доходит.
    const note = systemLines(page).last();
    await note.getByRole('button', { name: 'Техническое сообщение' }).hover();
    await page.mouse.down();
    await expect(note, 'вымпел утопил плашку под собой').not.toHaveClass(/pressed/);
    await page.mouse.up();
});

test('сообщение из соседней вкладки доезжает', async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);
    const before = await bubbles(mine).count();

    await send(theirs, 'Швартовы отданы');

    await expect(bubbles(mine)).toHaveCount(before + 1);
    await expect(bubbles(mine).last()).toContainText('Швартовы отданы');
});

/**
 * Убранная панель считает то, что пришло без неё.
 *
 * Разговор с экрана убирают целиком, и тогда о новой реплике не говорит ничто: кнопка, которой
 * его возвращают, выглядит одинаково и с непрочитанным, и без. Счётчик на ней — единственная
 * примета, и держится он ровно до возврата разговора: показали ленту — значит, прочитано.
 *
 * Меряется здесь всё, что счётчик обещает: что он появляется, что цифра в нём та самая, что она
 * есть и в подписи кнопки (сама пилюля читалке не достаётся), что возврат панели его убирает
 * и что заново он с прочитанного не начинается.
 */
/** Счётчик непрочитанного у кнопки панели. Число он несёт пометкой, а не одним лишь текстом:
 *  показывает пилюля не больше «99+», а проверять надо настоящий счёт. */
const unreadCount = (page: Page) => page.locator('[data-unread]');

test('убранная панель считает пришедшие реплики', async ({ context }) => {
    takes(10);
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);
    const before = await bubbles(mine).count();

    await mine.getByRole('button', { name: 'Убрать панель' }).click();
    await expect(unreadCount(mine), 'на кнопке нашёлся счётчик, когда считать было нечего').toHaveCount(0);

    await send(theirs, 'Швартовы отданы');
    await send(theirs, 'Идём на выход');

    await expect(unreadCount(mine), 'счётчик не сошёлся с числом пришедших реплик').toHaveAttribute('data-unread', '2');
    // Та же цифра словами: пилюлю читалка не видит, и без подписи убранная панель молчала бы
    // о новостях всем, кроме глаз.
    await expect(
        mine.getByRole('button', { name: 'Вернуть панель, 2 новых сообщения', exact: true }),
        'счётчик не дошёл до подписи кнопки'
    ).toBeVisible();

    // Разговор вернулся — счётчик снят, и реплики в ленте на месте: считались настоящие
    // сообщения, а не что-нибудь ещё.
    await mine.getByRole('button', { name: 'Вернуть панель' }).click();
    await expect(unreadCount(mine), 'счётчик пережил возврат разговора').toHaveCount(0);
    await expect(bubbles(mine)).toHaveCount(before + 2);

    // И прочитанное не пересчитывается заново: убранная во второй раз панель начинает с нуля.
    await mine.getByRole('button', { name: 'Убрать панель' }).click();
    await expect(unreadCount(mine), 'счётчик пересчитал уже прочитанное').toHaveCount(0);
});

test('уход с рейда отмечается в ленте и возвращает к постановке в строй', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    // Уход — кнопкой внизу списка кораблей, а следом новый курс: молча с рейда не уходят.
    await leaveRaid(page, 'В Кронштадт, на зимовку');

    // Вкладка возвращается к закрытой форме — туда же, куда попадает и пришедший по ссылке:
    // тупика нет, встать в строй можно снова, а до того рейд просто виден со стороны.
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toBeVisible();
    expect((await readState(page)).channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(
        ALBATROS
    );
    // Бэкенд пишет данными, а не фразой: каким корабль был на момент ухода и что он сказал
    // на прощание. Как это сказать словами, решает лента — её слова проверены выше.
    // Запись в хранилище приходит следом за перерисовкой формы, а не вместе с ней, — ждём её.
    await expect
        .poll(async () => (await readState(page)).channels['ch-demo'].messages.at(-1)!.notice, {
            message: 'прощание не легло в хранилище последней записью',
        })
        .toEqual({
            event: 'left',
            before: { shipKind: 'pr1400', name: 'Альбатрос', hullNumber: '317' },
            course: 'В Кронштадт, на зимовку',
        });

    // А словами курс читают оставшиеся: у самого ушедшего на месте разговора теперь форма,
    // и своё прощание он не видит — оно и написано не ему.
    await openChannel(page, DEMO, VYMPEL);
    await expect(systemLines(page).last()).toContainText('Уходит с рейда. Новый курс: В Кронштадт, на зимовку');
});

/**
 * Лента переживает корабли. Сообщение остаётся в ней и после того, как автор снялся с рейда,
 * а искать автора среди нынешних участников тогда уже негде: у такой строчки пропадала
 * аватарка, а в цитате ответа вместо позывного вставало «Неизвестный». Отвечает на это
 * снимок автора, записанный вместе с сообщением (см. `MemberRef` и `authorLook`).
 */
test('ушедший корабль остаётся в ленте с аватаркой и позывным', async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);

    // Аватарки стоят у последней строчки каждой цепочки, и номер на них нынешний: «Вымпел»
    // менял бортовой, и пока он на рейде, в ленте у него везде новый.
    const avatars = mine.locator('[class*="avatarCell"]');
    await expect(avatars.filter({ hasText: '561' })).toHaveCount(4);

    await leaveRaid(theirs);
    await expect(mine.locator('[class*="chatStatus"]')).toHaveText('2 на связи');

    // Корабля на рейде нет, а строчки его стоят как стояли — и подписаны теперь снимками:
    // до переоснащения на борту был 555, после него 561, и в ленте это видно.
    await expect(avatars.filter({ hasText: '555' }), 'аватарки ушедшего пропали').toHaveCount(3);
    // Две, а не одна: последняя — у самой строчки об уходе, и её снимок сделан уже в ту
    // минуту, когда участника вычеркнули из состава.
    await expect(avatars.filter({ hasText: '561' })).toHaveCount(2);
    // И цитата ответа зовёт его позывным, а не «Неизвестный».
    await expect(mine.locator('[class*="quote_"]').last()).toContainText('Вымпел');
    await expect(mine.getByText('Неизвестный')).toHaveCount(0);
});

/**
 * Уход спрашивает новый курс — и спрашивает всерьёз: поле обязательное, а пока оно пустое,
 * уходить нечем. Это единственное действие в канале, после которого от корабля ничего
 * не остаётся, и курс как раз то, что остаётся.
 *
 * Второй выход из шторки — «Полный назад»: передумавший возвращается в список, из которого
 * и уходил, а корабль остаётся на рейде.
 */
test('уход спрашивает курс, и без него не уйти, а «Полный назад» оставляет на рейде', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);
    await leaveButton(page).click();

    const shade = page.getByRole('region', { name: 'Вы уходите с рейда' });
    await expect(shade, 'шторка прощания не открылась').toBeVisible();
    const confirm = shade.getByRole('button', { name: 'Курс верный' });
    await expect(confirm, 'уйти можно и не сказав куда').toBeDisabled();

    // Курс набран — уходить есть чем.
    await page.getByLabel('Задайте новый курс').fill('В Кронштадт');
    await expect(confirm).toBeEnabled();

    // Но передумали: «Полный назад» возвращает в список кораблей, и корабль на месте.
    await shade.getByRole('button', { name: 'Полный назад' }).click();
    await expect(shade, 'шторка прощания не закрылась').toBeHidden();
    await expect(page.getByRole('button', { name: 'Корабль «Альбатрос»' }), 'корабль ушёл с рейда').toBeVisible();
    await expect(ships(page)).toHaveCount(3);
});

/**
 * Координаты рейда — ссылка на канал, которой зовут остальных. Показывать её негде, она
 * длинная, поэтому уходит прямо в буфер, а ответом служит снекбар: без него нажатие
 * не отвечало бы ничем.
 *
 * Живёт кнопка внизу списка кораблей — там же, где смотрят, кто уже пришёл. Прежде ссылка
 * копировалась нажатием на название канала в шапке, и догадаться об этом было нечем.
 *
 * Разрешение на буфер выдаётся здесь же: без него браузер отказывает в записи, и проверять
 * пришлось бы не то, что скопировалось, а то, как приложение сообщает об отказе.
 */
test.describe(() => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('координаты рейда копируются из списка кораблей', async ({ page }) => {
        await openChannel(page, DEMO, ALBATROS);
        await openSheet(page);

        await page.getByRole('button', { name: /^Координаты/ }).click();
        await expect(page.getByRole('status'), 'о скопированном не сказали').toHaveText('Координаты скопированы');

        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied, 'в буфер ушла не ссылка на этот канал').toBe(`${new URL(page.url()).origin}/?channel=${DEMO}`);
    });
});

test('каждая перемена при переоснащении — своё сообщение', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    const before = await systemLines(page).count();

    // Меняем разом всё: силуэт, позывной и бортовой номер.
    await shipsButton(page).click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await join(page, 'Буран', '512', 'Рейдовый тральщик');

    // Три перемены — три строчки, от крупного к мелкому. В каждой сказано только, что именно
    // сменилось: новое значение и так стоит над строчкой позывным и на аватарке номером,
    // а старое — выше в той же ленте.
    await expect(systemLines(page)).toHaveCount(before + 3);
    const added = systemLines(page);
    await expect(added.nth(before)).toContainText('Сменил корабль');
    await expect(added.nth(before + 1)).toContainText('Сменил позывной');
    await expect(added.nth(before + 2)).toContainText('Сменил бортовой номер');

    // Бэкенд пишет их отдельными сообщениями, а не одной записью с перечислением: у каждой
    // свой номер и своё время, и потому на каждую можно ответить.
    const messages = (await readState(page)).channels['ch-demo'].messages.slice(-3);
    expect(messages.map((message) => message.notice?.changed)).toEqual(['shipKind', 'name', 'hullNumber']);
    expect(new Set(messages.map((message) => message.messageId)).size).toBe(3);
});

test('строчка о корабле стоит по его сторону ленты, со временем и ответом', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await send(page, 'Курс норд');
    await expect(bubbles(page).last()).toContainText('Курс норд');

    // Меняем один бортовой номер: тип и позывной остаются прежними.
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await join(page, 'Альбатрос', '512');
    // И убираем список: форма ушла, а он под ней остался — так и задумано, — но лежит он
    // слоем поверх ленты и нажатия по строчке забирал бы себе.
    await closeSheet(page);

    const note = systemLines(page).last();
    // Сказано только, что сменилось: новый номер стоит на аватарке рядом, старый — выше
    // в той же ленте, и пересказывать их строчкой незачем.
    await expect(note).toContainText('Сменил бортовой номер');

    // Позывной над строчкой стоит всегда — и над своей, и над второй подряд: фраза в ней
    // безличная, и без имени непонятно, кто сменил. Рядом с позывным — ответный вымпел,
    // и по нажатию он говорит, что значит.
    await expect(note.locator('[class*="name_"]')).toHaveText('Альбатрос');
    await note.getByRole('button', { name: 'Техническое сообщение' }).click();
    await expect(page.getByRole('status')).toHaveText('Техническое сообщение');

    // Время у неё есть, как у всякого сообщения: строчка канала — такое же сообщение.
    await expect(note.locator('[class*="time"]')).toHaveText(/^\d{2}:\d{2}$/);

    // Стоит строчка там же, где реплики своего корабля: правым краем по правому краю пузыря.
    // Раньше она шла плашкой по центру, и в разговоре нескольких кораблей было не разобрать,
    // о ком речь.
    const bubble = (await bubbles(page).last().boundingBox())!;
    const line = (await note.boundingBox())!;
    expect(Math.abs(line.x + line.width - (bubble.x + bubble.width))).toBeLessThanOrEqual(1);

    // Набрана она тем же кеглем, что реплика: служебная запись — такое же сообщение канала,
    // и мельчить её незачем. Отличают её цвет плашки и вымпел у позывного, а не размер букв.
    const style = (locator: Locator, prop: 'fontSize' | 'lineHeight'): Promise<number> =>
        locator.evaluate((node, name) => parseFloat(getComputedStyle(node)[name]), prop);
    const reply = bubbles(page).last();
    expect(await style(note, 'fontSize'), 'служебная строчка не того кегля, что реплика').toBe(
        await style(reply, 'fontSize')
    );
    expect(await style(note, 'lineHeight')).toBeCloseTo(await style(reply, 'lineHeight'), 1);

    // И на неё отвечают, как на реплику: нажали — и цитата встала над строкой ввода.
    await expect(async () => {
        await note.click();
        await expect(page.locator('[class*="replyBar"]')).toContainText('Сменил бортовой номер', {
            timeout: 1_000,
        });
    }, 'лента так и не показала, что отвечает на строчку канала').toPass({ timeout: 3_000 });
    await send(page, 'Принял новый номер');
    await expect
        .poll(
            async () => {
                const messages = (await readState(page)).channels['ch-demo'].messages;
                const reply = messages.at(-1)!;
                // Последняя такая, а не первая: смена номера есть и в демо-переписке,
                // а отвечали мы на свою, только что записанную.
                const target = messages.filter((message) => message.notice?.changed === 'hullNumber').at(-1);
                return reply.thread?.messageId === target?.messageId;
            },
            { message: 'ответ не привязался к строчке канала' }
        )
        .toBe(true);
});

test('набранный номер стоит на выбранном корабле, и только на нём', async ({ page }) => {
    await openNewChannel(page, 'nomer-na-bortu');
    await page.locator('input[inputmode="numeric"]').fill('317');

    // Спрашиваем не «есть ли номер на выбранном», а «на скольких он вообще есть»: правило
    // тут в том, что борт с номером один, — на всех сразу номер читался бы как часть рисунка.
    const onHulls = (): Promise<string[]> =>
        page
            .locator('[class*="portraitShip"] [class*="hullNumber"]')
            .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? '').filter(Boolean));

    expect(await onHulls(), 'номер сел не на один борт').toEqual(['317']);
    await expect(
        page.locator('[class*="kindActive"] [class*="hullNumber"]'),
        'номер стоит не на выбранном корабле'
    ).toHaveText('317');

    // Выбрали другой силуэт — номер перешёл вместе с выбором, прежний борт остался чистым.
    // Плашка корабля — `div` с ролью кнопки, а не `button`: из настоящей кнопки не выделишь
    // текст, а он там главное (см. проверку про характеристики ниже).
    const kinds = page.locator('[role="button"]:has([class*="portraitShip"])');
    await kinds.nth(3).click();
    expect(await onHulls(), 'номер остался на прежнем борту').toEqual(['317']);
    await expect(kinds.nth(3).locator('[class*="hullNumber"]'), 'номер не перешёл на новый выбор').toHaveText('317');

    // И правится он тут же: борт показывает набранное, а не то, с чем форма открылась.
    await page.locator('input[inputmode="numeric"]').fill('42');
    await expect(kinds.nth(3).locator('[class*="hullNumber"]'), 'борт не пошёл за набором').toHaveText('42');
});

/** Звание старшего одной строкой: им подписан и бэдж, и снекбар под вымпелом. */
const SENIOR = 'Старший на рейде';

/**
 * Старший на рейде. Правило простое: старший в канале один, это тот, кто встал первым,
 * и только он может высадить чужой корабль. Проверяем обе стороны — что старшему это можно
 * и что остальным нечем даже попробовать.
 */
test('старший на рейде отмечен бэджем и высаживает чужие корабли', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    await shipsButton(page).click();
    await expect(page.getByText(SENIOR)).toHaveCount(1);

    // Высадка — из строчки того, кого высаживают: свою кнопку старший в списке не находит.
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(2);
    await page.getByLabel('Высадить «Вымпел»').click();

    // Считаем не корабли в кадре, а канал: высаженный ещё уходит за кромку и висит в сцене
    // столько же, сколько ушедший сам.
    await expect(systemLines(page).last()).toContainText('Малый ракетный корабль выдворен с рейда');
    const crew = await readState(page);
    expect(crew.channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(VYMPEL);
});

/**
 * Вымпел у позывного старшего. Он стоит всегда и всегда отвечает званием тычком; подпись
 * словами рядом — только там, где на неё есть ширина. Ширина при этом меряется у самого списка,
 * а не у окна: список живёт в блоке разговора, а тот бывает и в треть окна шириной. Проверяем
 * оба состояния подряд на одной странице — важно, что подпись уходит и возвращается на живом
 * списке, а не только на свежеоткрытом.
 */
// Окно, в котором подписи хватает места, и окно, в котором уже нет. Список идёт во всю ширину
// блока разговора за вычетом его полей (12px с каждой стороны), а прячется подпись ниже 400px
// — см. @badge-fits в стилях. Сбоку блок занимает треть окна, поэтому широкое окно тут заметно
// шире четырёхсот: треть от него и должна перевалить за мерку.
const BADGE_FITS_ABOVE = 1600;
const BADGE_HIDES_BELOW = 360;

test('вымпел старшего отвечает званием, а подпись рядом — по ширине списка', async ({ page }) => {
    await page.setViewportSize({ width: BADGE_FITS_ABOVE, height: 900 });
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    // Просторная панель: вымпел один (старший в канале один) и подпись рядом с ним.
    const pennants = page.locator('img[class*="pennant"]');
    const flag = page.getByRole('button', { name: SENIOR });
    await expect(pennants, 'вымпел стоит не у одного корабля').toHaveCount(1);
    await expect(page.getByText(SENIOR), 'подписи старшего нет в просторной панели').toBeVisible();

    // Узкий список: подписи в строке места нет — её занимают позывной, тип и кнопка.
    // Убирает её @container в стилях, а не разметка, поэтому спрашиваем про видимость,
    // а не про наличие: в разметке подпись стоит всегда.
    await page.setViewportSize({ width: BADGE_HIDES_BELOW, height: 844 });
    await expect(page.getByText(SENIOR), 'подпись осталась в узком списке').toBeHidden();
    await expect(pennants, 'вымпел пропал вместе с подписью').toHaveCount(1);

    // Вымпел отвечает званием и здесь, и там: снекбар не спрашивает, видна ли подпись.
    await flag.click();
    await expect(page.locator('[class*="snackbar"]'), 'вымпел не ответил званием').toHaveText(SENIOR);
});

/**
 * Тот же вымпел в карточке корабля. Карточка чужая по определению, поэтому и заходим
 * не старшим: у своего корабля карточки нет вовсе. В карточке вымпел стоит без подписи
 * словами — места для неё там нет, — и спросить, что он значит, можно только тычком.
 */
test('вымпел старшего в карточке корабля отвечает званием', async ({ page }) => {
    await openChannel(page, DEMO, VYMPEL);

    // Открываем карточку старшего из списка кораблей, тычком по его строчке.
    await openShipCard(page, 'Альбатрос');
    const card = page.getByRole('region', { name: 'Корабль' });
    await expect(card).toContainText('Альбатрос');

    await card.getByRole('button', { name: SENIOR }).click();
    await expect(page.locator('[class*="snackbar"]'), 'вымпел в карточке не ответил званием').toHaveText(SENIOR);
});

test('не старшему высаживать нечем, а после его ухода старшинство переходит дальше', async ({ page }) => {
    // Канал открывается дважды: сперва за одного, потом за другого.
    takes(4);
    await openChannel(page, DEMO, VYMPEL);
    await shipsButton(page).click();
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(0);

    // Старший ушёл — канал не остаётся без него: старшинство берёт тот, кто дольше всех
    // из оставшихся. Иначе высаживать было бы уже некому.
    await openChannel(page, DEMO, ALBATROS);
    await leaveRaid(page);
    await expect(page.getByRole('button', { name: 'Встать на рейд' })).toBeVisible();

    // Форма возвращается по своему состоянию вкладки, а старшинство переписывает бэкенд —
    // порядок между ними не оговорён, поэтому ждём смену старшего, а не смотрим сразу после формы.
    await expect
        .poll(async () => (await readState(page)).channels['ch-demo'].channel.owner?.memberId, {
            message: 'старшинство не перешло к оставшемуся',
        })
        .toBe(VYMPEL);

    // И это видно в списке: бэдж переехал на нового старшего, а с ним и кнопки высадки.
    await openChannel(page, DEMO, VYMPEL);
    await shipsButton(page).click();
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(1);
});

/**
 * Прицеп ленты к низу. Пока лента внизу, она там и держится: новые реплики приходят на виду,
 * и поле ввода отделяет их от последней строчки. Отмотал вверх — лента отцепляется, и место,
 * на которое человек смотрит, больше не двигается ни от чужих сообщений, ни от того, что
 * окошко ленты переменило рост (им ходит смена раскладки). Домотал обратно
 * до низа — прицепилась снова.
 *
 * Свои реплики — исключение, и единственное: отправить сообщение и не увидеть его нельзя.
 */
// Сама лента, а не список кораблей: имя класса у обеих одно и то же (.list в своём модуле),
// поэтому берём её через плашку с датой — та бывает только в ленте и лежит прямо в ней.
const listBox = (page: Page) => page.locator('[class*="dateChip"]').locator('xpath=..');

const scrollState = (page: Page): Promise<{ top: number; bottom: number }> =>
    listBox(page).evaluate((node) => ({
        top: Math.round(node.scrollTop),
        bottom: Math.round(node.scrollHeight - node.scrollTop - node.clientHeight),
    }));

test('лента держится низа, пока её не отмотали, и не дёргается, пока не вернули', async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);

    // Набиваем ленту так, чтобы её было что мотать.
    for (let index = 0; index < 12; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await send(theirs, `Отметка ${index}`);
    }
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'лента не стоит внизу' })
        .toBeLessThan(24);

    // Отматываем вверх — и с этого мгновения место на виду не двигается.
    await listBox(mine).evaluate((node) => {
        node.scrollTop = 0;
    });
    const parked = await scrollState(mine);
    expect(parked.top, 'лента не отмоталась').toBe(0);

    await send(theirs, 'Пришло, пока читают старое');
    await expect(bubbles(mine).last()).toContainText('Пришло, пока читают старое');
    expect((await scrollState(mine)).top, 'чужая реплика утянула ленту с места').toBe(parked.top);

    // Своя реплика — другое дело: её надо видеть, и лента прицепляется обратно.
    await send(mine, 'Принято');
    await expect
        .poll(async () => (await scrollState(mine)).bottom, {
            message: 'после своей реплики лента не вернулась к низу',
        })
        .toBeLessThan(24);
});

/**
 * Ужавшееся окошко ленты — не отмотка.
 *
 * Смена раскладки, выехавшая клавиатура, поднявшаяся панель ответа — всё это оставляет
 * `scrollTop` на месте и отодвигает от него конец списка. Мерка «далеко от низа — значит
 * отмотали» на этом и ломалась: одно нажатие по кнопке кадра отцепляло ленту навсегда,
 * и дальше её не возвращало ни доехавшая раскладка, ни новое сообщение.
 */
test('лента держится низа при смене раскладки', async ({ context }) => {
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);

    for (let index = 0; index < 12; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await send(theirs, `Отметка ${index}`);
    }
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'лента не стоит внизу' })
        .toBeLessThan(24);

    // Окно из лежачего становится стоячим — разговор переезжает из панели сбоку под кадр
    // и ужимается до трети высоты. Лента должна поехать вместе с ним, а не остаться там,
    // где стояла в панели во весь рост.
    await mine.setViewportSize({ width: 420, height: 600 });
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'ужавшаяся лента отстала от низа' })
        .toBeLessThan(24);

    // И остаётся прицепленной: следующее сообщение видно, а не догадываешься о нём по счётчику.
    await send(theirs, 'После переезда');
    await expect(bubbles(mine).last()).toContainText('После переезда');
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'после переезда лента отцепилась от низа' })
        .toBeLessThan(24);
});

/**
 * Две вкладки, переставляющие корабли в один и тот же миг.
 *
 * Состояние «сервера» лежит одним JSON-ом на весь браузер, и всякая перестановка — это
 * «прочитал целиком, поменял, записал целиком». Пока вкладка одна, это неделимо: JS однопоточен.
 * Вкладок две — и они читают одно и то же состояние, а записывают каждая своё: записавшая второй
 * стирает чужую перестановку. Место на рейде обе выбирают по своему снимку, обе видят точку
 * свободной и обе на неё встают. В кадре это и выглядит как пропажа корабля: один стоит
 * на другом, а после перезагрузки уезжает туда, откуда уходил.
 *
 * Чинится общей очередью на запись (Web Locks, см. exclusive в localBackend), и проверяется
 * это здесь: с двух вкладок разом — сперва на разные места, потом на одно.
 */

/** Сама форма корабля: та, где выбирают место на рейде. */
const shipForm = (page: Page) => page.locator('form').filter({ has: page.getByPlaceholder('Гром') });

/**
 * Открыть форму настройки своего корабля: оттуда и переставляют.
 *
 * Сперва дожидаемся, пока уйдёт прежняя. Отправленная форма закрывается не в тот же миг:
 * сперва запись в «сервер» через общую очередь, потом рендер, — и позванный сразу после
 * отправки помощник застаёт её ещё на экране. А пока она стоит, дороги к кнопке нет никакой:
 * список кораблей лежит под ней накрытый, и «Настроить корабль» из-под формы не нажать,
 * кнопка же списка в это время говорит «закрыт» — помощник жмёт её и закрывает как раз тот
 * список, в котором эта кнопка и лежит. Обоими исходами проверка и падала: то нажатием
 * в никуда, то прежней формой, застрявшей на отобранном месте.
 */
const openShipForm = async (page: Page): Promise<void> => {
    await expect(shipForm(page), 'прежняя форма корабля так и не ушла с экрана').toHaveCount(0);
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.locator('[data-berth]').first()).toBeVisible();
};

/**
 * Кнопка «Готово» самой формы. Через страницу её не взять: форма выезжает поверх разговора,
 * и у поля ввода под ней тоже кнопка-submit.
 */
const shipFormSubmit = (page: Page) => shipForm(page).locator('button[type=submit]');

/** Свободные места, какими их видит эта вкладка: они и предлагаются к выбору. */
const freeBerths = (page: Page): Promise<string[]> =>
    page
        .locator('[data-berth][aria-pressed="false"]')
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.berth ?? ''));

/** Где корабль стоит по состоянию «сервера». */
const berthOf = async (page: Page, memberId: string): Promise<string> => {
    const member = (await readState(page)).channels['ch-demo'].members.find((item) => item.memberId === memberId);
    return member ? `${member.place.slot}-${member.place.corridor}` : 'нет в канале';
};

/**
 * Место, на котором эта вкладка рисует свой корабль пришедшим.
 *
 * Спрашивают у кадра, а не у «сервера»: перестановка возвращается во вкладку рассылкой,
 * и до неё вкладка честно показывает прежнее место. Метка «свой» тут кстати вдвойне —
 * она же и признак прихода: своим корабль помечается только тогда, когда его можно открыть,
 * а идущий по воде не открывает ничего (см. canEdit в SeaScene). Пока он идёт, метки нет,
 * и ответом будет отговорка.
 *
 * Отговорка, а не ожидание: спрашивают отсюда пробой, а ожидание внутри пробы кончается
 * не новой попыткой, а падением всей проверки. Ждёт поэтому сама проба.
 *
 * Весь рейд так не спросишь: перезаход — это уход со старого места и приход на новое,
 * и какое-то время в кадре стоят оба корпуса. Разобрать, где чей, по одним местам нельзя,
 * а на своём корабле метка эту пару и разводит.
 */
const shownBerth = (page: Page): Promise<string> =>
    page.evaluate(
        () => document.querySelector('[class*="shipMine"]')?.getAttribute('data-berth-ship') ?? 'корабль ещё в пути'
    );

/**
 * Место, которое вкладка считает своим: оно отмечено в форме нажатым.
 *
 * Отвечает сразу тем, что видит, — и «ничего не выбрано», если нажатого места нет. Ждать
 * ему нельзя: зовут его из `expect.poll`, а ожидание внутри такой пробы кончается не пробой,
 * а падением всей проверки. Отобранное место возвращается во вкладку рассылкой, и, спрошенная
 * разом после открытия формы, она честно стоит ни на чём — это ответ, а не ошибка, и ждать
 * его должна проба снаружи.
 */
const ownBerth = (page: Page): Promise<string> =>
    page.evaluate(
        () =>
            document.querySelector('[data-berth][aria-pressed="true"]')?.getAttribute('data-berth') ??
            'ничего не выбрано'
    );

test('перестановка из соседней вкладки не затирает свою', async ({ context }) => {
    takes(6);
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);

    await openShipForm(mine);
    await openShipForm(theirs);
    const [here] = await freeBerths(mine);
    // Второе место берём подальше от первого: рядом с занявшим соседний корабль может уже
    // и не поместиться, и тогда непонятно, чем кончилось — теснотой или гонкой.
    const line = Number(here.split('-')[0]);
    const there = (await freeBerths(theirs)).find((berth) => Math.abs(Number(berth.split('-')[0]) - line) > 1)!;

    const wasTheirs = await berthOf(theirs, VYMPEL);
    await mine.locator(`[data-berth="${here}"]`).click();
    await theirs.locator(`[data-berth="${there}"]`).click();
    // Выбор должен дойти до формы прежде, чем жать «Готово»: гонка тут проверяется одна —
    // между вкладками, — и подмешивать к ней вторую, между проверкой и отрисовкой, незачем.
    // Не дошедший выбор виден как «ничего не переставилось»: форма отправляет прежнее место.
    await expect(mine.locator(`[data-berth="${here}"]`), 'выбор места не дошёл до формы').toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await expect(theirs.locator(`[data-berth="${there}"]`), 'выбор места не дошёл до соседней формы').toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await Promise.all([shipFormSubmit(mine).click(), shipFormSubmit(theirs).click()]);

    // Своя перестановка доезжает целиком: терялась тут именно первая из двух записей —
    // она уходила в состояние и тут же затиралась второй.
    await expect
        .poll(() => berthOf(mine, ALBATROS), { message: 'свою перестановку затёрла соседняя вкладка' })
        .toBe(here);

    // С соседней вкладкой спрос мягче, и нарочно. Пока идёт та же гонка, выбранное ею место
    // может перестать быть свободным — и тогда приложение молча берёт другое, оставляя корабль
    // там, где он стоял (см. berthIsFree в App): заставлять человека выбирать заново из-за
    // чужого хода незачем. Оба исхода правильные, неправильный тут один — третье место,
    // которого никто не выбирал.
    expect([there, wasTheirs], 'соседняя вкладка встала не туда, куда просила, и не туда, где стояла').toContain(
        await berthOf(mine, VYMPEL)
    );
    expect((await readState(mine)).channels['ch-demo'].members, 'кораблей в канале стало меньше').toHaveLength(3);
});

test('два корабля не встают на одно место, даже если выбрали его разом', async ({ context }) => {
    // Две вкладки, и в каждой — свой заход на рейд с ходом по морю. Вдобавок проверка дважды
    // ждёт, пока корабль дойдёт до отведённого места: ход по воде и есть здесь самое долгое.
    takes(13);
    const mine = await context.newPage();
    const theirs = await context.newPage();
    await openChannel(mine, DEMO, ALBATROS);
    await openChannel(theirs, DEMO, VYMPEL);

    await openShipForm(mine);
    await openShipForm(theirs);
    const free = await freeBerths(theirs);
    const shared = (await freeBerths(mine)).find((berth) => free.includes(berth))!;

    await mine.locator(`[data-berth="${shared}"]`).click();
    await theirs.locator(`[data-berth="${shared}"]`).click();
    // Обе вкладки должны и правда стоять на спорном месте, иначе спора не выйдет: не дошедший
    // выбор отправит прежнее место, и проверка разойдётся на том, чего не проверяет.
    await expect(mine.locator(`[data-berth="${shared}"]`), 'выбор места не дошёл до формы').toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await expect(theirs.locator(`[data-berth="${shared}"]`), 'выбор места не дошёл до соседней формы').toHaveAttribute(
        'aria-pressed',
        'true'
    );
    await Promise.all([shipFormSubmit(mine).click(), shipFormSubmit(theirs).click()]);

    // Место одно, а желающих двое: достаться оно должно кому-то одному, второму — другое.
    const allBerths = async (): Promise<string[]> =>
        (await readState(mine)).channels['ch-demo'].members.map(
            (member) => `${member.place.slot}-${member.place.corridor}`
        );
    // Ждём именно спорное место, а не три разных: разными они и были с самого начала —
    // три корабля демо-эскадры стоят порознь, — и проверка на их число проходила, ещё не
    // дождавшись ни одной записи. Дальше она читала рейд, на котором никто никуда не двигался,
    // и падала на «место досталось не одному», хотя доставаться было ещё нечему.
    await expect
        .poll(async () => (await allBerths()).filter((berth) => berth === shared).length, {
            message: 'спорное место так и не досталось никому',
        })
        .toBe(1);
    // А проигравший встал не на спорное — либо на другое свободное, либо остался, где стоял.
    expect(new Set(await allBerths()).size, 'на рейде два корабля на одном месте').toBe(3);

    // И каждая вкладка держит своим то место, которое ей и досталось. До общей очереди обе
    // оставались при своём выборе — том самом спорном, — и вкладка рисовала свой корабль там,
    // где на деле уже стоял чужой.
    //
    // Сперва ждём, пока перестановка дойдёт до самих вкладок. Форма заводит свой выбор один
    // раз, когда открывается: открытая раньше рассылки, она подставит прежнее место — и так
    // на нём и останется, потому что прежнее свободно, а переспрашивать себя ей незачем.
    //
    // Признак прихода — свой корабль, вставший в кадре на то самое место, что записано за ним
    // в «сервере». Сверяются они прямо в пробе, а не с заранее снятым рейдом: записи идут
    // общей очередью, и вторая доходит позже — снимок, взятый разом после первой, устареет
    // к следующей же попытке. Ход по воде долгий, отсюда и срок ожидания.
    const standsWhereTold = async (page: Page, memberId: string): Promise<string> => {
        const shown = await shownBerth(page);
        const told = await berthOf(page, memberId);
        return shown === told ? 'на своём месте' : `${shown} вместо ${told}`;
    };
    await expect
        .poll(() => standsWhereTold(mine, ALBATROS), {
            message: 'корабль так и не встал в кадре туда, где ему отвели место',
            timeout: SAIL_TIMEOUT,
        })
        .toBe('на своём месте');
    await expect
        .poll(() => standsWhereTold(theirs, VYMPEL), {
            message: 'корабль соседней вкладки так и не встал в кадре туда, где ему отвели место',
            timeout: SAIL_TIMEOUT,
        })
        .toBe('на своём месте');

    await openShipForm(mine);
    await openShipForm(theirs);
    // Отобранное место возвращается во вкладку рассылкой, и приходит она не в тот же миг:
    // ждём совпадения, а не смотрим на первый попавшийся кадр формы.
    await expect
        .poll(async () => [await ownBerth(mine), await berthOf(mine, ALBATROS)], {
            message: 'вкладка держит своим место, которое ей не досталось',
        })
        .toEqual([await berthOf(mine, ALBATROS), await berthOf(mine, ALBATROS)]);
    await expect
        .poll(async () => [await ownBerth(theirs), await berthOf(theirs, VYMPEL)], {
            message: 'соседняя вкладка держит своим место, которое ей не досталось',
        })
        .toEqual([await berthOf(theirs, VYMPEL), await berthOf(theirs, VYMPEL)]);
    expect(await ownBerth(mine), 'обе вкладки считают своим одно и то же место').not.toBe(await ownBerth(theirs));
});

/**
 * Плашка корабля в форме почти целиком состоит из текста: название и строчка характеристик.
 * Текст этот для того и написан, чтобы его читали и сравнивали, — а значит, и выделяли:
 * выбирая между катером и тральщиком, ход с осадкой хочется утащить с собой.
 *
 * Настоящей кнопкой такая плашка быть не может (см. `@/utils/tap`): из `button` браузер не даёт
 * выделить текст вовсе, даже при `user-select: text`, и нажатие по ней не сбрасывает уже набранное
 * выделение. Форма от этого выглядела заклинившей: выделить нечего, а если выделилось соседним
 * полем или Cmd+A — обратно уже не снимешь, нажатия она словно не замечает.
 */
test('характеристики корабля в форме выделяются, а тычок сбрасывает выделение', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openShipForm(page);

    const selection = (): Promise<string> => page.evaluate(() => window.getSelection()?.toString().trim() ?? '');
    const plates = page.locator('[class*="kinds_"] [role="button"]');

    // Берём невыбранную плашку по номеру, а не локатором по `aria-pressed`: за проверку она
    // как раз становится выбранной, и локатор уехал бы с неё на соседнюю.
    const pressed = await plates.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-pressed')));
    const plate = plates.nth(pressed.indexOf('false'));

    // Тянем по самой строчке характеристик, изнутри её полей: снаружи выделять было бы нечего.
    // Форма длинная и мотает себя сама, а мышь ходит по окну: не подведи плашку под глаза —
    // и протяжка пройдёт мимо экрана.
    const spec = plate.locator('[class*="kindSpec"]');
    await spec.scrollIntoViewIfNeeded();
    const box = (await spec.boundingBox())!;
    const middle = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, middle);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, middle, { steps: 12 });
    await page.mouse.up();

    expect(await selection(), 'характеристики корабля не выделяются').not.toBe('');
    await expect(plate, 'протяжка по тексту обернулась выбором корабля').toHaveAttribute('aria-pressed', 'false');

    // Тычок по той же плашке — обычный выбор, и выделение он снимает, как снял бы на любом
    // другом месте страницы.
    await plate.click();
    expect(await selection(), 'выделение не сбросилось нажатием').toBe('');
    await expect(plate, 'тычок по плашке не выбрал корабль').toHaveAttribute('aria-pressed', 'true');

    // Клавиатуру плашка отрабатывает сама, раз она не кнопка: ввод по ней выбирает корабль.
    const next = plates.nth(pressed.indexOf('false') === 0 ? 1 : 0);
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(next, 'ввод по плашке не выбрал корабль').toHaveAttribute('aria-pressed', 'true');
});

/**
 * Системного отклика на касание в интерфейсе нет. На телефоне браузер подсвечивает нажатое
 * синим прямоугольником по своей мерке — по всей коробке разом, не зная ни скруглений,
 * ни того, что нажали вымпел внутри плашки, — и это читалось поломкой: синие углы у круглой
 * аватарки, синяя полоса во всю шапку от названия канала. Свой отклик рисуют сами кнопки
 * и лента, и его довольно.
 *
 * Выделение текста при этом остаётся там, где текст читают: подпись кнопки выделять незачем,
 * а чужую реплику человек должен уметь скопировать.
 */
test('нажатия не подсвечиваются системой, а подписи кнопок не выделяются', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);

    const look = (target: Locator, property: string): Promise<string> =>
        target.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

    // Название канала в шапке — кнопка: подсветки нет, подпись не выделяется.
    await expect(shipsButton(page)).toBeVisible();
    expect(await look(shipsButton(page), '-webkit-tap-highlight-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await look(shipsButton(page), 'user-select')).toBe('none');

    // В ленте подсветки нет тоже, хотя плашка реплики — не кнопка: свойство наследуется,
    // и снято оно на всё дерево разом.
    const bubble = bubbles(page).first();
    expect(await look(bubble, '-webkit-tap-highlight-color')).toBe('rgba(0, 0, 0, 0)');
    // А вот текст реплики выделяется — за тем плашка и сделана не кнопкой.
    expect(await look(bubble, 'user-select'), 'реплику в ленте не выделить').not.toBe('none');
});
