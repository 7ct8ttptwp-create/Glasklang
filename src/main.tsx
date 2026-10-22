import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { api } from './lib/api';
import './styles.css';

// Anything that goes wrong is written to a local crash.log (never sent anywhere).
window.addEventListener('error', (e) => void api.logError(`window error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => void api.logError(`unhandled rejection: ${String(e.reason)}`));

// Hide the browser context menu in the packaged app.
if (import.meta.env.PROD) document.addEventListener('contextmenu', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
