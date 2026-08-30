import { Firestore } from 'firebase-admin/firestore';

import { paths } from '../../shared/config/model';
import { Member, ShipKind, ShipPlacement, redactMember } from '../../shared/types/channel';

/**
 * Список кораблей для того, кто ещё не вошёл (см. previewChannel в index.ts): участники
 * и лента закрыты правилами для всех, кроме вошедших (firestore.rules, allow read: if signedIn()) —
 * полем тут не обойтись, правило открывает документ целиком или никак. Читает Admin SDK,
 * минуя правила, — ровно за этим, за отдельным Firestore-инстансом, и заведён этот файл,
 * а не raid.ts: тот про то, как рейд меняется, этот — про то, что из него видно снаружи.
 *
 * Без транзакции: это разовый показ на загрузку страницы, а не шаг рейда — расхождение
 * в доли секунды между составом флота и тем, что увидит гость, не тот случай, ради которого
 * стоит платить лишним чтением. Живьём список не обновляется вовсе (см. firebaseBackend.ts,
 * subscribe): проверить, кто на связи, гость может, только заново открыв канал.
 */
interface MemberDoc {
    name: string;
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    place: ShipPlacement;
    joinedAt: number;
}

export const previewMembers = async (db: Firestore, channelId: string): Promise<Member[]> => {
    const snapshot = await db.collection(paths.members({ channelId })).get();
    return snapshot.docs.map((doc) => redactMember({ memberId: doc.id, ...(doc.data() as MemberDoc) }));
};
