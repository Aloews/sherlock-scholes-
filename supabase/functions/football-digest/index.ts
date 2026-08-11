// ============================================================================
// football-digest — заголовки дня и видео дня.
//
// Ходит по открытым RSS/Atom-лентам, складывает результат в news_items и
// goal_clips. Ключей не требует вовсе, и это не удача, а критерий отбора:
// каждый источник ниже проверен запросом. Reddit (r/soccer) и Scorebat, которые
// были очевидными кандидатами на «лучшие голы», отвечают 403 всем, кто не
// платит — поэтому их здесь нет, а не потому, что о них не подумали.
//
// ЧТО ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ. Она не ранжирует. Громкость заголовка считается
// при чтении, в digest_news() — сюжет становится громким постепенно, и число,
// записанное в момент выхода первой заметки, к обеду было бы ложью. Здесь
// только «сходить и положить», и это делает функцию тупой и безопасной для
// повтора: обе таблицы имеют уникальный ключ, а запись идёт с on_conflict.
//
// ПОЧЕМУ XML РАЗБИРАЕТСЯ РЕГУЛЯРКАМИ. Ленты — это ~20 разных генераторов, и
// половина из них отдаёт невалидный XML (незакрытые теги, голые амперсанды).
// Строгий парсер на таком роняет весь источник целиком; регулярка по <item> и
// <entry> достаёт то, что достаётся, и молча пропускает остальное. Для задачи
// «показать заголовки» это верный размен, и он выбран сознательно.
//
// Расписание: supabase/migrations/schedule_football_digest.sql (pg_cron + pg_net).
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

/**
 * Ленты изданий, по языку.
 *
 * ДВА ИСТОЧНИКА НА ЯЗЫК — ЭТО МИНИМУМ, НИЖЕ КОТОРОГО ГРОМКОСТЬ НЕ РАБОТАЕТ.
 * Громкость считается как «сколько разных изданий вышло с тем же сюжетом», так
 * что при одном источнике она тождественно равна единице и лента вырождается в
 * хронологию. Русский, английский и испанский её имеют; португальский и
 * французский — нет, и там это честная хронология, а не сломанный рейтинг.
 *
 * Языков без проверенной ленты (ar, ja, ko, zh) здесь нет намеренно: пустая
 * строка в таблице выглядела бы как поддержка, которой не существует.
 * digest_news() отдаёт таким читателям английский.
 *
 * ДВА ИСТОЧНИКА ОТСЮДА УЖЕ УБРАНЫ, и оба по измеренной причине, а не по вкусу:
 *   • РИА Спорт — адрес отвечает 301, а цель редиректа 404. Лента переехала.
 *   • Sky Sports — отвечает 200 и полон свежих заметок, но его pubDate написан
 *     как «Tue, 11 Aug 2026 11:46:00 BST», а `new Date()` такую зону не знает и
 *     возвращает Invalid Date. Разбор ниже отказывается выдумывать время, так
 *     что источник отдавал двадцать заметок и ноль строк. Это не «сломанный
 *     парсер»: строка с придуманной датой встала бы наверх ленты навсегда.
 * Обоих поймал `feeds_silent` в отчёте — ради этого он и поимённый.
 */
const FEEDS: { lang: string; source: string; url: string }[] = [
  { lang: "en", source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml" },
  { lang: "en", source: "The Guardian", url: "https://www.theguardian.com/football/rss" },
  { lang: "ru", source: "Чемпионат", url: "https://www.championat.com/rss/news/football/" },
  { lang: "ru", source: "Soccer.ru", url: "https://www.soccer.ru/rss" },
  { lang: "es", source: "Marca", url: "https://e00-marca.uecdn.es/rss/futbol/primera-division.xml" },
  { lang: "es", source: "Mundo Deportivo", url: "https://www.mundodeportivo.com/feed/rss/futbol" },
  { lang: "pt", source: "Record", url: "https://www.record.pt/rss" },
  { lang: "fr", source: "Foot Mercato", url: "https://www.footmercato.net/flux-rss" },
];

/**
 * Официальные каналы лиг на YouTube.
 *
 * Идентификаторы, а не @-имена: имя канала — это адрес, который владелец может
 * сменить, и тогда лента молча опустеет. Взяты со страниц самих каналов.
 */
const CHANNELS: { channel: string; id: string }[] = [
  { channel: "Premier League", id: "UCG5qGWdu8nIRZqJ_GgDwQ-w" },
  { channel: "LALIGA", id: "UCTv-XvfzLX3i4IGWAm4sbmA" },
  { channel: "Serie A", id: "UCBJeMCIeLQos7wacox4hmLQ" },
  { channel: "Ligue 1", id: "UCQsH5XtIc9hONE1BQjucM0g" },
  { channel: "UEFA", id: "UCyGa1YEx9ST66rYrJTGIKOw" },
];

/** Одна лента не должна валить прогон: неудача источника — это минус источник. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "sherlock-scholes/1.0 (+https://github.com/Aloews/sherlock-scholes-)" },
      redirect: "follow",
    });
    if (!r.ok) {
      console.warn(`[digest] ${r.status} ${url}`);
      return null;
    }
    return await r.text();
  } catch (err) {
    console.warn(`[digest] ${url} threw: ${err}`);
    return null;
  }
}

function tag(block: string, name: string): string | null {
  // CDATA и обычный текст в одном выражении: ленты мешают их произвольно, а
  // отдельная ветка на каждый случай — это два места, где можно разойтись.
  const m = new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i").exec(block);
  return m ? m[1].trim() : null;
}

/** Сущности, которые реально встречаются в заголовках. Больше не нужно. */
function unescape(text: string): string {
  return text
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // Амперсанд последним: иначе «&amp;lt;» превратится в «<».
    .replace(/&amp;/g, "&");
}

function stripTags(text: string): string {
  return unescape(text.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

interface NewsRow {
  lang: string;
  source: string;
  title: string;
  url: string;
  published_at: string;
  image_url: string | null;
}

function parseRss(xml: string, lang: string, source: string): NewsRow[] {
  const out: NewsRow[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = tag(block, "title");
    const link = tag(block, "link");
    const date = tag(block, "pubDate") ?? tag(block, "dc:date");
    if (!title || !link) continue;

    const when = date ? new Date(date) : new Date();
    // Дата, которую не удалось прочитать, — это не «сейчас»: строка с
    // выдуманным временем встанет наверх ленты и останется там навсегда.
    if (Number.isNaN(when.getTime())) continue;

    const image =
      /<enclosure[^>]+url="([^"]+)"/i.exec(block)?.[1] ??
      /<media:(?:content|thumbnail)[^>]+url="([^"]+)"/i.exec(block)?.[1] ??
      null;

    out.push({
      lang,
      source,
      title: stripTags(title),
      url: unescape(link),
      published_at: when.toISOString(),
      image_url: image ? unescape(image) : null,
    });
  }
  return out;
}

