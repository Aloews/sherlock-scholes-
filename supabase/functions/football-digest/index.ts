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
 * сменить, и тогда лента молча опустеет. Взяты со страниц самих каналов и
 * проверены методом, который сам сначала проверен: разбор `rel="canonical"`
 * прогнан по двум каналам с заранее известными id (Premier League, LALIGA) и
 * сошёлся на обоих. Без такой сверки первый же подход дал вместо
 * «Бразилейрао» идентификатор LALIGA (он попадался в блоке рекомендаций), а
 * `@spl` разрешился в канал про чистку бассейнов.
 *
 * ПЕРВЫЕ ПЯТЬ — LEGACY. Они ходят по Atom-фиду, а его YouTube в robots.txt
 * закрывает прямо и поимённо: `Disallow: /feeds/videos.xml`. Это уже
 * работающее поведение, и ломать его здесь не место; но РАСШИРЯТЬ закрытый
 * путь нельзя, поэтому всё, что ниже пятёрки, включается только вместе с
 * ключом официального API.
 */
const LEGACY_CHANNELS: { channel: string; id: string }[] = [
  { channel: "Premier League", id: "UCG5qGWdu8nIRZqJ_GgDwQ-w" },
  { channel: "LALIGA", id: "UCTv-XvfzLX3i4IGWAm4sbmA" },
  { channel: "Serie A", id: "UCBJeMCIeLQos7wacox4hmLQ" },
  { channel: "Ligue 1", id: "UCQsH5XtIc9hONE1BQjucM0g" },
  { channel: "UEFA", id: "UCyGa1YEx9ST66rYrJTGIKOw" },
];

/** Всё остальное, что играет, когда Европа отдыхает. */
const EXTRA_CHANNELS: { channel: string; id: string }[] = [
  { channel: "Bundesliga", id: "UC6UL29enLNe4mqwTfAyeNuw" },
  { channel: "MLS", id: "UCSZbXT5TLLW_i-5W8FZpFsg" },
  { channel: "Brasileirão", id: "UCrf4Fr6uTCoU9RkYa5CbzcA" },
  { channel: "CONMEBOL", id: "UCzU8-lZlRfkV3nj0RzAZdrQ" },
  { channel: "Liga MX", id: "UCq8BPLXtFeiSFOvmJrknWGg" },
  { channel: "EFL", id: "UCkgm4b5n3QsMUgB9FjA8S2w" },
];

/**
 * Ключ официального YouTube Data API v3 — бесплатный, квота 10 000 единиц в
 * сутки.
 *
 * ЗАЧЕМ ОН, ЕСЛИ И ТАК РАБОТАЛО. Atom-фид закрыт в robots.txt YouTube
 * (`Disallow: /feeds/videos.xml`), то есть ежечасный серверный обход по нему —
 * это обход запрета. Официальный API — разрешённый путь к тем же данным, и он
 * дешёв: список загрузок канала стоит 1 единицу, статистика полусотни роликов
 * ещё 1. Одиннадцать каналов каждые двадцать минут — около 1600 единиц в
 * сутки, шестая часть квоты.
 *
 * Без ключа поведение не меняется НИСКОЛЬКО: пять прежних каналов, прежний
 * Atom, прежняя частота. Ключ включает и остальные лиги, и учащение.
 */
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY") ?? "";

const CHANNELS = YT_KEY ? [...LEGACY_CHANNELS, ...EXTRA_CHANNELS] : LEGACY_CHANNELS;

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
  /** Просмотры и оценки на момент забора. Растут — поэтому обновляются. */
  views: number;
  likes: number;
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
      // ЭТО И ЕСТЬ «ЛУЧШИЕ». Фид YouTube отдаёт media:statistics и starRating —
      // настоящий сигнал популярности, бесплатно и без ключа. Пока он не был
      // прочитан, «лучшие голы» пришлось бы выдумывать; с ним это замер.
      views: Number(/<media:statistics[^>]+views="(\d+)"/i.exec(block)?.[1] ?? 0),
      likes: Number(/<media:starRating[^>]+count="(\d+)"/i.exec(block)?.[1] ?? 0),
    });
  }
  return out;
}

