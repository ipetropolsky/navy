import { createRoot } from 'react-dom/client';

import App from '@/App';
import { SnackbarProvider } from '@/components/ui/Snackbar';

createRoot(document.getElementById('root')!).render(
    <SnackbarProvider>
        <App />
    </SnackbarProvider>
);
