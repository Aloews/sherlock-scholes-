import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initI18n } from './shared/i18n';
import { initAnalytics } from './shared/lib/analytics';

// Init Telegram Analytics before the app renders (no-op without a token).
initAnalytics();

// ⚠️ ЖДЁМ ЯЗЫК ДО ПЕРВОГО КАДРА. Локали больше не лежат в главном бандле (все
// девять весили 352 КБ из 933 — см. шапку shared/i18n), и свою игрок догружает
// отдельным файлом. Рендер без этого ожидания дал бы вспышку русского текста
// перед испанским; на загрузочном экране, который и так показывается, лишние
// сто миллисекунд не видны, а вспышка видна всем.
void initI18n().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
