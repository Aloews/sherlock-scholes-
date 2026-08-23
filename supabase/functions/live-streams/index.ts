// ============================================================================
// live-streams — что из футбола идёт прямо сейчас на ОФИЦИАЛЬНЫХ каналах лиг.
//
// ЧТО ЭТО НЕ ЕСТЬ. Не агрегатор стримов. Каналы берутся из `digest_source` —
// того же списка, с которого конвейер уже качает голы, то есть это каналы
// самих лиг. Если лига открыла эфир у себя, ссылка на него — не перепродажа
// чужого сигнала, и именно этим разговор отличается от разговора про IPTV.
//
// ⚠️ ПОЧЕМУ НЕ ОФИЦИАЛЬНЫЙ API, ХОТЯ КЛЮЧ ЕСТЬ. Два замера:
//
//   1. Идущий эфир НЕ ЛЕЖИТ в списке загрузок канала. Проверено на живом
//      эфире MLS: сто роликов в `UUSZbXT5TLLW_i-5W8FZpFsg`, эфира среди них
//      нет. Значит дешёвая пара `playlistItems` + `videos.list` (2 единицы на
//      канал) его не найдёт — та самая пара, которой берутся голы.
//   2. Найти его можно только `search.list` с `eventType=live`, а он стоит
//      100 ЕДИНИЦ за канал. Двенадцать каналов даже раз в час — 28 800 единиц
//      в сутки при квоте 10 000; на нынешних десяти минутах это 172 800. Не
//      влезает ни при каком расписании, которое имело бы смысл.
//
// Поэтому берётся публичная страница `youtube.com/channel/<id>/live`: ноль
// квоты, и `robots.txt` YouTube её не запрещает — запрещены `/feeds/videos.xml`,
// `/results`, `/youtubei/`, `/api/`, но не `/channel/` и не `/live`.
//
// ⚠️ ЦЕНА ЭТОГО РЕШЕНИЯ — РАЗМЕТКА. Мы читаем не документированный ответ, а
// страницу, и YouTube вправе её поменять. Поэтому отказ здесь ТИХИЙ И
// БЕЗОПАСНЫЙ: не нашли — не записали, экран показал пустой раздел. Ни одна
// ветка не пишет в базу «наугад». Если раздел пуст неделю — сломался разбор,
// и смотреть надо на `parsed` в ответе функции.
//
// ⚠️ ЗАГОЛОВОК БЕРЁТСЯ oEmbed'ОМ, А НЕ СО СТРАНИЦЫ. oEmbed — публичный
// документированный эндпоинт без ключа, и он отдаёт ровно то, что нужно
// предикату. Заголовок с HTML-страницы пришлось бы вычищать от разметки и
// сущностей, а это ровно тот класс работы, на котором лента Record уже один
// раз отдала «&lt;![CDATA[…».
//
// Признака «можно встраивать» здесь БОЛЬШЕ НЕТ: не-200 от oEmbed значит и
// «нельзя встраивать», и «ролика нет», а различить их отсюда невозможно —
// подробности у describe() и в шапке миграции.
//
// РАЗБОР ЗАГОЛОВКА ЗДЕСЬ НЕ ДЕЛАЕТСЯ. «Матч это или пресс-конференция»
// решают `looks_like_match` и `is_studio_talk` в базе, при чтении. Функция
// приносит, а не судит — как и football-digest.
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Один и тот же User-Agent для всех запросов. Без него YouTube отдаёт другой
// вариант страницы, в котором нужных полей может не быть.
const UA = "Mozilla/5.0 (compatible; SherlockScholesBot/1.0)";

// Потолок на ОДИН запрос. Двенадцать секунд — с запасом для страницы канала;
// больше значит держать соединение ради канала, который сегодня молчит.
const TIMEOUT_MS = 12_000;

