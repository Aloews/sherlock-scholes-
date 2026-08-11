// ============================================================================
// assistant-bot — a private Telegram assistant for the owner of this project.
//
// It is NOT the game's bot, and that separation is the whole security design.
// The Mini App's bot holds the payment webhook and the token that validates
// every player's initData; this one holds model keys and answers free-form
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
// DERIVED: sha256(ASSISTANT_BOT_TOKEN), hex. Install and verification compute
// the same value from the same input, so they cannot disagree; and it is not
// the token, so a leaked header reveals a hash. Rotating the token rotates the
// secret, which means a rotation MUST be followed by another install.
//
// ── Who it answers to ──────────────────────────────────────────────────────
// Trust on first use: the first account to write is recorded as the owner and
// the row is then fixed. Everyone else is ignored in SILENCE — an "access
// denied" reply tells a stranger the bot is real and worth pushing on.
//
// ── Why it answers Telegram before it answers the owner ────────────────────
// Telegram retries a webhook it considers failed, and a model call is slower
// than its patience. The 200 goes out first and the work runs in
// EdgeRuntime.waitUntil() behind a typing indicator. Otherwise one slow answer
// arrives four times.
//
// ── It can read the repository ─────────────────────────────────────────────
// Asked "is the test setup in order", an assistant with no access can only say
// so — which is honest and useless. So it has two tools, list_files and
// read_file, pointed at this repository. The repo is PUBLIC, so this needs no
// credential at all: raw.githubusercontent for contents, the trees API (cached,
// see the migration) for the file list. Both models get the same tools through
// their own calling conventions.
//
// Deploy / install: see ./README.md
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";

const BOT_TOKEN = Deno.env.get("ASSISTANT_BOT_TOKEN") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * The key the DATABASE tool reads with — deliberately the public one.
 *
 * The bot holds SERVICE_ROLE for its own two tables, and that key bypasses RLS
 * entirely. Handing it to a tool the model drives would mean the model's
 * mistakes, and anything that talks its way into the model, reach every row in
 * the project — including this conversation and the players' rows. As anon it
 * sees exactly what the game's own client sees and nothing else, and that is a
 * property of Postgres rather than of the allowlist I remembered to write.
 *
 * Injected by the Functions runtime alongside SUPABASE_URL, so it costs no
 * setup. It is public by construction: the same key ships in the browser
 * bundle.
 */
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * A pinned Gemini model, when somebody wants one. Empty by default.
 *
 * The default USED to be a hardcoded `gemini-2.5-flash`, and that is exactly
 * the bug this replaces: Google retired it ("no longer available to new
 * users") and the bot answered 404 in the middle of a question, twice. Any
 * name written here is correct until it silently is not.
 */
const GEMINI_MODEL_PINNED = Deno.env.get("GEMINI_MODEL") ?? "";

/**
 * The model actually used — discovered from the API rather than remembered.
 *
 * ASKING BEATS GUESSING. Cached for the life of the isolate: the list changes
 * on Google's timescale, not ours, and paying a round trip on every message to
 * re-learn something that moves twice a year is the wrong trade.
 */
let geminiModelCache = "";

/** Newest first, so a retired elder is never the pick. */
function preferFlash(names: string[]): string | null {
  const flash = names.filter((n) => /flash/i.test(n) && !/vision|thinking|exp|preview/i.test(n));
  if (flash.length === 0) return null;
  // `-latest` aliases exist precisely so callers stop hardcoding versions.
  const latest = flash.find((n) => n.endsWith("-latest"));
  if (latest) return latest;
  const score = (n: string) => {
    const m = /(\d+)(?:[.-](\d+))?/.exec(n);
    return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : 0;
  };
  return [...flash].sort((a, b) => score(b) - score(a))[0];
}

async function geminiModel(): Promise<string> {
  if (GEMINI_MODEL_PINNED) return GEMINI_MODEL_PINNED;
  if (geminiModelCache) return geminiModelCache;
  if (!GEMINI_KEY) return "";

  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": GEMINI_KEY },
  });
  if (!r.ok) throw new Error(`Gemini models ${r.status}: ${(await r.text()).slice(0, 200)}`);

  const data = (await r.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const usable = (data.models ?? [])
    // A model that cannot generateContent is not a candidate whatever it is
    // called — embedding models match /flash/ too.
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter((n) => n.length > 0);

  const picked = preferFlash(usable);
  if (!picked) throw new Error("Gemini: no flash model available to this key");
  geminiModelCache = picked;
  console.log("[assistant-bot] gemini model resolved to", picked);
  return picked;
}

