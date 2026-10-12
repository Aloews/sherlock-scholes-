import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LLM_KEY = Deno.env.get("SUMMARY_LLM_API_KEY") ?? "";
const LLM_BASE_URL = Deno.env.get("SUMMARY_LLM_BASE_URL") ?? "https://ai.starimg.ru";
const LLM_MODEL = Deno.env.get("SUMMARY_LLM_MODEL") ?? "claude-opus-5";
const WINDOW_MS = 6 * 60 * 60 * 1000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Family = "form" | "form-news" | "news" | "golden-era";
interface Evidence {
  card_id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
}
interface Candidate {
  id: string;
  family: Family;
  title: string;
  description: string;
  card_ids: string[];
  names: string[];
  evidence?: Evidence[];
  era?: { club: string; startYear: number; endYear: number };
  stats?: Array<{ card_id: string; matches: number; goals: number; assists: number }>;
}
interface CardDbRow {
  id: string; name: string; name_en: string | null; active: boolean; category: string;
  legend_career: { clubs?: Array<{ club?: string; years?: string }> } | null;
}
interface NewsDbRow { title: string; url: string; source: string; published_at: string }
interface Editorial {
  id: string;
  title: string;
  hook: string;
  why: string;
  rank: number;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function safeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, max) : "";
}
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validateCandidates(
  supabase: any,
  candidates: Candidate[],
): Promise<Candidate[]> {
  const ids = [...new Set(candidates.flatMap((d) => d.card_ids))];
  if (!ids.length || ids.length > 64) return [];
  const { data: cardData, error: cardError } = await supabase.from("cards")
    .select("id,name,name_en,active,category,legend_career")
    .in("id", ids);
  if (cardError) throw new Error("card_validation_failed");
  const cardRows = (cardData ?? []) as unknown as CardDbRow[];
  const cards = new Map<string, CardDbRow>(cardRows.map((c) => [c.id, c]));
  const rating = await supabase.rpc("player_ratings", {
    p_days: 30, p_limit: 200, p_club_key: null, p_league: null, p_country: null,
  });
  if (rating.error) throw new Error("rating_validation_failed");
  const ratingRows = (rating.data ?? []) as Array<{ card_id: string; matches: number; goals: number; assists: number }>;
  const ratingsById = new Map(ratingRows.map((r) => [r.card_id, r]));
  const formIds = new Set(ratingRows.map((r) => r.card_id));
  const families = new Set<Family>(["form", "form-news", "news", "golden-era"]);

  const result: Candidate[] = [];
  for (const candidate of candidates) {
    if (!families.has(candidate.family)) continue;
    const deckIds = [...new Set(candidate.card_ids)].slice(0, 20);
    if (!candidate.id || deckIds.length < 3 || deckIds.length !== candidate.card_ids.length) continue;
    const deckCards = deckIds.map((id) => cards.get(id));
    if (deckCards.some((c) => !c || !c.active || c.category !== "player")) continue;

    if (candidate.family === "form" && deckIds.some((id) => !formIds.has(id))) continue;
    if (candidate.family === "form-news" && deckIds.some((id) => !formIds.has(id))) continue;

    if (candidate.family === "news" || candidate.family === "form-news") {
      const evidence = (candidate.evidence ?? []).filter((e) =>
        deckIds.includes(e.card_id) && e.url.startsWith("https://") &&
        Number.isFinite(Date.parse(e.published_at)) &&
        Date.parse(e.published_at) >= Date.now() - 72 * 60 * 60 * 1000 &&
        Date.parse(e.published_at) <= Date.now() + 5 * 60 * 1000
      );
      const urls = [...new Set(evidence.map((e) => e.url))];
      if (new Set(evidence.map((e) => e.card_id)).size < 3 || urls.length === 0) continue;
      const { data: newsData, error: newsError } = await supabase.from("news_items")
        .select("title,url,source,published_at").in("url", urls)
        .gte("published_at", new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
      if (newsError) throw new Error("news_validation_failed");
      const newsRows = (newsData ?? []) as unknown as NewsDbRow[];
      const verified = new Map<string, NewsDbRow>(newsRows.map((n) => [n.url, n]));
      const grounded = evidence.filter((e) => {
        const row = verified.get(e.url);
        const card = cards.get(e.card_id);
        if (!row || !card) return false;
        const title = normalize(row.title ?? "");
        const names = [card.name, card.name_en].filter((x): x is string => !!x)
          .map(normalize).filter((n) => n.length >= 5 && n.includes(" "));
        return names.some((n) => title.includes(n));
      });
      if (new Set(grounded.map((e) => e.card_id)).size < 3) continue;
      candidate.evidence = grounded.map((e) => {
        const row = verified.get(e.url)!;
        return { ...e, title: row.title, source: row.source, published_at: row.published_at };
      });
    }

    if (candidate.family === "golden-era") {
      const era = candidate.era;
      if (!era || !era.club || !Number.isInteger(era.startYear) ||
        !Number.isInteger(era.endYear) || era.startYear > era.endYear) continue;
      const club = normalize(era.club);
      const currentYear = new Date().getUTCFullYear();
      const overlapCount = deckCards.filter((card) => {
        const career = card?.legend_career;
        return (career?.clubs ?? []).some((entry) => {
          if (!entry.club || normalize(entry.club) !== club || !entry.years) return false;
          const match = entry.years.match(/(\d{4})(?:\D+(\d{4}))?/);
          if (!match) return false;
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : currentYear;
          return start <= era.endYear && end >= era.startYear && end >= start;
        });
      }).length;
      if (overlapCount < 3 || overlapCount !== deckIds.length) continue;
      candidate.era = {
        club: safeText(era.club, 80),
        startYear: era.startYear,
        endYear: era.endYear,
      };
    }

    if (candidate.family === "form" || candidate.family === "form-news") {
      // Stats are sourced on the server. Never let browser-supplied numbers
      // become facts in the editorial prompt.
      candidate.stats = deckIds.map((id) => ratingsById.get(id)!)
        .map((r) => ({ card_id: r.card_id, matches: r.matches, goals: r.goals, assists: r.assists }));
    } else {
      candidate.stats = [];
    }

    result.push({
      ...candidate,
      title: safeText(candidate.title, 100),
      description: safeText(candidate.description, 400),
      card_ids: deckIds,
      names: deckCards.map((c) => c!.name),
    });
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server_not_configured" }, 503);

  try {
    const body = await req.json();
    const language = body?.language === "en" ? "en" : "ru";
    const input = Array.isArray(body?.candidates) ? body.candidates.slice(0, 4) as Candidate[] : [];
    if (!input.length) return json({ editorials: {}, mode: "deterministic" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await validateCandidates(supabase, input);
    if (!verified.length) return json({ editorials: {}, mode: "deterministic" });

    // Hash only server-validated facts. Identical inputs reuse the same editorial
    // packet for six hours instead of spending tokens on every home-screen open.
    const cacheKey = await sha256(JSON.stringify({
      language,
      candidates: verified.map((d) => ({
        id: d.id, family: d.family, card_ids: d.card_ids, names: d.names,
        evidence: d.evidence ?? [], era: d.era ?? null, stats: d.stats ?? [],
      })),
    }));
    const { data: cached } = await supabase.from("smart_deck_editorial_cache")
      .select("payload").eq("cache_key", cacheKey).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.payload) return json({ ...cached.payload, mode: "cached-ai" });

    if (!LLM_KEY) return json({ editorials: {}, mode: "deterministic" });
    const client = new Anthropic({ apiKey: LLM_KEY, baseURL: LLM_BASE_URL });
    const modelInput = verified.map((d) => ({
      id: d.id, family: d.family,
      players: d.names,
      verified_headlines: (d.evidence ?? []).map((e) => ({
        title: e.title, source: e.source, published_at: e.published_at,
      })),
      verified_era: d.era ?? null,
      verified_recent_stats: d.stats ?? [],
    }));
    const response = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 1400,
      system: [
        "Ты — футбольный редактор игрового приложения Sherlock Scholes.",
        "Создавай короткую редакционную подачу для уже проверенных подборок карточек.",
        "Факты из входа — единственный источник истины. Не добавляй игроков, счёты, трансферы, трофеи, даты или связи, которых нет во входе.",
        "Не придумывай личные предпочтения пользователя и не утверждай, что знаешь его мысли. Можно объяснять актуальность самой подборки.",
        "Верни только валидный JSON без markdown: {\"editorials\":[{\"id\":\"known-id\",\"title\":\"до 48 символов\",\"hook\":\"до 130 символов\",\"why\":\"до 160 символов\",\"rank\":1}]}",
        "Каждый id должен дословно совпадать с одним из входных id. Не создавай новые id. Пиши на " + (language === "ru" ? "русском" : "английском") + ".",
      ].join("\n"),
      messages: [{ role: "user", content: JSON.stringify({ candidates: modelInput }) }],
    });
    const text = response.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    let parsed: { editorials?: unknown[] };
    try { parsed = JSON.parse(text); } catch { return json({ editorials: {}, mode: "deterministic" }); }

    const allowed = new Map(verified.map((d) => [d.id, d]));
    const editorialRows: Editorial[] = [];
    for (const raw of parsed.editorials ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const id = safeText(row.id, 80);
      if (!allowed.has(id) || editorialRows.some((e) => e.id === id)) continue;
      const fallback = allowed.get(id)!;
      editorialRows.push({
        id,
        title: safeText(row.title, 48) || fallback.title,
        hook: safeText(row.hook, 130) || fallback.description,
        why: safeText(row.why, 160) || fallback.description,
        rank: Number.isFinite(Number(row.rank)) ? Math.max(1, Math.min(99, Math.round(Number(row.rank)))) : editorialRows.length + 1,
      });
    }
    if (!editorialRows.length) return json({ editorials: {}, mode: "deterministic" });
    const payload = { editorials: editorialRows };
    const expiresAt = new Date(Date.now() + WINDOW_MS).toISOString();
    await supabase.from("smart_deck_editorial_cache").upsert({
      cache_key: cacheKey, language, payload, expires_at: expiresAt,
    }, { onConflict: "cache_key" });
    return json({ ...payload, mode: "ai" });
  } catch (error) {
    console.error("[smart-deck-editorial] failed", error instanceof Error ? error.message : "unknown");
    return json({ editorials: {}, mode: "deterministic" });
  }
});