interface ClipRow {
  video_id: string;
  title: string;
  channel: string;
  published_at: string;
  thumb_url: string | null;
}

function parseAtom(xml: string, channel: string): ClipRow[] {
  const out: ClipRow[] = [];
  for (const m of xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const block = m[0];
    const id = tag(block, "yt:videoId");
    const title = tag(block, "title");
    const published = tag(block, "published");
    if (!id || !title || !published) continue;
    const when = new Date(published);
    if (Number.isNaN(when.getTime())) continue;

    out.push({
      video_id: id,
      title: stripTags(title),
      channel,
      published_at: when.toISOString(),
      thumb_url: /<media:thumbnail[^>]+url="([^"]+)"/i.exec(block)?.[1] ?? null,
    });
  }
  return out;
}

/**
 * Запись пачкой, с игнором дубликатов.
 *
 * `resolution=ignore-duplicates`, а не merge: заголовок, однажды взятый из
 * ленты, не меняется, а издание вполне может переписать его через час — и
 * тогда читатель, уже открывший новость, увидит в ленте другой текст.
 *
 * `on_conflict` ОБЯЗАТЕЛЕН, и его отсутствие стоило первого прогона: без него
 * PostgREST целится в первичный ключ, а он здесь bigserial и не передаётся,
 * так что конфликта по нему не бывает никогда. Настоящий конфликт — по url
 * (и по video_id), и он приходил как 409 на всю пачку: 285 прочитанных
 * заголовков, ноль записанных, и оба числа в отчёте выглядели правдоподобно.
 */
async function insert(table: string, key: string, rows: unknown[]): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${key}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    console.error(`[digest] insert ${table}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return 0;
  }
  return ((await r.json().catch(() => [])) as unknown[]).length;
}

/** Старше суток нам не нужно — экран всё равно смотрит на 24 часа. */
function fresh<T extends { published_at: string }>(rows: T[]): T[] {
  const floor = Date.now() - 24 * 60 * 60 * 1000;
  return rows.filter((row) => Date.parse(row.published_at) > floor);
}

/**
 * Убрать повторы внутри пачки.
 *
 * Ленты повторяют одну и ту же ссылку — в разных рубриках, при обновлении
 * заметки, просто по ошибке генератора. `on_conflict` выше переживает и это,
 * но платить за передачу трёхсот строк, чтобы база выбросила треть, незачем.
 */
function unique<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const k = key(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function run(): Promise<Response> {
  const report: Record<string, unknown> = {};

  // Все ленты параллельно: их около полутора десятков, и последовательный
  // обход упирается в таймаут функции на первой же медленной.
  const news = await Promise.all(
    FEEDS.map(async (feed) => {
      const xml = await fetchText(feed.url);
      return xml ? parseRss(xml, feed.lang, feed.source) : [];
    }),
  );
  const clips = await Promise.all(
    CHANNELS.map(async (ch) => {
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
      return xml ? parseAtom(xml, ch.channel) : [];
    }),
  );

  const newsRows = unique(fresh(news.flat()), (row) => row.url);
  const clipRows = unique(fresh(clips.flat()), (row) => row.video_id);

  report.news_seen = newsRows.length;
  report.news_new = await insert("news_items", "url", newsRows);
  report.clips_seen = clipRows.length;
  report.clips_new = await insert("goal_clips", "video_id", clipRows);
  // ПОИМЁННО, а не числом. «Молчит 2 источника» не даёт ничего сделать; лента
  // переезжает и умирает молча, и единственный способ это заметить — увидеть,
  // КТО именно перестал отвечать. Отличает «сегодня тихо» от «полгода назад
  // сменился адрес».
  report.feeds_silent = FEEDS.filter((_, i) => news[i].length === 0).map((f) => f.source);
  report.channels_silent = CHANNELS.filter((_, i) => clips[i].length === 0).map((c) => c.channel);

  await fetch(`${SUPABASE_URL}/rest/v1/rpc/prune_digest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: "{}",
  }).catch((err) => console.warn(`[digest] prune failed: ${err}`));

  console.log("[digest]", JSON.stringify(report));
  return json(report);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    return await run();
  } catch (err) {
    console.error("[digest] failed", err);
    return json({ error: String(err) }, 500);
  }
});
