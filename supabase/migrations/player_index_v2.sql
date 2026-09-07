-- ===========================================================================
-- ОКОНЧАТЕЛЬНЫЙ ВИД: рейтинг с пятью новыми показателями и отбором по
-- континенту. Файл существует, чтобы репозиторий совпадал с боем.
--
-- Владелец: «добавь все новые категории стоимости, просмотры странички в
-- Википедии и другие новые, не менее важные 5 шт.»; «разбей всё по
-- континентам, странам, лигам».
--
--   growth     — во сколько раз подорожал за 90 дней
--   caps       — матчи за ГЛАВНУЮ сборную
--   countries  — в скольких странах играл (Сёрлот — 8)
--   cards      — жёлтые и красные за карьеру (Неймар 225, Джака 219)
--   young      — самые молодые
--
-- ⚠️ ВСЕ ПЯТЬ СЧИТАЮТСЯ НОЧЬЮ И ЛЕЖАТ КОЛОНКАМИ. Чтобы упорядочить 25 509
-- карточек по росту стоимости, надо знать рост КАЖДОЙ — два поиска по истории
-- на карточку при каждом открытии экрана. Ночью это одна операция.
--
-- ⚠️ `value_growth` СЕГОДНЯ ПУСТ У ВСЕХ, и это не поломка: история показателей
-- заведена 06.09.2026, а рост считается за 90 дней. Пустое честнее выдуманного.
--
-- ⚠️ DROP ПЕРЕД CREATE у читающих функций: добавился параметр, а это НОВАЯ
-- ПЕРЕГРУЗКА, а не замена. Прод уже звал старую функцию, пока рядом лежала
-- новая.
-- ===========================================================================

alter table public.player_level
  add column if not exists value_growth numeric,
  add column if not exists caps         integer,
  add column if not exists countries    integer,
  add column if not exists foul_cards   integer;

create index if not exists player_level_growth_idx
  on public.player_level (value_growth desc nulls last);

create or replace function public.rebuild_player_levels()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare
  c_min_matches constant int := 10;
  c_icon_floor  constant int := 80;
  c_prior_n     constant numeric := 1;
  c_prior_v     constant numeric := 50;
  v_count integer;
  v_was   integer;
