import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

/**
 * Подпись Telegram — читается НА КАЖДЫЙ ЗАПРОС, а не один раз при запуске.
 *
 * ⚠️ РАНЬШЕ ОНА БРАЛАСЬ ОДИН РАЗ, И ЭТО БЫЛО ОШИБКОЙ С ОДНИМ ИСХОДОМ: пусто
 * навсегда. `telegram-web-app.js` грузится с telegram.org обычным тегом
 * script; он блокирует разбор страницы и обычно успевает — но если запрос к
 * telegram.org не прошёл (сеть, блокировка, холодный старт клиента), то
 * `window.Telegram` не появится к моменту, когда выполнится наш модуль, а
 * второй попытки у снимка нет. Заголовок не ставится НИКОГДА, и каждый
 * закрытый подпиской раздел отвечает 42501 — даже подписчику.
 *
 * Именно так «общий рейтинг» мог перестать грузиться сразу после того, как
 * ворота Pro переехали на сервер.
 *
 * Чтение при каждом запросе стоит одно обращение к полю объекта и снимает
 * весь этот класс поломок разом.
 */
function telegramSignature(): string {
  try {
    return (window as unknown as {
      Telegram?: { WebApp?: { initData?: string } };
    }).Telegram?.WebApp?.initData || '';
  } catch {
    return '';
  }
}

/**
 * ⚠️ ПОДПИСЬ ЕДЕТ ЗАГОЛОВКОМ, И ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ОНА СТАВИТСЯ.
 * Закрытые подпиской RPC зовут `require_pro()`, а тот читает
 * `request.headers ->> 'x-tg-init-data'`. Класть подпись параметром пришлось
 * бы в двадцать функций и в каждый вызов; заголовок ставится один раз здесь.
 *
 * ⚠️ ЭТО НЕ СЕКРЕТ, КОТОРЫЙ МЫ РАЗДАЁМ. initData подписана ботом и проверяется
 * на сервере (`tg_validate_init_data`); подделать её, не зная токена, нельзя —
 * проверено запросом с `hash=deadbeef`, ответ 401 `pro_required`.
 *
 * ⚠️ ЗАГОЛОВОК СО СЛОМАННЫМ ЗНАЧЕНИЕМ НЕ СТАВИТСЯ ВОВСЕ. `Headers.set`
 * бросает на значении вне ASCII, и непойманное исключение убило бы ЛЮБОЙ
 * запрос, а не только закрытый: экран остался бы пустым целиком, вместо того
 * чтобы честно упереться в подписку.
 */
const fetchWithSignature: typeof fetch = (input, init) => {
  const opts = init ?? {};
  const headers = new Headers(opts.headers);
  const sig = telegramSignature();
  if (sig) {
    try {
      headers.set('x-tg-init-data', sig);
    } catch {
      /* значение не проходит в заголовок — едем без него, как вне Telegram */
    }
  }
  return fetch(input, { ...opts, headers });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithSignature },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
