import { Account, MyChannel } from '@/backend';
import Button from '@/components/ui/Button';
import ListRow from '@/components/ui/ListRow';
import Panel from '@/components/ui/Panel';

import HomeFooter from '@/components/channel/HomeFooter';

import styles from './ChannelsList.module.less';

/**
 * Главная вошедшего: рейды, на которых стоит его корабль. Прежде на этом месте сразу стояла
 * форма создания канала — и человек, у которого каналы уже есть, каждый раз встречал
 * предложение завести ещё один, а к своим добирался только по сохранённой ссылке. Теперь
 * первым делом видно, куда вернуться, а «Создать канал» стоит рядом кнопкой: заводят канал
 * редко, а возвращаются в него каждый день.
 *
 * Строчка — общая со списком кораблей (см. ui/ListRow): нажимается целиком, отвечает на ввод
 * и пробел, а протяжку по тексту не считает нажатием — адрес канала переписывают в письмо.
 * Открывает она канал, и это единственное, что строчка сегодня делает: место под метку справа
 * и под значок действия в строчке есть (badge и action у ListRow), но чем их занять — вопрос
 * ещё не решённый, и пустые они честнее выдуманных.
 *
 * Каналов может не быть вовсе — и это обычное дело, а не пустой экран по ошибке: только что
 * вошедшему возвращаться некуда. Тогда на месте списка одна строка о том, что рейдов пока нет,
 * а оба хода — завести свой и заглянуть в демо — стоят там же, где и всегда.
 */

interface ChannelsListProps {
    channels: MyChannel[];
    /** Ещё спрашиваем. Список при этом пуст, и «каналов нет» говорить рано. */
    loading: boolean;
    /** Спросить не вышло: сеть или сервер. Текст уже человеческий. */
    error: string | null;
    /** Спросить заново — после отказа. */
    onRetry: () => void;
    /** Открыть канал по адресу. */
    onOpen: (slug: string) => void;
    /** Показать форму создания канала. */
    onCreate: () => void;
    demoHref: string;
    onOpenDemo: () => void;
    account: Account | null;
    onSignOut: () => void;
}

/** Якорь: канал как место, где стоят на рейде. Больше нигде не встречается — потому и здесь. */
function AnchorMark() {
    return (
        <span className={styles.mark} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
                <path
                    d="M12 8v12M12 8a2.2 2.2 0 1 0 0-4.4A2.2 2.2 0 0 0 12 8zM8 10h8M5 14a7 7 0 0 0 14 0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
}

export default function ChannelsList({
    channels,
    loading,
    error,
    onRetry,
    onOpen,
    onCreate,
    demoHref,
    onOpenDemo,
    account,
    onSignOut,
}: ChannelsListProps) {
    return (
        <Panel
            title="Ваши каналы"
            hint={error ?? 'Рейды, на которых стоит ваш корабль. Нажмите на канал, чтобы вернуться в него.'}
            actions={
                <>
                    {/* Спросить заново — только после отказа: без него кнопка обещала бы, что
                        список бывает несвежим, а он спрашивается на каждый вход заново. */}
                    {error && (
                        <Button variant="secondary" onClick={onRetry}>
                            Ещё раз
                        </Button>
                    )}
                    <Button onClick={onCreate}>Создать канал</Button>
                </>
            }
            footer={<HomeFooter demoHref={demoHref} onOpenDemo={onOpenDemo} account={account} onSignOut={onSignOut} />}
        >
            <div className={styles.list}>
                {loading && <div className={styles.empty}>Загружаем…</div>}
                {!loading && !error && !channels.length && (
                    <div className={styles.empty}>Пока ни одного: заведите свой канал или загляните в демо.</div>
                )}
                {channels.map((channel) => (
                    <ListRow
                        key={channel.channelId}
                        // Название строчке даём своё: собранное из содержимого, оно вышло бы
                        // из названия канала и его адреса разом — читать такое с экрана тяжело.
                        label={`Канал «${channel.title}»`}
                        icon={<AnchorMark />}
                        title={channel.title}
                        // Адрес — вторая строка: по нему канал узнают среди двух одинаково
                        // названных, и он же уходит в ссылку, которой зовут остальных.
                        subtitle={channel.slug}
                        onOpen={() => onOpen(channel.slug)}
                    />
                ))}
            </div>
        </Panel>
    );
}
