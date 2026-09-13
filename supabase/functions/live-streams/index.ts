// ============================================================================
// live-streams — что из футбола идёт ПРЯМО СЕЙЧАС на ОФИЦИАЛЬНЫХ каналах лиг.
//
// ЧТО ЭТО НЕ ЕСТЬ. Не агрегатор стримов. Каналы берутся из `digest_source` —
// того же списка, с которого конвейер уже качает голы, то есть это каналы
// самих лиг. Если лига открыла эфир у себя, ссылка на него — не перепродажа
// чужого сигнала, и именно этим разговор отличается от разговора про IPTV.
//
// ============================== ДВА ШАГА ====================================
// КАНДИДАТА ДАЁТ СТРАНИЦА, СТАТУС РЕШАЕТ API. Разделение — не украшение
// слоёв, в нём вся починка «идёт сейчас».
//
// ⚠️ ШАГ 1: НАЙТИ РОЛИК. Здесь API не годится по цене, и это замер.
//   1. Идущий эфир НЕ ЛЕЖИТ в списке загрузок канала. Проверено на живом
//      эфире MLS: сто роликов в `UUSZbXT5TLLW_i-5W8FZpFsg`, эфира среди них
//      нет. Значит дешёвая пара `playlistItems` + `videos.list` (2 единицы на
//      канал) его не найдёт — та самая пара, которой берутся голы.
//   2. Найти его можно только `search.list` с `eventType=live`, а он стоит
//      100 ЕДИНИЦ за канал. Двенадцать каналов даже раз в час — 28 800 единиц
//      в сутки при квоте 10 000; на нынешних десяти минутах это 172 800.
// Поэтому кандидат берётся с публичной страницы `youtube.com/channel/<id>/live`:
// ноль квоты, и `robots.txt` YouTube её не запрещает — запрещены
// `/feeds/videos.xml`, `/results`, `/youtubei/`, `/api/`, но не `/channel/` и
// не `/live`.
//
// ⚠️ ШАГ 2: СПРОСИТЬ, ИДЁТ ЛИ ОН. Вот здесь страница НЕ ГОДИТСЯ, и это тоже
// замер, 13.09.2026:
//
//   вечные эфиры (Sky News, NASA, DW, Bloomberg, Lofi Girl) — `"isLiveNow":true`
//     не встречается на странице НИ РАЗУ, а canonical не указывает на ролик;
//   каналы лиг с АНОНСОМ (Concacaf, MLS) — canonical на ролик есть, и рядом
//     `"isUpcoming":true`, `"scheduledStartTime"`, `LIVE_STREAM_OFFLINE`.
//
// Прежний признак (`isLiveNow` ИЛИ `isLive`) поэтому ловил РОВНО ОБРАТНОЕ
// обещанному: первая половина не срабатывала никогда, вторая срабатывала на
// анонсах. В таблице лежали одни анонсы, и все восемь строк, подписанных «идёт
// сейчас», начинались в будущем — вплоть до «Пряма трансляція матчу УПЛ-2
// (15.09.2026)» при сегодняшнем 13.09.
//
// Статус спрашивается у `videos.list?part=snippet,liveStreamingDetails` —
// ОДНА ЕДИНИЦА ЗА ВЕСЬ ПРОГОН, а не за канал: до 50 идентификаторов уходят
// одним вызовом. 144 единицы в сутки на десятиминутном расписании при квоте
// 10 000 — то есть возражение из шага 1 сюда не переносится, потому что искать
// уже ничего не надо.
//
// ⚠️ ЗАГОЛОВОК ОТТУДА ЖЕ, И oEmbed БОЛЬШЕ НЕ ВЫЗЫВАЕТСЯ. Тот же ответ несёт
// `snippet.title` — двенадцать лишних запросов к YouTube ушли вместе с
// отдельным шагом. oEmbed выбирался ради чистого текста без HTML-сущностей;
// JSON API даёт его с тем же свойством.
//
// ⚠️ БЕЗ КЛЮЧА НЕ ПИШЕТСЯ НИЧЕГО, и это выбрано намеренно. Прежний отказ был
// «тихий и безопасный» ровно потому, что незаписанная строка никого не
// обманывает. Записать кандидата как идущий эфир, не спросив статус, — это
// вернуть ту же ложь; поэтому при отсутствии ключа или отказе API прогон
// сообщает `verified:false` и уходит, ничего не записав.
//
// РАЗБОР ЗАГОЛОВКА ЗДЕСЬ НЕ ДЕЛАЕТСЯ. «Матч это или пресс-конференция»
// решают `looks_like_match` и `is_studio_talk` в базе, при чтении. Функция
// приносит, а не судит — как и football-digest.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
// Разбор страницы и разбор ответа API — отдельным файлом: только так их
// видит vitest. `index.ts` зовёт Deno.serve на загрузке и из теста не
// импортируется вовсе.
import { candidateVideoId, verdictOf, type Verdict } from "./verdict.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Тот же секрет, что у football-digest: ключ на проект, а не на функцию.
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? "";

