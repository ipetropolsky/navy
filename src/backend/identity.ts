import { localStore } from '@/backend/storage';

/**
 * Кто эта вкладка в канале. Лежит отдельно от данных «сервера»: бэкенд знает про всех
 * участников, а вот кто из них — ты, это дело клиента, и в настоящей системе тут был бы
 * токен входа.
 *
 * Ключ включает channelId: в разных каналах ты разный корабль, и один не должен подменять
 * другого. Чтобы в соседней вкладке говорить за другой корабль, id можно передать в адресе
 * (`&memberId=…`) — он перебивает сохранённый, но сам не сохраняется, поэтому одна вкладка
 * не меняет личность другой. Без адреса и без сохранённого id канал предложит встать в строй.
 */

const KEY_PREFIX = 'kilvater.member.';

export const readMemberId = (channelId: string): string | null => localStore.read(KEY_PREFIX + channelId);

export const rememberMemberId = (channelId: string, memberId: string): void => {
    localStore.write(KEY_PREFIX + channelId, memberId);
};

export const forgetMemberId = (channelId: string): void => {
    localStore.remove(KEY_PREFIX + channelId);
};
