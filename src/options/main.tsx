import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { SettingsCenter } from './SettingsCenter';

installGlassMotion();

createRoot(document.getElementById('root')!).render(<SettingsCenter />);