// Один и тот же User-Agent для всех запросов. Без него YouTube отдаёт другой
// вариант страницы, в котором нужных полей может не быть.
const UA = "Mozilla/5.0 (compatible; SherlockScholesBot/1.0)";

// Потолок на ОДИН запрос. Двенадцать секунд — с запасом для страницы канала;
// больше значит держать соединение ради канала, который сегодня молчит.
const TIMEOUT_MS = 12_000;

// ⚠️ ПОТОЛОК НА ВЕСЬ ПРОГОН, И ОН НУЖЕН ИЗ-ЗА АРИФМЕТИКИ, А НЕ ИЗ ОСТОРОЖНОСТИ.
// Каналов около двадцати, идём по ним последовательно, каждый может стоить до
// TIMEOUT_MS — то есть худший случай втрое больше того, что ждёт вызывающий. А
// `pg_net` в schedule_live_streams.sql ждёт ответа 50 секунд.
//
// Что при этом ломается — НЕ ДАННЫЕ: функция переживёт таймаут вызывающего и
// допишет строки. Пропадает ОТВЕТ, а в нём `parsed` — единственный признак,
// по которому снаружи видно, что разбор страницы сломался. То есть
// диагностика гаснет ровно в тот момент, когда прогон идёт плохо.
//
// Тридцать пять секунд, а не пятьдесят: остаток нужен на проверку статусов
// (один запрос к API), запись, чистку и ответ.
const RUN_BUDGET_MS = 35_000;

interface Channel {
  name: string;
  ref: string;
}

interface Candidate {
  video_id: string;
  channel_id: string;
  channel: string;
}

