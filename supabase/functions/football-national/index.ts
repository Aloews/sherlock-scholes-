// ============================================================================
// football-national — матчи сборных в календарь и результаты. БЕСПЛАТНО.
//
// ⚠️ ЗАЧЕМ ВТОРОЙ ИСТОЧНИК РАСПИСАНИЯ. Платный провайдер, который ведёт
// клубные турниры, сборных НЕ НЕСЁТ ВООБЩЕ. Замер 22.09.2026: `{"list": true}`
// у football-fixtures вернул весь его справочник футбола, и из турниров
// сборных там РОВНО ОДИН — UEFA Nations League. Ни отбора чемпионата мира, ни
// товарищеских, ни Кубка Америки, ни Кубка Африки.
//
// ESPN отдаёт их даром, одним запросом на турнир за месяц. Тем же днём:
// товарищеские 75 матчей за три месяца (пять уже сыграны), Лига наций
// CONCACAF 74 — то есть в календаре не хватало 149 матчей, и у части из них
// уже был результат.
//
// ⚠️ ЭТА ФУНКЦИЯ СОЗДАЁТ СТРОКИ, В ОТЛИЧИЕ ОТ football-scores-espn. У той в
// шапке: «ни одной строки не создаётся, расписание ведёт провайдер». Для
// клубов это по-прежнему так. Для сборных провайдера нет — значит либо строки
// создаёт этот источник, либо матчей сборных в приложении нет.
//
// ⚠️ ЛИГУ НАЦИЙ UEFA ЗДЕСЬ НЕ СПРАШИВАЕМ. Её ведёт платный провайдер, и
// второй источник задвоил бы каждый матч. Выключено в реестре строкой с
// причиной, а не отсутствием строки.
//
// ⚠️ СЧЁТ СБОРНЫХ ВЕДЁТ ЭТА ЖЕ ФУНКЦИЯ, А НЕ football-scores-espn. Та сводит
// ESPN с расписанием ПО ИМЕНАМ КЛУБОВ (`resolve_club_key` со словарём
// псевдонимов), и «Burkina Faso» в клубном словаре не найдётся никогда.
// Здесь сопоставление идёт по идентификатору события ESPN — тому самому,
// из которого сложен `id` строки. Совпадение точное, словарь не нужен.
//
// ЧЕГО ЭТА ФУНКЦИЯ НЕ ДЕЛАЕТ И ПОЧЕМУ. Не ходит за составами и не заводит
// карточки стран: в колоде нет карточек сборных, и матч сборной ни с чем не
// связывается. Он нужен в календаре и в результатах — там, где человек
// смотрит «что сегодня» и «чем кончилось».
//
// ⚠️ У КАЖДОГО ЗАПРОСА ЕСТЬ СРОК, И У ПРОГОНА ЦЕЛИКОМ ТОЖЕ. Запрос без срока
// не падает — он висит, а висящий сборщик неотличим от работающего. Это тот
// же случай, что съел ночной обход: шаг шёл 3 ч 36 мин при бюджете 80 минут.
//
// ── ДВА РЕЖИМА, И ВТОРОЙ СУЩЕСТВУЕТ РАДИ ЦЕНЫ ──────────────────────────────
//
// `calendar` (по умолчанию) — полный обход: все активные турниры × три месяца.
// Замер 22.09.2026: 13 турниров, 39 запросов, 12 секунд. Дважды в сутки.
//
// `scores` — ТОЛЬКО турниры, у которых прямо сейчас идёт или только что
// закончился матч, и только месяцы этого окна. Обычно это ноль запросов
// (ночью) или один-два. Именно поэтому его можно звать каждые пять минут, и
// именно поэтому счёт сборной обновляется так же быстро, как счёт клуба.
//
// ⚠️ ПОЛНЫЙ ОБХОД КАЖДЫЕ ПЯТЬ МИНУТ БЫЛ БЫ 11 232 ЗАПРОСА В СУТКИ к чужому
// бесплатному адресу. Ровно за такую цену — 2304 запроса в сутки — из этого
// проекта уже выброшен раздел «идёт сейчас»; см. CLAUDE.md.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const UA = "sherlock-scholes-bot/1.0 (+https://github.com/Aloews/sherlock-scholes-)";
const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Срок одного запроса к ESPN. */
const REQUEST_MS = 12_000;
/** Срок всего прогона. За ним функция дописывает собранное и выходит. */
const RUN_MS = 100_000;
/**
 * Насколько назад смотрит режим `scores`.
 *
 * Те же четыре часа, что и у `espn_leagues_in_play`: матч плюс добавленное
 * плюс серия пенальти укладываются в них с запасом, а окно шире тянуло бы
 * лишние турниры в каждый пятиминутный заход.
 */
const SCORES_BACK_HOURS = 4;

/**
 * Статусы, при которых счёт ЕСТЬ.
 *
 * ⚠️ Матч до свистка ESPN отдаёт как «0:0» со STATUS_SCHEDULED, и это НЕ
 * ничья, а отсутствие игры. Тот же список — в football-scores-espn; правило
 * одно, и разойтись им нельзя.
 */
const PLAYED = new Set([
  "STATUS_IN_PROGRESS", "STATUS_FIRST_HALF", "STATUS_HALFTIME",
  "STATUS_SECOND_HALF", "STATUS_END_PERIOD", "STATUS_OVERTIME",
  "STATUS_SHOOTOUT", "STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FINAL_PEN",
]);

/** Статусы, после которых матч считается доигранным. */
const DONE = new Set([
  "STATUS_FULL_TIME", "STATUS_FINAL", "STATUS_FINAL_PEN",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(REQUEST_MS * 2),
  });
}

