-- ===========================================================================
-- ОБЩИЙ РЕЙТИНГ ИГРОКА ПО ЧЕТЫРЁМ ОПОРАМ — популярность, стоимость,
-- статистика, новости. И сортировки по каждой из них внутри любой лиги,
-- страны и клуба.
--
-- Владелец: «интересно было видеть общую систему рейтинга игроков по
-- активности в сетях или просмотрам страницы игрока в Википедии
-- (популярности), по стоимости, по статистике и новостям»; «можно добавить
-- категории и сортировки по новым показателям… по всем лигам и странам».
--
-- ЗАМЕР ДО. Рейтинг в проекте был, и он видел 2909 карточек из 25 509 — 11%.
-- `player_level` строился из известности и формы, а известность есть у 9656,
-- форма — у 637. Стоимость, которая есть у 20 715, в рейтинг не входила вовсе.
-- Поэтому «рейтинг» показывал не лучших игроков, а лучших из тех, про кого
-- есть статья в Википедии.
--
-- ⚠️ `level` НЕ ТРОНУТ, И ЭТО НАРОЧНО. Его читают колода, экран рейтинга и
-- лента трансферов; сменить смысл под старым именем значит поменять игру
-- молча. Новый рейтинг живёт в СВОЕЙ колонке `index_score`. Этот проект уже
-- обжигался на подмене смысла под прежним именем — `home_fame`/`away_fame`
-- пришлось оставить с враньём в названии, чтобы не уронить экран.
--
-- ⚠️ «АКТИВНОСТИ В СЕТЯХ» У НАС НЕТ, И ВЫДУМЫВАТЬ ЕЁ НЕЛЬЗЯ. Ни одного
-- источника соцсетей в проекте не подключено. Опора «популярность» — это
-- просмотры страницы в Википедии, ровно то, что владелец назвал вторым
-- вариантом. Называем её так и в коде, и на экране.
--
-- ⚠️ ОПОРА, КОТОРОЙ НЕТ, НЕ РАВНА НУЛЮ. Игрок без стоимости — это «мы не
-- знаем», а не «стоит нисколько»; поставить ему 0 значило бы утопить в конец
-- списка всех малоизвестных, то есть ровно тех, ради кого владелец и просил
-- заполнить стоимость. Среднее считается по ТЕМ опорам, что есть, а рядом
-- лежит `parts` — сколько их было. Четвёрка при равном счёте выигрывает у
-- одиночки: иначе счёт 50 по одному новостному упоминанию встал бы рядом с
-- 50 по четырём измеренным опорам.
--
-- ⚠️ НОВОСТИ ЕСТЬ У ВСЕХ, И НОЛЬ ТУТ — ИЗМЕРЕННЫЙ РЕЗУЛЬТАТ. Упоминания
-- ищутся по всей ленте для каждой карточки (фразой, по полному имени), так что
-- «про него не писали» — это факт, а не пробел. Поэтому новостная опора
-- считается всегда, и `parts` никогда не ноль.
--
-- ⚠️ СТАТИСТИКА — ЭТО МИНУТЫ, А НЕ ГОЛЫ. «Голов за матч» ставит любого
-- нападающего выше любого центрального защитника, а в колоде есть и те и
-- другие. Минуты на поле — единственная статистика, которая значит одно и то
-- же на каждой позиции. Голевое действие никуда не делось: оно живёт своей
-- опорой `form_part` и своей сортировкой.
-- ===========================================================================

alter table public.player_level
  add column if not exists value_part  smallint,
  add column if not exists views_part  smallint,
  add column if not exists stats_part  smallint,
  add column if not exists news_part   smallint,
  add column if not exists index_score smallint,
  add column if not exists parts       smallint;

create index if not exists player_level_index_idx
  on public.player_level (index_score desc nulls last);

