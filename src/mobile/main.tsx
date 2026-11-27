// The chrome.* shim and the in-page router must be installed before the UI modules load.
import './shim';
import './translator-shim';
import './engine';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { installReaderBridge } from './reader-install';
import { App } from './App';
import { startWidgetAutoSync } from './WidgetCard';
import { startAppThemeSync } from './app-theme';
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
  startWidgetAutoSync(); // words saved here (Lưu, Đã lưu, Ghi chú) reach the widget even while the main page is covered
} else {
  installReaderBridge(); // the in-app Web Reader asks this page's engine to translate
  start();
}

function start() {

  createRoot(document.getElementById('root')!).render(<App />);
  startAppThemeSync(); // the Web Reader takes the same theme as the app
}
