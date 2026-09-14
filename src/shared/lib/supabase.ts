import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

// ⚠️ ПОДПИСЬ TELEGRAM ЕДЕТ ЗАГОЛОВКОМ НА КАЖДОМ ЗАПРОСЕ, и это единственное
// место, где она ставится. Закрытые подпиской RPC зовут `require_pro()`, а тот
// читает `request.headers ->> 'x-tg-init-data'` — то есть ИМЕННО этот заголовок.
// Класть подпись параметром пришлось бы в двадцать функций и в каждый вызов;
// заголовок ставится один раз здесь.
//
// ⚠️ БЕРЁТСЯ ОДИН РАЗ, ПРИ СОЗДАНИИ КЛИЕНТА, И ЭТОГО ДОСТАТОЧНО: Telegram
// кладёт initData в `window.Telegram.WebApp` ДО того, как приложение
// смонтировано, и за сессию она не меняется. Вне Telegram её нет вовсе —
// заголовок тогда просто не ставится, и закрытые разделы честно отвечают
// отказом вместо того, чтобы притворяться доступными.
//
// ⚠️ ЭТО НЕ СЕКРЕТ, КОТОРЫЙ МЫ РАЗДАЁМ. initData подписана ботом и проверяется
// на сервере (`tg_validate_init_data`); подделать её, не зная токена, нельзя —
// проверено запросом с `hash=deadbeef`, ответ 401 `pro_required`.
const rawInitData = (() => {
  try {
    return (window as unknown as {
      Telegram?: { WebApp?: { initData?: string } };
    }).Telegram?.WebApp?.initData || '';
  } catch {
    return '';
  }
})();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: rawInitData ? { headers: { 'x-tg-init-data': rawInitData } } : undefined,
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
