import { createRoot } from 'react-dom/client';
// Виртуальный модуль подставляет vite-plugin-pwa на лету — линтер резолвит импорты по файлам
// на диске, и такого файла для него нет и не будет.
// eslint-disable-next-line import/no-unresolved
import { registerSW } from 'virtual:pwa-register';

import App from '@/App';
import { ShadeStack } from '@/components/ui/ShadeStack';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { TIME_SCALE } from '@/config/time';

/**
 * Ставим service worker, чтобы приложение можно было установить на телефон и на десктоп,
 * а не только держать вкладкой браузера. `registerSW` без параметров ничего не решает
 * за пользователя: новая версия скачивается в фоне и ждёт своей очереди (подробности —
 * в `vite.config.ts` у `registerType: 'prompt'`), а не подменяет собой открытый разговор.
 *
 * Проверка на `'serviceWorker' in navigator` не строго обязательна — `registerSW` делает
 * её сама, — но старые браузеры без поддержки не должны и пытаться грузить виртуальный модуль
 * плагина понапрасну.
 */
if ('serviceWorker' in navigator) {
    registerSW();
}

// Скорость времени — наружу, в стили: движение ведут пополам код и стили, и идти они обязаны
// по одной мерке. Ставится она до первой отрисовки и больше не меняется.
document.documentElement.style.setProperty('--time-scale', String(TIME_SCALE));

createRoot(document.getElementById('root')!).render(
    <SnackbarProvider>
        {/* Стопка шторок: кто над кем лежит и что случается, когда поверх открывают ещё одну. */}
        <ShadeStack>
            <App />
        </ShadeStack>
    </SnackbarProvider>
);
