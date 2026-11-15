import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { SidePanel } from './SidePanel';

installGlassMotion();

createRoot(document.getElementById('root')!).render(<SidePanel />);
