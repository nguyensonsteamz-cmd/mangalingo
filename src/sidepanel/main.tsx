import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { SidePanel } from './SidePanel';

createRoot(document.getElementById('root')!).render(<SidePanel />);
