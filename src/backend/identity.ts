import { sessionStore } from '@/utils/storage';

/**
 * Кто эта вкладка в канале. Лежит отдельно от данных «сервера»: бэкенд знает про всех
 * участников, а вот кто из них — ты, это дело клиента, и в настоящей системе тут был бы
 * токен входа.
 *
 * Личность хранится в `sessionStorage`, то есть у каждой вкладки своя, — и это ровно то,
 * что нужно эмулятору. Данные канала общие на браузер (`localStorage`), поэтому с общей
 * личностью вторая вкладка молча оказывалась бы тем же кораблём и поговорить сам с собой
 * было бы не с кем. Теперь новая вкладка приходит в канал никем и встаёт в строй заново.
 * За настоящий вход это, конечно, не считается: закрыли вкладку — личность потеряли.
 *
 * Ключ включает channelId: в разных каналах ты разный корабль, и один не должен подменять
 * другого. Ещё id можно передать в адресе (`&memberId=…`) — он перебивает сохранённый,
 * но сам не сохраняется. Без адреса и без сохранённого id канал предложит встать в строй.
 */

const KEY_PREFIX = 'kilvater.member.';

export const readMemberId = (channelId: string): string | null => sessionStore.read(KEY_PREFIX + channelId);

export const rememberMemberId = (channelId: string, memberId: string): void => {
    sessionStore.write(KEY_PREFIX + channelId, memberId);
};

export const forgetMemberId = (channelId: string): void => {
    sessionStore.remove(KEY_PREFIX + channelId);
};
