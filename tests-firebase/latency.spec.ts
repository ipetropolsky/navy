import { Page, expect } from '@playwright/test';

import { bubbles, createChannel, join, newTab, openChannel, send, signIn, takes, test } from '@tests-firebase/helpers';

/**
 * Задержка между отправкой и появлением у соседа — замером, а не впечатлением
 * (docs/FIREBASE.md, «Онлайн: из чего складывается задержка», «Проверки»): своя реплика встаёт
 * в ленту в том же кадре (это не про сеть, а про локальное эхо Firestore — и уже проверено
 * в errors.spec.ts значком «доставляется»), а вот сколько идёт до соседней вкладки — вопрос
 * к настоящей сети и настоящему Firestore, и ответ на него — число, а не «должно быть быстро».
 */

/**
 * Отправить реплику в одной вкладке и дождаться её в другой — вернуть время между этим
 * в миллисекундах. Метка времени берётся снаружи, в самой проверке, а не внутри вкладок:
 * обеим страницам, в отличие от часов теста, не нужно быть синхронными друг с другом,
 * а вот с тем, что меряет их разницу, — обязательно, и часы самой проверки для обеих вкладок
 * одни и те же.
 */
const measureLatency = async (from: Page, to: Page, text: string): Promise<number> => {
    const sentAt = Date.now();
    await send(from, text);
    await expect(bubbles(to).last(), `реплика «${text}» не дошла до соседней вкладки`).toContainText(text, {
        timeout: 10_000,
    });
    return Date.now() - sentAt;
};

/**
 * Порог — замер, а не догадка (тот же принцип, что и у `takes` в tests-firebase/helpers.ts):
 * прогнано `E2E_ARGS='--repeat-each=10 -g "задержка до соседней вкладки"'` поверх эмулятора,
 * а потом ещё восемь прогонов тем же способом — восемнадцать заходов, по три обмена репликами
 * в каждом. Обычная худшая реплика в заходе — 260–380 мс, и такой она была в пятнадцати
 * заходах из восемнадцати; в трёх — 835, 846 и 905 мс.
 *
 * Три выброса из восемнадцати — это не разовая случайность, а разброс, и ловить порог должен
 * именно его. Взят худший из наблюдённых (905 мс) с запасом почти вдвое, округлённым до сотни:
 * порог ниже — и проверка мигала бы примерно каждый шестой прогон, ничего при этом не утверждая
 * про приложение.
 */
const LATENCY_THRESHOLD_MS = 1_500;

test('задержка до соседней вкладки — замер', async ({ browser }) => {
    // Долгого тут — два входа по WRITE_TIMEOUT + SAIL_TIMEOUT, ожидание, что вкладки увидели
    // друг друга, и три обмена репликами по десять секунд, — и общий срок стоит поверх их
    // суммы, тем же способом и по той же причине, что и в e2e.spec.ts.
    takes(85);

    const slug = `latency-${Date.now()}`;

    const pageA = await newTab(browser);
    await signIn(pageA, 'latency-uid-a', 'Экипаж А');
    await createChannel(pageA, 'Замер задержки', slug);
    await join(pageA, 'Гроза', '101');

    const pageB = await newTab(browser);
    await signIn(pageB, 'latency-uid-b', 'Экипаж Б');
    await openChannel(pageB, slug);
    await join(pageB, 'Отзвук', '202');

    // Обе вкладки видят друг друга, прежде чем мерить между ними задержку.
    await expect(pageA.getByText('Отзвук').first(), 'вторая вкладка не появилась в ленте первой').toBeVisible({
        timeout: 10_000,
    });

    // Три замера, не один: единственное число легко объяснить удачей или, наоборот, случайной
    // заминкой машины. В отчёт идёт каждый, а порог считается по худшему из них.
    const latencies: number[] = [];
    latencies.push(await measureLatency(pageA, pageB, `замер-1-${Date.now()}`));
    latencies.push(await measureLatency(pageB, pageA, `замер-2-${Date.now()}`));
    latencies.push(await measureLatency(pageA, pageB, `замер-3-${Date.now()}`));

    latencies.forEach((latency, index) => {
        // eslint-disable-next-line no-console -- число из задачи: замер, а не впечатление
        console.log(`[замер] реплика #${index + 1} дошла до соседней вкладки за ${latency} мс`);
    });
    const worst = Math.max(...latencies);
    // eslint-disable-next-line no-console -- число из задачи: замер, а не впечатление
    console.log(
        `[замер] худшая задержка из ${latencies.length} обменов — ${worst} мс (порог ${LATENCY_THRESHOLD_MS} мс)`
    );

    expect(worst, 'задержка вышла за порог, посчитанный по замеру (см. LATENCY_THRESHOLD_MS)').toBeLessThan(
        LATENCY_THRESHOLD_MS
    );

    await pageA.context().close();
    await pageB.context().close();
});
