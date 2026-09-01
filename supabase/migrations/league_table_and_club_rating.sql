-- ============================================================================
-- ТУРНИРНАЯ ТАБЛИЦА И РЕЙТИНГ КОМАНД — вторая половина общей системы рейтинга.
--
-- ЗАЧЕМ. Владелец: «общей системы рейтинга так и нет, как и таблицы». Он прав
-- по обоим пунктам. `player_level` — это уровень ИГРОКА; у клуба числа не было
-- вообще, и сравнить команду с футболистом было нечем. Таблицы не было тоже:
-- в комментарии к экрану команды прямо стояло «ЭТО НЕ ТУРНИРНАЯ ТАБЛИЦА».
--
-- ЗДЕСЬ ДВА РАЗНЫХ ОТВЕТА НА ДВА РАЗНЫХ ВОПРОСА, и путать их нельзя:
--
--   `league_table`  — «как идут дела В ЭТОМ СЕЗОНЕ»: очки, и ничего кроме
--                     очков. Внутри своей лиги.
--   `club_rating`   — «насколько команда сильна вообще»: Эло, сравнимое между
--                     лигами, потому что учитывает, КОГО обыграли.
--
-- Первое место в слабой лиге при среднем рейтинге — не противоречие, а ровно
-- та разница, ради которой заведены обе.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Где начинается сезон.
--
-- ⚠️ КАЛЕНДАРЯ СЕЗОНОВ У НАС НЕТ и купить негде. Граница ВЫВОДИТСЯ ИЗ ДАННЫХ:
-- летний перерыв виден в расписании сам — последний разрыв длиннее 30 дней.
--
-- Почему это вообще понадобилось: без границы таблица считалась бы за
-- скользящие 400 дней, а это ДВА сезона. Замер: у АПЛ в таком окне 786 матчей
-- и 23 команды при двадцати в лиге — вылетевшие и пришедшие вперемешку.
--
-- `source = manual` — граница, поставленная человеком; пересборка её не
-- трогает. Нужно для МЛС и Бразилии: там сезон календарный, и разрыв в
-- середине лета — перерыв, а не новый сезон.
-- ---------------------------------------------------------------------------
create table if not exists public.league_season (
  tournament   text primary key,
  season_start date not null,
  source       text not null default 'detected',
  detected_at  timestamptz not null default now()
);

comment on table public.league_season is
  'Где начинается текущий сезон турнира. Календаря сезонов нет — граница '
  'выводится из данных: последний разрыв в датах длиннее 30 дней.';

create or replace function public.rebuild_league_seasons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into league_season (tournament, season_start, source, detected_at)
  select tournament, season_start, 'detected', now()
    from (
      select tournament,
             max(match_date) filter (where gap >= 30) as season_start
        from (
          select tournament, match_date,
                 match_date - lag(match_date) over (partition by tournament order by match_date) as gap
            from (select distinct tournament, match_date
                    from club_match where home_score is not null) x
        ) d
       group by tournament
    ) s
   where s.season_start is not null
  on conflict (tournament) do update set
    season_start = case when league_season.source = 'manual'
                        then league_season.season_start else excluded.season_start end,
    detected_at  = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Таблица.
