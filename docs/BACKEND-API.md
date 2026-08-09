# API бэкенда

Фронтенд не знает, где лежат данные. Он знает только интерфейс `ChannelBackend`
(`src/backend/types.ts`) и берёт готовый экземпляр из `src/backend/index.ts`:

```ts
import { backend } from '@/backend';
```

Сегодня за этим интерфейсом стоит `LocalBackend` — эмулятор на `localStorage` и
`BroadcastChannel`. Завтра там окажется Firebase, и поменяется одна строка в
`src/backend/index.ts`. Всё остальное приложение останется как есть.

## Правила, которые задают форму API

- **Всё асинхронно.** Даже там, где реализация может ответить мгновенно. Синхронный ответ
  приучил бы интерфейс к порядку, которого у настоящего сервера не будет.
- **Всё адресно.** Канал — `channelId`, участник — `memberId`, сообщение — `messageId`
  (поле `id` у сообщения), ответ — `threadId`, то есть id сообщения, к которому он привязан.
- **Изменения возвращаются событиями, а не ответами.** Метод сообщает, что действие принято;
  состояние приложение обновляет по подписке. Событие приходит одинаково и на своё действие,
  и на чужое, поэтому в UI нет ветки «это сделал я».

## Сущности

```ts
interface ChannelSnapshot {
    id: string;
    title: string;
    createdAt: number; // мс эпохи
    members: Member[];
    messages: Message[];
}

interface Member {
    id: string;
    name: string; // позывной, он же название корабля
    hullNumber: string; // ровно три цифры
    shipKind: ShipKind; // 'patrol' | 'missile' | 'minesweeper' | 'corvette' | 'torpedo'
    color: string; // цвет позывного в ленте
    joinedAt: number;
}

interface Message {
    id: string;
    memberId: string; // кто отправил
    text: string;
    threadId?: string; // id сообщения, на которое отвечаем
    sentAt: number; // мс эпохи; как показать — дело интерфейса
}
```

## Методы

| Метод                                      | Что делает                           | Возвращает                |
| ------------------------------------------ | ------------------------------------ | ------------------------- |
| `getChannel(channelId)`                    | Состояние канала целиком             | `ChannelSnapshot \| null` |
| `createChannel(title)`                     | Заводит канал без участников         | `ChannelSnapshot`         |
| `renameChannel(channelId, title)`          | Переименовывает канал                | `void`                    |
| `join(channelId, draft)`                   | Ставит корабль в строй               | `Member`                  |
| `updateMember(channelId, memberId, draft)` | Меняет позывной, номер, силуэт, цвет | `Member`                  |
| `leave(channelId, memberId)`               | Выводит корабль из канала            | `void`                    |
| `sendMessage(channelId, draft)`            | Отправляет сообщение                 | `Message`                 |
| `setTyping(channelId, memberId, chars)`    | Сообщает о печати                    | `void`                    |
| `subscribe(channelId, listener)`           | Подписка на события канала           | функция отписки           |

### Открыть канал и подписаться

```ts
const channel = await backend.getChannel(channelId);
if (!channel) {
    // Канала нет: адрес устарел или канал не создавали.
}

const unsubscribe = backend.subscribe(channelId, (event) => {
    console.log(event.type, event);
});
// когда экран закрывается
unsubscribe();
```

### Создать канал

```ts
const channel = await backend.createChannel('Эскадра «Полночь»');
// дальше открываем ?channelId=<channel.id> и встаём в строй
```

### Встать в строй

```ts
import { ChannelError } from '@/backend';

try {
    const me = await backend.join(channelId, {
        name: 'Гроза',
        hullNumber: '042',
        shipKind: 'corvette',
        color: '#8ecae6',
    });
    rememberMemberId(channelId, me.id);
} catch (error) {
    if (error instanceof ChannelError) {
        // error.code: 'channel-full' | 'name-taken' | 'hull-taken' | ...
        // error.message уже написан по-человечески, его можно показать в форме
    }
}
```

