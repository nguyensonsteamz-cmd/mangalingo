import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { SettingsCenter } from './SettingsCenter';
import { AuthGate } from '@/ui/AuthGate';

installGlassMotion();

createRoot(document.getElementById('root')!).render(
  <AuthGate goToSetup={() => (location.hash = 'setup')}>
    <SettingsCenter />
  </AuthGate>,
);
