import { createRoot } from 'react-dom/client';

import App from '@/App';
import { ShadeStack } from '@/components/ui/ShadeStack';
import { SnackbarProvider } from '@/components/ui/Snackbar';
import { TIME_SCALE } from '@/config/time';

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
