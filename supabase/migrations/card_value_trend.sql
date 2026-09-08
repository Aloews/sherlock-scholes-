-- Стоимость — основное мерило игрока, и главное в ней ИЗМЕНЕНИЕ.
-- ===========================================================================
--
-- Владелец: «скрой этот показатель [уровень] и основным сделай стоимость, она
-- лучше отражает рейтинг игрока. Нужно просто записывать изменение стоимости
-- в карточке, так будет ясно повышается уровень игрока или нет».
--
-- ПОЧЕМУ ОН ПРАВ И ПО СУЩЕСТВУ. Уровень — перцентиль, округлённый до целого, и
-- на верхушке в сотню упирались слишком многие: «98–100» переставало
-- что-либо значить. Стоимость различает там, где перцентиль уже нет.
--
-- ⚠️ УРОВЕНЬ УБРАН С КАРТОЧКИ, НО НЕ ИЗ БАЗЫ. Его читают рейтинг футболистов и
-- уровень состава в прогнозах — там он к месту.
--
-- ⚠️ РОСТА ПОКА НЕТ НИ У ОДНОЙ КАРТОЧКИ, И ЭТО НАДО ГОВОРИТЬ ПРЯМО.
-- `card_metric_history` заведена 06.09.2026: на 25 509 карточек ровно 25 509
-- записей market_value, то есть по ОДНОЙ. Второй точки нет ни у кого, значит и
-- отношения не посчитать. Ночной снимок пишет изменения дальше сам; до второй
-- точки карточка показывает стоимость и дату, а не выдуманную стрелку.
--
-- ⚠️ В ИСТОРИИ ЛЕЖАТ ИЗМЕНЕНИЯ, А НЕ ЕЖЕДНЕВНЫЕ СНИМКИ. Поэтому «сколько было
-- раньше» ищется как ПОСЛЕДНЯЯ запись не позже даты, а не как строка за эту
-- дату: строки за неё может не быть вовсе. Тот же приём уже стоит в
-- `rebuild_player_levels` при расчёте value_growth.

create or replace function public.card_value_trend(p_card_id uuid, p_points integer default 8)
returns table (
  value_eur   bigint,
  value_at    date,
  prev_eur    bigint,
  prev_at     date,
  growth      numeric,
  points      jsonb
)
language sql stable security definer set search_path = public
set statement_timeout = '10s'
as $$
  with h as (
    select taken_on, value
      from card_metric_history
     where card_id = p_card_id and metric = 'market_value' and value is not null
     order by taken_on desc
  ),
  now_v as (select taken_on, value from h limit 1),
  prev_v as (
    select taken_on, value from h
     where taken_on <= (now() at time zone 'utc')::date - 90
     limit 1
  ),
  pts as (
    select jsonb_agg(jsonb_build_object('d', taken_on, 'v', value) order by taken_on)
      from (select taken_on, value from h limit greatest(coalesce(p_points, 8), 2)) t
  )
  select (select value from now_v)::bigint,
         (select taken_on from now_v),
         (select value from prev_v)::bigint,
         (select taken_on from prev_v),
         case when (select value from prev_v) > 0
              then round((select value from now_v)::numeric / (select value from prev_v), 3) end,
         coalesce((select * from pts), '[]'::jsonb);
$$;

comment on function public.card_value_trend(uuid, integer) is
  'Стоимость карточки и её изменение: сейчас, 90 дней назад, отношение и точки истории. История хранит ИЗМЕНЕНИЯ, поэтому «раньше» ищется как последняя запись не позже даты.';

revoke all on function public.card_value_trend(uuid, integer) from public;
grant execute on function public.card_value_trend(uuid, integer) to anon, authenticated, service_role;
