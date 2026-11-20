import '@fontsource/press-start-2p/400.css';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/vt323/400.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './styles/booth.css';
import './styles/admin.css';
import { AdminApp } from './admin/AdminApp';
import { BoothApp } from './booth/BoothApp';

// Dua rute dalam satu project: /booth (monitor tamu) dan /admin (laptop operator).
const isBooth = location.pathname.replace(/\/+$/, '') === '/booth';
document.title = isBooth ? 'Photobooth - Guest Display' : 'Photobooth - Control Room';

createRoot(document.getElementById('root')!).render(<StrictMode>{isBooth ? <BoothApp /> : <AdminApp />}</StrictMode>);
