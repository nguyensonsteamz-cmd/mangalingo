// The chrome.* shim and the in-page router must be installed before the UI modules load.
import './shim';
import './translator-shim';
import './engine';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { installReaderBridge } from './reader-install';
import { App } from './App';

installGlassMotion();
installReaderBridge(); // the in-app Web Reader asks this page's engine to translate
document.documentElement.dataset.app = 'mobile'; // edge-to-edge layout rules in styles.css

createRoot(document.getElementById('root')!).render(<App />);