interface PlaylistItem {
  snippet?: {
    title?: string;
    publishedAt?: string;
    resourceId?: { videoId?: string };
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
}

interface VideoStats {
  id: string;
  statistics?: { viewCount?: string; likeCount?: string };
}

/**
 * Ролики канала через официальный API.
 *
 * Плейлист загрузок канала — это его же идентификатор с `UC` → `UU`; так не
 * нужен лишний вызов channels.list, чтобы узнать то, что и так известно.
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН, И ВТОРОЙ ОБЯЗАТЕЛЕН. `playlistItems` отдаёт, что
 * вышло, но не отдаёт просмотров — а «самые горячие» без просмотров пришлось
 * бы выдумывать. Просмотры даёт `videos.list?part=statistics`, и он берёт до
 * полусотни идентификаторов за раз, то есть стоит ещё одну единицу на канал.
 */
async function fetchClipsViaApi(channel: string, channelId: string): Promise<ClipRow[]> {
  const uploads = "UU" + channelId.slice(2);
  const listed = await fetchText(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet` +
      `&playlistId=${uploads}&maxResults=20&key=${YT_KEY}`,
  );
  if (!listed) return [];

  let items: PlaylistItem[];
  try {
    items = (JSON.parse(listed) as { items?: PlaylistItem[] }).items ?? [];
  } catch {
    console.warn(`[digest] ${channel}: playlistItems is not JSON`);
    return [];
  }

  const rows = items
    .map((item): ClipRow | null => {
      const id = item.snippet?.resourceId?.videoId;
      const published = item.snippet?.publishedAt;
      if (!id || !published) return null;
      const when = new Date(published);
      if (Number.isNaN(when.getTime())) return null;
      const thumbs = item.snippet?.thumbnails ?? {};
      return {
        video_id: id,
        title: stripTags(item.snippet?.title ?? ""),
        channel,
        published_at: when.toISOString(),
        thumb_url:
          thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
        views: 0,
        likes: 0,
      };
    })
    .filter((row): row is ClipRow => row !== null);

  if (rows.length === 0) return [];

  const statsText = await fetchText(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics` +
      `&id=${rows.map((r) => r.video_id).join(",")}&key=${YT_KEY}`,
  );
  if (statsText) {
    try {
      const stats = (JSON.parse(statsText) as { items?: VideoStats[] }).items ?? [];
      const byId = new Map(stats.map((s) => [s.id, s.statistics]));
      for (const row of rows) {
        const s = byId.get(row.video_id);
        row.views = Number(s?.viewCount ?? 0);
        row.likes = Number(s?.likeCount ?? 0);
      }
    } catch {
      // Ролик без статистики лучше, чем никакого: он попадёт в ленту по
      // времени, просто не поборется за «самое горячее».
      console.warn(`[digest] ${channel}: statistics is not JSON`);
    }
  }
  return rows;
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
async function insert(
  table: string,
  key: string,
  rows: unknown[],
  /**
   * merge — переписать существующую строку, ignore — оставить как есть.
   *
   * РАЗНОЕ ДЛЯ ДВУХ ТАБЛИЦ, И ЭТО НЕ НЕДОСМОТР. Заголовок, однажды взятый из
   * ленты, меняться не должен: издание перепишет его через час, и читатель,
   * уже открывший новость, увидит в ленте другой текст. А у ролика меняется
   * ровно то, ради чего он здесь — просмотры; строка, замороженная в момент
   * первого забора, к воскресенью врёт о том, что было лучшим.
   */
  merge = false,
): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${key}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: `resolution=${merge ? "merge" : "ignore"}-duplicates,return=representation`,
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
  // ⚠️ ЧАСТОТА РАСТЁТ ТОЛЬКО ТАМ, ГДЕ ЭТО РАЗРЕШЕНО. Расписание участилось до
  // каждых двадцати минут ради новостей и ради лиг, которые играют, когда
  // Европа спит. Но Atom-фид YouTube закрыт в robots.txt, и опрашивать его
  // втрое чаще значило бы втрое увеличить обход запрета. Поэтому без ключа
  // ролики берутся по-прежнему раз в час — на том же двадцатом минуте, что и
  // раньше, — а с ключом идут через официальный API каждый прогон.
  const hourlySlot = new Date().getUTCMinutes() < 20;
  const wantClips = YT_KEY !== "" || hourlySlot;

  const clips = await Promise.all(
    CHANNELS.map(async (ch) => {
      if (!wantClips) return [];
      if (YT_KEY) return await fetchClipsViaApi(ch.channel, ch.id);
      const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
      return xml ? parseAtom(xml, ch.channel) : [];
    }),
  );

  const newsRows = unique(fresh(news.flat()), (row) => row.url);
  // РОЛИКИ БЕРУТСЯ ЦЕЛИКОМ, БЕЗ ОКНА В СУТКИ. Экран выходных смотрит на два
  // дня, которые к понедельнику уже позади, а фид отдаёт всего пятнадцать
  // записей на канал — выбрасывать из них всё старше суток значило бы не иметь
  // выходных вовсе. Срок жизни держит prune_digest: десять дней.
  const clipRows = unique(clips.flat(), (row) => row.video_id);

  report.news_seen = newsRows.length;
  report.news_new = await insert("news_items", "url", newsRows);
  report.clips_seen = clipRows.length;
  report.clips_new = await insert("goal_clips", "video_id", clipRows, true);
  // ПОИМЁННО, а не числом. «Молчит 2 источника» не даёт ничего сделать; лента
  // переезжает и умирает молча, и единственный способ это заметить — увидеть,
  // КТО именно перестал отвечать. Отличает «сегодня тихо» от «полгода назад
  // сменился адрес».
  report.feeds_silent = FEEDS.filter((_, i) => news[i].length === 0).map((f) => f.source);
  // Каким путём шли ролики — иначе по отчёту не отличить «ключа нет» от
  // «ключ есть, но квота кончилась».
  report.clips_source = YT_KEY ? "api" : "atom";
  // ⚠️ Пропущенный прогон — НЕ молчание. Без ключа ролики берутся раз в час, и
  // в остальные два прогона все каналы вернули бы пустоту: поимённый список
  // «молчат все одиннадцать» звучал бы как отказ источника и обесценил бы
  // единственный сигнал, ради которого он заведён.
  report.channels_silent = wantClips
    ? CHANNELS.filter((_, i) => clips[i].length === 0).map((c) => c.channel)
    : [];
  report.clips_skipped = !wantClips;

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
