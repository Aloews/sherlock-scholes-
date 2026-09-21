// ============================================================================
// amateur-logo — загрузка логотипа любительской лиги или команды.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ЗАГРУЗКА ИЗ БРАУЗЕРА. У игрока нет своего
// Supabase-токена: он аноним с ключом, который лежит в каждом браузере.
// Политика на insert в корзину для роли anon отдала бы её всему миру — любой
// смог бы залить что угодно и подменить чужой логотип. Поэтому пишет только
// сервисный ключ, и только здесь.
//
// ЧТО ПРОВЕРЯЕТСЯ, ПО ПОРЯДКУ И ДО ЕДИНОГО БАЙТА НА ДИСКЕ:
//   1. подпись Telegram (tg_validate_init_data в базе) — кто это;
//   2. вид и идентификатор — что правим;
//   3. ВЛАДЕНИЕ — правило живёт в SQL (amateur_set_logo), не здесь;
//   4. тип и размер картинки — по её собственным первым байтам, а не по
//      тому, как её назвал клиент.
//
// ⚠️ ТИП ОПРЕДЕЛЯЕТСЯ ПО СОДЕРЖИМОМУ. Клиент может назвать «image/png» что
// угодно, включая html со скриптом; корзина публичная, и такой файл отдавался
// бы браузеру с нашего домена. Смотрим сигнатуру: PNG, JPEG или WebP — иначе
// отказ.
//
// ⚠️ ПРЕДЕЛ РАЗМЕРА ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ ТОЛЬКО В КОРЗИНЕ. Корзина
// откажет после приёма тела; мы отказываем до него.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_BYTES = 256 * 1024;
const BUCKET = "amateur-logos";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

/** Тип по первым байтам. Возвращает null для всего, что не картинка. */
function sniff(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // RIFF....WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => null) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "not_configured" }, 500);

  let body: { initData?: string; kind?: string; id?: string; data?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const { initData, kind, id, data } = body;
  if (!initData) return json({ error: "no_signature" }, 401);
  if (kind !== "league" && kind !== "team") return json({ error: "bad_kind" }, 400);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad_id" }, 400);
  if (!data) return json({ error: "no_image" }, 400);

  // 1. Кто это. Подпись проверяет БАЗА тем же кодом, что и везде: второй
  //    реализации HMAC в проекте нет намеренно.
  const me = await rpc("amateur_me", { p_init_data: initData });
  if (!me.ok || typeof me.data !== "number") {
    return json({ error: "bad_signature" }, 401);
  }
  const telegramId = me.data as number;

  // 2. Картинка. base64 без префикса data:; префикс режем, если пришёл.
  const b64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  // ⚠️ ОЦЕНКА РАЗМЕРА ДО ДЕКОДИРОВАНИЯ. base64 раздувает на треть; проверить
  // после декодирования значит сперва разложить в памяти то, что мы и так
  // собирались отвергнуть.
  if (b64.length > MAX_BYTES * 1.4) return json({ error: "too_big" }, 413);

  // ⚠️ ПАРАМЕТР У `Uint8Array` ОБЯЗАТЕЛЕН, И ЭТО НЕ УКРАШЕНИЕ. С TypeScript
  // 5.7 тип стал обобщённым, и голое `Uint8Array` значит
  // `Uint8Array<ArrayBufferLike>`, которое `fetch` в тело не принимает.
  // Присваивается сюда всегда `new Uint8Array(...)`, то есть
  // `Uint8Array<ArrayBuffer>` — аннотация лишь перестаёт его расширять.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json({ error: "bad_base64" }, 400);
  }
  if (bytes.length > MAX_BYTES) return json({ error: "too_big" }, 413);

  const mime = sniff(bytes);
  if (!mime) return json({ error: "not_an_image" }, 415);

  // 3. Имя файла НЕ ИЗ ЗАПРОСА. Клиентское имя — это путь, который клиент
  //    выбирает сам, то есть возможность писать поверх чужого файла.
  const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp";
  const path = `${kind}/${id}.${ext}`;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": mime,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) {
    return json({ error: "upload_failed", status: up.status }, 502);
  }

  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  // 4. ВЛАДЕНИЕ ПРОВЕРЯЕТ SQL, А НЕ ЭТА ФУНКЦИЯ. Правило «кто может менять
  //    логотип» лежит рядом с данными: amateur_set_logo обновляет строку
  //    только если owner_tg совпал, и возвращает false, если нет.
  const set = await rpc("amateur_set_logo", {
    p_telegram_id: telegramId, p_kind: kind, p_id: id, p_url: url,
  });
  if (!set.ok || set.data !== true) {
    return json({ error: "not_owner" }, 403);
  }

  return json({ url });
});