const REPO = Deno.env.get("ASSISTANT_REPO") ?? "Aloews/sherlock-scholes-";
const BRANCH = Deno.env.get("ASSISTANT_BRANCH") ?? "main";

const HISTORY_TURNS = 20;
const TELEGRAM_MAX_CHARS = 4096;

/** Bytes of a single file the model may see. Above this it is truncated aloud. */
const FILE_CAP = 60_000;
/** The file list is refreshed at most this often. See the migration. */
const TREE_TTL_MS = 60 * 60 * 1000;
/**
 * How many times the model may call a tool before it must answer.
 *
 * This is the cost ceiling. Without it a confused model can read the whole
 * repository one file at a time, and the owner finds out from the invoice.
 */
const MAX_TOOL_ROUNDS = 8;

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
 * Send a reply, split where Telegram's ceiling demands it.
 *
 * No parse_mode: the model writes prose with stray underscores and asterisks,
 * and Telegram REJECTS a message whose Markdown does not parse — turning a
 * good answer into no answer at all.
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
    await tg("sendMessage", { chat_id: chatId, text: chunk });
    rest = rest.slice(chunk.length).trimStart();
  }
}

// ---------------------------------------------------------------------------
// The derived webhook secret
// ---------------------------------------------------------------------------

async function webhookSecret(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BOT_TOKEN));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare. Both sides are 64 hex chars, so length leaks nothing. */
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

type Owner = { telegram_id: number; model: string | null };

/**
 * Return the bound owner, binding `candidate` if there is none yet.
 *
 * The insert tolerates a conflict and the result is read back rather than
 * assumed: two messages at the same instant cannot both bind, and whoever
 * loses that race is a stranger the caller then ignores.
 */
async function owner(candidate: number): Promise<Owner | null> {
  const read = async (): Promise<Owner | null> => {
    const r = await pg("assistant_owner?select=telegram_id,model&limit=1");
    if (!r.ok) {
      console.error("[assistant-bot] owner read failed", r.status, await r.text().catch(() => ""));
      return null;
    }
    const rows = (await r.json().catch(() => [])) as Owner[];
    return rows.length > 0 ? { telegram_id: Number(rows[0].telegram_id), model: rows[0].model } : null;
  };

  const existing = await read();
  if (existing !== null) return existing;

  const r = await pg("assistant_owner", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify({ singleton: true, telegram_id: candidate }),
  });
  if (!r.ok) console.error("[assistant-bot] bind failed", r.status, await r.text().catch(() => ""));
  return await read();
}

async function storeModel(id: ModelId): Promise<void> {
  const r = await pg("assistant_owner?singleton=eq.true", {
    method: "PATCH",
    body: JSON.stringify({ model: id }),
  });
  if (!r.ok) console.error("[assistant-bot] model write failed", r.status, await r.text().catch(() => ""));
}

type Turn = { role: "user" | "assistant"; content: string };

async function loadHistory(telegramId: number): Promise<Turn[]> {
  const r = await pg(
    `assistant_chat?select=role,content&telegram_id=eq.${telegramId}` +
      `&order=id.desc&limit=${HISTORY_TURNS}`,
  );
  if (!r.ok) return [];
  const rows = (await r.json().catch(() => [])) as Turn[];
  // Newest-first pages a tail cheaply; the model needs oldest-first.
  return rows.reverse();
}

async function remember(
  telegramId: number,
  role: Turn["role"],
  content: string,
  cost?: { model: string; input: number; output: number },
): Promise<void> {
  const r = await pg("assistant_chat", {
    method: "POST",
    body: JSON.stringify({
      telegram_id: telegramId,
      role,
      content,
      model: cost?.model ?? null,
      input_tokens: cost?.input ?? null,
      output_tokens: cost?.output ?? null,
    }),
  });
  if (!r.ok) console.error("[assistant-bot] remember failed", r.status, await r.text().catch(() => ""));
}

