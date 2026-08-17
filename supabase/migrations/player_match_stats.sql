-- ============================================================================
-- Per-match football statistics, and the ratings built on top of them.
--
-- WHY A NEW TABLE, when the schema already looks like it has this. It does
-- not, and the resemblance is the trap:
--
--   * `player_stats`  is about the people who PLAY THE APP — games_played,
--     cards_guessed, xp. Nothing to do with football.
--   * `player_seasons` holds pageviews and popularity, no goals at all.
--   * `player_career`  has goals and assists but is EMPTY (0 rows), and its
--     grain is a whole season — one row per player per club per season.
--
-- A season summary can never answer "who scored in the last seven days". The
-- window is the requirement, so the grain has to be the match. That is the
-- only reason this table exists.
--
-- WHERE THE ROWS COME FROM: football_scraper/sports_ru_stats.py, off
-- sports.ru's `/football/person/<slug>/stat/` pages, nightly. That page is the
-- only one on the site carrying dated per-match rows; the person page itself
-- carries a season table, which is exactly the shape that cannot be windowed.
--
-- HONESTY ABOUT FRESHNESS: an empty week is a real answer during an
-- international break, and an empty week is also what a broken pipeline looks
-- like. Those must not render the same, so `player_stats_freshness()` exists
-- next to the rating and the screen shows when the data was last collected.
-- The rule is docs/MAP.md §8а: emptiness that ASSERTS something is the
-- dangerous kind, and "nobody scored this week" asserts plenty.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Card -> sports.ru slug.
--
-- A slug is NOT a transliteration of the player's name and cannot be
-- generated: Zenit's "Нино" lives at `marcilio-florencia-mota-filho`, "Джон
-- Джон" at `jhonatan-dos-santos-rosa`. Each is the full legal name behind a
-- one-word playing name, so a generated slug 404s — and a 404 is
-- indistinguishable from "this player had no matches". The mapping is
-- therefore crawled from club squad pages and stored, never inferred.
-- ---------------------------------------------------------------------------
create table if not exists public.sports_ru_player (
  card_id     uuid primary key references public.cards(id) on delete cascade,
  slug        text not null unique,
  -- The name as the squad page spelled it, kept so a wrong match can be seen
  -- by a human without re-fetching anything.
  name_ru     text,
  club_slug   text,
  resolved_at timestamptz not null default now(),
  -- Last time the player's stat page was read. Drives the nightly order:
  -- least-recently-checked first, so a run that is cut short still makes
  -- progress instead of re-reading the same head of the list.
  checked_at  timestamptz
);

create index if not exists sports_ru_player_checked_idx
  on public.sports_ru_player (checked_at nulls first);

-- ---------------------------------------------------------------------------
-- 2. One row per player per match, PER SOURCE.
--
-- The primary key is (card_id, match_date, tournament). A player cannot play
-- two matches in the same tournament on the same day, and re-reading a page
-- must UPDATE rather than duplicate — the scraper writes with
-- `resolution=merge-duplicates`, which needs a real conflict target.
--
-- ⚠️ ЭТОТ КЛЮЧ НЕ СКЛЕИВАЕТ ДВА ИСТОЧНИКА, И ЭТО НАМЕРЕННО. `tournament`
-- пишется словарём источника: sports.ru печатает «США. МЛС», ESPN — «MLS»
-- (`header.league.name`). Строки не конфликтуют, и один реальный матч лежит
-- здесь ДВУМЯ строками, по одной от каждого источника.
--
-- Так и задумано: две независимые записи одного матча — единственное, чем
-- ловится тихая поломка разбора. Сдвиг колонок на sports.ru однажды выдал 62
-- гола вместо 59, и оба числа выглядели правдоподобно; строка ESPN о том же
-- матче — то, с чем это можно сравнить. Схлопывание при записи стёрло бы
-- ровно ту улику, ради которой заведён второй источник.
--
-- ⚠️ ПОЭТОМУ СЧИТАТЬ ПО ЭТОЙ ТАБЛИЦЕ НАПРЯМУЮ НЕЛЬЗЯ: `sum(goals)` по двум
-- строкам одного матча даёт удвоенный гол, а `count(*)` — «2 матча» за один
-- сыгранный. Обе функции ниже сначала сворачивают строки к одной на
-- игрока-и-день; новый читатель обязан делать то же.
-- ---------------------------------------------------------------------------
create table if not exists public.player_match_stats (
  card_id     uuid not null references public.cards(id) on delete cascade,
  match_date  date not null,
  tournament  text not null,
  home_team   text,
  away_team   text,
  home_score  smallint,
  away_score  smallint,
  -- ⚠️ NULL means UNKNOWN, and it is a real case, not laziness. sports.ru
  -- prints minutes; ESPN does not have them at all — its `subbedIn` /
  -- `subbedOut` are BOOLEANS, so the payload says a player came on and never
  -- when. Writing 0 there would be a lie with consequences: the rating breaks
  -- ties by "fewer minutes for the same return", so a fabricated 0 would put
  -- those rows above players who actually earned the same points. An unused
  -- substitute from a source that DOES report minutes is still 0 — he was
  -- named and did not play, which is a different fact from "we do not know".
  minutes     smallint,
  goals       smallint not null default 0,
  assists     smallint not null default 0,
  yellow      smallint not null default 0,
  red         smallint not null default 0,
  source      text not null default 'sports.ru',
  fetched_at  timestamptz not null default now(),
  primary key (card_id, match_date, tournament)
);

