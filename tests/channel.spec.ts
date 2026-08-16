import { Locator, Page, expect, test } from '@playwright/test';

import {
    ALBATROS,
    DEMO,
    VYMPEL,
    bubbles,
    join,
    leaveRaid,
    openChannel,
    openNewChannel,
    openSheet,
    openShipCard,
    readState,
    send,
    ships,
    shipsButton,
    systemLines,
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
    // засчитана, когда над строкой ввода встала цитата того самого сообщения.
    // Первая реплика, а не первое сообщение: лента начинается со строчек канала о входе,
    // и пузырей среди них нет — щёлкать в них не по чему.
    const target = (await readState(page)).channels['ch-demo'].messages.find((message) => message.text)!;
    await expect(async () => {
        await bubbles(page).first().click();
        await expect(page.locator('[class*="replyBar"]')).toContainText(target.text!, { timeout: 2000 });
    }, 'лента так и не показала, на что отвечает').toPass({ timeout: 20_000 });
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

test('уход с рейда отмечается в ленте и возвращает к постановке в строй', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await expect(ships(page)).toHaveCount(3);

    // Уход — кнопкой внизу списка кораблей, а следом новый курс: молча с рейда не уходят.
    await leaveRaid(page, 'В Кронштадт, на зимовку');

    // Вкладка возвращается к форме — тупика нет, встать в строй можно снова.
    await expect(page.getByPlaceholder('Гром')).toBeVisible();
    const state = await readState(page);
    expect(state.channels['ch-demo'].members.map((member) => member.memberId)).not.toContain(ALBATROS);
    // Бэкенд пишет данными, а не фразой: каким корабль был на момент ухода и что он сказал
    // на прощание. Как это сказать словами, решает лента — её слова проверены выше.
    expect(state.channels['ch-demo'].messages.at(-1)!.notice).toEqual({
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
    await page.getByRole('button', { name: 'Уйти с рейда' }).click();

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
    await shipsButton(page).click();
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await join(page, 'Альбатрос', '512');

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
        await expect(page.locator('[class*="replyBar"]')).toContainText('Сменил бортовой номер', { timeout: 2000 });
    }, 'лента так и не показала, что отвечает на строчку канала').toPass({ timeout: 20_000 });
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
 * а не у окна: список живёт в шторке, и шторка бывает уже окна. Проверяем оба состояния подряд
 * на одной странице — важно, что подпись уходит и возвращается на живом списке, а не только
 * на свежеоткрытом.
 */
// Окно, в котором подписи уже не хватает места: список идёт во всю ширину шторки за вычетом
// её полей (12px с каждой стороны), а прячется подпись ниже 358px — см. @badge-fits в стилях.
const BADGE_HIDES_BELOW = 360;

test('вымпел старшего отвечает званием, а подпись рядом — по ширине списка', async ({ page }) => {
    await openChannel(page, DEMO, ALBATROS);
    await openSheet(page);

    // Широкий экран: вымпел один (старший в канале один) и подпись рядом с ним.
    const pennants = page.locator('img[class*="pennant"]');
    const flag = page.getByRole('button', { name: SENIOR });
    await expect(pennants, 'вымпел стоит не у одного корабля').toHaveCount(1);
    await expect(page.getByText(SENIOR), 'подписи старшего нет на широком экране').toBeVisible();

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
    await openChannel(page, DEMO, VYMPEL);
    await shipsButton(page).click();
    await expect(page.getByLabel(/^Высадить/)).toHaveCount(0);

    // Старший ушёл — канал не остаётся без него: старшинство берёт тот, кто дольше всех
    // из оставшихся. Иначе высаживать было бы уже некому.
    await openChannel(page, DEMO, ALBATROS);
    await leaveRaid(page);
    await expect(page.getByPlaceholder('Гром')).toBeVisible();

    const state = await readState(page);
    expect(state.channels['ch-demo'].channel.owner?.memberId).toBe(VYMPEL);

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

    // Кадр разворачивается — блок с разговором ужимается под ним, и лента едет вместе с ним.
    await mine.getByRole('button', { name: 'Развернуть сцену' }).click();
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'ужавшаяся лента отстала от низа' })
        .toBeLessThan(24);

    // И остаётся прицепленной: следующее сообщение видно, а не догадываешься о нём по счётчику.
    await send(theirs, 'После разворота');
    await expect(bubbles(mine).last()).toContainText('После разворота');
    await expect
        .poll(async () => (await scrollState(mine)).bottom, { message: 'после разворота лента отцепилась от низа' })
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

/** Открыть форму настройки своего корабля: оттуда и переставляют. */
const openShipForm = async (page: Page): Promise<void> => {
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(page.locator('[data-berth]').first()).toBeVisible();
};

/**
 * Кнопка «Готово» самой формы. Через страницу её не взять: форма выезжает поверх разговора,
 * и у поля ввода под ней тоже кнопка-submit.
 */
const shipFormSubmit = (page: Page) =>
    page
        .locator('form')
        .filter({ has: page.getByPlaceholder('Гром') })
        .locator('button[type=submit]');

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

/** Место, которое вкладка считает своим: оно отмечено в форме нажатым. */
const ownBerth = async (page: Page): Promise<string> =>
    (await page.locator('[data-berth][aria-pressed="true"]').getAttribute('data-berth')) ?? 'ничего не выбрано';

test('перестановка из соседней вкладки не затирает свою', async ({ context }) => {
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
    await Promise.all([shipFormSubmit(mine).click(), shipFormSubmit(theirs).click()]);

    // Место одно, а желающих двое: достаться оно должно кому-то одному, второму — другое.
    await expect
        .poll(
            async () => {
                const members = (await readState(mine)).channels['ch-demo'].members;
                return members.map((member) => `${member.place.slot}-${member.place.corridor}`).sort();
            },
            { message: 'на рейде так и не стало трёх разных мест' }
        )
        .toHaveLength(3);
    const berths = (await readState(mine)).channels['ch-demo'].members.map(
        (member) => `${member.place.slot}-${member.place.corridor}`
    );
    expect(new Set(berths).size, 'два корабля встали на одно место').toBe(3);
    expect(
        berths.filter((berth) => berth === shared),
        'место досталось не одному'
    ).toHaveLength(1);

    // И каждая вкладка держит своим то место, которое ей и досталось. До общей очереди обе
    // оставались при своём выборе — том самом спорном, — и вкладка рисовала свой корабль там,
    // где на деле уже стоял чужой.
    await openShipForm(mine);
    await openShipForm(theirs);
    const ownMine = await ownBerth(mine);
    const ownTheirs = await ownBerth(theirs);
    expect(ownMine, 'вкладка держит своим место, которое ей не досталось').toBe(await berthOf(mine, ALBATROS));
    expect(ownTheirs, 'соседняя вкладка держит своим место, которое ей не досталось').toBe(
        await berthOf(theirs, VYMPEL)
    );
    expect(ownMine, 'обе вкладки считают своим одно и то же место').not.toBe(ownTheirs);
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
