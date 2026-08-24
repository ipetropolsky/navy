import { ReactNode } from 'react';

import { Message } from '@shared/types/channel';

import ShipNoticeLine from '@/components/chat/ShipNoticeLine';

/**
 * Что в сообщении написано: у реплики — её текст, у системной записи — сложенная лентой
 * фраза о корабле.
 *
 * Отдельным компонентом, потому что показать сообщение надо в трёх местах: в самой ленте,
 * в цитате внутри ответа и в цитате над строкой ввода. Системная запись теперь такое же
 * сообщение, как реплика, — со своим номером, временем и ответом, — и разбирать её на текст
 * в каждом из трёх мест значило бы трижды написать одно и то же.
 */

interface MessageBodyProps {
    message: Message;
}

export default function MessageBody({ message }: MessageBodyProps): ReactNode {
    return message.kind === 'system' ? <ShipNoticeLine notice={message.notice} /> : message.text;
}