/** `YYYYMM` месяца, в котором лежит момент. */
function ym(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Месяцы полного обхода: прошлый, текущий и следующий.
 *
 * ⚠️ ПРОШЛЫЙ — РАДИ РЕЗУЛЬТАТОВ, а не для полноты. Матч, сыгранный вчера,
 * лежит в прошлом месяце ровно первого числа, и без него календарь первого
 * числа теряет вчерашний счёт.
 */
export function months(now: Date): string[] {
  return [-1, 0, 1].map((shift) =>
    ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1))));
}

/**
 * Месяцы режима `scores`: те, что накрывают окно «идёт или только что было».
 *
 * ⚠️ ИХ БЫВАЕТ ДВА, И ЭТО НЕ ПЕДАНТИЗМ. Матч, начавшийся 30-го в 23:00, в
 * 01:00 первого числа всё ещё идёт — а у ESPN он лежит в ПРОШЛОМ месяце.
 * Спросить только текущий значило бы терять счёт ровно на границе месяца,
 * то есть двенадцать раз в год и всегда незаметно.
 */
export function scoreMonths(now: Date, backHours = SCORES_BACK_HOURS): string[] {
  const back = new Date(now.getTime() - backHours * 3_600_000);
  return [...new Set([ym(back), ym(now)])];
}

type League = { espn_slug: string; sport_key: string; title?: string };
type Row = {
  event_id: string; sport_key: string; commence_at: string;
  home_team: string; away_team: string;
  home_score: number | null; away_score: number | null; completed: boolean;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const startedAt = Date.now();

  // Пустое тело — законный вызов (так ходит `curl` из инструкции), поэтому
  // разбор не должен ронять функцию.
  let mode = "calendar";
  try {
    const body = await req.json() as { mode?: string };
    if (body?.mode === "scores") mode = "scores";
  } catch { /* пустое тело — полный обход */ }

  const source = mode === "scores" ? "national_leagues_in_play" : "espn_national_leagues";
  const lr = await rpc(source, {});
  if (!lr.ok) return json({ error: "leagues_failed", mode, status: lr.status }, 503);
  const leagues = await lr.json() as League[];

  // Пустой список в режиме `scores` — это ночь, а не отказ: матчей в окне нет
  // и ходить никуда не надо. Ровно это и делает пятиминутный заход бесплатным.
  if (!leagues.length) {
    return json({ mode, leagues: 0, asked: 0, fetched: 0,
                  note: mode === "scores" ? "матчей сборных в окне нет" : "реестр пуст" });
  }

  const now = new Date();
  const wanted = mode === "scores" ? scoreMonths(now) : months(now);
  const rows = new Map<string, Row>();
  const failures: string[] = [];
  const perLeague: Record<string, number> = {};
  let asked = 0;
  let ranOut = false;

  outer:
  for (const lg of leagues) {
    for (const m of wanted) {
      if (Date.now() - startedAt > RUN_MS) { ranOut = true; break outer; }
      const url = `${SCOREBOARD}/${lg.espn_slug}/scoreboard?dates=${m}`;
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(REQUEST_MS),
        });
        asked++;
        // 400 — законный ответ на турнир, которого у ESPN нет в этом сезоне,
        // и шуметь им незачем. 5xx — уже отказ, и его надо видеть.
        if (!r.ok) {
          if (r.status >= 500) failures.push(`${lg.espn_slug}/${m}:${r.status}`);
          continue;
        }
        const d = await r.json() as { events?: unknown[] };
        for (const ev of (d.events ?? []) as Record<string, never>[]) {
          const id = String(ev["id"] ?? "");
          const date = String(ev["date"] ?? "");
          if (!id || !date) continue;
          const comp = (ev["competitions"] as Record<string, never>[] ?? [])[0];
          if (!comp) continue;
          const st = ((comp["status"] ?? {}) as Record<string, never>)["type"] as
            Record<string, never> | undefined;
          const status = String(st?.["name"] ?? "");

          const by: Record<string, Record<string, never>> = {};
          for (const c of (comp["competitors"] as Record<string, never>[] ?? [])) {
            by[String(c["homeAway"])] = c;
          }
          const h = by["home"], a = by["away"];
          if (!h || !a) continue;
          const home = String((h["team"] as Record<string, never>)?.["displayName"] ?? "");
          const away = String((a["team"] as Record<string, never>)?.["displayName"] ?? "");
          if (!home || !away) continue;

          const played = PLAYED.has(status);
          const hs = Number(h["score"]), as_ = Number(a["score"]);
          rows.set(id, {
            event_id: id,
            sport_key: lg.sport_key,
            commence_at: date,
            home_team: home,
            away_team: away,
            home_score: played && Number.isFinite(hs) ? hs : null,
            away_score: played && Number.isFinite(as_) ? as_ : null,
            completed: DONE.has(status) || Boolean(st?.["completed"]),
          });
          perLeague[lg.sport_key] = (perLeague[lg.sport_key] ?? 0) + 1;
        }
      } catch (e) {
        failures.push(`${lg.espn_slug}/${m}:${(e as Error).name}`);
      }
    }
  }

  const list = [...rows.values()];
  if (!list.length) {
    return json({
      mode, leagues: leagues.length, asked, fetched: 0, failures, ranOut,
      note: "межсезонье: у активных турниров сборных сейчас нет матчей",
    });
  }

  const w = await rpc("apply_espn_fixtures", { p_rows: list });
  if (!w.ok) return json({ error: "write_failed", mode, status: w.status, failures }, 503);
  const res = (await w.json() as Record<string, number>[])[0] ?? {};

  return json({
    mode, leagues: leagues.length, asked, fetched: list.length,
    ...res, perLeague, failures, ranOut,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
});
