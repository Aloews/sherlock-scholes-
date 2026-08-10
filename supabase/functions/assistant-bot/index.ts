// ============================================================================
// assistant-bot — a private Telegram assistant for the owner of this project.
//
// It is NOT the game's bot, and that separation is the whole security design.
// The Mini App's bot holds the payment webhook and the token that validates
// every player's initData; this one holds a model key and answers free-form
// questions. They share no secret: this reads ASSISTANT_BOT_TOKEN, tg-pay
// reads TELEGRAM_BOT_TOKEN, and `tg_validate_init_data` reads the Vault entry
// `telegram_bot_token`. Replacing any one of those with another is how the
// invoices break.
//
// ── The webhook secret nobody had to invent ────────────────────────────────
// Telegram echoes a `secret_token` back on every update, in
// X-Telegram-Bot-Api-Secret-Token, and that header is the only proof an update
// really came from Telegram — the URL itself is guessable. Rather than ask for
// a second secret and have it drift out of sync with setWebhook, the secret is
// DERIVED: sha256(ASSISTANT_BOT_TOKEN), hex. Two consequences worth stating:
//
//   * install and verify compute the same value from the same input, so they
//     cannot disagree. There is no "I set the webhook with the old secret".
//   * it is not the token. A leak of the header reveals a hash, and the bot
//     token stays a secret. Rotating the token rotates the webhook secret,
//     which means a rotation MUST be followed by another install — see below.
//
// ── Who it answers to ──────────────────────────────────────────────────────
// Trust on first use. The first account to write to a brand-new bot nobody
// else knows the name of is recorded as the owner, and after that the row is
// fixed. Everyone else is ignored in SILENCE: an "access denied" reply tells a
// stranger the bot is real and worth pushing on, whereas nothing at all is
// indistinguishable from a bot that does not exist. Rebinding is one DELETE
// against assistant_owner.
//
// ── Why it answers Telegram before it answers the owner ────────────────────
// Telegram retries a webhook it considers failed, and a model call is far
// slower than its patience. So the 200 goes out first and the work happens in
// EdgeRuntime.waitUntil(); the user sees a typing indicator in the meantime.
// Without this, one slow answer becomes four duplicate answers.
//
// Deploy / install: see ./README.md
// ============================================================================

// Declares `EdgeRuntime` (and Deno's Supabase-specific globals). Without it
// the waitUntil below is an undeclared name to any type-checker that looks.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const BOT_TOKEN = Deno.env.get("ASSISTANT_BOT_TOKEN") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** The model the assistant thinks with. */
const MODEL = "claude-opus-5";

/**
 * How much of the conversation is resent.
 *
 * The Messages API is stateless: every request carries the history, and the
 * history is the entire memory. Twenty turns is roughly a working session and
 * a bounded prompt — the table keeps everything, this only bounds what is
 * replayed.
 */
const HISTORY_TURNS = 20;

/** Telegram refuses a message longer than this. Split rather than truncate. */
const TELEGRAM_MAX_CHARS = 4096;

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

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

