import { createRoot } from 'react-dom/client';
import { EvoControls } from '@/app/admin/_components/evo-controls';
import { ConfirmProvider } from '@/app/admin/_components/confirm-dialog';
import { ToastProvider } from '@/app/admin/_components/toast';
import '@/app/admin/admin.css';

createRoot(document.getElementById('root')!).render(<div className="adm" style={{ padding: 16 }}><ToastProvider><ConfirmProvider><EvoControls engine="engine-a" /></ConfirmProvider></ToastProvider></div>);