async function forget(telegramId: number): Promise<void> {
  await pg(`assistant_chat?telegram_id=eq.${telegramId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// The repository, read-only
// ---------------------------------------------------------------------------

/**
 * Every path in the repository, cached for an hour.
 *
 * The trees API allows 60 anonymous requests an hour per IP, and this function
 * shares its IP. Cached, that ceiling is never approached; uncached, the tool
 * works until a neighbour is busy, which is the worst kind of broken.
 */
async function repoTree(): Promise<string[]> {
  const cached = await pg("assistant_repo_tree?select=paths,fetched_at&limit=1");
  if (cached.ok) {
    const rows = (await cached.json().catch(() => [])) as { paths: string[]; fetched_at: string }[];
    if (rows.length > 0 && Date.now() - Date.parse(rows[0].fetched_at) < TREE_TTL_MS) {
      return rows[0].paths;
    }
  }

  const r = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "sherlock-assistant" } },
  );
  if (!r.ok) throw new Error(`GitHub trees ${r.status}: ${await r.text().catch(() => "")}`);

  const data = (await r.json()) as { tree?: { path?: string; type?: string }[] };
  const paths = (data.tree ?? [])
    .filter((n) => n.type === "blob" && typeof n.path === "string")
    .map((n) => n.path as string);

  await pg("assistant_repo_tree", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ singleton: true, paths, fetched_at: new Date().toISOString() }),
  });
  return paths;
}

/**
 * One file, straight from the branch — never cached.
 *
 * A cached file read back as current is precisely the lie this bot must not
 * tell, and raw.githubusercontent has no rate limit worth managing.
 */
async function readRepoFile(path: string): Promise<string> {
  const clean = path.replace(/^\/+/, "");
  // `..` cannot escape anywhere meaningful on a URL path, but it produces
  // confusing 404s, so it is refused with a reason instead.
  if (clean.includes("..")) return "Путь с «..» не поддерживается — укажите путь от корня репозитория.";

  const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${clean}`);
  if (r.status === 404) return `Файла ${clean} нет в ${REPO}@${BRANCH}.`;
  if (!r.ok) return `Не удалось прочитать ${clean}: HTTP ${r.status}`;

  const body = await r.text();
  if (body.length > FILE_CAP) {
    return body.slice(0, FILE_CAP) +
      `\n\n[…обрезано: файл ${body.length} байт, показаны первые ${FILE_CAP}]`;
  }
  return body;
}

interface ToolDef {
  name: string;
  description: string;
  /** JSON-Schema-ish properties, translated per provider below. */
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  run: (args: Record<string, unknown>) => Promise<string>;
}

const TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description:
      "Список файлов репозитория. Необязательный prefix ограничивает каталогом " +
      "(например 'src/features/voice' или '.github/workflows'). Начинай с него, " +
      "чтобы не гадать про пути.",
    properties: { prefix: { type: "string", description: "Префикс пути, необязательно" } },
    required: [],
    run: async (args) => {
      const prefix = typeof args.prefix === "string" ? args.prefix.replace(/^\/+/, "") : "";
      const all = await repoTree();
      const hits = all.filter((p) => p.startsWith(prefix));
      if (hits.length === 0) return `Ничего не найдено по префиксу «${prefix}».`;
      // A cap here, not just in the model's budget: 900 paths is a wall of
      // tokens that answers nothing a narrower prefix would not answer better.
      const shown = hits.slice(0, 300);
      return shown.join("\n") +
        (hits.length > shown.length ? `\n[…ещё ${hits.length - shown.length}, сузьте prefix]` : "");
    },
  },
  {
    name: "read_file",
    description:
      "Прочитать файл репозитория по пути от корня, например 'package.json' или " +
      "'docs/MAP.md'. Возвращает текущее содержимое ветки, без кэша.",
    properties: { path: { type: "string", description: "Путь от корня репозитория" } },
    required: ["path"],
    run: async (args) =>
      typeof args.path === "string" ? await readRepoFile(args.path) : "Не указан path.",
  },
  {
    name: "query_db",
    description:
      "Запрос к боевой базе через PostgREST, ТОЛЬКО ЧТЕНИЕ и только то, что " +
      "видит обычный игрок. Передай путь после /rest/v1/, например " +
      "'cards?select=id,name&category=eq.player&limit=5' или " +
      "'cards?select=count'. Приватные таблицы недоступны — это не список " +
      "запретов, а права в Postgres.",
    properties: { path: { type: "string", description: "Путь PostgREST после /rest/v1/" } },
    required: ["path"],
    run: async (args) => {
      if (typeof args.path !== "string") return "Не указан path.";
      if (!ANON_KEY) return "Публичный ключ базы не настроен, читать нечем.";
      const path = args.path.replace(/^\/+/, "");

      // GET only. PostgREST writes through POST/PATCH/DELETE, and the anon key
      // is not the reason this is read-only — this line is. Both have to hold.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, Prefer: "count=exact" },
      });
      const body = await r.text().catch(() => "");
      if (!r.ok) {
        // Handed over verbatim: 42501 means the table is closed to players,
        // which is an ANSWER about the schema, not a malfunction to smooth over.
        return `PostgREST ${r.status}: ${body.slice(0, 2000)}`;
      }
      return body.length > 20_000
        ? body.slice(0, 20_000) + "\n[…обрезано, добавьте limit= или select= поуже]"
        : body;
    },
  },
  {
    name: "ci_status",
    description:
      "Последние прогоны GitHub Actions: ветка, событие, вывод каждой джобы. " +
      "Отвечает на «зелёный ли CI сейчас» фактом, а не предположением.",
    properties: {
      branch: { type: "string", description: "Ветка, необязательно; по умолчанию все" },
    },
    required: [],
    run: async (args) => {
      const branch = typeof args.branch === "string" && args.branch ? `&branch=${encodeURIComponent(args.branch)}` : "";
      const r = await fetch(
        `https://api.github.com/repos/${REPO}/actions/runs?per_page=8${branch}`,
        { headers: { Accept: "application/vnd.github+json", "User-Agent": "sherlock-assistant" } },
      );
      if (!r.ok) return `GitHub Actions ${r.status}: ${await r.text().catch(() => "")}`;
      const data = (await r.json()) as {
        workflow_runs?: {
          name?: string; head_branch?: string; event?: string;
          status?: string; conclusion?: string | null; created_at?: string;
          html_url?: string;
        }[];
      };
      const runs = data.workflow_runs ?? [];
      if (runs.length === 0) return "Прогонов не найдено.";
      return runs
        .map((run) =>
          `${run.created_at ?? "?"} ${run.name ?? "?"} [${run.head_branch ?? "?"}/${run.event ?? "?"}] ` +
          // A run still going has no conclusion, and reporting that as "no
          // result" reads as failure. MAP.md §8 also warns that Actions drops
          // the pull_request event outright, so "нет прогона" is a real state.
          `→ ${run.status === "completed" ? (run.conclusion ?? "без вывода") : `идёт (${run.status ?? "?"})`}`,
        )
        .join("\n");
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `Нет инструмента «${name}».`;
  try {
    return await tool.run(args);
  } catch (err) {
    // Handed back to the model rather than thrown: a failed read is something
    // it can work around and report, whereas a thrown error loses the turn.
    return `Инструмент ${name} не сработал: ${err instanceof Error ? err.message : err}`;
  }
}

// ---------------------------------------------------------------------------
// The models
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Ты — личный ассистент владельца проекта Sherlock Scholes.

ЧТО ЭТО. Telegram Mini App: игра в объяснение футбольных карточек на одном
телефоне, две команды. React + Vite + Tailwind поверх Supabase (Postgres, RPC,
Edge Functions на Deno). Карточки обогащаются из Википедии. Репозиторий
${REPO}, ветка ${BRANCH}.

ЧЕМ ТЫ РАСПОЛАГАЕШЬ. Четыре инструмента, и это меняет то, как ты отвечаешь:
не рассуждай о том, как там скорее всего устроено, а посмотри и скажи, как
есть.

  list_files, read_file — этот репозиторий. Начинай с docs/MAP.md: это карта,
  она отвечает на «где что лежит» за один шаг. Правила разработки в CLAUDE.md,
  инженерные стандарты в docs/.

  query_db — боевая база через PostgREST, только чтение и только то, что видит
  обычный игрок. Приватные таблицы закрыты правами Postgres, а не списком
  запретов, так что 42501 в ответе — это факт о схеме, а не поломка: так и
  скажи. Писать в базу ты не можешь вообще.

  ci_status — последние прогоны GitHub Actions. Важно: Actions в этом проекте
  регулярно теряет событие pull_request, и «прогона нет» — это отдельное
  состояние, не то же самое, что «упало», и не то же самое, что «зелено».

ЧЕГО У ТЕБЯ НЕТ. Ты не можешь ничего изменить: ни коммита, ни записи в базу,
ни перезапуска CI. Если ответ требует действия — скажи, какое именно, и не
делай вид, что выполнил его.

ЧЕСТНОСТЬ ВАЖНЕЕ ПОЛЕЗНОСТИ. Разделяй то, что ты прочитал, и то, что
предполагаешь, и говори, чем именно ты это знаешь — называй файл. Если не
проверял, скажи «не проверял», а не «скорее всего настроено». Если инструмент
вернул ошибку или файла нет — так и скажи, вместо того чтобы достроить ответ
догадкой. Отсутствие проверки — это результат, а не повод для обтекаемой
формулировки.

ЭКОНОМЬ. Каждый вызов инструмента и каждая реплика стоят денег владельца.
Читай только то, что нужно для ответа: сузь list_files префиксом, вместо того
чтобы листать репозиторий целиком; не читай файл, если вопрос про его наличие;
не пересказывай прочитанное целиком — отвечай на вопрос. Больше ${MAX_TOOL_ROUNDS}
раундов инструментов тебе не дадут, так что планируй, что читать.

КАК ПИСАТЬ. Отвечай на языке собеседника, по умолчанию русский. Кратко и по
делу: это Telegram, а не документ. Обычным текстом, без Markdown-разметки —
она здесь не разбирается, и звёздочки будут видны как звёздочки. Пути к файлам
пиши как есть, они полезнее любого оформления.`;

type ModelId = "claude" | "gemini";

interface Answer {
  text: string;
  input: number;
  output: number;
}

interface ModelSpec {
  label: string;
  hint: string;
  secret: string;
  key: () => string;
  ask: (history: Turn[], prompt: string) => Promise<Answer>;
}

/**
 * Anthropic. The considered answer.
 *
 * Thinking is adaptive (the default on Opus 5, stated so the intent survives a
 * model change) at low effort, because this is a chat and latency is the cost
 * the owner feels. The assistant's own blocks are pushed back VERBATIM between
 * rounds: they carry the thinking blocks, and dropping those breaks the loop.
 */
async function askClaude(history: Turn[], prompt: string): Promise<Answer> {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content }) as Anthropic.MessageParam),
    { role: "user", content: prompt },
  ];

  let input = 0;
  let output = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      // cache_control on the system block: it is the largest constant part of
      // every request, and a chat resends it on every single turn.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { type: "object" as const, properties: t.properties, required: t.required },
      })),
      messages,
    });

    input += message.usage.input_tokens;
    output += message.usage.output_tokens;

    if (message.stop_reason === "refusal") {
      return { text: "Я не могу ответить на это.", input, output };
    }

    if (message.stop_reason !== "tool_use") {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { text: text || "(пустой ответ)", input, output };
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: await runTool(block.name, (block.input ?? {}) as Record<string, unknown>),
      });
    }
    messages.push({ role: "user", content: results });
  }

  // The ceiling is reported, not hidden: an answer that stopped because it ran
  // out of budget is a different thing from an answer that finished.
  return {
    text: `Не уложился в ${MAX_TOOL_ROUNDS} обращений к репозиторию. Спросите точнее.`,
    input,
    output,
  };
}

/**
 * Google. The cheap answer.
 *
 * WHAT MAKES FLASH CHEAP IS `thinkingBudget: 0`, not the name — it thinks by
 * default and bills for it, so a Flash that was never told to stop is the same
 * money for a smaller model. That field is also the likeliest to be rejected by
 * a future model, and a rejection costs the whole answer, so a 400 naming it is
 * retried once without it.
 */
async function askGemini(history: Turn[], prompt: string): Promise<Answer> {
  const model = await geminiModel();
  type Part = Record<string, unknown>;
  const contents: { role: string; parts: Part[] }[] = [
    ...history.map((t) => ({
      // Gemini's word for the assistant is "model". Sending "assistant" is a
      // 400 on a field that looks like it should be symmetrical.
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }] as Part[],
    })),
    { role: "user", parts: [{ text: prompt }] },
  ];

  const declarations = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: "OBJECT",
      properties: Object.fromEntries(
        Object.entries(t.properties).map(([k, v]) => [k, { type: v.type.toUpperCase(), description: v.description }]),
      ),
      required: t.required,
    },
  }));

  const call = async (thrifty: boolean, body: typeof contents): Promise<Response> =>
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: body,
          tools: [{ function_declarations: declarations }],
          generationConfig: {
            maxOutputTokens: 2048,
            ...(thrifty ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      },
    );

  let input = 0;
  let output = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let r = await call(true, contents);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      if (r.status === 400 && /thinking/i.test(body)) {
        console.warn("[assistant-bot] gemini rejected thinkingBudget, retrying without it");
        r = await call(false, contents);
        if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text().catch(() => "")}`);
      } else {
        throw new Error(`Gemini ${r.status}: ${body}`);
      }
    }

    const data = (await r.json().catch(() => ({}))) as {
      candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    input += data.usageMetadata?.promptTokenCount ?? 0;
    output += data.usageMetadata?.candidatesTokenCount ?? 0;

    // A block arrives as a 200 with no candidate. Read as an empty answer, that
    // reports a refusal as a bug in our own code.
    const blocked = data.promptFeedback?.blockReason;
    if (blocked) return { text: `Gemini отказался отвечать: ${blocked}`, input, output };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall) as { functionCall: { name: string; args?: Record<string, unknown> } }[];

    if (calls.length === 0) {
      const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
      if (text) return { text, input, output };
      return {
        text: `(пустой ответ, finishReason: ${candidate?.finishReason ?? "неизвестен"})`,
        input,
        output,
      };
    }

    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const c of calls) {
      responses.push({
        functionResponse: {
          name: c.functionCall.name,
          response: { result: await runTool(c.functionCall.name, c.functionCall.args ?? {}) },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return {
    text: `Не уложился в ${MAX_TOOL_ROUNDS} обращений к репозиторию. Спросите точнее.`,
    input,
    output,
  };
}

const MODELS: Record<ModelId, ModelSpec> = {
  claude: {
    label: "Claude Opus 5",
    hint: "качественно и медленнее — для разбора и кода",
    secret: "ANTHROPIC_API_KEY",
    key: () => ANTHROPIC_KEY,
    ask: askClaude,
  },
  gemini: {
    label: GEMINI_MODEL_PINNED ? `Gemini Flash (${GEMINI_MODEL_PINNED})` : "Gemini Flash",
    hint: "быстро и дёшево, без размышления — для коротких вопросов",
    secret: "GEMINI_API_KEY",
    key: () => GEMINI_KEY,
    ask: askGemini,
  },
};

const MODEL_IDS = Object.keys(MODELS) as ModelId[];
const configured = (): ModelId[] => MODEL_IDS.filter((id) => MODELS[id].key() !== "");

/**
 * Which model actually answers this request.
 *
 * The stored choice is a preference, not a promise: a key can be removed after
 * it was chosen, and honouring a dead choice would make the bot mute for a
 * reason the owner cannot see. `fellBack` is returned so the reply can say so.
 */
function resolveModel(stored: string | null): { id: ModelId; fellBack: boolean } | null {
  const usable = configured();
  if (usable.length === 0) return null;
  if (stored && (usable as string[]).includes(stored)) return { id: stored as ModelId, fellBack: false };
  return { id: usable[0], fellBack: stored !== null };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function keyStatusLines(): string {
  return MODEL_IDS
    .map((id) => {
      const m = MODELS[id];
      return `/model ${id} — ${m.label}\n   ${m.hint}\n   ключ: ${m.key() ? "есть" : `НЕТ (секрет ${m.secret})`}`;
    })
    .join("\n\n");
}

function modelReport(stored: string | null): string {
  const active = resolveModel(stored);
  const head = active === null
    ? "Сейчас: ни одной модели — нет ни одного ключа."
    : `Сейчас: ${MODELS[active.id].label}` +
      (active.fellBack ? `\n(выбран был «${stored}», но его ключа нет — отвечаю этой)` : "");
  return `${head}\n\n${keyStatusLines()}`;
}

/** `/models` — ask the providers what these keys can really see. */
async function catalogue(): Promise<string> {
  const out: string[] = [];
  if (GEMINI_KEY) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": GEMINI_KEY },
      });
      const data = (await r.json().catch(() => ({}))) as { models?: { name?: string }[] };
      const flash = (data.models ?? [])
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter((n) => n.includes("flash"))
        .slice(0, 15);
      out.push(
        `Google (сейчас используется ${geminiModelCache || GEMINI_MODEL_PINNED || "подбирается автоматически"}):\n` +
          (flash.length ? flash.join("\n") : `ничего с «flash» не вернулось, HTTP ${r.status}`),
      );
    } catch (err) {
      out.push(`Google: не удалось получить список — ${err instanceof Error ? err.message : err}`);
    }
  } else {
    out.push("Google: ключа нет.");
  }
  out.push(ANTHROPIC_KEY ? "Anthropic: ключ есть, модель claude-opus-5." : "Anthropic: ключа нет.");
  return out.join("\n\n");
}