-- --------------------------------------------------------------------------
-- Ночная пересборка. К прежним `level`/`fame_part`/`form_part` добавлены
-- четыре опоры и общий счёт.
--
-- ⚠️ ПРЕДОХРАНИТЕЛЬ ПЕРЕД DELETE. Пересборка сносит таблицу и наполняет
-- заново; если источник сломался и набралось вдвое меньше строк, чем было,
-- прежние данные исчезнут молча. В этом проекте ночной DELETE уже сносил
-- собранное — `rebuild_card_current_clubs` оставлял только карточки из статей.
-- Здесь такая ночь ОТМЕНЯЕТСЯ целиком, а не записывается.
-- --------------------------------------------------------------------------
create or replace function public.rebuild_player_levels()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare
  -- ⚠️ ДЕСЯТЬ МАТЧЕЙ, А НЕ ТРИ, И ЭТО ИСПРАВЛЕННАЯ ОШИБКА. При пороге в три в
  -- верхушку приезжали Жуан Феликс с формой 98 по ТРЁМ матчам и Луис Суарес с
  -- 99 по четырём — выше Винисиуса с 70 матчами. Среднее по трём наблюдениям
  -- не мера игрока, а мера удачной недели.
  c_min_matches constant int := 10;
  -- ⚠️ ПОЛ ДЛЯ ИКОН. Значимость Паненки не в просмотрах: fame = 25, тир
  -- common, а его именем называется способ бить пенальти. 80 — потому что
  -- 'rare' в этой колоде начинается с 75.
  c_icon_floor  constant int := 80;
  -- Вес «мы ничего не знаем» в общем счёте: одно наблюдение середины (50),
  -- подмешанное к тому, что измерено. Разбор — у формулы ниже.
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
  -- ПЕРЦЕНТИЛЬ, А НЕ СЫРАЯ ОТДАЧА: «голов за матч» несравнимо между позициями
  -- и лигами, ранг внутри игравших — сравнимо.
  select card_id, matches,
         round(100 * percent_rank() over (order by pts / matches))::int as form_part
    from played;

  -- Четыре опоры. Каждая — перцентиль внутри ТЕХ, У КОГО ЧИСЛО ЕСТЬ: ранг
  -- считается среди измеренных, иначе неизмеренные тянули бы шкалу вниз.
  create temporary table _parts on commit drop as
  with pool as (
    select c.id as card_id, c.market_value_eur, c.pageviews,
           (select sum(s.minutes) from player_season_stat s
              left join tm_club k on k.id = s.club_id
             where s.card_id = c.id and not coalesce(k.is_national_team, false)
           ) as career_minutes,
           coalesce((select h.value from card_metric_history h
                      where h.card_id = c.id and h.metric = 'news_30d'
                      order by h.taken_on desc limit 1), 0) as news
      from cards c
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
  select p.card_id,
         p.value_part, p.views_part, p.stats_part, p.news_part,
         -- ⚠️ СЧЁТ ПРИТЯНУТ К СЕРЕДИНЕ ТЕМ СИЛЬНЕЕ, ЧЕМ МЕНЬШЕ ИЗВЕСТНО, и это
         -- ИСПРАВЛЕННАЯ ОШИБКА, а не украшение. Первая версия делила сумму
         -- опор на их число — и Жуан Феликс с ОДНИМ упоминанием в новостях
         -- получил ровно 100 и второе место в мире, обойдя Бруну Фернандеша,
         -- у которого все четыре опоры по 99. Одно наблюдение не даёт права
         -- на совершенный счёт.
         --
         -- Лечится не запретом, а честной мерой уверенности: к измеренному
         -- подмешивается одно наблюдение середины. Четыре опоры по 99 дают 89,
         -- одна опора в 100 даёт 75. Игрок, про которого известно всё и плохо,
         -- оказывается НИЖЕ игрока, про которого не известно ничего, — так и
         -- должно быть: в первом случае мы уверены, во втором лишь не знаем.
         --
         -- Ноль за отсутствующую опору утопил бы всех малоизвестных — то есть
         -- тех, ради кого стоимость и собирается; поэтому делится на число
         -- ИЗМЕРЕННЫХ опор, а не на четыре.
         round(((coalesce(p.value_part, 0) + coalesce(p.views_part, 0)
                 + coalesce(p.stats_part, 0) + p.news_part) + c_prior_n * c_prior_v)
               / ((p.value_part is not null)::int + (p.views_part is not null)::int
                  + (p.stats_part is not null)::int + 1 + c_prior_n))::int as index_score,
         ((p.value_part is not null)::int + (p.views_part is not null)::int
          + (p.stats_part is not null)::int + 1)::int as parts
    from _parts p;

  select count(*) into v_count from _out;
  if v_was >= 100 and v_count < v_was / 2 then
    raise exception 'пересборка рейтинга дала % строк вместо % — это поломка '
                    'источника, а не ночь без данных; прежние данные сохранены',
                    v_count, v_was;
  end if;

  delete from player_level;

  insert into player_level (card_id, level, fame_part, form_part, matches, basis,
                            value_part, views_part, stats_part, news_part,
                            index_score, parts, computed_at)
  select c.id,
         greatest(
           case when f.form_part is null then coalesce(c.fame, 0)
                else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part)
           end,
           case when 'icon' = any(coalesce(c.tags, '{}')) then c_icon_floor else 0 end
         )::smallint,
         c.fame,
         f.form_part,
         coalesce(f.matches, 0),
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
         now()
    from cards c
    join _out o on o.card_id = c.id
    left join _form f on f.card_id = c.id
   where c.category = 'player' and c.active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_player_levels() from public;
grant execute on function public.rebuild_player_levels() to service_role;

