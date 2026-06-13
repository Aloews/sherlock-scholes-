import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './shared/i18n';
import { initAnalytics } from './shared/lib/analytics';

// Init Telegram Analytics before the app renders (no-op without a token).
initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
