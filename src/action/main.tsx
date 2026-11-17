import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { ActionPopup } from './ActionPopup';
import { AuthGate } from '@/ui/AuthGate';
import { send } from '@/shared/messages';

installGlassMotion();

createRoot(document.getElementById('root')!).render(
  <AuthGate compact goToSetup={() => void send({ type: 'options:open', section: 'setup' }).catch(() => {})}>
    <ActionPopup />
  </AuthGate>,
);
