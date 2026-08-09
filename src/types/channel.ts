export type ShipKind = 'patrol' | 'missile' | 'minesweeper' | 'corvette' | 'torpedo';

/**
 * Корабль в канале. Позывной, бортовой номер, силуэт и цвет участник выбирает сам,
 * когда встаёт в строй; цветом подписаны его реплики в ленте.
 */
export interface Member {
    id: string;
    /** Позывной — он же название корабля. */
    name: string;
    /** Бортовой номер: ровно три цифры, белым по борту и вместо аватарки в чате. */
    hullNumber: string;
    shipKind: ShipKind;
    color: string;
    joinedAt: number;
}

export interface Message {
    id: string;
    /** Кто отправил. */
    memberId: string;
    text: string;
    /** Ответ: id сообщения, на которое отвечаем. */
    threadId?: string;
    /** Время отправки, мс эпохи. Формат для показа выбирает интерфейс, а не хранилище. */
    sentAt: number;
}

/** Порция символов для передачи азбукой Морзе; seq делает каждую порцию уникальной. */
export interface MorseFeed {
    seq: number;
    text: string;
}

export const SHIP_KINDS: ShipKind[] = ['patrol', 'missile', 'minesweeper', 'corvette', 'torpedo'];

export const SHIP_KIND_LABELS: Record<ShipKind, string> = {
    patrol: 'Сторожевой катер',
    missile: 'Ракетный катер',
    minesweeper: 'Тральщик',
    corvette: 'Малый противолодочный корабль',
    torpedo: 'Торпедный катер',
};

/**
 * Цвета позывных. Все читаются на тёмном фоне ленты и достаточно различимы между собой,
 * чтобы по одному цвету было понятно, кто говорит, ещё до чтения имени.
 */
export const MEMBER_COLORS = ['#8ecae6', '#f2cc8f', '#95d5b2', '#d8b4f8', '#f4978e'];

/** Номер строго из трёх цифр: он рисуется на борту, и место под него фиксированное. */
export const HULL_NUMBER_LENGTH = 3;
export const isValidHullNumber = (value: string): boolean => new RegExp(`^\\d{${HULL_NUMBER_LENGTH}}$`).test(value);
