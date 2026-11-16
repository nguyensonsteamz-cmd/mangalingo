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

installGlassMotion();
installReaderBridge(); // the in-app Web Reader asks this page's engine to translate
document.documentElement.dataset.app = 'mobile'; // edge-to-edge layout rules in styles.css

// iPhone: Google sign-in is required before the app can be used (Chrome has the same gate; Android is unchanged for now)
const needsSignIn = (globalThis as { MangaLingoPlatform?: string }).MangaLingoPlatform === 'ios';
const goToSetup = () => {
  (globalThis as { __mlNextSettingsSection?: string }).__mlNextSettingsSection = 'setup';
  window.dispatchEvent(new Event('ml-settings-section'));
  location.hash = 'settings';
};

createRoot(document.getElementById('root')!).render(needsSignIn ? <AuthGate goToSetup={goToSetup}><App /></AuthGate> : <App />);