-- The rating scans a date window and nothing else, so the window leads.
create index if not exists player_match_stats_window_idx
  on public.player_match_stats (match_date desc);

-- ---------------------------------------------------------------------------
-- 3. The rating.
--
-- Points are goals*4 + assists*3 — the fantasy scale this app already uses for
-- outfield scoring, kept identical so two screens never disagree about what a
-- goal is worth. Every input is returned alongside the total: a rating a
-- player cannot audit is a rating they will assume is broken.
--
-- Ordered by points, then goals, then minutes ASC — fewer minutes for the same
-- return is the better performance, and it makes the order total so paging is
-- stable.
--
-- ⚠️ СНАЧАЛА СВЁРТКА ПО ДНЮ, ПОТОМ АРИФМЕТИКА. Один матч лежит в таблице
-- двумя строками, если его принесли оба источника (см. §2), и без `distinct
-- on` гол считался бы дважды: 4 очка превращались бы в 8, а «1 матч» — в «2».
-- Ошибка была бы невидима на экране, потому что удвоенное число выглядит
-- ровно так же правдоподобно, как настоящее.
-- ---------------------------------------------------------------------------
create or replace function public.player_ratings(
  p_days  integer default 7,
  p_limit integer default 50
)
returns table (
  card_id   uuid,
  name      text,
  name_en   text,
  photo_url text,
  country   text,
  club      text,
  matches   integer,
  minutes   integer,
  goals     integer,
  assists   integer,
  points    integer
)
language sql
stable
as $$
  with per_day as (
    -- Одна строка на игрока и день. Окно отсекается ДО свёртки: оно режет по
    -- `match_date`, то есть день попадает в него целиком или не попадает
    -- вовсе, и на выбор победителя внутри дня повлиять не может.
    select distinct on (s.card_id, s.match_date)
      s.card_id, s.match_date, s.minutes, s.goals, s.assists
    from public.player_match_stats s
    where s.match_date > current_date - greatest(1, least(coalesce(p_days, 7), 3650))
    -- Выигрывает строка, которая ЗНАЕТ БОЛЬШЕ, а не та, что пришла первой:
    -- минуты есть у sports.ru и отсутствуют у ESPN, и запись с минутами
    -- сохраняет тай-брейк рейтинга. Имя источника дописано, чтобы порядок был
    -- полным: иначе ответ мог бы меняться от прогона к прогону.
    order by s.card_id, s.match_date, (s.minutes is not null) desc, s.source
  )
  select
    c.id,
    c.name,
    c.name_en,
    c.photo_url,
    c.country,
    cc.club,
    count(*)::integer                    as matches,
    -- Not coalesced to 0: see the column comment. Postgres sums across NULLs,
    -- so a player with one source that reports minutes and one that does not
    -- shows the minutes actually known.
    sum(s.minutes)::integer              as minutes,
    coalesce(sum(s.goals), 0)::integer   as goals,
    coalesce(sum(s.assists), 0)::integer as assists,
    (coalesce(sum(s.goals), 0) * 4 + coalesce(sum(s.assists), 0) * 3)::integer as points
  from per_day s
  join public.cards c on c.id = s.card_id and c.active
  left join public.card_current_club cc on cc.card_id = c.id
  group by c.id, c.name, c.name_en, c.photo_url, c.country, cc.club
  -- A player who only warmed the bench all week is not a rating entry.
  having coalesce(sum(s.goals), 0) + coalesce(sum(s.assists), 0) > 0
  -- `nulls last`: unknown minutes must not win a tie-break they cannot
  -- have earned.
  order by points desc, goals desc, minutes asc nulls last, c.name asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- ---------------------------------------------------------------------------
