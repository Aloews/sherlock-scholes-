-- Счёт каждые два часа, пока идут матчи — из ESPN, а не за кредиты.
--
-- ПОЧЕМУ НЕ ЧАЩЕ ЗВАТЬ ТОГО ЖЕ ПРОВАЙДЕРА. `/scores` у the-odds-api стоит
-- ОДИН КРЕДИТ ЗА ТУРНИР ЗА ЗАПРОС при потолке 500 в месяц — в шапке
-- football-fixtures это записано так: «спрашивать все двадцать ежедневно —
-- 600 кредитов против потолка 500, расписание само съело бы бюджет».
-- Каждые два часа это не «дороже», это невозможно: даже пять турниров в игре
-- по четыре захода в день дают 600 в месяц. Замер 05.09.2026: потолок 500,
-- потрачено 24, остаток 476 — запас есть ровно потому, что путь спрашивает
-- мало и редко.
--
-- ⚠️ ПОЭТОМУ ИСТОЧНИК ДРУГОЙ, А НЕ ЧАСТОТА ДРУГАЯ. ESPN отдаёт СЧЁТ, СТАТУС И
-- МИНУТУ бесплатно и ОДНИМ запросом на лигу:
--     site.api.espn.com/apis/site/v2/sports/soccer/<slug>/scoreboard?dates=…
-- Проверено 05.09.2026: eng.1 → 7 матчей, «Newcastle 2:2 Bournemouth»,
-- STATUS_FULL_TIME, 90'+7'. Кредиты остаются целиком на разбор прогнозов.
--
-- ⚠️ ПОПРАВКА К СОБСТВЕННОЙ ЗАПИСИ. В шапке docs/clubs_crests_espn.py стоит,
-- что `site.api.espn.com` отдаёт 403 из песочницы, а живёт только
-- `sports.core.api.espn.com`. Сейчас site.api ответил 200 и полным телом на
-- 74 КБ. Ходить через core тоже можно, но там четыре-пять запросов НА МАТЧ
-- (событие → статус → команда → счёт), а Edge Function этого проекта уже
-- падала по WORKER_RESOURCE_LIMIT на длинной череде вызовов. Один запрос на
-- лигу — единственная форма, которая заведомо влезает.
--
-- ⚠️ КОРЕИ У ESPN НЕТ. В его справочнике 218 лиг и ни одного слага `kor.*`:
-- soccer_korea_kleague1 закрыт не будет и остаётся на прежнем, платном пути.
-- Написано здесь, чтобы «счёт не обновляется» не искали как поломку.

-- ---------------------------------------------------------------------------
-- Соответствие турниров — ДАННЫМИ, а не константой в коде функции: слаги
-- проверяются запросом к ESPN, и менять их не должно требовать выкладки.
-- Каждая строка ниже СВЕРЕНА с ответом ESPN 05.09.2026 (его же полем `name`).
-- ---------------------------------------------------------------------------
create table if not exists espn_league_slug (
  sport_key  text primary key,
  espn_slug  text not null unique,
  espn_name  text not null,
  checked_at date not null default current_date
);

comment on table espn_league_slug is
  'sport_key провайдера расписания → слаг лиги у ESPN. Слаги сверены запросом '
  'к ESPN, а не по памяти; Кореи у ESPN нет вовсе.';

insert into espn_league_slug (sport_key, espn_slug, espn_name) values
  ('soccer_epl',                            'eng.1',                  'English Premier League'),
  ('soccer_spain_la_liga',                  'esp.1',                  'Spanish LALIGA'),
  ('soccer_italy_serie_a',                  'ita.1',                  'Italian Serie A'),
  ('soccer_germany_bundesliga',             'ger.1',                  'German Bundesliga'),
  ('soccer_france_ligue_one',               'fra.1',                  'French Ligue 1'),
  ('soccer_netherlands_eredivisie',         'ned.1',                  'Dutch Eredivisie'),
  ('soccer_portugal_primeira_liga',         'por.1',                  'Portuguese Primeira Liga'),
  ('soccer_turkey_super_league',            'tur.1',                  'Turkish Super Lig'),
  ('soccer_russia_premier_league',          'rus.1',                  'Russian Premier League'),
  ('soccer_usa_mls',                        'usa.1',                  'MLS'),
  ('soccer_mexico_ligamx',                  'mex.1',                  'Mexican Liga BBVA MX'),
  ('soccer_argentina_primera_division',     'arg.1',                  'Argentine Liga Profesional de Fútbol'),
  ('soccer_brazil_campeonato',              'bra.1',                  'Brazilian Serie A'),
  ('soccer_japan_j_league',                 'jpn.1',                  'Japanese J.League'),
  ('soccer_china_superleague',              'chn.1',                  'Chinese Super League'),
  ('soccer_uefa_champs_league',             'uefa.champions',         'UEFA Champions League'),
  ('soccer_uefa_europa_league',             'uefa.europa',            'UEFA Europa League'),
  ('soccer_uefa_europa_conference_league',  'uefa.europa.conf',       'UEFA Conference League'),
  ('soccer_uefa_nations_league',            'uefa.nations',           'UEFA Nations League'),
  ('soccer_conmebol_copa_libertadores',     'conmebol.libertadores',  'CONMEBOL Libertadores'),
  ('soccer_conmebol_copa_sudamericana',     'conmebol.sudamericana',  'CONMEBOL Sudamericana'),
  ('soccer_uefa_champs_league_qualification','uefa.champions_qual',   'UEFA Champions League Qualifying')
on conflict (sport_key) do update
  set espn_slug = excluded.espn_slug,
      espn_name = excluded.espn_name,
      checked_at = excluded.checked_at;

