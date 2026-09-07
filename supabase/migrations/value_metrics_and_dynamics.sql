-- Стоимость как основная метрика, дата рождения, динамика показателей.
--
-- Владелец, одним заходом: «известность оставь, но поменяй её на „просмотры
-- страницы в Википедии“»; «новости, стоимость, статистика, просмотры нужны для
-- отслеживания резких улучшений… создай систему, которая бы отслеживала
-- динамику»; «у игроков, которые не завершили карьеру, в карточке пиши дату
-- рождения»; «у малоизвестных клубов и игроков не посчитана стоимость»;
-- «добавь сортировку… по стоимости и просмотрам в вики по каждой лиге,
-- стране, команде»; «выводить лучших игроков месяца и года, женщин и парней».
--
-- ⚠️ СТОИМОСТИ У 3142 ИГРОКОВ НЕТ И НЕ БУДЕТ — ЭТО ЗАМЕР, А НЕ НЕДОРАБОТКА.
-- id на Transfermarkt у них есть, а суммы на профиле нет: стоит «-». Проба из
-- четырёх разных мест выборки — 0 из 20, при исправном разборе (у Леона
-- Классена он читает €600 тыс.). Выдумывать сумму нельзя. Вместо неё на
-- карточку перенесён рейтинг Soccer Wiki (1..99) — ДРУГАЯ шкала, отдельным
-- полем: смешивать их в одно число значит соврать про обе.
--
-- ⚠️ ДАТУ РОЖДЕНИЯ НЕ НАДО НИГДЕ ДОБЫВАТЬ. Она уже лежала в заявках клубов —
-- 24 334 карточки из 25 509; на карточку её просто никогда не переносили.
-- Граница правдоподобия: только после 1930 года, потому что в источнике
-- встречается заглушка «1881-01-01».
--
-- ⚠️ ДИНАМИКИ БЕЗ СНИМКОВ НЕ БЫВАЕТ. В карточке лежит только сегодняшнее
-- значение; вчерашнего нет нигде, и «вырос вдвое» посчитать не из чего.
-- История начинается с первого снимка: 39 549 строк, 5 секунд.
--
-- Определения выгружены ИЗ ПРОДА (pg_get_functiondef), а не перепечатаны.

