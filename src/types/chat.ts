export type ShipKind = 'patrol' | 'missile' | 'minesweeper' | 'corvette' | 'torpedo';

export interface Participant {
    id: string;
    name: string;
    shipKind: ShipKind;
    joinedAt: number;
}

export interface Message {
    id: string;
    authorId: string;
    text: string;
    replyToId?: string;
    sentAt: string;
}

/** Порция символов для передачи азбукой Морзе; seq делает каждую порцию уникальной. */
export interface MorseFeed {
    seq: number;
    text: string;
}

export const SHIP_KIND_LABELS: Record<ShipKind, string> = {
    patrol: 'Сторожевой катер',
    missile: 'Ракетный катер',
    minesweeper: 'Тральщик',
    corvette: 'Малый противолодочный корабль',
    torpedo: 'Торпедный катер',
};