/** `/repo` — is the repository actually reachable, and how fresh is the list. */
async function repoStatus(): Promise<string> {
  try {
    const paths = await repoTree();
    const r = await pg("assistant_repo_tree?select=fetched_at&limit=1");
    const rows = r.ok ? ((await r.json().catch(() => [])) as { fetched_at: string }[]) : [];
    const age = rows.length
      ? Math.round((Date.now() - Date.parse(rows[0].fetched_at)) / 60000)
      : null;
    return `Репозиторий ${REPO}@${BRANCH}: вижу ${paths.length} файлов.\n` +
      (age === null ? "" : `Список обновлён ${age} мин назад (обновляется раз в час).\n`) +
      "Содержимое файлов читается напрямую, без кэша.\n\n" +
      `База: ${ANON_KEY ? "читаю правами обычного игрока (запись невозможна)" : "публичный ключ не настроен"}\n` +
      "CI: вижу прогоны GitHub Actions\n" +
      `Инструменты: ${TOOLS.map((t) => t.name).join(", ")}`;
  } catch (err) {
    return `Репозиторий недоступен: ${err instanceof Error ? err.message : err}`;
  }
}

/** `/usage` — what the answers have cost so far. Economy you can check. */
async function usageReport(telegramId: number): Promise<string> {
  const r = await pg(
    `assistant_chat?select=model,input_tokens,output_tokens&telegram_id=eq.${telegramId}&role=eq.assistant`,
  );
  if (!r.ok) return "Не удалось прочитать статистику.";
  const rows = (await r.json().catch(() => [])) as
    { model: string | null; input_tokens: number | null; output_tokens: number | null }[];

  const byModel = new Map<string, { n: number; input: number; output: number }>();
  for (const row of rows) {
    if (!row.model) continue; // rows written before accounting existed
    const acc = byModel.get(row.model) ?? { n: 0, input: 0, output: 0 };
    acc.n += 1;
    acc.input += row.input_tokens ?? 0;
    acc.output += row.output_tokens ?? 0;
    byModel.set(row.model, acc);
  }
  if (byModel.size === 0) return "Пока ничего не потрачено: ни одного ответа модели.";

  const lines = [...byModel.entries()].map(([id, a]) =>
    `${MODELS[id as ModelId]?.label ?? id}: ${a.n} ответ(ов), ` +
    `${a.input.toLocaleString("ru")} вход / ${a.output.toLocaleString("ru")} выход`,
  );
  return "Потрачено токенов (с момента, когда завёлся учёт):\n\n" + lines.join("\n") +
    "\n\nВход считается за весь цикл с инструментами, включая повторные раунды.";
}