async function tg(method: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Send a reply, split across messages when Telegram's ceiling demands it.
 *
 * Splits on a paragraph or line boundary when one is available near the end of
 * the window, and mid-text only when a single paragraph is itself too long —
 * a hard cut through a sentence reads as a truncation bug.
 */
async function sendText(chatId: number, text: string): Promise<void> {
  let rest = text.trim();
  if (!rest) return;
  while (rest.length > 0) {
    let chunk = rest.slice(0, TELEGRAM_MAX_CHARS);
    if (rest.length > TELEGRAM_MAX_CHARS) {
      const brk = Math.max(chunk.lastIndexOf("\n\n"), chunk.lastIndexOf("\n"));
      if (brk > TELEGRAM_MAX_CHARS * 0.5) chunk = chunk.slice(0, brk);
    }
    // No parse_mode. The model writes prose with stray underscores and
    // asterisks in it, and Telegram REJECTS a message whose Markdown does not
    // parse — turning a good answer into no answer at all.
    await tg("sendMessage", { chat_id: chatId, text: chunk });
    rest = rest.slice(chunk.length).trimStart();
  }
}

// ---------------------------------------------------------------------------
// The derived webhook secret
// ---------------------------------------------------------------------------

async function webhookSecret(): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(BOT_TOKEN),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time compare.
 *
 * Both sides are 64 hex chars here, so the length check leaks nothing, and the
 * loop refuses to return early on the first mismatching byte.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Storage (service_role — the tables have RLS on and no policy)
// ---------------------------------------------------------------------------

async function pg(path: string, init: RequestInit = {}): Promise<Response> {
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

/**
 * Return the bound owner, binding `candidate` if there is none yet.
 *
 * The insert carries the primary key explicitly and tolerates a conflict, so
 * two messages arriving at the same instant cannot both bind: one wins, the
 * other reads the winner back. Whoever loses that race is a stranger, and the
 * caller then ignores them.
 */
async function ownerId(candidate: number): Promise<number | null> {
  const read = async (): Promise<number | null> => {
    const r = await pg("assistant_owner?select=telegram_id&limit=1");
    if (!r.ok) {
      console.error("[assistant-bot] owner read failed", r.status, await r.text().catch(() => ""));
      return null;
    }
    const rows = (await r.json().catch(() => [])) as { telegram_id: number }[];
    return rows.length > 0 ? Number(rows[0].telegram_id) : null;
  };

  const existing = await read();
  if (existing !== null) return existing;

  const r = await pg("assistant_owner", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ singleton: true, telegram_id: candidate }),
  });
  if (!r.ok) console.error("[assistant-bot] bind failed", r.status, await r.text().catch(() => ""));
  // Read back rather than assume we won: on conflict the row is someone else's.
  return await read();
}

type Turn = { role: "user" | "assistant"; content: string };

async function loadHistory(telegramId: number): Promise<Turn[]> {
  const r = await pg(
    `assistant_chat?select=role,content&telegram_id=eq.${telegramId}` +
      `&order=id.desc&limit=${HISTORY_TURNS}`,
  );
  if (!r.ok) return [];
  const rows = (await r.json().catch(() => [])) as Turn[];
  // Newest-first is how you page a tail cheaply; the model needs oldest-first.
  return rows.reverse();
}

async function remember(telegramId: number, role: Turn["role"], content: string): Promise<void> {
  const r = await pg("assistant_chat", {
    method: "POST",
    body: JSON.stringify({ telegram_id: telegramId, role, content }),
  });
  if (!r.ok) console.error("[assistant-bot] remember failed", r.status, await r.text().catch(() => ""));
}

