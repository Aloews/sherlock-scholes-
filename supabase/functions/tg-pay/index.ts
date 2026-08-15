// ============================================================================
// tg-pay — Telegram Stars payment for Sherlock Scholes Pro (one-time purchase).
//
// ONE endpoint, TWO roles, distinguished by the request itself:
//
//   1) FRONTEND invoice request — POST { action: "create_invoice", initData }
//      (no Telegram secret header). We validate the Mini App initData
//      SERVER-SIDE (via the get_user_status RPC, which checks the HMAC against
//      the bot token in Vault), then createInvoiceLink and return { link }.
//
//   2) TELEGRAM webhook update — POST carrying the header
//        X-Telegram-Bot-Api-Secret-Token == TG_WEBHOOK_SECRET
//      (set when we call setWebhook). We:
//        • pre_checkout_query   -> answerPreCheckoutQuery(ok: true)
//        • successful_payment   -> grant_pro(PAY_WEBHOOK_SECRET, payer_id)
//        • /start <код комнаты> -> ответ кнопкой, открывающей Mini App в этой
//          комнате. См. handleStart() ниже — это половина приглашений.
//
// SECURITY:
//   • The secret header proves the update really came from Telegram. Without a
//     matching header we NEVER grant Pro.
//   • Pro is granted to message.from.id — the Telegram-authenticated payer —
//     never to a client-supplied id.
//   • grant_pro runs with the service_role key + pay_webhook_secret and is
//     idempotent, so a re-delivered "successful_payment" is harmless.
//   • Bot token + both secrets live in `supabase secrets`, NOT the repo.
//   • Currency is XTR (Telegram Stars): no provider_token, the price is
//     server-authoritative (env PRO_PRICE_STARS), never trusted from the client.
//
// Deploy / setWebhook: see ./README.md
// ============================================================================

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// Echoed by Telegram on every webhook update (set via setWebhook secret_token).
const TG_WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET") ?? "";
// The secret grant_pro requires to authorize a grant (already in prod/Vault).
const PAY_WEBHOOK_SECRET = Deno.env.get("PAY_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Keep in sync with src/shared/lib/pro.ts (PRO_PRICE_STARS). Server-authoritative,
// overridable via secret so the price can change without a redeploy.
const PRO_PRICE_STARS = Number(Deno.env.get("PRO_PRICE_STARS") ?? "199");
// Адрес самого приложения. Нужен для web_app-кнопки в ответе на /start.
const APP_URL = Deno.env.get("APP_URL") ?? "https://sherlock-scholes.vercel.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// --- Telegram Bot API helper ---
async function tg(method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await r.json();
}

// --- PostgREST RPC helper (service_role) ---
async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(args),
  });
}

// Validate Mini App initData server-side and return the Telegram id (or null).
// get_user_status raises 28000 on a bad signature -> non-2xx here.
async function validateInitData(initData: string): Promise<number | null> {
  const r = await rpc("get_user_status", { p_init_data: initData });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return typeof data?.telegram_id === "number" ? data.telegram_id : null;
}

// Grant Pro to the authenticated payer. Idempotent on the DB side.
// NOTE: param names below must match the deployed grant_pro signature
//       (assumed grant_pro(p_secret text, p_telegram_id bigint)).
async function grantPro(telegramId: number): Promise<boolean> {
  const r = await rpc("grant_pro", {
    p_secret: PAY_WEBHOOK_SECRET,
    p_telegram_id: telegramId,
  });
  if (!r.ok) {
    console.error("[tg-pay] grant_pro failed", r.status, await r.text().catch(() => ""));
  }
  return r.ok;
}

/**
 * Ответ на `/start <КОД>` — кнопка, открывающая игру сразу в комнате.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ ЕСТЬ. Приглашения раньше уходили ссылкой
 * `t.me/<бот>?startapp=КОД`, и на Android она отвечала `BOT_INVALID`: эта форма
 * требует включённого Main Mini App, а у бота его нет. Форма `?start=КОД`
 * требований не предъявляет никаких — это обычная команда боту, — и приводит
 * сюда. Одно лишнее касание вместо неработающей ссылки.
 *
 * КОД ЕДЕТ В URL КНОПКИ, а не в start_param: кнопка web_app открывает
 * произвольный адрес, и приложение читает `?room=` из своего location.search.
 * start_param существует только у startapp-ссылок, то есть ровно у той формы,
 * которая здесь не работает.
 *
 * Код НЕ ПРОВЕРЯЕТСЯ на существование комнаты, и это осознанно: бот не ходит в
 * базу ради кнопки, а приложение всё равно проверяет код при входе и говорит
 * «комнаты нет» само. Формат — да: шесть букв и цифр, чтобы в URL не уехало
 * произвольное содержимое чужого сообщения.
 */