### Отправить сообщение и ответить на него

```ts
const message = await backend.sendMessage(channelId, {
    memberId: myId,
    text: 'Швартовы отданы, выходим из бухты',
});

// Ответ ссылается на id того сообщения, к которому привязан.
await backend.sendMessage(channelId, {
    memberId: myId,
    text: 'Идём следом, держу кильватер',
    threadId: message.id,
});
```

### Печать

```ts
// На каждое изменение поля ввода: добавленные символы или '\b' при удалении.
// Из них лампа на мачте набирает Морзе.
void backend.setTyping(channelId, myId, chars);
```

Печать — единственное, что никуда не сохраняется: она живёт ровно столько, сколько идёт.

## События

У всех событий одинаковый конверт: `id`, `channelId`, `at`. Различает их только `type`.

```ts
type ChannelEvent = { id: string; channelId: string; at: number } & (
    | { type: 'channel-created'; title: string }
    | { type: 'channel-renamed'; title: string }
    | { type: 'member-joined'; member: Member }
    | { type: 'member-updated'; member: Member }
    | { type: 'member-left'; memberId: string }
    | { type: 'message-added'; message: Message }
    | { type: 'typing'; memberId: string; chars: string }
);
```

Формат расширяемый: чтобы добавить, например, системное уведомление о шторме, достаточно
дописать вариант в объединение. Транспорт и подписка про конкретные типы не знают,
а обработчик в UI разбирает знакомые и молча пропускает незнакомые:

```ts
switch (event.type) {
    case 'message-added':
        return { ...state, messages: [...state.messages, event.message] };
    // …
    default:
        return state; // незнакомое событие — не повод ломаться
}
```

## Ошибки

Отказ приходит отклонённым промисом с `ChannelError`. У него есть `code` для логики
и `message` — готовый текст для человека.

| `code`              | Когда                           |
| ------------------- | ------------------------------- |
| `channel-not-found` | Канала с таким id нет           |
| `channel-full`      | В канале уже пять кораблей      |
| `name-taken`        | Позывной занят другим кораблём  |
| `hull-taken`        | Бортовой номер занят            |
| `member-not-found`  | Корабля с таким id в канале нет |

## Что делает эмулятор

`LocalBackend` (`src/backend/localBackend.ts`) держит состояние «сервера» в `localStorage`
под ключом `kilvater.v1`:

```json
{ "channels": { "demo": { "id": "demo", "title": "…", "members": [], "messages": [] } } }
```

- **Хранилище и провод разделены.** `localStorage` — память: пережил перезагрузку и отдал
  состояние тому, кто пришёл позже. `BroadcastChannel` — провод: доставил новость тем,
  кто уже здесь. Печать идёт только по проводу.
- **Задержка ответа 40 мс** стоит нарочно: у настоящего сервера мгновенных ответов не бывает,
  и интерфейс не должен рассчитывать, что состояние обновится к следующей строке кода.
- **Демо-канал** (`src/backend/seed.ts`, id `demo`) записывается при первом запуске, если
  хранилище пустое. Существующее состояние он не трогает.
- **Кто ты в канале — не дело бэкенда.** `memberId` лежит отдельно, в `localStorage`
  по ключу `kilvater.member.<channelId>` (`src/backend/identity.ts`). В настоящей системе
  на этом месте был бы токен входа.

## Как проверить разговор двух кораблей

Данные каналов общие для всех вкладок браузера, а `memberId` — тоже общий, поэтому вторая
вкладка по умолчанию окажется тем же кораблём. Чтобы говорить за другой, есть два пути:

- открыть канал с явным участником: `?channelId=demo&memberId=m-albatros` — адрес перебивает
  сохранённый id, но сам не сохраняется, поэтому первая вкладка остаётся собой;
- либо открыть вторую вкладку в другом профиле браузера или в приватном окне — там своё
  хранилище, и канал придётся создать заново.