--
-- ⚠️ ЧЕСТНОСТЬ ЗДЕСЬ ДЕРЖИТСЯ НА КОЛОНКЕ «СЫГРАНО», И ОНА ПЕРВАЯ НЕ ИЗ
-- ТРАДИЦИИ. Наши матчи собраны из статистики игроков: в них попали только те,
-- где сыграл кто-то из оцифрованных. Замер по сезону 2026/27: в РПЛ у команд
-- 5–6 матчей, в АПЛ 1–2, в Ла Лиге 1–3 — это НАСТОЯЩИЕ числа сыгранного,
-- потому что европейский сезон только начался. Но «начало сезона» и «сбор
-- потерял половину» выглядят на экране одинаково, и различить их можно только
-- одним способом: посмотреть, ОДИНАКОВО ли мало у всех. Отсюда «И» первой
-- колонкой и `coverageIsEven` на клиенте.
--
-- Порядок — футбольный: очки, разница, забитые. Не «по проценту побед»: при
-- разном числе игр процент ставит выше того, кто сыграл меньше.
--
-- ⚠️ `place`, а НЕ `position`: в списке колонок RETURNS TABLE это
-- зарезервированное слово, и функция не создаётся вовсе.
-- ---------------------------------------------------------------------------
create or replace function public.league_table(p_tournament text, p_lang text default 'ru')
returns table (
  place        integer,
  club_key     text,
  name         text,
  crest_url    text,
  played       integer,
  wins         integer,
  draws        integer,
  losses       integer,
  goals_for    integer,
  goals_against integer,
  goal_diff    integer,
  points       integer,
  form         text
)
language sql stable
security definer
set search_path = public
as $$
  with start as (
    select coalesce((select season_start from league_season where tournament = p_tournament),
                    current_date - 400) as st
  ),
  played as (
    select x.k as club_key, m.match_date,
           case when x.k = m.home_key then m.home_score else m.away_score end as gf,
           case when x.k = m.home_key then m.away_score else m.home_score end as ga
      from club_match m, start s,
      lateral (select unnest(array[m.home_key, m.away_key]) as k) x
     where m.tournament = p_tournament
       and m.match_date >= s.st
       and m.home_score is not null and m.away_score is not null
  ),
  agg as (
    select club_key,
           count(*)::int                                  as played,
           count(*) filter (where gf > ga)::int            as wins,
           count(*) filter (where gf = ga)::int            as draws,
           count(*) filter (where gf < ga)::int            as losses,
           sum(gf)::int                                    as gf,
           sum(ga)::int                                    as ga,
           (sum(gf) - sum(ga))::int                        as gd,
           (count(*) filter (where gf > ga) * 3
            + count(*) filter (where gf = ga))::int        as pts,
           -- Форма считается здесь же, а не вторым запросом: иначе две
           -- выборки разъедутся по границе сезона.
           string_agg(case when gf > ga then 'w' when gf = ga then 'd' else 'l' end,
                      '' order by match_date desc)         as all_form
      from played group by club_key
  )
  select (row_number() over (order by a.pts desc, a.gd desc, a.gf desc, f.name))::int,
         a.club_key,
         coalesce(club_display_name(a.club_key, p_lang), f.name),
         f.crest_url,
         a.played, a.wins, a.draws, a.losses, a.gf, a.ga, a.gd, a.pts,
         left(a.all_form, 5)
    from agg a
    left join football_club f on f.club_key = a.club_key
   order by a.pts desc, a.gd desc, a.gf desc, f.name
$$;

create or replace function public.league_list(p_lang text default 'ru', p_limit integer default 30)
returns table (tournament text, country text, teams integer, matches integer, season_start date)
language sql stable
security definer
set search_path = public
as $$
  select m.tournament,
         tournament_scope(m.tournament),
         count(distinct x.k)::int,
         count(distinct (m.match_date, m.home_key, m.away_key))::int,
         s.season_start
    from club_match m
    join league_season s on s.tournament = m.tournament
    cross join lateral (select unnest(array[m.home_key, m.away_key]) as k) x
   where m.match_date >= s.season_start
     and m.home_score is not null
     and not is_national_tournament(m.tournament)
     and m.tournament !~* 'кубок|суперкубок|товарищеск'
     and tournament_scope(m.tournament) is not null
   group by m.tournament, s.season_start
  having count(distinct x.k) >= 6
   order by count(distinct (m.match_date, m.home_key, m.away_key)) desc
   limit greatest(coalesce(p_limit, 30), 1)
$$;

comment on function public.league_list(text, integer) is
  'Турниры, для которых таблица осмысленна: лига (не кубок, не сборные, не '
  'товарищеские), страна названа, хотя бы шесть команд.';

-- ---------------------------------------------------------------------------
-- 3. Рейтинг команд.
--
-- ⚠️ ПОЧЕМУ ЭЛО, А НЕ ОЧКИ И НЕ ПРОЦЕНТ ПОБЕД. У нас неровное расписание:
-- клубы играют разное число матчей и с разными соперниками, а еврокубковые —
-- ещё и с командами других лиг. Очки на такое не отвечают: шесть побед в
-- слабой лиге дают больше очков, чем три в сильной. Эло считает, КОГО ты
-- обыграл.
-- ---------------------------------------------------------------------------
create table if not exists public.club_rating (
  club_key      text primary key,
  elo           integer not null,
  level         smallint,
  played        integer not null default 0,
  last_match    date,
  league_weight numeric,
  computed_at   timestamptz not null default now()
);

create index if not exists club_rating_level_idx on public.club_rating (level desc);