async function get(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    // Сеть, таймаут, отказ — всё это «эфира не нашли», а не повод падать:
    // один недоступный канал не должен уносить остальные.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Спросить у API статус сразу всех кандидатов.
 *
 * ОДИН ВЫЗОВ НА ПРОГОН: `id` принимает до 50 идентификаторов через запятую, и
 * стоит это те же 1 единицу квоты, что и один. Пачки по 50 — на случай, если
 * каналов когда-нибудь станет больше; сегодня их два десятка.
 *
 * Возвращает null, если СПРОСИТЬ НЕ ВЫШЛО (нет ключа, отказ, квота). Пустая
 * карта и null — разные вещи: первое значит «ни один не идёт», второе «мы не
 * знаем», и записывать во втором случае нельзя ничего.
 */
async function verifyAll(ids: string[]): Promise<Map<string, Verdict> | null> {
  if (!YT_KEY) return null;
  const out = new Map<string, Verdict>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      "https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails" +
      `&id=${chunk.join(",")}&key=${YT_KEY}`;
    const body = await get(url);
    if (!body) return null;
    try {
      const j = JSON.parse(body) as { items?: { id?: string }[] };
      for (const item of j.items ?? []) {
        const id = typeof item?.id === "string" ? item.id : "";
        const v = verdictOf(item);
        if (id && v) out.set(id, v);
      }
    } catch {
      return null;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Список каналов — в базе, не в этом файле. Ровно та же причина, по которой
  // ленты дайджеста переехали в `digest_source`: добавить канал должно стоить
  // один INSERT, а не перенос файла агентом.
  const { data: rows, error: srcErr } = await db
    .from("digest_source")
    .select("name, ref")
    .in("kind", ["channel", "live"])
    .eq("enabled", true);

  if (srcErr) {
    console.error("[live] digest_source failed:", srcErr.code, srcErr.message);
    return Response.json({ error: "sources_unavailable" }, { status: 500 });
  }

  const channels = (rows ?? []) as Channel[];
  const candidates: Candidate[] = [];
  let parsed = 0;

  const startedAt = Date.now();
  let skipped = 0;

  // Последовательно, а не Promise.all: два десятка запросов к одному хосту
  // разом — это всплеск, за который отвечают отказом, а выигрыш в секундах
  // здесь никому не нужен — функция работает по расписанию, её никто не ждёт.
  for (const ch of channels) {
    // Бюджет кончился — досматривать остальные каналы нечем. Уходим с тем,
    // что нашли: следующий прогон через десять минут начнёт с того же списка,
    // а `skipped` в ответе скажет, сколько каналов сегодня не посмотрели.
    if (Date.now() - startedAt > RUN_BUDGET_MS) { skipped++; continue; }
    if (!/^UC[\w-]{22}$/.test(ch.ref)) continue; // не id канала — не наш случай
    const html = await get(`https://www.youtube.com/channel/${ch.ref}/live`);
    if (!html) continue;
    parsed++;
    const videoId = candidateVideoId(html);
    if (!videoId) continue;
    candidates.push({ video_id: videoId, channel_id: ch.ref, channel: ch.name });
  }

  const verdicts = await verifyAll(candidates.map((c) => c.video_id));

  // ⚠️ НЕ ЗНАЕМ — НЕ ПИШЕМ. Именно так эта функция и должна ломаться: пустой
  // раздел вместо уверенного вранья. `verified:false` в ответе — единственный
  // признак снаружи, что молчит не футбол, а ключ.
  if (!verdicts) {
    console.error("[live] статус не проверен:", YT_KEY ? "отказ API" : "нет YOUTUBE_API_KEY");
    return Response.json({
      channels: channels.length,
      parsed,
      skipped,
      candidates: candidates.length,
      verified: false,
      reason: YT_KEY ? "api_refused" : "no_key",
    }, { status: 200 });
  }

  const now = new Date().toISOString();
  const live: Record<string, unknown>[] = [];
  const upcoming: Record<string, unknown>[] = [];
  const over: string[] = [];

  for (const c of candidates) {
    const v = verdicts.get(c.video_id);
    if (!v) continue; // API про ролик не ответил — он и не эфир
    if (v.state === "over") { over.push(c.video_id); continue; }
    const row = {
      video_id: c.video_id,
      channel_id: c.channel_id,
      channel: c.channel,
      title: v.title,
      seen_at: now,
      started_at: v.started_at,
      scheduled_start_at: v.scheduled_start_at,
    };
    (v.state === "live" ? live : upcoming).push(row);
  }

  const toWrite = [...live, ...upcoming];
  if (toWrite.length > 0) {
    // merge-duplicates, а не ignore: `seen_at` обязан обновляться, иначе
    // идущий второй час матч выпадет из часового окна чтения и экран скажет,
    // что эфира нет, посреди эфира. И `started_at` обязан дописаться в ту же
    // строку, когда анонс наконец начался, — это тот же ролик, не новый.
    const { error } = await db
      .from("live_streams")
      .upsert(toWrite, { onConflict: "video_id" });
    if (error) {
      console.error("[live] upsert failed:", error.code, error.message);
      return Response.json({ error: "write_failed", detail: error.code }, { status: 500 });
    }
  }

  // ⚠️ КОНЧИВШЕЕСЯ УДАЛЯЕТСЯ СРАЗУ, а не ждёт чистки по `seen_at`. Иначе между
  // финальным свистком и истечением двух часов строка остаётся свежей и
  // начатой — то есть экран говорит «идёт сейчас» про доигранный матч. Чистка
  // ниже этого не ловит: она смотрит на возраст строки, а не на конец эфира.
  if (over.length > 0) {
    const { error } = await db.from("live_streams").delete().in("video_id", over);
    if (error) console.error("[live] delete ended failed:", error.code, error.message);
  }

  // Чистка — здесь, а не отдельным расписанием: она стоит один запрос и
  // должна случаться ровно тогда, когда список пересобран.
  const { error: pruneErr } = await db.rpc("prune_live_streams");
  if (pruneErr) console.error("[live] prune failed:", pruneErr.code, pruneErr.message);

  // `parsed` отвечает на вопрос «раздел пуст потому, что футбола нет, или
  // потому, что сломался разбор». Без него это неразличимо снаружи.
  return Response.json({
    channels: channels.length,
    parsed,
    // Ненулевое значение значит «бюджет кончился раньше каналов»: смотреть
    // надо не на разбор, а на то, кто из каналов отвечает медленно.
    skipped,
    // Сколько роликов нашла страница и сколько из них ИДЁТ. Разрыв между этими
    // числами — норма, а не поломка: почти всё, на что указывает `/live`, ещё
    // не началось.
    candidates: candidates.length,
    verified: true,
    live: live.length,
    upcoming: upcoming.length,
    ended: over.length,
    titles: live.map((r) => r.title),
    soon: upcoming.map((r) => `${r.scheduled_start_at} ${r.title}`),
  });
});