-- 4. Freshness — the difference between "quiet week" and "pipeline is down".
--
-- Returned separately so the screen can say which one it is. `last_match` is
-- the newest match we hold; `collected_at` is when the crawler last wrote
-- anything. A quiet international break moves neither backwards; a dead
-- pipeline freezes `collected_at` while the calendar walks away from it.
--
-- `first_match` is here because THE YEARLY WINDOW STARTS OUT INCOMPLETE and
-- must say so. A stat page renders one season and only one: the season picker
-- posts to /ajax/, which robots.txt closes, and a ?season= query string is
-- ignored (checked — the page returns the current season either way). So the
-- first crawl can only reach back to the start of the current season, and the
-- 365-day window fills in as the table accumulates day by day. A yearly rating
-- covering four August weeks is fine; a yearly rating covering four August
-- weeks while implying a year is the lie, and `first_match` is what lets the
-- screen tell the truth instead.
-- ---------------------------------------------------------------------------
create or replace function public.player_stats_freshness()
returns table (
  first_match  date,
  last_match   date,
  collected_at timestamptz,
  players      integer,
  matches      integer
)
language sql
stable
as $$
  select
    min(s.match_date),
    max(s.match_date),
    max(s.fetched_at),
    count(distinct s.card_id)::integer,
    count(*)::integer
  from public.player_match_stats s;
$$;

-- ---------------------------------------------------------------------------
-- 4а. Свёртка по турнирам — для досье карточки и любой аналитики.
--
-- НОВОГО ИСТОЧНИКА ПОД ЭТО НЕ НУЖНО, и это важнее самой функции. Сезонные
-- итоги, ради которых напрашивались openligadb и football-data.org,
-- выводятся из уже собранных матчей: мелкое зерно всегда сворачивается в
-- крупное. Обратное неверно — потому окно в 7 дней и потребовало матчей.
-- ---------------------------------------------------------------------------
create or replace function public.player_collected_totals(p_card_id uuid)
returns table (
  tournament  text,
  matches     integer,
  minutes     integer,
  goals       integer,
  assists     integer,
  yellow      integer,
  red         integer,
  first_match date,
  last_match  date
)
language sql
stable
as $$
  with per_day as (
    -- Та же свёртка, что и в рейтинге, и по той же причине: иначе один матч,
    -- принесённый обоими источниками, разошёлся бы в досье по ДВУМ строкам
    -- разных турниров — «MLS: 1 матч» рядом с «США. МЛС: 1 матч», — и сложить
    -- их читатель уже не смог бы.
    select distinct on (s.match_date)
      s.match_date, s.tournament, s.minutes, s.goals, s.assists, s.yellow, s.red
    from public.player_match_stats s
    where s.card_id = p_card_id
    -- Победитель тот же, поэтому и название турнира берётся из одного словаря,
    -- а не смешивается через строку.
    order by s.match_date, (s.minutes is not null) desc, s.source
  )
  select
    s.tournament,
    count(*)::integer,
    -- NULL, а не 0, когда минут не знает ни один источник: см. комментарий к
    -- колонке в player_match_stats.sql.
    sum(s.minutes)::integer,
    coalesce(sum(s.goals), 0)::integer,
    coalesce(sum(s.assists), 0)::integer,
    coalesce(sum(s.yellow), 0)::integer,
    coalesce(sum(s.red), 0)::integer,
    min(s.match_date),
    max(s.match_date)
  from per_day s
  group by s.tournament
  order by count(*) desc, max(s.match_date) desc;
$$;

-- ---------------------------------------------------------------------------
-- 5. Rights.
--
-- ⚠️ A POLICY IS NOT A GRANT. Postgres checks the grant FIRST and answers
-- 42501 before any policy is consulted. `card_current_club` shipped that way
-- once and it took the whole deck down, because a function three layers from
-- the screen read a table nobody had granted. Both gates, every time.
--
-- ⚠️ And the pipeline needs its own. `resolution=merge-duplicates` makes
-- PostgREST emit ON CONFLICT DO UPDATE, so a writer holding INSERT but not
-- UPDATE writes nothing and still returns 200 — "285 read, 0 written", both
-- numbers believable.
-- ---------------------------------------------------------------------------
alter table public.player_match_stats enable row level security;
drop policy if exists player_match_stats_read on public.player_match_stats;
create policy player_match_stats_read on public.player_match_stats
  for select using (true);

alter table public.sports_ru_player enable row level security;
-- The slug map is plumbing, not content: no reason for a player's client to
-- read it, so it gets no policy and no grant beyond the pipeline's.
drop policy if exists sports_ru_player_read on public.sports_ru_player;

grant select on public.player_match_stats to anon, authenticated;
grant select, insert, update, delete on public.player_match_stats to service_role;
grant select, insert, update, delete on public.sports_ru_player   to service_role;
revoke all on public.sports_ru_player from anon, authenticated;

grant execute on function public.player_ratings(integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.player_stats_freshness()
  to anon, authenticated, service_role;
grant execute on function public.player_collected_totals(uuid)
  to anon, authenticated, service_role;
