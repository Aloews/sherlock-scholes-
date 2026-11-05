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
//        • /quiz -> интерактивная чат-игра через Telegram Rich Messages.
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

import { createQuizCallback, formatQuizFacts, parseQuizCallback, parseQuizRound, questionRichBlocks, resultRichBlocks, type QuizRound } from "./rich-quiz.ts";

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

/**
 * ⚠️ СРОК У КАЖДОГО ОБРАЩЕНИЯ НАРУЖУ, И ОН СТАВИТСЯ ОДИН РАЗ НА ВЕСЬ МОДУЛЬ.
 *
 * Запрос без срока НЕ ПАДАЕТ — он висит. Висящий сборщик неотличим от
 * работающего, и ровно этим ночной обход шёл 3 ч 36 мин при бюджете 80 минут;
 * разбор — в CLAUDE.md, «Прогон по расписанию обязан уметь краснеть».
 *
 * ⚠️ ЗАТЕНЕНИЕ `fetch`, А НЕ ПРАВКА КАЖДОГО ВЫЗОВА. Мест вызова в Edge-функциях
 * этого проекта тридцать три; поправить их по одному значит оставить без срока
 * тридцать четвёртый, дописанный завтра. Здесь же новый вызов получает срок
 * просто потому, что написан в этом файле.
 *
 * Свой `signal` у вызова ПОБЕЖДАЕТ: `init.signal ?? …` — то есть место, которому
 * нужен другой срок или отмена по своей причине, ничего не теряет.
 *
 * Двадцать секунд с запасом покрывают любой здоровый ответ: замеры
 * соседних функций — 164–2600 мс.
 */
const FETCH_MS = 20_000;
const bareFetch = globalThis.fetch;
const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
  bareFetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(FETCH_MS) });

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

type QuizSession = {
  session_key: string;
  chat_id: number;
  created_by: number;
  message_id: number | null;
  language_code: string;
  answer_id: string;
  facts: Record<string, unknown>;
  options: { id: string; name: string }[];
  chosen_option_id: string | null;
  answered_at: string | null;
  expires_at: string;
};

async function quizTable(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      ...(init.headers ?? {}),
    },
  });
}

function newQuizSessionKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchQuizRound(): Promise<QuizRound | null> {
  const response = await rpc("quiz_player_round", {});
  if (!response.ok) {
    console.error("[tg-pay] quiz_player_round failed", response.status, await response.text().catch(() => ""));
    return null;
  }
  return parseQuizRound(await response.json().catch(() => null));
}

async function createQuizSession(
  chatId: number,
  createdBy: number,
  language: string,
  messageId: number | null = null,
): Promise<{ key: string; round: QuizRound } | null> {
  const round = await fetchQuizRound();
  if (!round) return null;

  const key = newQuizSessionKey();
  const now = Date.now();
  const expiresAt = new Date(now + 30 * 60_000).toISOString();
  const response = await quizTable("telegram_chat_quiz_sessions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      session_key: key,
      chat_id: chatId,
      created_by: createdBy,
      message_id: messageId,
      language_code: language.toLowerCase().startsWith("ru") ? "ru" : "en",
      answer_id: round.answer_id,
      facts: round.facts,
      options: round.options,
      expires_at: expiresAt,
    }),
  });
  if (!response.ok) {
    console.error("[tg-pay] quiz session insert failed", response.status, await response.text().catch(() => ""));
    return null;
  }
  void quizTable(`telegram_chat_quiz_sessions?expires_at=lt.${encodeURIComponent(new Date(now).toISOString())}`, {
    method: "DELETE",
  }).catch(() => undefined);
  return { key, round };
}

function quizQuestionText(round: QuizRound, language: string): string {
  const ru = language.toLowerCase().startsWith("ru");
  return [
    ru ? "Угадай футболиста" : "Guess the player",
    ru ? "Кто это? Выбери один вариант." : "Who is it? Choose one option.",
    ...formatQuizFacts(round.facts, language),
  ].join("\n");
}

function quizQuestionKeyboard(round: QuizRound, key: string): Record<string, unknown> {
  return {
    inline_keyboard: round.options.map((option) => [{
      text: option.name,
      callback_data: createQuizCallback("answer", key, round.options.indexOf(option)),
    }]),
  };
}

