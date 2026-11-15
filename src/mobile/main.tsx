// The chrome.* shim and the in-page router must be installed before the UI modules load.
import './shim';
import './engine';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { installGlassMotion } from '@/ui/motion';
import { App } from './App';

installGlassMotion();

createRoot(document.getElementById('root')!).render(<App />);
