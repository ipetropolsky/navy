import { ReactNode } from 'react';

import MemberName from '@/components/ships/MemberName';
import { Member } from '@/types/channel';

import styles from './ReplyQuote.module.less';

/**
 * На что отвечают: полоска слева цветом автора, его позывной, начало реплики. Одна и та же
 * и в пузыре в ленте, и над полем ввода, пока ответ ещё набирается, — это одно и то же
 * по смыслу, поэтому и выглядеть должно одинаково.
 */

interface ReplyQuoteProps {
    author?: Member;
    /** Что процитировано. Узлом, а не строкой: у системной записи текста нет — есть фраза. */
    text: ReactNode;
}

export default function ReplyQuote({ author, text }: ReplyQuoteProps) {
    return (
        <span className={styles.quote} style={author ? { borderColor: author.color } : undefined}>
            <MemberName name={author?.name ?? 'Неизвестный'} color={author?.color} />
            <span className={styles.text}>{text}</span>
        </span>
    );
}
