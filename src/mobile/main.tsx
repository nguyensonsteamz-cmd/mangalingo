// The chrome.* shim and the in-page router must be installed before the UI modules load.
import './shim';
import './engine';
import { createRoot } from 'react-dom/client';
import '@/ui/styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