begin
  select count(*) into v_was from player_level;

  create temporary table _form on commit drop as
  with played as (
    select d.card_id, count(*)::int as matches,
           sum(coalesce(d.goals,0) * 4 + coalesce(d.assists,0) * 3)::numeric as pts
      from player_match_days d
      join cards c on c.id = d.card_id and c.active and c.category = 'player'
     where d.match_date >= current_date - 365
     group by d.card_id
    having count(*) >= c_min_matches
  )
  select card_id, matches,
         round(100 * percent_rank() over (order by pts / matches))::int as form_part
    from played;

  create temporary table _career on commit drop as
  select s.card_id,
         sum(s.minutes) filter (where not coalesce(k.is_national_team, false)) as minutes,
         (sum(s.yellow) + sum(s.yellow_red) + sum(s.red))::integer as foul_cards,
         count(distinct t.country_id) filter (
           where not coalesce(k.is_national_team, false)
             and t.country_id is not null and t.country_id > 0)::integer as countries
    from player_season_stat s
    left join tm_club k on k.id = s.club_id
    left join tm_competition t on t.id = s.competition_id
   where s.card_id is not null
   group by s.card_id;

  -- Матчи за ГЛАВНУЮ сборную: ту, за которую сыграно больше всего. Сумма по
  -- всем сборным давала Роналду 259 вместо 246 — юношеские в неё попадали.
  create temporary table _caps on commit drop as
  select distinct on (card_id) card_id, apps::integer as caps from (
    select s.card_id, k.name, sum(s.apps) as apps
      from player_season_stat s
      join tm_club k on k.id = s.club_id and k.is_national_team
     where s.card_id is not null
     group by s.card_id, k.name
  ) t order by card_id, apps desc;

  -- Рост стоимости: последнее значение против последнего не позже 90 дней
  -- назад. Хранятся ИЗМЕНЕНИЯ, поэтому обе точки ищутся как «последняя не
  -- позже даты», а не как «строка за эту дату».
  create temporary table _growth on commit drop as
  with latest as (
    select distinct on (h.card_id) h.card_id, h.value
      from card_metric_history h where h.metric = 'market_value'
     order by h.card_id, h.taken_on desc
  ), before as (
    select distinct on (h.card_id) h.card_id, h.value
      from card_metric_history h
     where h.metric = 'market_value'
       and h.taken_on <= (now() at time zone 'utc')::date - 90
     order by h.card_id, h.taken_on desc
  )
  select l.card_id, round(l.value / b.value, 3) as growth
    from latest l join before b on b.card_id = l.card_id
   where b.value is not null and b.value > 0 and l.value is not null;

  create temporary table _parts on commit drop as
  with pool as (
    select c.id as card_id, c.market_value_eur, c.pageviews,
           cr.minutes as career_minutes,
           coalesce((select h.value from card_metric_history h
                      where h.card_id = c.id and h.metric = 'news_30d'
                      order by h.taken_on desc limit 1), 0) as news
      from cards c
      left join _career cr on cr.card_id = c.id
     where c.active and c.category = 'player'
  )
  select card_id,
         case when market_value_eur is null then null else
           round(100 * percent_rank() over (
             partition by (market_value_eur is null) order by market_value_eur))::int end as value_part,
         case when pageviews is null then null else
           round(100 * percent_rank() over (
             partition by (pageviews is null) order by pageviews))::int end as views_part,
         case when career_minutes is null then null else
           round(100 * percent_rank() over (
             partition by (career_minutes is null) order by career_minutes))::int end as stats_part,
         round(100 * percent_rank() over (order by news))::int as news_part
    from pool;

  create temporary table _out on commit drop as
  select p.card_id, p.value_part, p.views_part, p.stats_part, p.news_part,
         round(((coalesce(p.value_part, 0) + coalesce(p.views_part, 0)
                 + coalesce(p.stats_part, 0) + p.news_part) + c_prior_n * c_prior_v)
               / ((p.value_part is not null)::int + (p.views_part is not null)::int
                  + (p.stats_part is not null)::int + 1 + c_prior_n))::int as index_score,
         ((p.value_part is not null)::int + (p.views_part is not null)::int
          + (p.stats_part is not null)::int + 1)::int as parts
    from _parts p;

  select count(*) into v_count from _out;
  if v_was >= 100 and v_count < v_was / 2 then
    raise exception 'пересборка рейтинга дала % строк вместо % — это поломка источника, а не ночь без данных; прежние данные сохранены',
                    v_count, v_was;
  end if;

  delete from player_level;

  insert into player_level (card_id, level, fame_part, form_part, matches, basis,
                            value_part, views_part, stats_part, news_part,
                            index_score, parts,
                            value_growth, caps, countries, foul_cards, computed_at)
  select c.id,
         greatest(
           case when f.form_part is null then coalesce(c.fame, 0)
                else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part)
           end,
           case when 'icon' = any(coalesce(c.tags, '{}')) then c_icon_floor else 0 end
         )::smallint,
         c.fame, f.form_part, coalesce(f.matches, 0),
         case
           when 'icon' = any(coalesce(c.tags, '{}'))
                and c_icon_floor > case when f.form_part is null then coalesce(c.fame, 0)
                                        else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part) end
             then 'icon'
           when f.form_part is null then 'fame'
           else 'fame+form'
         end,
         o.value_part, o.views_part, o.stats_part, o.news_part,
         o.index_score, o.parts,
         g.growth, cp.caps, cr.countries, cr.foul_cards,
         now()
    from cards c
    join _out o on o.card_id = c.id
    left join _form f on f.card_id = c.id
    left join _growth g on g.card_id = c.id
    left join _caps cp on cp.card_id = c.id
    left join _career cr on cr.card_id = c.id
   where c.category = 'player' and c.active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_player_levels() from public;
grant execute on function public.rebuild_player_levels() to service_role;

drop function if exists public.player_index(text, text, text, text, text, integer, integer);
drop function if exists public.player_index_count(text, text, text, text);