grant select on espn_league_slug to service_role;

-- ---------------------------------------------------------------------------
-- Какие лиги спрашивать СЕЙЧАС. «Идут матчи» — это окно вокруг начала, а не
-- «есть матч сегодня»: спрашивать лигу, чей матч будет вечером, смысла нет.
--
-- Окно с запасом в обе стороны: −15 минут ловит сдвиг начала, +4 часа
-- покрывает добавленное время, перерывы и задержку, с которой ESPN проставляет
-- FULL_TIME. Матч, уже помеченный completed, из окна выпадает сам.
-- ---------------------------------------------------------------------------
create or replace function public.espn_leagues_in_play()
returns table(sport_key text, espn_slug text, matches integer)
language sql
stable
security definer
set search_path = public
as $function$
  select f.sport_key, s.espn_slug, count(*)::integer
    from fixtures f
    join espn_league_slug s on s.sport_key = f.sport_key
   where not f.completed
     and f.commence_at between now() - interval '4 hours' and now() + interval '15 minutes'
   group by f.sport_key, s.espn_slug;
$function$;

comment on function public.espn_leagues_in_play() is
  'Лиги, у которых прямо сейчас идёт хотя бы один матч. Пустой ответ — '
  'законный: ночью спрашивать нечего и ходить никуда не надо.';

revoke all on function public.espn_leagues_in_play() from public;
grant execute on function public.espn_leagues_in_play() to service_role;

-- ---------------------------------------------------------------------------
-- Запись счёта. СОПОСТАВЛЯЕТ БАЗА: имена команд у ESPN и у провайдера
-- расписания разные («Newcastle United» против «Newcastle»), и сводит их
-- штатный `resolve_club_key` со своим словарём псевдонимов. Второй копии
-- этого правила в Edge Function быть не должно.
--
-- ⚠️ ПАРА КЛЮЧЕЙ, А НЕ ОДНО ИМЯ. Матч опознаётся тройкой «турнир + хозяин +
-- гость» в пределах суток от начала. Одного имени мало: один и тот же клуб
-- играет дважды за тур в разных турнирах.
--
-- ⚠️ НЕОДНОЗНАЧНОСТЬ — ОТКАЗ. Если под тройку подходят два матча (двойная
-- встреча в пределах суток), не пишем ни в один и возвращаем числом.
--
-- ⚠️ NULL НЕ ЗАТИРАЕТ СЧЁТ. Матч до стартового свистка отдаёт у ESPN «0:0»
-- со статусом STATUS_SCHEDULED — это не ничья, а отсутствие игры. Пишем
-- только при статусе, означающем, что мяч был в игре.
--
-- ⚠️ `completed` СТАВИТСЯ ТОЛЬКО ВВЕРХ. Снять его нельзя: разбор прогнозов
-- уже мог по нему пройти, и «раззавершение» матча вернуло бы людям снятые
-- очки в неопределённом состоянии.
-- ---------------------------------------------------------------------------
create or replace function public.apply_espn_scores(p_rows jsonb)
returns table(written integer, ambiguous integer, unmatched integer, seen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_written integer := 0;
  v_amb     integer := 0;
  v_unm     integer := 0;
  v_seen    integer := 0;
begin
  create temp table _sc on commit drop as
  select r->>'sport_key'                       as sport_key,
         resolve_club_key(r->>'home', null)    as home_key,
         resolve_club_key(r->>'away', null)    as away_key,
         (r->>'home_score')::smallint          as home_score,
         (r->>'away_score')::smallint          as away_score,
         (r->>'completed')::boolean            as completed,
         (r->>'commence_at')::timestamptz      as commence_at
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'sport_key','') <> ''
     and r->>'home_score' is not null
     and r->>'away_score' is not null;

  select count(*) into v_seen from pg_temp._sc;

  with cand as (
    select s.*, f.id as fixture_id
      from pg_temp._sc s
      join fixtures f
        on f.sport_key = s.sport_key
       and resolve_club_key(f.home_team, null) = s.home_key
       and resolve_club_key(f.away_team, null) = s.away_key
       and f.commence_at between s.commence_at - interval '1 day'
                             and s.commence_at + interval '1 day'
     where s.home_key is not null and s.away_key is not null
  ),
  clean as (
    select c.* from cand c
     where 1 = (select count(*) from cand x
                 where x.sport_key = c.sport_key
                   and x.home_key = c.home_key and x.away_key = c.away_key)
       and 1 = (select count(*) from cand y where y.fixture_id = c.fixture_id)
  ),
  upd as (
    update fixtures f
       set home_score = k.home_score,
           away_score = k.away_score,
           completed  = f.completed or k.completed,   -- только вверх, см. шапку
           scores_at  = now(),
           updated_at = now()
      from clean k
     where f.id = k.fixture_id
       and (f.home_score is distinct from k.home_score
         or f.away_score is distinct from k.away_score
         or (k.completed and not f.completed))
    returning 1
  )
  select (select count(*) from upd),
         (select count(*) from cand) - (select count(*) from clean),
         (select count(*) from pg_temp._sc) - (select count(distinct (sport_key, home_key, away_key)) from cand)
    into v_written, v_amb, v_unm;

  drop table pg_temp._sc;
  return query select v_written, v_amb, v_unm, v_seen;
end;
$function$;

comment on function public.apply_espn_scores(jsonb) is
  'Пишет счёт из ESPN в fixtures. Матч опознаётся тройкой турнир+хозяин+гость '
  'через resolve_club_key; неоднозначное не пишется и возвращается числом.';

revoke all on function public.apply_espn_scores(jsonb) from public;
grant execute on function public.apply_espn_scores(jsonb) to service_role;
