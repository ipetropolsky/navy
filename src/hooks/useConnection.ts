import { useEffect, useState } from 'react';

import { Connection, backend } from '@/backend';

/**
 * Есть ли связь с бэкендом прямо сейчас. Тонкая обвязка над watchConnection — компонент
 * не должен знать, что за ней стоит navigator.onLine и, у настоящего бэкенда, ещё и обрыв
 * подписки; только сам факт и с какого момента он длится.
 *
 * Начальное состояние — «на связи»: до первого ответа подписки (он приходит следом, уже после
 * первой отрисовки) это не факт, а то, с чем меньше всего риска ошибиться, — так же сегодня
 * ведёт себя приложение без этого хука вовсе.
 */
export function useConnection(): Connection {
    const [connection, setConnection] = useState<Connection>({ status: 'online', since: 0 });
    useEffect(() => backend.watchConnection({ onChange: setConnection }), []);
    return connection;
}
