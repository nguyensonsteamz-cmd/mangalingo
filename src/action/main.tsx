import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { ActionPopup } from './ActionPopup';

installGlassMotion();

createRoot(document.getElementById('root')!).render(<ActionPopup />);