async function ensureQuizCallbackUpdates(): Promise<boolean> {
  if (!BOT_TOKEN || !TG_WEBHOOK_SECRET || !SUPABASE_URL) return false;

  const info = await tg("getWebhookInfo", {});
  if (info.ok !== true || !info.result || typeof info.result.url !== "string") {
    console.error("[tg-pay] cannot inspect current Telegram webhook", info.description);
    return false;
  }

  const webhook = info.result as {
    url: string;
    allowed_updates?: string[];
    has_custom_certificate?: boolean;
    max_connections?: number;
    ip_address?: string;
  };
  const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
  const supportedUrls = new Set([
    `https://${projectRef}.functions.supabase.co/tg-pay`,
    `${SUPABASE_URL.endsWith("/") ? SUPABASE_URL.slice(0, -1) : SUPABASE_URL}/functions/v1/tg-pay`,
  ]);

  // Never repoint a bot whose webhook belongs to another service.
  if (!supportedUrls.has(webhook.url)) {
    console.error("[tg-pay] refusing to modify a webhook owned by another endpoint", webhook.url);
    return false;
  }
  if (webhook.has_custom_certificate) {
    console.error("[tg-pay] custom-certificate webhook requires a manual allowed_updates change");
    return false;
  }

  // An omitted list means Telegram's default update set, which already includes callback_query.
  const allowed = webhook.allowed_updates;
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.includes("callback_query")) return true;

  const updated = await tg("setWebhook", {
    url: webhook.url,
    secret_token: TG_WEBHOOK_SECRET,
    allowed_updates: [...new Set([...allowed, "callback_query"])],
    ...(typeof webhook.max_connections === "number" ? { max_connections: webhook.max_connections } : {}),
    ...(typeof webhook.ip_address === "string" ? { ip_address: webhook.ip_address } : {}),
  });
  if (updated.ok !== true) {
    console.error("[tg-pay] could not enable callback_query webhook updates", updated.description);
    return false;
  }
  return true;
}

async function sendQuizQuestion(chatId: number, createdBy: number, language: string): Promise<void> {
  if (!await ensureQuizCallbackUpdates()) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: language.toLowerCase().startsWith("ru")
        ? "Чат-игра пока недоступна: не удалось безопасно проверить настройки Telegram webhook."
        : "Chat quiz is unavailable because the Telegram webhook could not be safely verified.",
    });
    return;
  }

  const session = await createQuizSession(chatId, createdBy, language);
  if (!session) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: language.toLowerCase().startsWith("ru")
        ? "Сейчас не удалось загрузить вопрос. Попробуй ещё раз."
        : "The question could not be loaded. Please try again.",
    });
    return;
  }

  const rich = await tg("sendRichMessage", {
    chat_id: chatId,
    rich_message: { blocks: questionRichBlocks(session.round, session.key, language) },
  });
  const messageId = (rich.result as { message_id?: number } | undefined)?.message_id;
  if (rich.ok === true && typeof messageId === "number") {
    const saved = await quizTable(`telegram_chat_quiz_sessions?session_key=eq.${session.key}`, {
      method: "PATCH",
      body: JSON.stringify({ message_id: messageId }),
    });
    if (!saved.ok) console.error("[tg-pay] quiz message id write failed", saved.status);
    return;
  }

  console.warn("[tg-pay] sendRichMessage unavailable; using inline-keyboard fallback", rich.description);
  const fallback = await tg("sendMessage", {
    chat_id: chatId,
    text: quizQuestionText(session.round, language),
    reply_markup: quizQuestionKeyboard(session.round, session.key),
  });
  const fallbackId = (fallback.result as { message_id?: number } | undefined)?.message_id;
  if (fallback.ok === true && typeof fallbackId === "number") {
    await quizTable(`telegram_chat_quiz_sessions?session_key=eq.${session.key}`, {
      method: "PATCH",
      body: JSON.stringify({ message_id: fallbackId }),
    });
  }
}

