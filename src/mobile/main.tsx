// The chrome.* shim and the in-page router must be installed before the UI modules load.
import './shim';
import './translator-shim';
import './engine';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { installReaderBridge } from './reader-install';
import { App } from './App';
import { AuthGate } from '@/ui/AuthGate';
import { SidePanel } from '@/sidepanel/SidePanel';
import { send } from '@/shared/messages';

installGlassMotion();
document.documentElement.dataset.app = 'mobile'; // edge-to-edge layout rules in styles.css

// The Web Reader's sidebar: the same page, opened by the native Reader in a second web view at #reader-sidebar. It shows only the
// extension's sidebar (Dịch / Từ vựng / Ngữ pháp / Ngữ cảnh / Đã lưu / Ghi chú) and receives its content from the native side.
if (location.hash.startsWith('#reader-sidebar')) {
  const g = globalThis as { __mlSidebar?: (p: unknown) => Promise<unknown>; __mlSidebarTab?: (t: string) => void; __mlNextSidebarTab?: string };
  g.__mlSidebar = (payload) => send({ type: 'sidebar:push', payload: payload as never });
  g.__mlSidebarTab = (t) => {
    g.__mlNextSidebarTab = t;
    window.dispatchEvent(new Event('ml-sidebar-tab'));
  };
  createRoot(document.getElementById('root')!).render(<SidePanel />);
} else {
  installReaderBridge(); // the in-app Web Reader asks this page's engine to translate
  start();
}

function start() {

  // iPhone: Google sign-in is required before the app can be used (Chrome has the same gate; Android is unchanged for now)
  const needsSignIn = (globalThis as { MangaLingoPlatform?: string }).MangaLingoPlatform === 'ios';
  const goToSetup = () => {
    (globalThis as { __mlNextSettingsSection?: string }).__mlNextSettingsSection = 'setup';
    window.dispatchEvent(new Event('ml-settings-section'));
    location.hash = 'settings';
  };

  createRoot(document.getElementById('root')!).render(needsSignIn ? <AuthGate goToSetup={goToSetup}><App /></AuthGate> : <App />);
}
