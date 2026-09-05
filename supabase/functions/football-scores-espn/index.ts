// ============================================================================
// football-scores-espn — счёт каждые два часа, пока идут матчи. БЕСПЛАТНО.
//
// ПОЧЕМУ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ЧАЩЕ ЗВАТЬ football-fixtures. `/scores` у
// the-odds-api стоит ОДИН КРЕДИТ ЗА ТУРНИР ЗА ЗАПРОС при потолке 500 в месяц.
// В шапке football-fixtures это уже посчитано: «спрашивать все двадцать
// ежедневно — 600 против 500, расписание само съело бы бюджет». Каждые два
// часа там не «дороже», а невозможно: пять турниров в игре по четыре захода
// в день — те же 600 в месяц.
//
// ESPN отдаёт счёт, статус и минуту даром и ОДНИМ запросом на лигу. Замер
// 05.09.2026: 11 лиг в игре, 33 матча со счётом, 15 записано, 0 неоднозначных.
//
// ⚠️ ОДИН ЗАПРОС НА ЛИГУ — ЭТО ТРЕБОВАНИЕ, А НЕ УДОБСТВО. У ESPN есть и
// core-API, но там четыре-пять запросов НА МАТЧ (событие → статус → команда →
// счёт). Эта функция уже падала по WORKER_RESOURCE_LIMIT на длинной череде
// вызовов, и тогда потерялись 23 турнира из 24. Здесь запросов столько,
// сколько лиг сейчас играет — обычно меньше пятнадцати.
//
// ⚠️ СОПОСТАВЛЯЕТ БАЗА, А НЕ ЭТА ФУНКЦИЯ. Имена команд у ESPN и у провайдера
// расписания разные; сводит их `resolve_club_key` со своим словарём
// псевдонимов внутри `apply_espn_scores`. Второй копии правила здесь нет.
//
// ⚠️ НИ ОДНОЙ СТРОКИ НЕ СОЗДАЁТСЯ. `apply_espn_scores` только ОБНОВЛЯЕТ уже
// существующие матчи. Поэтому матч, которого нет в нашем расписании, просто
// не находится — и это правильно: расписание ведёт провайдер, а не ESPN.
//
// ⚠️ КОРЕИ У ESPN НЕТ. 218 лиг в его справочнике, ни одного слага `kor.*`.
// soccer_korea_kleague1 остаётся на платном пути; см. espn_live_scores.sql.
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const UA = "sherlock-scholes-bot/1.0 (+https://github.com/Aloews/sherlock-scholes-)";
const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/**
 * Статусы, при которых счёт ЕСТЬ.
 *
 * ⚠️ Матч до свистка ESPN отдаёт как «0:0» со STATUS_SCHEDULED, и это НЕ
 * ничья, а отсутствие игры. Записать такое значило бы объявить несыгранный
 * матч сыгранным — а `completed` снимается только вручную, потому что по нему
 * уже мог пройти разбор прогнозов.
 */
const PLAYED = new Set([
  "STATUS_IN_PROGRESS", "STATUS_FIRST_HALF", "STATUS_HALFTIME",
  "STATUS_SECOND_HALF", "STATUS_END_PERIOD", "STATUS_OVERTIME",
  "STATUS_SHOOTOUT", "STATUS_FULL_TIME", "STATUS_FINAL",
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
  });
}

type League = { sport_key: string; espn_slug: string; matches: number };
type Row = {
  sport_key: string; home: string; away: string;
  home_score: number; away_score: number;
  completed: boolean; commence_at: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const lr = await rpc("espn_leagues_in_play", {});
  if (!lr.ok) return json({ error: "leagues_failed", status: lr.status }, 503);
  const leagues = await lr.json() as League[];

  // Пустой список — законный ответ, а не отказ: ночью матчей нет и ходить
  // никуда не надо. Именно это и делает шаг раз в два часа бесплатным.
  if (!leagues.length) return json({ leagues: 0, written: 0, note: "матчей в окне нет" });

  const rows: Row[] = [];
  const failures: string[] = [];

  for (const lg of leagues) {
    try {
      const r = await fetch(`${SCOREBOARD}/${lg.espn_slug}/scoreboard`,
                            { headers: { "User-Agent": UA } });
      if (!r.ok) { failures.push(`${lg.espn_slug}:${r.status}`); continue; }
      const d = await r.json() as { events?: unknown[] };
      for (const ev of (d.events ?? []) as Record<string, never>[]) {
        const comp = (ev["competitions"] as Record<string, never>[] ?? [])[0];
        if (!comp) continue;
        const st = ((comp["status"] ?? {}) as Record<string, never>)["type"] as
          Record<string, never> | undefined;
        if (!st || !PLAYED.has(String(st["name"]))) continue;
        const by: Record<string, Record<string, never>> = {};
        for (const c of (comp["competitors"] as Record<string, never>[] ?? [])) {
          by[String(c["homeAway"])] = c;
        }
        const h = by["home"], a = by["away"];
        if (!h || !a) continue;
        const hs = Number(h["score"]), as_ = Number(a["score"]);
        if (!Number.isFinite(hs) || !Number.isFinite(as_)) continue;
        rows.push({
          sport_key: lg.sport_key,
          home: String((h["team"] as Record<string, never>)?.["displayName"] ?? ""),
          away: String((a["team"] as Record<string, never>)?.["displayName"] ?? ""),
          home_score: hs, away_score: as_,
          completed: Boolean(st["completed"]),
          commence_at: String(ev["date"] ?? ""),
        });
      }
    } catch (e) {
      failures.push(`${lg.espn_slug}:${(e as Error).message.slice(0, 40)}`);
    }
  }

  if (!rows.length) {
    return json({ leagues: leagues.length, written: 0, failures,
                  note: "лиги в игре есть, счёта ещё нет" });
  }

  const w = await rpc("apply_espn_scores", { p_rows: rows });
  if (!w.ok) return json({ error: "write_failed", status: w.status, failures }, 503);
  const res = (await w.json() as Record<string, number>[])[0] ?? {};

  return json({ leagues: leagues.length, fetched: rows.length, ...res, failures });
});
