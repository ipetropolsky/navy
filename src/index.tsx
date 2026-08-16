import { createRoot } from 'react-dom/client';

import App from '@/App';
import { ShadeStack } from '@/components/ui/ShadeStack';
import { SnackbarProvider } from '@/components/ui/Snackbar';

createRoot(document.getElementById('root')!).render(
    <SnackbarProvider>
        {/* Стопка шторок: кто над кем лежит и что случается, когда поверх открывают ещё одну. */}
        <ShadeStack>
            <App />
        </ShadeStack>
    </SnackbarProvider>
);
