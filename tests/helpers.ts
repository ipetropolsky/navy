import { Locator, Page, expect } from '@playwright/test';

/**
 * Общее для всех проверок: как открыть канал, как встать в строй, как заглянуть в хранилище.
 *
 * Хранилище у каждой проверки своё — Playwright даёт каждой свой контекст, — поэтому демо-канал
 * всегда свежий: три корабля и семь реплик из `src/backend/seed.ts`.
 */

export const DEMO = 'demo';

/** Корабли демо-канала: их id заданы руками в seed.ts, на них можно ссылаться. */
export const ALBATROS = 'm-albatros';
export const VYMPEL = 'm-vympel';

/** Сколько ждём, пока сцена проявится: картинки грузятся все разом и только потом показываются. */
const SCENE_READY_MS = 1500;

/**
 * Открыть канал. `memberId` в адресе перебивает сохранённую личность вкладки — так вторая
 * вкладка говорит за другой корабль, не трогая первую.
 *
 * Раскладку тут никто не подкладывает: приложение открывается с разговором в треть окна —
 * сбоку в лежачем, под кадром в стоячем (см. `defaultWish` в hooks/useLayout), — и это ровно
 * то, что проверкам и нужно. Прежде сюда писали в хранилище сжатый кадр: раскладок было
 * четыре, умолчание уводило кадр во весь экран, и каждой проверке пришлось бы начинаться
 * с пары нажатий по шапке.
 */
export const openChannel = async (page: Page, slug = DEMO, memberId?: string): Promise<void> => {
    const address = memberId ? `/?channel=${slug}&memberId=${memberId}` : `/?channel=${slug}`;
    await page.goto(address, { waitUntil: 'networkidle' });
    await page.waitForTimeout(SCENE_READY_MS);
};

/**
 * Завести свой канал и остаться в нём. Нужен там, где важен ровно один корабль в кадре
 * и он же — свой: в демо-канале на рейде уже стоит эскадра.
 */
export const openNewChannel = async (page: Page, slug: string): Promise<void> => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByPlaceholder('Эскадра «Полночь»').fill(slug);
    await page.locator('input[placeholder="eskadra-polnoch"]').fill(slug);
    await page.locator('button[type=submit]').click();
    await page.waitForTimeout(SCENE_READY_MS);
};

/**
 * Сколько ждём, пока «сервер» запишет отправленное, мс.
 *
 * Запись идёт не в тот же тик, что нажатие: сперва общая очередь на запись, потом сама запись
 * (см. exclusive в localBackend). «Сервер» при этом живёт в самой вкладке — уйти с неё на другой
 * адрес раньше, чем очередь дошла до записи, значит унести отправленное с собой. Человек столько
 * не успевает, а проверка, у которой следом стоит переход, успевает всегда.
 *
 * 300 мс — с запасом: сама задержка эмулятора 40 мс, очередь при незанятом замке проходится
 * за такт.
 */
const WRITE_MS = 300;

/**
 * Открыть форму постановки в строй. Канал по ссылке встречает гостя закрытой формой — пустой
 * плашкой с одной кнопкой посреди, — и до нажатия по ней ни полей, ни свободных мест на рейде
 * на экране нет. Свой, только что заведённый канал сюда не приходит: там форма открыта сразу.
 */
export const openJoinForm = async (page: Page): Promise<void> => {
    await page.getByRole('button', { name: 'Встать на рейд' }).click();
    await expect(page.getByPlaceholder('Гром'), 'форма постановки в строй не открылась').toBeVisible();
};

/**
 * Заполнить форму постановки в строй и отправить её. Закрытую сперва открываем: проверке,
 * которой нужен сам вход, дорога к форме безразлична, а гостя встречает именно закрытая.
 *
 * Кнопку берём из самой формы, а не со страницы: при переоснащении форма выезжает поверх
 * разговора, и поле ввода со своей кнопкой отправки никуда не девается — «отправить» на
 * странице в этот момент двое.
 */