// ⚠️ ПОТОЛОК НА ВЕСЬ ПРОГОН, И ОН НУЖЕН ИЗ-ЗА АРИФМЕТИКИ, А НЕ ИЗ ОСТОРОЖНОСТИ.
// Каналов двенадцать, идём по ним последовательно, каждый может стоить до
// TIMEOUT_MS — то есть худший случай 144 секунды. А `pg_net` в
// schedule_live_streams.sql ждёт ответа 50.
//
// Что при этом ломается — НЕ ДАННЫЕ: функция переживёт таймаут вызывающего и
// допишет строки. Пропадает ОТВЕТ, а в нём `parsed` — единственный признак,
// по которому снаружи видно, что разбор страницы сломался. То есть
// диагностика гаснет ровно в тот момент, когда прогон идёт плохо.
//
// Сорок секунд, а не пятьдесят: остаток нужен на запись, чистку и ответ.
const RUN_BUDGET_MS = 40_000;

interface Channel {
  name: string;
  ref: string;
}

interface Found {
  video_id: string;
  channel_id: string;
  channel: string;
  title: string;
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
    // один недоступный канал не должен уносить остальные одиннадцать.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Идёт ли на канале эфир, и если да — какой ролик.
 *
 * ДВА УСЛОВИЯ, А НЕ ОДНО. Страница `/live` отвечает 200 и тогда, когда эфира
 * нет — это просто страница канала. Признак эфира — `isLiveNow: true`, а
 * идентификатор берётся из canonical: только он указывает на сам ролик, а не
 * на канал. Без второго условия мы бы записывали канал как эфир.
 */
function liveVideoId(html: string): string | null {
  if (!/"isLiveNow"\s*:\s*true/.test(html) && !/"isLive"\s*:\s*true/.test(html)) return null;
  const m = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
  );
  return m ? m[1] : null;
}

/**
 * Заголовок эфира — публичным oEmbed, без ключа.
 *
 * ⚠️ ЗДЕСЬ КОГДА-ТО ВОЗВРАЩАЛСЯ ЕЩЁ И ПРИЗНАК «МОЖНО ВСТРАИВАТЬ», и это была
 * ошибка: не-200 от oEmbed значит и «встраивать нельзя», и «ролика нет», а
 * различить их отсюда невозможно. При этом без заголовка строка всё равно не
 * пишется — предикат в базе разбирает именно его. То есть признак мог принять
 * ровно одно значение, и колонка под него была ложным обещанием. Убрано вместе
 * с колонкой; подробности в шапке миграции.
 */
async function describe(videoId: string): Promise<{ title: string } | null> {
  const url =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`) +
    "&format=json";
  const body = await get(url);
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    if (typeof j?.title !== "string" || !j.title) return null;
    return { title: j.title as string };
  } catch {
    return null;
  }
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
  const found: Found[] = [];
  let parsed = 0;

  const startedAt = Date.now();
  let skipped = 0;

  // Последовательно, а не Promise.all: двенадцать запросов к одному хосту
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
    const videoId = liveVideoId(html);
    if (!videoId) continue;
    const meta = await describe(videoId);
    if (!meta) continue;
    found.push({
      video_id: videoId,
      channel_id: ch.ref,
      channel: ch.name,
      title: meta.title,
    });
  }

  if (found.length > 0) {
    // merge-duplicates, а не ignore: `seen_at` обязан обновляться, иначе
    // идущий второй час матч выпадет из часового окна чтения и экран скажет,
    // что эфира нет, посреди эфира.
    const { error } = await db
      .from("live_streams")
      .upsert(
        found.map((f) => ({ ...f, seen_at: new Date().toISOString() })),
        { onConflict: "video_id" },
      );
    if (error) {
      console.error("[live] upsert failed:", error.code, error.message);
      return Response.json({ error: "write_failed", detail: error.code }, { status: 500 });
    }
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
    live: found.length,
    titles: found.map((f) => f.title),
  });
});