async function forget(telegramId: number): Promise<void> {
  await pg(`assistant_chat?telegram_id=eq.${telegramId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — личный ассистент владельца проекта Sherlock Scholes.

Sherlock Scholes — это Telegram Mini App: игра в объяснение футбольных карточек
на одном телефоне, две команды. Стек: React + Vite + Tailwind поверх Supabase
(Postgres, RPC, Edge Functions на Deno), карточки обогащаются из Википедии,
интерфейс переведён на девять языков (ru en es pt fr ar ja ko zh).

Отвечай на языке собеседника; по умолчанию это русский. Пиши кратко и по делу:
это Telegram, а не документ. Обычным текстом, без Markdown-разметки — Telegram
её здесь не разбирает, и звёздочки будут видны как звёздочки.

Ты разговариваешь через бота и не имеешь доступа ни к репозиторию, ни к базе,
ни к интернету. Если для ответа нужно посмотреть в код или в данные — так и
скажи, вместо того чтобы предполагать, как там устроено.`;

/** What the bot says when it has no key. Useful rather than broken. */
const NO_KEY_MESSAGE =
  "Модель пока не подключена: в секретах проекта нет ANTHROPIC_API_KEY.\n\n" +
  "Добавьте его в Supabase → Edge Functions → Secrets, и я начну отвечать. " +
  "Команды /start, /whoami и /reset работают и без ключа.";

async function ask(history: Turn[], prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const message = await client.messages.create({
    model: MODEL,
    // Thinking counts against max_tokens on this model, so a value sized only
    // for the visible answer starves the reasoning and truncates mid-sentence.
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    // Adaptive is the default on Opus 5; stated so the intent survives a model
    // change. Low effort because this is a chat bot and latency is the cost the
    // owner actually feels — Telegram shows "typing" the whole time.
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    messages: [...history, { role: "user" as const, content: prompt }],
  });

  // A refusal has no usable content, and reading it as text yields an empty
  // reply that looks like a bug on our side.
  if (message.stop_reason === "refusal") {
    return "Я не могу ответить на это.";
  }

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return text || "(пустой ответ)";
}

// ---------------------------------------------------------------------------
// Handling one message
// ---------------------------------------------------------------------------

async function handle(chatId: number, userId: number, text: string): Promise<void> {
  const command = text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];

  if (command === "/start") {
    await sendText(
      chatId,
      "Готов. Пишите вопрос обычным сообщением — я помню последние " +
        `${HISTORY_TURNS} реплик.\n\n` +
        "/reset — забыть разговор\n" +
        "/whoami — ваш Telegram ID\n\n" +
        (ANTHROPIC_KEY ? "" : "\n" + NO_KEY_MESSAGE),
    );
    return;
  }

  if (command === "/whoami") {
    await sendText(chatId, `Ваш Telegram ID: ${userId}\nВы владелец этого бота.`);
    return;
  }

  if (command === "/reset") {
    await forget(userId);
    await sendText(chatId, "Разговор забыт.");
    return;
  }

  if (!ANTHROPIC_KEY) {
    await sendText(chatId, NO_KEY_MESSAGE);
    return;
  }

  await tg("sendChatAction", { chat_id: chatId, action: "typing" });

  const history = await loadHistory(userId);
  let reply: string;
  try {
    reply = await ask(history, text);
  } catch (err) {
    // The owner is the only reader, so the actual error is more useful to them
    // than a polite nothing — a wrong key and a rate limit need different
    // fixes, and only one of them is worth waiting out.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[assistant-bot] model call failed", detail);
    await sendText(chatId, `Модель не ответила: ${detail}`);
    return;
  }

  // Written only once both sides exist: a stored question with no answer would
  // be replayed forever as an unanswered turn.
  await remember(userId, "user", text);
  await remember(userId, "assistant", reply);
  await sendText(chatId, reply);
}

// ---------------------------------------------------------------------------
// install — point Telegram at this very function
//
// The URL is built from SUPABASE_URL, never from the request, so this endpoint
// cannot be used to redirect the bot somewhere else: the only thing an
// uninvited caller can achieve is re-pointing the webhook at where it already
// points, with the secret it already has. That is why it needs no secret of
// its own.
// ---------------------------------------------------------------------------

async function install(): Promise<Response> {
  if (!BOT_TOKEN) return json({ error: "missing ASSISTANT_BOT_TOKEN" }, 500);

  const url = `${SUPABASE_URL}/functions/v1/assistant-bot`;
  const set = await tg("setWebhook", {
    url,
    secret_token: await webhookSecret(),
    // Everything else is noise for a private assistant, and dropping the rest
    // keeps other bots' update types from waking this one.
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });

  const info = await tg("getWebhookInfo", {});
  return json({
    set_webhook: set.ok === true,
    description: set.description ?? null,
    // Neither the token nor the secret appears in getWebhookInfo.
    webhook: info.result ?? null,
    model_key_present: ANTHROPIC_KEY !== "",
  });
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const header = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // ── Path 1: an update from Telegram ──
  if (header !== null) {
    if (!BOT_TOKEN || !secretsMatch(header, await webhookSecret())) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await req.json().catch(() => null);
    const msg = update?.message;
    const chatId = msg?.chat?.id;
    const userId = msg?.from?.id;
    const text = msg?.text;

    // Ack anything we cannot act on. A non-200 makes Telegram retry, and
    // retrying a sticker forever helps nobody.
    if (typeof chatId !== "number" || typeof userId !== "number" || typeof text !== "string") {
      return new Response("ok");
    }

    const owner = await ownerId(userId);
    // Silence for strangers, and silence too if the owner lookup failed —
    // answering on a failed check is how a bug becomes an open bot.
    if (owner === null || owner !== userId) return new Response("ok");

    // Answer Telegram now, think afterwards. See the header.
    EdgeRuntime.waitUntil(
      handle(chatId, userId, text).catch((err) => {
        console.error("[assistant-bot] handler failed", err);
      }),
    );
    return new Response("ok");
  }

  // ── Path 2: administrative call ──
  const body = await req.json().catch(() => null);
  if (body?.action === "install") return await install();

  return json({ error: "unknown_action" }, 400);
});
