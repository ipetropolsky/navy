import { describe, expect, test } from 'vitest';

import {
    MIN_LIGHT_GAP,
    SHIP_SPRITES,
    ShipLights,
    ShipSprite,
    SpritePoint,
    hasTwoLights,
} from '@/components/ships/shipSprites';
import { SHIP_KINDS, ShipKind } from '@/types/channel';

/**
 * Отметки на спрайтах. Ставят их глазами — открыл картинку, навёл курсор, переписал числа, —
 * и глазами же проверяют, что огонь сидит на мачте, а не висит в воздухе. Но часть требований
 * к ним чисто счётная: горящие разом огни должны быть различимы по отдельности, второй топовый
 * стоит выше и позади первого, носовой якорный — выше кормового. Это и меряем: в кадре такое
 * пришлось бы разглядывать в пятне размером с пиксель.
 */

type LightName = keyof ShipLights;

/**
 * Какие огни горят разом — тем же набором, что зажигает Ship.tsx. Сигнальная лампа в обоих
 * списках: морзянку передают и на ходу, и на якоре.
 */
const LIT: Record<'underway' | 'anchored', (kind: ShipKind) => LightName[]> = {
    underway: (kind) => [
        'signal',
        'masthead',
        'side',
        'stern',
        ...(hasTwoLights(kind) ? (['mastheadAft'] as const) : []),
    ],
    anchored: (kind) => ['signal', 'anchorFore', ...(hasTwoLights(kind) ? (['anchorAft'] as const) : [])],
};

/** Расстояние между отметками в долях ширины корабля: спрайт вписан по ширине без искажения. */
const gap = (a: SpritePoint, b: SpritePoint, sprite: ShipSprite): number =>
    Math.hypot(a.x - b.x, a.y - b.y) / sprite.size.width;

const kinds = SHIP_KINDS;

describe('огни на спрайтах', () => {
    test('горящие разом огни не сливаются в одно пятно', () => {
        for (const kind of kinds) {
            const sprite = SHIP_SPRITES[kind];
            for (const mode of ['underway', 'anchored'] as const) {
                const lit = LIT[mode](kind);
                for (let i = 0; i < lit.length; i++) {
                    for (let j = i + 1; j < lit.length; j++) {
                        const [one, two] = [lit[i], lit[j]];
                        const share = gap(sprite.lights[one], sprite.lights[two], sprite);
                        expect(share, `${kind}, ${mode}: ${one} и ${two}`).toBeGreaterThanOrEqual(MIN_LIGHT_GAP);
                    }
                }
            }
        }
    });

    test('второй топовый выше и позади первого', () => {
        // Спрайты нарисованы носом влево, поэтому «позади» — это правее. Правило не украшение:
        // по паре топовых с берега понимают, куда корабль идёт, а по их разносу — какой он длины.
        for (const kind of kinds.filter(hasTwoLights)) {
            const { masthead, mastheadAft } = SHIP_SPRITES[kind].lights;
            expect(mastheadAft.y, `${kind}: второй топовый ниже первого`).toBeLessThan(masthead.y);
            expect(mastheadAft.x, `${kind}: второй топовый впереди первого`).toBeGreaterThan(masthead.x);
        }
    });

    test('носовой якорный выше кормового и ближе к носу', () => {
        for (const kind of kinds.filter(hasTwoLights)) {
            const { anchorFore, anchorAft } = SHIP_SPRITES[kind].lights;
            expect(anchorFore.y, `${kind}: носовой якорный ниже кормового`).toBeLessThan(anchorAft.y);
            expect(anchorFore.x, `${kind}: носовой якорный позади кормового`).toBeLessThan(anchorAft.x);
        }
    });

    test('ходовые огни стоят там, куда светят', () => {
        for (const kind of kinds) {
            const { size, lights } = SHIP_SPRITES[kind];
            const { masthead, side, stern } = lights;
            // Топовый светит вперёд, кормовой — назад, и стоят они по разные стороны корабля.
            expect(masthead.x, `${kind}: топовый позади кормового`).toBeLessThan(stern.x);
            expect(stern.x, `${kind}: кормовой не у кормы`).toBeGreaterThan(size.width * 0.7);
            // Бортовой ставят на крыле мостика — ниже топового, поднятого на мачту.
            expect(side.y, `${kind}: бортовой выше топового`).toBeGreaterThan(masthead.y);
        }
    });

    test('все отметки лежат внутри картинки', () => {
        // Отметки переводятся в доли размера, и вылет за край не сломает разметку, а тихо
        // унесёт огонь за силуэт — заметить это в сцене куда труднее, чем сравнить два числа.
        for (const kind of kinds) {
            const { size, hullNumber, lights } = SHIP_SPRITES[kind];
            const points: [string, SpritePoint][] = [
                ['hullNumber', hullNumber],
                ...(Object.keys(lights) as LightName[]).map((name): [string, SpritePoint] => [name, lights[name]]),
            ];
            for (const [name, point] of points) {
                expect(point.x, `${kind}, ${name}: x за краем`).toBeGreaterThanOrEqual(0);
                expect(point.x, `${kind}, ${name}: x за краем`).toBeLessThanOrEqual(size.width);
                expect(point.y, `${kind}, ${name}: y за краем`).toBeGreaterThanOrEqual(0);
                expect(point.y, `${kind}, ${name}: y за краем`).toBeLessThanOrEqual(size.height);
            }
        }
    });
});
