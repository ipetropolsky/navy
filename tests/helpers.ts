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
 * Раскладка, с которой открывается вкладка в проверках: кадр сжат, разговор под ним.
 *
 * Приложение на широком окне открывается иначе — развёрнутым кадром и разговором сбоку
 * (см. `defaultWish` в hooks/useLayout), — и это правильно для человека, но не для проверок:
 * почти все они про разговор, про шторку и про кадр в колонке, и каждой пришлось бы начинаться
 * с двух нажатий по шапке. Записываем выбор в хранилище до первой отрисовки — ровно так же,
 * как его записала бы вкладка, в которой раскладку уже трогали руками.
 *
 * Проверки самой раскладки хранилище не трогают и открывают страницу сами: им как раз важно,
 * с чем приложение открывается, когда вкладке нечего вспомнить.
 */
const startCollapsed = async (page: Page): Promise<void> => {
    // Записывается это только в пустое хранилище: скрипт выполняется перед каждым переходом,
    // и без проверки он затирал бы то, что вкладка выбрала по ходу проверки, — в том числе
    // на перезагрузке, которой как раз и проверяют память о раскладке.
    await page.addInitScript(() => {
        // Хранилище тут дёргается напрямую в обход обёртки из utils/storage: этот кусок
        // выполняется в браузере до приложения и своего кода не видит вовсе.
        /* eslint-disable no-restricted-syntax */
        if (!window.sessionStorage.getItem('navy:layout')) {
            window.sessionStorage.setItem(
                'navy:layout',
                JSON.stringify({ expanded: false, side: false, sideShare: 1 / 3 })
            );
        }
        /* eslint-enable no-restricted-syntax */
    });
};

/**
 * Открыть канал. `memberId` в адресе перебивает сохранённую личность вкладки — так вторая
 * вкладка говорит за другой корабль, не трогая первую.
 */
export const openChannel = async (page: Page, slug = DEMO, memberId?: string): Promise<void> => {
    const address = memberId ? `/?channel=${slug}&memberId=${memberId}` : `/?channel=${slug}`;
    await startCollapsed(page);
    await page.goto(address, { waitUntil: 'networkidle' });
    await page.waitForTimeout(SCENE_READY_MS);
};

/**
 * Завести свой канал и остаться в нём. Нужен там, где важен ровно один корабль в кадре
 * и он же — свой: в демо-канале на рейде уже стоит эскадра.
 */
export const openNewChannel = async (page: Page, slug: string): Promise<void> => {
    await startCollapsed(page);
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
 * Заполнить форму постановки в строй и отправить её.
 *
 * Кнопку берём из самой формы, а не со страницы: при переоснащении форма выезжает поверх
 * разговора, и поле ввода со своей кнопкой отправки никуда не девается — «отправить» на
 * странице в этот момент двое.
 */
export const join = async (page: Page, name: string, hullNumber: string, shipKind?: string): Promise<void> => {
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
 * Открыть шторку со списком кораблей — нажатием на название канала в шапке: значок списка
 * стоит в конце названия, и нажимаются они вместе.
 *
 * Ищется кнопка по подсказке, а не по подписи: подпись у неё — само название канала, разное
 * от канала к каналу, а та же подпись «Корабли на связи» стоит и на самой шторке.
 */
export const shipsButton = (page: Page) => page.locator('button[title="Корабли на связи"]');

/** Она же, когда список уже открыт: значок в названии сменился на облачко разговора. */
export const backToChatButton = (page: Page) => page.locator('button[title="Вернуться к разговору"]');

export const openSheet = async (page: Page): Promise<void> => {
    await shipsButton(page).click();
    await page.waitForTimeout(300);
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
    await page.getByRole('button', { name: `Корабль «${name}»` }).click();
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
