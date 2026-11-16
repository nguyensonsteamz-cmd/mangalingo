import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { SidePanel } from './SidePanel';
import { AuthGate } from '@/ui/AuthGate';
import { send } from '@/shared/messages';

installGlassMotion();

createRoot(document.getElementById('root')!).render(
  <AuthGate goToSetup={() => void send({ type: 'options:open', section: 'setup' }).catch(() => {})}>
    <SidePanel />
  </AuthGate>,
);