comment on table public.club_rating is
  'Сила команды по результатам матчей. level — Эло, приведённое к 0–100, ТОЙ '
  'ЖЕ шкале, что player_level.level: ради этого всё и делалось.';

comment on column public.club_rating.league_weight is
  'Насколько мы вправе верить УРОВНЮ ЛИГИ этого клуба: доля межлиговых матчей, '
  'приведённая к 0..1. Экран обязан это показывать — см. шапку функции.';

create or replace function public.rebuild_club_ratings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- K — насколько один матч двигает рейтинг. 20 — обычное для футбола: при 40
  -- таблица прыгает после каждого тура, при 10 не успевает за переходом
  -- команды из лиги в лигу.
  c_k          constant numeric := 20;
  c_home       constant numeric := 60;   -- преимущество своего поля, в Эло
  c_start      constant numeric := 1500;
  c_min_played constant int     := 5;
  -- Сколько межлиговых матчей нужно, чтобы поверить УРОВНЮ ЛИГИ целиком.
  c_full_trust constant numeric := 40;
  -- ⚠️ ИМЯ ПЕРЕМЕННОЙ ЦИКЛА НЕ ДОЛЖНО СОВПАДАТЬ С ПСЕВДОНИМОМ В ЗАПРОСЕ. Она
  -- называлась `m`, и ниже был CTE с псевдонимом `m`: plpgsql разрешил
  -- `m.league` в СВОЮ запись и упал с «record m has no field league» — в
  -- запросе, где всё написано верно.
  match_row record;
  v_h numeric; v_a numeric; v_exp numeric; v_score numeric; v_count integer;
begin
  create temporary table _elo on commit drop as
    select club_key, c_start as elo, 0 as played, null::date as last_match
      from football_club where kind = 'club';
  create unique index on _elo (club_key);

  -- ⚠️ ХРОНОЛОГИЧЕСКИ, И ЭТО НЕ ПРИДИРКА. Эло — последовательность: рейтинг
  -- после матча зависит от рейтингов ДО него. Обработать матчи в другом
  -- порядке значит получить другое число, которое выглядит так же.
  for match_row in
    select home_key, away_key, home_score, away_score, match_date
      from club_match
     where home_score is not null and away_score is not null
     order by match_date, home_key, away_key
  loop
    select elo into v_h from _elo where club_key = match_row.home_key;
    select elo into v_a from _elo where club_key = match_row.away_key;
    -- Команда вне справочника (сборная) в рейтинг не идёт — пропускаем именно
    -- этот матч, а не весь прогон.
    continue when v_h is null or v_a is null;

    v_exp := 1.0 / (1.0 + power(10.0, (v_a - (v_h + c_home)) / 400.0));
    v_score := case when match_row.home_score > match_row.away_score then 1.0
                    when match_row.home_score = match_row.away_score then 0.5
                    else 0.0 end;

    update _elo set elo = elo + c_k * (v_score - v_exp), played = played + 1,
                    last_match = greatest(coalesce(last_match, match_row.match_date),
                                          match_row.match_date)
     where club_key = match_row.home_key;
    update _elo set elo = elo - c_k * (v_score - v_exp), played = played + 1,
                    last_match = greatest(coalesce(last_match, match_row.match_date),
                                          match_row.match_date)
     where club_key = match_row.away_key;
  end loop;

  -- ⚠️ ЭЛО СРАВНИМО МЕЖДУ ЛИГАМИ РОВНО НАСТОЛЬКО, НАСКОЛЬКО ЛИГИ ИГРАЮТ ДРУГ
  -- С ДРУГОМ, и это пришлось чинить по замеру. Первая версия отдала ЧЕТЫРЕ
  -- саудовских клуба выше ПСЖ, а «Аль-Кадисию» — на уровень 98. Причина не в
  -- формуле: у саудовской лиги 13 межлиговых матчей из 222 (6%), у МЛС 11 из
  -- 331 (3%), у японской 10%, тогда как у европейских 11–14%. Лига-остров
  -- копит рейтинг внутри себя, и сверить его не с чем — а на экране это
  -- выглядит совершенно нормально.
  --
  -- Лечится не выбрасыванием лиги, а честностью про то, что мы знаем:
  -- ВНУТРЕННИЙ порядок лиги остаётся как есть (он выведен из настоящих
  -- матчей), а СРЕДНИЙ УРОВЕНЬ подтягивается к общему тем сильнее, чем меньше
  -- лига играет с другими.
  create temporary table _cross on commit drop as
    select f.league,
           count(*) filter (where fh.league <> fa.league) as cross_n
      from club_match c
      join football_club fh on fh.club_key = c.home_key
      join football_club fa on fa.club_key = c.away_key
      join football_club f  on f.club_key in (c.home_key, c.away_key)
     where c.match_date >= current_date - 400 and c.home_score is not null
       and fh.league is not null and fa.league is not null and f.league is not null
     group by f.league;

  create temporary table _adj on commit drop as
  with lg as (
    select e.club_key, e.elo, e.played, e.last_match, f.league
      from _elo e join football_club f on f.club_key = e.club_key
     where e.played > 0
  ),
  league_mean as (
    select league, avg(elo) as mean_elo from lg where league is not null group by league
  ),
  global as (select avg(elo) as g from lg)
  select l.club_key, l.played, l.last_match, l.league,
         least(1.0, coalesce(c.cross_n, 0) / c_full_trust) as w,
         case when l.league is null or lm.mean_elo is null then l.elo
              else (select g from global)
                 + (lm.mean_elo - (select g from global))
                   * least(1.0, coalesce(c.cross_n, 0) / c_full_trust)
                 + (l.elo - lm.mean_elo)
         end as elo
    from lg l
    left join league_mean lm on lm.league = l.league
    left join _cross      c  on c.league  = l.league;

  delete from club_rating;

  insert into club_rating (club_key, elo, level, played, last_match, league_weight, computed_at)
  select a.club_key,
         round(a.elo)::int,
         -- NULL при менее чем пяти матчах: Эло по двум играм — это стартовые
         -- 1500 плюс шум, и показывать его как уровень значит показывать шум.
         case when a.played >= c_min_played
              then round(100 * percent_rank() over (order by a.elo))::smallint end,
         a.played, a.last_match, round(a.w, 2), now()
    from _adj a;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.rebuild_club_ratings() is
  'Пересобирает club_rating. Матчи обрабатываются ХРОНОЛОГИЧЕСКИ (Эло — '
  'последовательность). Средний уровень лиги подтягивается к общему тем '
  'сильнее, чем меньше она играет с другими: без этого лига-остров копит '
  'рейтинг внутри себя и её середняк встаёт выше ПСЖ.';