async function handleStart(chatId: number, text: string, lang: string): Promise<void> {
  const raw = text.trim().split(/\s+/)[1] ?? "";
  const code = /^[A-Za-z0-9]{6}$/.test(raw) ? raw.toUpperCase() : "";
  const ru = lang.startsWith("ru");

  if (!code) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: ru ? "Открывай игру кнопкой ниже." : "Open the game with the button below.",
      reply_markup: {
        inline_keyboard: [[{
          text: ru ? "Играть" : "Play",
          web_app: { url: APP_URL },
        }]],
      },
    });
    return;
  }

  await tg("sendMessage", {
    chat_id: chatId,
    text: ru ? `Комната ${code}. Заходи:` : `Room ${code}. Join:`,
    reply_markup: {
      inline_keyboard: [[{
        text: ru ? `Войти в комнату ${code}` : `Join room ${code}`,
        web_app: { url: `${APP_URL}/?room=${encodeURIComponent(code)}` },
      }]],
    },
  });
}

/**
 * Разбудить спящую базу, пока человек ещё смотрит на кнопку.
 *
 * ТА ЖЕ ЗАДАЧА, ЧТО У wakeSupabase НА ГЛАВНОМ ЭКРАНЕ, но на несколько секунд
 * раньше. База на бесплатном тарифе засыпает, и первый запрос после сна стоит
 * секунды — их платит тот, кто открыл приложение. А между «/start» и нажатием
 * кнопки как раз проходит пара секунд: если разбудить здесь, к моменту
 * открытия она уже горячая, и первый экран рисуется сразу.
 *
 * НЕ ЖДЁМ ОТВЕТА. Ответ Telegram должен уйти немедленно — иначе разбудить
 * базу означало бы задержать сообщение ровно на то время, которое мы
 * экономим. Промис отдаётся waitUntil, чтобы среда не убила его вместе с
 * ответом; там, где waitUntil нет, он просто висит и гаснет сам.
 *
 * Запрос самый дешёвый из возможных: один id, без счётчика.
 */
function wakeDb(): void {
  const p = fetch(`${SUPABASE_URL}/rest/v1/cards?select=id&limit=1`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  }).then(() => undefined).catch(() => undefined);

  // EdgeRuntime есть в проде Supabase, но не в типах Deno.
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  rt?.waitUntil?.(p);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // ── Path 2: Telegram webhook update ──
  if (secretHeader !== null) {
    if (!TG_WEBHOOK_SECRET || secretHeader !== TG_WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    // Заголовок совпал — обращение настоящее, и только теперь можно тратить
    // на него работу. Прогрев ДО проверки секрета сделал бы из функции
    // бесплатный способ нагружать базу кому угодно.
    wakeDb();

    const update = await req.json().catch(() => null);
    if (!update) return new Response("ok"); // ignore garbage, ack to Telegram

    // Must approve the pre-checkout within seconds or the payment fails.
    if (update.pre_checkout_query) {
      await tg("answerPreCheckoutQuery", {
        pre_checkout_query_id: update.pre_checkout_query.id,
        ok: true,
      });
      return new Response("ok");
    }

    // Money received -> unlock Pro for the payer.
    const sp = update.message?.successful_payment;
    if (sp) {
      const payerId = update.message?.from?.id;
      if (typeof payerId === "number") {
        await grantPro(payerId);
        console.log("[tg-pay] granted Pro", payerId, sp.telegram_payment_charge_id);
      }
      return new Response("ok");
    }

    // Приглашение: `/start <КОД>`. Стоит после платёжных веток намеренно —
    // деньги важнее и не должны ждать разбора текста.
    const text = update.message?.text;
    const chatId = update.message?.chat?.id;
    if (typeof text === "string" && text.startsWith("/start") && typeof chatId === "number") {
      await handleStart(chatId, text, update.message?.from?.language_code ?? "");
      return new Response("ok");
    }

    return new Response("ok"); // other update types: nothing to do
  }

  // ── Path 1: frontend invoice request ──
  const body = await req.json().catch(() => null);
  const initData: string = body?.initData ?? "";
  if (!initData) return json({ error: "missing_init_data" }, 400);

  const id = await validateInitData(initData);
  if (!id) return json({ error: "invalid_init_data" }, 401);

  const res = await tg("createInvoiceLink", {
    title: "Sherlock Scholes Pro",
    description: "Легенды, полная колода и косметика — навсегда.",
    payload: `pro:${id}`,
    currency: "XTR", // Telegram Stars — no provider_token needed
    prices: [{ label: "Pro", amount: PRO_PRICE_STARS }],
  });

  if (!res?.ok || !res.result) {
    console.error("[tg-pay] createInvoiceLink failed", JSON.stringify(res));
    return json({ error: "invoice_failed" }, 502);
  }
  return json({ link: res.result });
});
