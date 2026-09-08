-- Большие матчи: СКОРО важнее, чем ДОРОГО.
--
-- Владелец: «во время большого количества громких матчей добавляй по 2-3 в
-- анонс на главную, и в дайджесте добавляются матчи, которые начинаются через
-- 2 дня, сделай так чтобы за полчаса анонсировали трансляцию матча».
--
-- ⚠️ ЧТО БЫЛО НЕ ТАК, И ЭТО НЕ НАСТРОЙКА, А ПОРЯДОК. Прежняя версия брала окно
-- в десять дней и сортировала ТОЛЬКО по сумме стоимости составов. Значит матч
-- «Реала» через девять дней стоял выше дерби, которое начинается через час: на
-- главной висел анонс позавчерашней свежести, а тот, на который можно успеть
-- включить телевизор, в тройку не попадал вовсе. Владелец увидел ровно это.
--
-- ⚠️ ТРИ КОРЗИНЫ, А НЕ ДВЕ, И ЭТО ИСПРАВЛЕНИЕ ПЕРВОЙ ЖЕ ПОПЫТКИ. Сначала я
-- поставил внутри «скоро» сортировку по времени — и главная тут же выдала
-- «Ульсан» — «Сеул» выше «Утрехта»: 9 млн против 80 млн, просто потому что
-- начинался на полтора часа раньше. Время не должно вытеснять важность, оно
-- должно её ОБГОНЯТЬ ТОЛЬКО НА ФИНИШЕ. Отсюда корзины:
--   0 — до начала меньше p_alert_minutes: это и есть анонс трансляции, и он
--       главнее всего, потому что на него можно успеть;
--   1 — ближайшие p_soon_hours: по стоимости составов;
--   2 — остальное окно: по стоимости составов.
--
-- ⚠️ МИНУТЫ ДО НАЧАЛА СЧИТАЕТ БАЗА, А НЕ ЭКРАН. Клиент знает своё время, а не
-- время сервера, и на телефоне с уехавшими часами «через 30 минут» стало бы
-- «через два часа» — молча. Число приходит готовым.
--
-- ⚠️ УДАЛЕНИЕ ПЕРЕД СОЗДАНИЕМ ОБЯЗАТЕЛЬНО. В `returns table` добавлена
-- колонка, а Postgres на это отвечает «cannot change return type of existing
-- function»: `create or replace` не проходит. Этот проект спотыкался об это
-- трижды, поэтому drop написан явно и по полной сигнатуре.
drop function if exists public.top_fixtures(text, integer, integer);

create or replace function public.top_fixtures(
  p_lang       text    default 'ru',
  p_limit      integer default 5,
  p_days         integer default 10,
  p_soon_hours   integer default 24,
  -- За сколько минут до начала матч становится анонсом трансляции. Владелец:
  -- «сделай так чтобы за полчаса анонсировали трансляцию матча».
  p_alert_minutes integer default 30)
returns table(
  fixture_id       text,
  commence_at      timestamptz,
  sport_key        text,
  league           text,
  home_key         text,
  home_name        text,
  home_crest       text,
  home_value       bigint,
  home_squad       integer,
  away_key         text,
  away_name        text,
  away_crest       text,
  away_value       bigint,
  away_squad       integer,
  importance       bigint,
  -- Сколько минут до начала. Клиент по нему решает, что писать: «через
  -- 25 минут», «через 3 часа» или дату.
  minutes_to_start integer)
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $function$
  -- ⚠️ MATERIALIZED — НЕ УКРАШЕНИЕ, А ЛИМИТ ANON В 3 СЕКУНДЫ. Без него
  -- планировщик вкладывает свёртку по 24 тысячам строк внутрь соединения и
  -- считает её на каждый матч: первый живой замер дал 4.1 с — то есть для
  -- игрока это не «медленно», а «главная пустая». Этот же приём уже спасал
  -- `fixture_team_rating`, см. шапку check-prod.
  with squad as materialized (
    select cc.club_key,
           sum(c.market_value_eur)::bigint as value,
           count(*) filter (where c.market_value_eur is not null)::integer as priced
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  ),
  soon as materialized (
    select f.id, f.commence_at, f.sport_key,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.commence_at > now()
       and f.commence_at < now() + make_interval(days => greatest(coalesce(p_days, 10), 1))
       and not coalesce(f.completed, false)
  ),
  ranked as materialized (
    select s.id, s.commence_at,
           -- ⚠️ ТУРНИР — ИЗ САМОГО МАТЧА, А НЕ ИЗ ЛИГИ ХОЗЯЕВ. Сперва здесь
           -- стояла football_club.league, и матч «Порту» — «Манчестер Сити» в
           -- Лиге чемпионов подписывался «Португалия. Высшая лига». Домашняя
           -- лига клуба и турнир, в котором идёт матч, — разные вещи, и в
           -- еврокубках они расходятся всегда.
           s.sport_key,
           coalesce(hc.league, ac.league) as league,
           s.hk, club_display_name(s.hk, p_lang) as home_name, hc.crest_url as home_crest,
           hs.value as home_value, coalesce(hs.priced, 0) as home_squad,
           s.ak, club_display_name(s.ak, p_lang) as away_name, ac.crest_url as away_crest,
           as_.value as away_value, coalesce(as_.priced, 0) as away_squad,
           (coalesce(hs.value, 0) + coalesce(as_.value, 0))::bigint as importance,
           (extract(epoch from (s.commence_at - now())) / 60)::integer as mins,
           case
             when s.commence_at < now() + make_interval(mins => greatest(coalesce(p_alert_minutes, 30), 1))
               then 0
             when s.commence_at < now() + make_interval(hours => greatest(coalesce(p_soon_hours, 24), 1))
               then 1
             else 2
           end as bucket
      from soon s
      left join football_club hc on hc.club_key = s.hk
      left join football_club ac on ac.club_key = s.ak
      left join squad hs on hs.club_key = s.hk
      left join squad as_ on as_.club_key = s.ak
     where s.hk is not null and s.ak is not null
       and hc.crest_url is not null and ac.crest_url is not null
       and coalesce(hs.value, 0) + coalesce(as_.value, 0) > 0
  )
  select fixture_id, commence_at, sport_key, league,
         home_key, home_name, home_crest, home_value, home_squad,
         away_key, away_name, away_crest, away_value, away_squad,
         importance, mins
    from (
      select r.id as fixture_id, r.commence_at, r.sport_key, r.league,
             r.hk as home_key, r.home_name, r.home_crest, r.home_value, r.home_squad,
             r.ak as away_key, r.away_name, r.away_crest, r.away_value, r.away_squad,
             r.importance, r.mins, r.bucket
        from ranked r
    ) q
   order by q.bucket asc,
            -- Внутри корзины анонса — по времени: тот, что вот-вот начнётся,
            -- обязан быть первым, иначе анонс опоздает. Во всех остальных
            -- корзинах решает стоимость составов.
            case when q.bucket = 0 then q.mins end asc nulls last,
            q.importance desc,
            q.commence_at
   limit greatest(coalesce(p_limit, 5), 1);
$function$;

comment on function public.top_fixtures(text, integer, integer, integer, integer) is
  'Большие матчи: сперва анонс трансляции (p_alert_minutes), затем самые дорогие '
  'по сумме составов — сначала ближайшие сутки, потом остальное окно. minutes_to_start считает база — часы телефона врут молча.';

revoke all on function public.top_fixtures(text, integer, integer, integer, integer) from public;
grant execute on function public.top_fixtures(text, integer, integer, integer, integer)
  to anon, authenticated, service_role;