export const join = async (page: Page, name: string, hullNumber: string, shipKind?: string): Promise<void> => {
    if (await page.getByRole('button', { name: 'Встать на рейд' }).isVisible()) {
        await openJoinForm(page);
    }
    const form = page.locator('form').filter({ has: page.getByPlaceholder('Гром') });
    await page.getByPlaceholder('Гром').fill(name);
    await page.locator('input[inputmode="numeric"]').fill(hullNumber);
    if (shipKind) {
        await page.getByText(shipKind, { exact: true }).click();
    }
    await form.locator('button[type=submit]').click();
    await page.waitForTimeout(WRITE_MS);
};

/**
 * Открыть список кораблей — нажатием на название канала в шапке: значок списка стоит в конце
 * названия, и нажимаются они вместе. Тем же нажатием список и закрывается: кнопка эта
 * переключатель.
 *
 * Ищется кнопка по подсказке, а не по подписи: подпись у неё — само название канала, разное
 * от канала к каналу, а та же подпись «Корабли на связи» стоит и на самом списке.
 */
export const shipsButton = (page: Page) => page.locator('button[title="Корабли на связи"]');

export const openSheet = async (page: Page): Promise<void> => {
    await shipsButton(page).click();
    await page.waitForTimeout(300);
};

/**
 * Кнопка выхода внизу списка кораблей.
 *
 * Ищется по первому слову: второе — «с рейда» — стоит только там, где список широк, а на узком
 * от подписи остаётся одно «Уйти» (см. `.wide` в MembersList.module.less). Ширину списку задаёт
 * разговор, и в боковой раскладке он и в треть окна бывает — рассчитывать на полную подпись
 * нельзя нигде.
 */
export const leaveButton = (page: Page) => page.getByRole('button', { name: /^Уйти/ });

/**
 * Уйти с рейда: кнопка внизу списка кораблей, а следом — новый курс в шторке прощания.
 *
 * Курс обязателен: молча с рейда не уходят, и без набранного курса подтверждение недоступно.
 * Дорог к выходу две — эта и кнопка в шапке, пока открыта форма своего корабля, — но шторка
 * прощания у них одна, и проверкам, которым нужен сам уход, а не путь к нему, хватает короткой.
 */
export const leaveRaid = async (page: Page, course = 'В Кронштадт'): Promise<void> => {
    await openSheet(page);
    await leaveButton(page).click();
    await page.getByLabel('Задайте новый курс').fill(course);
    await page.getByRole('button', { name: 'Курс верный' }).click();
    await page.waitForTimeout(WRITE_MS);
};

/**
 * Открыть карточку чужого корабля из списка кораблей — тычком по его строчке.
 *
 * Из ленты карточку больше не открыть: аватарка там окликает. Дорога к карточке две — кадр
 * и этот список, и в проверках, которым важна сама карточка, а не путь к ней, берём список:
 * он не зависит ни от раскладки, ни от того, куда корабль встал на рейде.
 */
export const openShipCard = async (page: Page, name: string): Promise<void> => {
    await openSheet(page);
    // Строчку берём внутри самого списка: тем же именем подписан и корабль в кадре, и на узком
    // окне первым из двух в разметке оказывается он — то есть тычок уходил бы на рейд.
    await page
        .getByRole('region', { name: 'Корабли на связи' })
        .getByRole('button', { name: `Корабль «${name}»` })
        .click();
    await page.waitForTimeout(300);
};

/** Написать в ленту. */
export const send = async (page: Page, text: string): Promise<void> => {
    await page.getByPlaceholder('Сообщение').fill(text);
    await page.keyboard.press('Enter');
};

/**
 * Состояние «сервера» глазами вкладки: то же, что лежит в localStorage. Читаем напрямую
 * нарочно — проверка смотрит на данные со стороны, а не через ту же обёртку, которой их пишет
 * приложение. Правило про обёртку — для кода приложения, а не для его проверок.
 */
export const readState = (page: Page): Promise<StoredState> =>
    page.evaluate(
        // eslint-disable-next-line no-restricted-syntax -- см. выше: это взгляд снаружи, а не код приложения
        () => JSON.parse(localStorage.getItem('kilvater.state') ?? '{}') as StoredState
    );