CREATE OR REPLACE FUNCTION public.best_players(p_days integer DEFAULT 30, p_category text DEFAULT 'player'::text, p_limit integer DEFAULT 10, p_club_key text DEFAULT NULL::text, p_league text DEFAULT NULL::text, p_country text DEFAULT NULL::text)
 RETURNS TABLE(card_id uuid, name text, name_en text, photo_url text, country text, club text, club_key text, matches integer, goals integer, assists integer, points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.name, c.name_en, c.photo_url, c.country,
         f.name, f.club_key,
         count(*)::int,
         sum(coalesce(d.goals, 0))::int,
         sum(coalesce(d.assists, 0))::int,
         (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3)::int
    from player_match_days d
    join cards c on c.id = d.card_id and c.active
                and c.category = coalesce(nullif(p_category, ''), 'player')
    left join card_current_club cc on cc.card_id = c.id
    left join football_club f on f.club_key = cc.club_key
   where d.match_date >= current_date - greatest(coalesce(p_days, 30), 1)
     and (p_club_key is null or p_club_key = '' or cc.club_key = p_club_key)
     and (p_league   is null or p_league   = '' or f.league   = p_league)
     and (p_country  is null or p_country  = '' or c.country  = p_country)
   group by c.id, c.name, c.name_en, c.photo_url, c.country, f.name, f.club_key
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
   order by (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3) desc,
            sum(coalesce(d.goals, 0)) desc,
            c.name
   limit greatest(coalesce(p_limit, 10), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.card_metric_movers(p_metric text DEFAULT 'market_value'::text, p_days integer DEFAULT 30, p_limit integer DEFAULT 20)
 RETURNS TABLE(card_id uuid, name_en text, was numeric, now_value numeric, growth numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with latest as (
    select distinct on (h.card_id) h.card_id, h.value, h.taken_on
      from card_metric_history h
     where h.metric = p_metric
     order by h.card_id, h.taken_on desc
  ),
  before as (
    select distinct on (h.card_id) h.card_id, h.value
      from card_metric_history h
     where h.metric = p_metric
       and h.taken_on <= (now() at time zone 'utc')::date - greatest(coalesce(p_days, 30), 1)
     order by h.card_id, h.taken_on desc
  )
  select l.card_id, c.name_en, b.value, l.value,
         round(l.value / nullif(b.value, 0), 2)
    from latest l
    join before b on b.card_id = l.card_id
    join cards c on c.id = l.card_id
   -- Рост считается только от НЕНУЛЕВОГО: деление на ноль даёт бесконечность,
   -- и «вырос с нуля до одного» вытеснило бы настоящие всплески.
   where b.value > 0 and l.value > b.value
   order by l.value / nullif(b.value, 0) desc
   limit greatest(coalesce(p_limit, 20), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.collection_facets(p_category text DEFAULT 'player'::text)
 RETURNS TABLE(kind text, value text, label text, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with base as (
    select c.id, c.country, cc.club_key, fc.league, fc.name as club_name
      from cards c
      left join card_current_club cc on cc.card_id = c.id
      left join football_club fc on fc.club_key = cc.club_key
     where c.active
       and (p_category is null or p_category = '' or c.category = p_category)
  )
  select 'club', club_key, max(club_name), count(*)::int
    from base where club_key is not null group by club_key
  union all
  select 'league', league, league, count(*)::int
    from base where league is not null group by league
  union all
  select 'country', country, country, count(*)::int
    from base where country is not null group by country
  order by 1, 4 desc;
$function$
;

CREATE OR REPLACE FUNCTION public.collection_page(p_lang text, p_category text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 48, p_offset integer DEFAULT 0)
 RETURNS SETOF cards
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.*
  FROM cards c
  WHERE c.active
    AND (p_category IS NULL OR p_category = '' OR c.category = p_category)
    AND (p_query IS NULL OR p_query = ''
         OR c.name ILIKE '%' || p_query || '%'
         OR c.name_en ILIKE '%' || p_query || '%')
  ORDER BY
    collection_views(c.pageviews, c.pageviews_i18n, left(COALESCE(p_lang, 'ru'), 2)) DESC,
    COALESCE(c.pageviews, 0) DESC,
    c.name ASC
  LIMIT  GREATEST(COALESCE(p_limit, 48), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.collection_page(p_lang text, p_category text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 48, p_offset integer DEFAULT 0, p_club_key text DEFAULT NULL::text, p_league text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_sort text DEFAULT 'views'::text)
 RETURNS SETOF cards
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select c.*
  from cards c
  left join card_current_club cc on cc.card_id = c.id
  left join football_club fc on fc.club_key = cc.club_key
  where c.active
    and (p_category is null or p_category = '' or c.category = p_category)
    and (p_query is null or p_query = ''
         or c.name ilike '%' || p_query || '%'
         or c.name_en ilike '%' || p_query || '%')
    and (p_club_key is null or p_club_key = '' or cc.club_key = p_club_key)
    and (p_league   is null or p_league   = '' or fc.league   = p_league)
    and (p_country  is null or p_country  = '' or c.country  = p_country)
  order by
    case when p_sort = 'value'  then c.market_value_eur end desc nulls last,
    case when p_sort = 'rating' then c.sw_rating        end desc nulls last,
    -- Просмотры — прежний порядок и умолчание: экран не должен измениться
    -- у того, кто ничего не выбирал.
    case when p_sort = 'value' or p_sort = 'rating' then null else
      collection_views(c.pageviews, c.pageviews_i18n, left(coalesce(p_lang, 'ru'), 2))
    end desc nulls last,
    coalesce(c.pageviews, 0) desc,
    c.name asc
  limit  greatest(coalesce(p_limit, 48), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.fill_born_on()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with best as (
    -- Одна дата на игрока: если заявки называют разные, не берём ни одной —
    -- расхождение в дате рождения значит, что это разные люди.
    select card_id, min(born_on) as born_on
      from club_roster
     where card_id is not null and born_on is not null
       and born_on > date '1930-01-01' and born_on < current_date
     group by card_id
    having count(distinct born_on) = 1
  ),
  upd as (
    update cards c set born_on = b.born_on
      from best b
     where c.id = b.card_id and c.born_on is distinct from b.born_on
    returning 1
  )
  select count(*)::integer from upd;
$function$
;

CREATE OR REPLACE FUNCTION public.fill_sw_rating()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with best as (
    -- Игрок может стоять в двух составах источника; берём наибольший рейтинг:
    -- разброс у одного человека там небольшой, а NULL хуже приблизительного.
    select card_id, max(rating) as rating
      from soccerwiki_player
     where card_id is not null and rating is not null
     group by card_id
  ),
  upd as (
    update cards c set sw_rating = b.rating
      from best b
     where c.id = b.card_id and c.sw_rating is distinct from b.rating
    returning 1
  )
  select count(*)::integer from upd;
$function$
;

CREATE OR REPLACE FUNCTION public.player_ratings(p_days integer DEFAULT 7, p_limit integer DEFAULT 50, p_club_key text DEFAULT NULL::text, p_league text DEFAULT NULL::text, p_country text DEFAULT NULL::text)
 RETURNS TABLE(card_id uuid, name text, name_en text, photo_url text, country text, club text, club_key text, level smallint, basis text, matches integer, minutes integer, goals integer, assists integer, points integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ⚠️ КЛУБ БЕРЁТСЯ ИЗ `card_current_club`, А НЕ ИЗ `club_squad`.
  -- `club_squad` — таблица ИГРЫ (кого раздавать в фэнтези), и новых игроков в
  -- ней нет: замер 06.09.2026 — карточек игроков 25 509, строк
  -- `card_current_club` 24 683. Рейтинг показывал клуб только тем, кто попал
  -- в игровой состав, а остальные шли без клуба и без ссылки.
  --
  -- `card_current_club` — это сведённая цепочка «заявка Transfermarkt →
  -- Soccer Wiki → статья» (см. verify_card_data), то есть самый свежий из
  -- доступных ответов на вопрос «где он сейчас». `club_squad` остаётся
  -- запасным: у ветеранов игры он бывает заполнен, когда сбор не дошёл.
  select c.id, c.name, c.name_en, c.photo_url, c.country,
         coalesce(f.name, fq.name), coalesce(f.club_key, fq.club_key),
         l.level, l.basis,
         count(*)::int,
         nullif(sum(coalesce(d.minutes, 0)), 0)::int,
         sum(coalesce(d.goals, 0))::int,
         sum(coalesce(d.assists, 0))::int,
         (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3)::int
    from player_match_days d
    join cards c on c.id = d.card_id and c.active and c.category = 'player'
    left join card_current_club cc on cc.card_id = c.id
    left join football_club f on f.club_key = cc.club_key
    left join club_squad q on q.card_id = c.id and q.left_at is null
    left join football_club fq on fq.club_key = q.club_key
    left join player_level l on l.card_id = c.id
   where d.match_date >= current_date - greatest(coalesce(p_days, 7), 1)
     -- Отбор считает база: на клиенте он резал бы уже усечённый ответ.
     and (p_club_key is null or p_club_key = ''
          or coalesce(cc.club_key, q.club_key) = p_club_key)
     and (p_league is null or p_league = '' or coalesce(f.league, fq.league) = p_league)
     and (p_country is null or p_country = '' or c.country = p_country)
   group by c.id, c.name, c.name_en, c.photo_url, c.country,
            f.name, f.club_key, fq.name, fq.club_key, l.level, l.basis
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
   order by (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3) desc,
            sum(coalesce(d.goals, 0)) desc,
            sum(coalesce(d.minutes, 0)) asc nulls last,
            c.name
   limit greatest(coalesce(p_limit, 50), 1);
$function$
;

CREATE OR REPLACE FUNCTION public.snapshot_card_metrics()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
  with rows as (
    select c.id as card_id, m.metric, m.value
      from cards c
      cross join lateral (values
        ('market_value', c.market_value_eur::numeric),
        ('pageviews',    c.pageviews::numeric),
        ('sw_rating',    c.sw_rating::numeric),
        ('fame',         c.fame::numeric)
      ) as m(metric, value)
     where c.active and c.category = 'player' and m.value is not null
  ),
  form as (
    select d.card_id, 'goals_30d' as metric, sum(coalesce(d.goals, 0))::numeric as value
      from player_match_days d
     where d.match_date >= current_date - 30
     group by d.card_id
    union all
    select d.card_id, 'assists_30d', sum(coalesce(d.assists, 0))::numeric
      from player_match_days d
     where d.match_date >= current_date - 30
     group by d.card_id
  ),
  ins as (
    insert into card_metric_history (card_id, metric, value)
    select card_id, metric, value from rows
    union all
    select f.card_id, f.metric, f.value from form f
      join cards c on c.id = f.card_id and c.active and c.category = 'player'
    on conflict (card_id, metric, taken_on) do update set value = excluded.value
    returning 1
  )
  select count(*)::integer from ins;
$function$
;

-- Таблица истории и её расписание.
create table if not exists public.card_metric_history (
  card_id   uuid not null references public.cards (id) on delete cascade,
  metric    text not null,
  taken_on  date not null default (now() at time zone 'utc')::date,
  value     numeric not null,
  primary key (card_id, metric, taken_on)
);
create index if not exists card_metric_history_metric_idx
  on public.card_metric_history (metric, taken_on desc);
alter table public.card_metric_history enable row level security;
drop policy if exists card_metric_history_read on public.card_metric_history;
create policy card_metric_history_read on public.card_metric_history for select using (true);

alter table public.cards add column if not exists sw_rating smallint;
alter table public.cards add column if not exists born_on   date;

select cron.schedule('snapshot-card-metrics', '0 7 * * *',
                     $$select public.snapshot_card_metrics()$$);