const startText = (stored: string | null): string =>
  `Готов. Пишите вопрос обычным сообщением — я помню последние ${HISTORY_TURNS} реплик ` +
  "и умею читать этот репозиторий.\n\n" +
  "/model — какая модель отвечает, и как переключить\n" +
  "/models — что реально доступно по ключам\n" +
  "/repo — вижу ли я репозиторий\n" +
  "/usage — сколько токенов потрачено\n" +
  "/reset — забыть разговор\n" +
  "/whoami — ваш Telegram ID\n\n" +
  modelReport(stored);

// ---------------------------------------------------------------------------
// Handling one message
// ---------------------------------------------------------------------------

async function handle(chatId: number, who: Owner, text: string): Promise<void> {
  const words = text.trim().split(/\s+/);
  const command = words[0].toLowerCase().split("@")[0];
  const userId = who.telegram_id;

  if (command === "/start") return await sendText(chatId, startText(who.model));
  if (command === "/whoami") {
    return await sendText(chatId, `Ваш Telegram ID: ${userId}\nВы владелец этого бота.`);
  }
  if (command === "/reset") {
    await forget(userId);
    return await sendText(chatId, "Разговор забыт.");
  }
  if (command === "/models") {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" });
    return await sendText(chatId, await catalogue());
  }
  if (command === "/repo") {
    await tg("sendChatAction", { chat_id: chatId, action: "typing" });
    return await sendText(chatId, await repoStatus());
  }
  if (command === "/usage") {
    return await sendText(chatId, await usageReport(userId));
  }

  if (command === "/model") {
    const wanted = (words[1] ?? "").toLowerCase();
    if (!wanted) return await sendText(chatId, modelReport(who.model));
    if (!(MODEL_IDS as string[]).includes(wanted)) {
      return await sendText(chatId, `Не знаю модель «${wanted}».\n\n${keyStatusLines()}`);
    }
    const spec = MODELS[wanted as ModelId];
    if (!spec.key()) {
      // Refusing to store a choice that cannot be honoured: stored, it would
      // leave the bot answering with the other model while claiming this one.
      return await sendText(
        chatId,
        `${spec.label} не подключена: нет секрета ${spec.secret}.\n` +
          "Добавьте его в Supabase → Edge Functions → Secrets и повторите.",
      );
    }
    await storeModel(wanted as ModelId);
    return await sendText(chatId, `Переключил на ${spec.label}.\n${spec.hint}`);
  }

  const active = resolveModel(who.model);
  if (active === null) {
    return await sendText(
      chatId,
      "Ни одна модель не подключена: в секретах проекта нет ни ANTHROPIC_API_KEY, " +
        "ни GEMINI_API_KEY.\n\nДобавьте любой из них в Supabase → Edge Functions → " +
        "Secrets, и я начну отвечать. Команды /start, /whoami, /model, /repo и " +
        "/reset работают и без ключа.",
    );
  }

  await tg("sendChatAction", { chat_id: chatId, action: "typing" });

  const history = await loadHistory(userId);
  let answer: Answer;
  try {
    answer = await MODELS[active.id].ask(history, text);
  } catch (err) {
    // The owner is the only reader, so the actual error is more useful than a
    // polite nothing: a wrong key and a rate limit need different fixes.
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[assistant-bot] model call failed", active.id, detail);
    return await sendText(chatId, `${MODELS[active.id].label} не ответила: ${detail}`);
  }

  // Written only once both sides exist: a stored question with no answer would
  // be replayed forever as an unanswered turn.
  await remember(userId, "user", text);
  await remember(userId, "assistant", answer.text, {
    model: active.id,
    input: answer.input,
    output: answer.output,
  });

  if (active.fellBack) {
    await sendText(chatId, `(«${who.model}» недоступна, отвечаю через ${MODELS[active.id].label})`);
  }
  await sendText(chatId, answer.text);
}