create or replace function public.player_index(
  p_sort      text default 'index',
  p_league    text default null,
  p_country   text default null,
  p_club_key  text default null,
  p_lang      text default 'ru',
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_continent text default null
)
returns table (
  card_id     uuid, name text, name_en text, photo_url text,
  country text, continent text, club_key text, club text, league text,
  index_score smallint, parts smallint,
  value_part smallint, views_part smallint, stats_part smallint, news_part smallint,
  sort_value numeric, place integer
)
language sql stable security definer set search_path = public
set statement_timeout = '60s' as $$
  with scoped as (
    select c.id, c.name, c.name_en, c.photo_url, c.country, c.continent,
           cc.club_key, fc.league,
           pl.index_score, pl.parts, pl.value_part, pl.views_part,
           pl.stats_part, pl.news_part,
           case coalesce(nullif(p_sort, ''), 'index')
             when 'value'     then c.market_value_eur::numeric
             when 'views'     then c.pageviews::numeric
             when 'rating'    then c.sw_rating::numeric
             when 'news'      then (select h.value from card_metric_history h
                                     where h.card_id = c.id and h.metric = 'news_30d'
                                     order by h.taken_on desc limit 1)
             when 'stats'     then (select sum(s.minutes)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             when 'goals'     then (select sum(s.goals)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             when 'growth'    then pl.value_growth
             when 'caps'      then pl.caps::numeric
             when 'countries' then pl.countries::numeric
             when 'cards'     then pl.foul_cards::numeric
             -- ⚠️ «МОЛОДЫЕ» — ЭТО ДАТА ЧИСЛОМ, А НЕ ВОЗРАСТ: так порядок
             -- «больше значит выше» не выворачивается ради одной кнопки.
             when 'young'     then extract(epoch from c.born_on)::numeric
             else pl.index_score::numeric
           end as sort_value
      from cards c
      join player_level pl on pl.card_id = c.id
      left join card_current_club cc on cc.card_id = c.id
      left join football_club fc on fc.club_key = cc.club_key
     where c.active and c.category = 'player'
       and (p_club_key  is null or p_club_key  = '' or cc.club_key   = p_club_key)
       and (p_league    is null or p_league    = '' or fc.league     = p_league)
       and (p_country   is null or p_country   = '' or c.country     = p_country)
       and (p_continent is null or p_continent = '' or c.continent   = p_continent)
  ),
  ranked as (
    select s.*, row_number() over (
             order by s.sort_value desc nulls last,
                      s.parts desc nulls last, s.name)::integer as place
      from scoped s
     where s.sort_value is not null
  )
  select r.id, r.name, r.name_en, r.photo_url, r.country, r.continent,
         r.club_key,
         case when r.club_key is null then null
              else club_display_name(r.club_key, p_lang) end,
         r.league,
         r.index_score, r.parts, r.value_part, r.views_part,
         r.stats_part, r.news_part, r.sort_value, r.place
    from ranked r
   order by r.place
   limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.player_index(text, text, text, text, text, integer, integer, text) from public;
grant execute on function public.player_index(text, text, text, text, text, integer, integer, text)
  to anon, authenticated, service_role;

create or replace function public.player_index_count(
  p_sort      text default 'index',
  p_league    text default null,
  p_country   text default null,
  p_club_key  text default null,
  p_continent text default null
)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from cards c
    join player_level pl on pl.card_id = c.id
    left join card_current_club cc on cc.card_id = c.id
    left join football_club fc on fc.club_key = cc.club_key
   where c.active and c.category = 'player'
     and (p_club_key  is null or p_club_key  = '' or cc.club_key = p_club_key)
     and (p_league    is null or p_league    = '' or fc.league   = p_league)
     and (p_country   is null or p_country   = '' or c.country   = p_country)
     and (p_continent is null or p_continent = '' or c.continent = p_continent)
     and case coalesce(nullif(p_sort, ''), 'index')
           when 'value'     then c.market_value_eur is not null
           when 'views'     then c.pageviews is not null
           when 'rating'    then c.sw_rating is not null
           when 'young'     then c.born_on is not null
           when 'growth'    then pl.value_growth is not null
           when 'caps'      then pl.caps is not null
           when 'countries' then pl.countries is not null
           when 'cards'     then pl.foul_cards is not null
           when 'stats'     then exists (select 1 from player_season_stat s where s.card_id = c.id)
           when 'goals'     then exists (select 1 from player_season_stat s where s.card_id = c.id)
           else pl.index_score is not null
         end;
$$;

revoke all on function public.player_index_count(text, text, text, text, text) from public;
grant execute on function public.player_index_count(text, text, text, text, text)
  to anon, authenticated, service_role;