-- --------------------------------------------------------------------------
-- ЧТЕНИЕ: список игроков, отсортированный по выбранной опоре, внутри выбранной
-- лиги, страны или клуба.
--
-- ⚠️ ОТБОР ДЕЛАЕТ SQL, А НЕ ЭКРАН. PostgREST отдаёт не больше `db-max-rows`
-- (у нас 1000) — при 25 509 карточках любая фильтрация на клиенте отвечала бы
-- по обрезку и называла бы лучшим в лиге того, кто просто попал в первую
-- тысячу.
--
-- ⚠️ ЧИСЛО ПОКАЗАТЕЛЯ ЕДЕТ ВМЕСТЕ С РАНГОМ. Перцентиль отвечает на «который по
-- счёту», а человек хочет видеть «€600 тыс.» и «13 942 просмотра». Без сырого
-- числа список сортируется правдоподобно и не проверяется никак.
-- --------------------------------------------------------------------------
create or replace function public.player_index(
  p_sort     text default 'index',
  p_league   text default null,
  p_country  text default null,
  p_club_key text default null,
  p_lang     text default 'ru',
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns table (
  card_id     uuid,
  name        text,
  name_en     text,
  photo_url   text,
  country     text,
  club_key    text,
  club        text,
  league      text,
  index_score smallint,
  parts       smallint,
  value_part  smallint,
  views_part  smallint,
  stats_part  smallint,
  news_part   smallint,
  sort_value  numeric,
  place       integer
)
language sql stable security definer set search_path = public
set statement_timeout = '60s' as $$
  with scoped as (
    select c.id, c.name, c.name_en, c.photo_url, c.country,
           cc.club_key, fc.name as club_name, fc.league,
           pl.index_score, pl.parts, pl.value_part, pl.views_part,
           pl.stats_part, pl.news_part,
           case coalesce(nullif(p_sort, ''), 'index')
             when 'value'  then c.market_value_eur::numeric
             when 'views'  then c.pageviews::numeric
             when 'news'   then (select h.value from card_metric_history h
                                  where h.card_id = c.id and h.metric = 'news_30d'
                                  order by h.taken_on desc limit 1)
             when 'stats'  then (select sum(s.minutes)::numeric from player_season_stat s
                                   left join tm_club k on k.id = s.club_id
                                  where s.card_id = c.id
                                    and not coalesce(k.is_national_team, false))
             when 'goals'  then (select sum(s.goals)::numeric from player_season_stat s
                                   left join tm_club k on k.id = s.club_id
                                  where s.card_id = c.id
                                    and not coalesce(k.is_national_team, false))
             when 'rating' then c.sw_rating::numeric
             else pl.index_score::numeric
           end as sort_value
      from cards c
      join player_level pl on pl.card_id = c.id
      left join card_current_club cc on cc.card_id = c.id
      left join football_club fc on fc.club_key = cc.club_key
     where c.active and c.category = 'player'
       and (p_club_key is null or p_club_key = '' or cc.club_key = p_club_key)
       and (p_league   is null or p_league   = '' or fc.league   = p_league)
       and (p_country  is null or p_country  = '' or c.country   = p_country)
  ),
  -- ⚠️ ПУСТОЙ ПОКАЗАТЕЛЬ НЕ УЧАСТВУЕТ В СОРТИРОВКЕ ПО НЕМУ. Игрок без
  -- стоимости в списке «по стоимости» — это не игрок за ноль евро, ему там
  -- просто нечего показать.
  ranked as (
    select s.*, row_number() over (
             order by s.sort_value desc nulls last,
                      -- Четвёрка опор выигрывает у одиночки при равном счёте.
                      s.parts desc nulls last, s.name)::integer as place
      from scoped s
     where s.sort_value is not null
  )
  select r.id, r.name, r.name_en, r.photo_url, r.country,
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

revoke all on function public.player_index(text, text, text, text, text, integer, integer) from public;
grant execute on function public.player_index(text, text, text, text, text, integer, integer)
  to anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- Сколько игроков в выбранном срезе — чтобы «3-й из 540» было честным числом,
-- а не длиной показанной страницы.
-- --------------------------------------------------------------------------
create or replace function public.player_index_count(
  p_sort     text default 'index',
  p_league   text default null,
  p_country  text default null,
  p_club_key text default null
)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
    from cards c
    join player_level pl on pl.card_id = c.id
    left join card_current_club cc on cc.card_id = c.id
    left join football_club fc on fc.club_key = cc.club_key
   where c.active and c.category = 'player'
     and (p_club_key is null or p_club_key = '' or cc.club_key = p_club_key)
     and (p_league   is null or p_league   = '' or fc.league   = p_league)
     and (p_country  is null or p_country  = '' or c.country   = p_country)
     and case coalesce(nullif(p_sort, ''), 'index')
           when 'value'  then c.market_value_eur is not null
           when 'views'  then c.pageviews is not null
           when 'rating' then c.sw_rating is not null
           when 'stats'  then exists (select 1 from player_season_stat s where s.card_id = c.id)
           when 'goals'  then exists (select 1 from player_season_stat s where s.card_id = c.id)
           else pl.index_score is not null
         end;
$$;

revoke all on function public.player_index_count(text, text, text, text) from public;
grant execute on function public.player_index_count(text, text, text, text)
  to anon, authenticated, service_role;