// ---------------------------------------------------------------------------
// install — point Telegram at this very function
//
// The URL is built from SUPABASE_URL, never from the request, so this endpoint
// cannot redirect the bot anywhere: the most an uninvited caller achieves is
// re-pointing the webhook where it already points, with the secret it already
// has. That is why it needs no secret of its own.
// ---------------------------------------------------------------------------

async function install(): Promise<Response> {
  if (!BOT_TOKEN) return json({ error: "missing ASSISTANT_BOT_TOKEN" }, 500);

  const set = await tg("setWebhook", {
    url: `${SUPABASE_URL}/functions/v1/assistant-bot`,
    secret_token: await webhookSecret(),
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  const info = await tg("getWebhookInfo", {});

  let repoFiles: number | string;
  try {
    repoFiles = (await repoTree()).length;
  } catch (err) {
    repoFiles = err instanceof Error ? err.message : String(err);
  }

  return json({
    set_webhook: set.ok === true,
    description: set.description ?? null,
    webhook: info.result ?? null,
    // Names only — never the values, and never a prefix of one.
    models_configured: configured(),
    gemini_model: GEMINI_MODEL_PINNED || geminiModelCache || "auto",
    repo: `${REPO}@${BRANCH}`,
    repo_files: repoFiles,
    // The database tool reads as anon on purpose; this says whether that key
    // arrived, not what it is.
    db_read_as_anon: ANON_KEY !== "",
    tools: TOOLS.map((t) => t.name),
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

    // Ack anything we cannot act on: a non-200 makes Telegram retry, and
    // retrying a sticker forever helps nobody.
    if (typeof chatId !== "number" || typeof userId !== "number" || typeof text !== "string") {
      return new Response("ok");
    }

    const who = await owner(userId);
    // Silence for strangers, and silence too if the lookup failed — answering
    // on a failed check is how a bug becomes an open bot.
    if (who === null || who.telegram_id !== userId) return new Response("ok");

    EdgeRuntime.waitUntil(
      handle(chatId, who, text).catch((err) => {
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