async function loadQuizSession(key: string, chatId: number, messageId: number): Promise<QuizSession | null> {
  const params = new URLSearchParams({
    select: "session_key,chat_id,created_by,message_id,language_code,answer_id,facts,options,chosen_option_id,answered_at,expires_at",
    session_key: `eq.${key}`,
    chat_id: `eq.${chatId}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  const response = await quizTable(`telegram_chat_quiz_sessions?${params.toString()}`);
  if (!response.ok) {
    console.error("[tg-pay] quiz session read failed", response.status, await response.text().catch(() => ""));
    return null;
  }
  const rows = await response.json().catch(() => []) as QuizSession[];
  const session = rows[0];
  if (!session) return null;
  // Telegram can deliver a button tap before sendRichMessage's response has
  // been persisted. Claim the message id on the first callback to close that
  // small send/insert race; subsequent callbacks must match it exactly.
  if (session.message_id === null) {
    const claim = await quizTable(
      `telegram_chat_quiz_sessions?session_key=eq.${key}&message_id=is.null`,
      { method: "PATCH", body: JSON.stringify({ message_id: messageId }) },
    );
    if (!claim.ok) return null;
    session.message_id = messageId;
  }
  return session.message_id === messageId ? session : null;
}

async function editQuizQuestion(chatId: number, messageId: number, round: QuizRound, key: string, language: string): Promise<void> {
  const rich = await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    rich_message: { blocks: questionRichBlocks(round, key, language) },
  });
  if (rich.ok === true) return;
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: quizQuestionText(round, language),
    reply_markup: quizQuestionKeyboard(round, key),
  });
}

async function editQuizResult(chatId: number, messageId: number, session: QuizSession, correct: boolean, answerName: string): Promise<void> {
  const rich = await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    rich_message: { blocks: resultRichBlocks(correct, answerName, session.session_key, session.language_code) },
  });
  if (rich.ok === true) return;
  const ru = session.language_code.startsWith("ru");
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: correct
      ? (ru ? `Верно! Это ${answerName}.` : `Correct! The answer is ${answerName}.`)
      : (ru ? `Не угадал. Это ${answerName}.` : `Not quite. The answer is ${answerName}.`),
    reply_markup: {
      inline_keyboard: [[{
        text: ru ? "Следующий вопрос" : "Next question",
        callback_data: createQuizCallback("next", session.session_key),
      }]],
    },
  });
}

async function handleQuizCallback(query: Record<string, unknown>): Promise<void> {
  const callbackId = query.id;
  const data = parseQuizCallback(query.data);
  const message = query.message as { message_id?: number; chat?: { id?: number } } | undefined;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const from = query.from as { id?: number } | undefined;
  if (typeof callbackId === "string") {
    await tg("answerCallbackQuery", {
      callback_query_id: callbackId,
      ...(!data ? { text: "This action is no longer available." } : {}),
    });
  }
  if (!data || typeof chatId !== "number" || typeof messageId !== "number") return;

  const session = await loadQuizSession(data.sessionKey, chatId, messageId);
  if (!session) return;
  const language = session.language_code;

  if (data.action === "answer") {
    if (session.answered_at) return;
    const selected = typeof data.optionIndex === "number" ? session.options[data.optionIndex] : undefined;
    if (!selected) return;

    const params = new URLSearchParams({
      session_key: `eq.${session.session_key}`,
      chat_id: `eq.${chatId}`,
      message_id: `eq.${messageId}`,
      answered_at: "is.null",
      expires_at: `gt.${new Date().toISOString()}`,
      select: "session_key",
    });
    const saved = await quizTable(`telegram_chat_quiz_sessions?${params.toString()}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ chosen_option_id: selected.id, answered_at: new Date().toISOString() }),
    });
    if (!saved.ok) {
      console.error("[tg-pay] quiz answer write failed", saved.status, await saved.text().catch(() => ""));
      return;
    }
    const changed = await saved.json().catch(() => []) as { session_key: string }[];
    if (changed.length === 0) return;
    const answer = session.options.find((option) => option.id === session.answer_id);
    if (!answer) return;
    await editQuizResult(chatId, messageId, session, selected.id === session.answer_id, answer.name);
    return;
  }

  if (!session.answered_at) return;
  const next = await createQuizSession(chatId, typeof from?.id === "number" ? from.id : session.created_by, language, messageId);
  if (!next) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: language.startsWith("ru")
        ? "Не удалось загрузить следующий вопрос. Попробуй ещё раз."
        : "Could not load the next question. Please try again.",
    });
    return;
  }
  await editQuizQuestion(chatId, messageId, next.round, next.key, language);
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

    // Rich-message answer buttons arrive as callback_query updates.
    if (update.callback_query) {
      await handleQuizCallback(update.callback_query as Record<string, unknown>);
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

    // Text commands are read only after payment updates have been handled.
    const text = update.message?.text;
    const chatId = update.message?.chat?.id;

    // Chat-native quiz: structured Telegram Rich Message with callback actions.
    if (typeof text === "string" && /^\/quiz(?:@\w+)?(?:\s|$)/i.test(text) && typeof chatId === "number") {
      await sendQuizQuestion(chatId, update.message?.from?.id ?? chatId, update.message?.from?.language_code ?? "");
      return new Response("ok");
    }

    // Приглашение: `/start <КОД>`. Стоит после платёжных веток намеренно —
    // деньги важнее и не должны ждать разбора текста.
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