interface StoredMember {
    memberId: string;
    name: string;
    hullNumber: string;
    shipKind: string;
    place: { slot: number; corridor: string; left: number; facing: string; enterFrom: string };
}

interface StoredShipTitle {
    shipKind: string;
    name: string;
    hullNumber: string;
}

interface StoredMessage {
    messageId: string;
    author: { memberId: string };
    /** Есть у реплики. У системной записи вместо него — `notice`: канал пишет данными. */
    text?: string;
    kind?: string;
    notice?: {
        event: string;
        before: StoredShipTitle;
        after?: StoredShipTitle;
        changed?: string;
        /** Новый курс уходящего: он приходит вместе с уходом и хранится вместе с ним. */
        course?: string;
    };
    thread?: { messageId: string };
}

export interface StoredState {
    version: number;
    channels: Record<
        string,
        {
            channel: { channelId: string; slug: string; owner?: { memberId: string } };
            members: StoredMember[];
            messages: StoredMessage[];
        }
    >;
}

/**
 * Системные строчки ленты по порядку: вход, переоснащение, уход. Локатор, а не готовый список:
 * строчка появляется не мгновенно — сперва ответ бэкенда, потом отрисовка, — и проверять её
 * надо ожидающим `expect`, иначе гонка.
 */
export const systemLines = (page: Page) => page.locator('[class*="systemNote"]');

/** Пузыри с репликами. Системные строчки сюда не попадают: они не пузыри. */
export const bubbles = (page: Page) => page.locator('[class*="bubble"]');

/** Корабли в кадре — вместе с теми, кто как раз уходит за кромку. */
export const ships = (page: Page) => page.locator('[class*="shipSlot"]');

/** Свободные места на рейде: огоньки на воде, пока открыта форма корабля. */
export const berths = (page: Page) => page.locator('[data-berth]');

/**
 * Ткнуть в корабль в кадре.
 *
 * Целимся в середину корпуса, а ловит нажатие вода поверх флота и отдаёт его ближайшей
 * стоянке (см. shipWater и shipNearest в SeaScene). Отсюда и `page.mouse` вместо
 * `locator.click()`: тот сперва проверяет, что в точке нажатия лежит сам корпус, — а лежит
 * там вода, и попадать в корпус больше не нужно ни человеку, ни проверке.
 */
export const clickShip = async (page: Page, ship: Locator): Promise<void> => {
    const box = await ship.boundingBox();
    if (!box) {
        throw new Error('корабля нет в кадре');
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/**
 * Открыть форму своего корабля — ту, в которой выбирают место на рейде.
 *
 * Через список кораблей, а не щелчком по своему кораблю в кадре, и это не лень. Места
 * демо-эскадре раздаёт расстановка, всякий раз заново, и ближний корабль запросто накрывает
 * собой дальнего: в трёх запусках из дюжины середина своего корпуса оказывалась под чужим,
 * а бывает, что дальний закрыт целиком. Для кадра это правильно — кто ближе, тот и впереди, —
 * а для проверки, которой форма нужна лишь поводом, это флак на ровном месте: щёлкнуть
 * в середину нечем.
 *
 * Сам щелчок по кораблю от этого не остаётся непроверенным — он проверяется отдельно и там,
 * где корабль на рейде один и накрыть его некому.
 */
export const openShipForm = async (page: Page): Promise<void> => {
    await openSheet(page);
    await page.getByRole('button', { name: 'Настроить корабль' }).click();
    await expect(berths(page).first()).toBeVisible();
};

/**
 * Подписи занятых мест: имена кораблей, их видно тоже только при выборе места. Подчёркивание
 * в конце обязательно: подпись ездит по такой же дорожке, как корабль, и без него в набор
 * попадала бы ещё и она.
 */
export const shipNames = (page: Page) => page.locator('[class*="shipName_"]');

/** Убедиться, что из состояния есть выход: на экране видна кнопка, которая куда-то ведёт. */
export const expectWayOut = async (page: Page): Promise<void> => {
    const actions = page.locator('button:visible, a:visible');
    expect(await actions.count(), 'из этого состояния некуда нажать').toBeGreaterThan(0);
};