-- ---------------------------------------------------------------------------
-- 4. Права.
-- ---------------------------------------------------------------------------
alter table public.league_season enable row level security;
alter table public.club_rating   enable row level security;
drop policy if exists league_season_read on public.league_season;
create policy league_season_read on public.league_season
  for select to anon, authenticated using (true);
drop policy if exists club_rating_read on public.club_rating;
create policy club_rating_read on public.club_rating
  for select to anon, authenticated using (true);

grant select on public.league_season to anon, authenticated;
grant select on public.club_rating   to anon, authenticated;
grant select, insert, update, delete on public.league_season to service_role;
grant select, insert, update, delete on public.club_rating   to service_role;

revoke all on function public.rebuild_league_seasons() from public, anon, authenticated;
revoke all on function public.rebuild_club_ratings()  from public, anon, authenticated;
grant execute on function public.rebuild_league_seasons() to service_role;
grant execute on function public.rebuild_club_ratings()   to service_role;
grant execute on function public.league_table(text, text)   to anon, authenticated, service_role;
grant execute on function public.league_list(text, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Пересборка — 06:35 UTC, МЕЖДУ конвейером клубов (06:25) и уровнями
--    игроков (06:40).
--
-- ⚠️ ПОРЯДОК ОБЯЗАТЕЛЕН, И ОН НЕ ПРО УДОБСТВО:
--   06:10  rebuild_card_current_clubs — клубы игроков из википедии
--   06:25  rebuild_clubs_all          — справочник, словарь, составы, МАТЧИ
--   06:35  здесь                      — сезоны и рейтинг ЧИТАЮТ club_match
--   06:40  rebuild_player_levels      — уровни игроков
--
-- Запустить рейтинг раньше 06:25 значит посчитать Эло по вчерашним матчам и
-- получить число, которое выглядит сегодняшним.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'rebuild-league-and-ratings',
  '35 6 * * *',
  $$select public.rebuild_league_seasons(); select public.rebuild_club_ratings()$$
);

--   select cron.unschedule('rebuild-league-and-ratings');
