-- Model-generated express tickets use only the two active forecast models.
-- Ticket legs are selected from calibrated, pre-match predictions; bookmaker
-- prices are not present in this model-based ticket type.

-- ── 1) Билет без цены, привязанный к ИГРОВОМУ ДНЮ ──────────────────────────
--
-- `accumulator_ticket.payout` и `accumulator_leg.price` остаются, но теперь
-- допускают NULL: у экспресса, собранного моделями, выплаты нет, потому что
-- нет ставки. Пустая цена здесь означает «мы не знаем и не показываем», а не
-- «коэффициент единица».

alter table public.accumulator_ticket alter column payout drop not null;
alter table public.accumulator_leg   alter column price  drop not null;

alter table public.accumulator_ticket add column if not exists model text;
alter table public.accumulator_ticket add column if not exists match_day date;
alter table public.accumulator_ticket
  add column if not exists backfilled boolean not null default false;

comment on column public.accumulator_ticket.model is
  'llm | own — чей это экспресс. NULL у старых билетов, собранных по '
  'букмекерской линии через admin_accumulator.';

-- ⚠️ УНИКАЛЬНОСТЬ ПО ИГРОВОМУ ДНЮ, А НЕ ПО ДНЮ СБОРКИ, И ЭТО НАШЛОСЬ НА
-- ПЕРВОМ ЖЕ ПРОГОНЕ. Сначала стояло «один билет на правило в день сборки» со
-- скользящим окном в 48 часов — и шаг не собрал НИЧЕГО: шёл перерыв на
-- сборные, за двое суток нашлось два матча. Замер на истории собирал по
-- одному экспрессу на ИГРОВОЙ ДЕНЬ; здесь теперь то же самое, и в перерыв
-- шаг спокойно доходит до следующего дня с матчами.
comment on column public.accumulator_ticket.match_day is
  'Игровой день, на который собран экспресс (UTC).';

-- ⚠️ ВЫРАЖЕНИЕ В УНИКАЛЬНОМ ИНДЕКСЕ НЕ ПРОШЛО, И ПРИЧИНА ПОУЧИТЕЛЬНА.
-- `(placed_at::date)` Postgres отвергает: приведение timestamptz к date
-- зависит от часового пояса сеанса и потому не IMMUTABLE. Отсюда отдельная
-- колонка вместо выражения.
drop index if exists public.accumulator_ticket_one_per_day;
create unique index if not exists accumulator_ticket_one_per_matchday
  on public.accumulator_ticket (rule, match_day)
  where model is not null;

comment on column public.accumulator_ticket.backfilled is
  'Собран задним числом по уже сыгранным матчам. ⚠️ У таких билетов есть '
  'поддавки: калибровка, которой отбирались плечи, подогнана в том числе НА '
  'ЭТИХ матчах. Честное число — в football_scraper/accumulator_backtest.py.';

-- ── 2) Сборка на ближайшие игровые дни ─────────────────────────────────────

drop function if exists public.build_model_accumulators(integer, integer[], numeric);

create function public.build_model_accumulators(
  p_days  integer default 14,
  p_legs  integer[] default array[3, 4],
  p_floor numeric default 0.47
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_model text;
  v_k     int;
  v_day   date;
  v_rule  text;
  v_id    bigint;
  v_prob  numeric;
  v_made  int := 0;
  v_skip  int := 0;
  v_thin  int := 0;
begin
  create temp table if not exists _legs_tmp (
    fixture_id text, pick text, prob numeric,
    home_team text, away_team text, commence_at timestamptz
  ) on commit drop;

  for v_day in
    select distinct (p.commence_at at time zone 'utc')::date
      from forecast_pick p
     where p.commence_at > now()
       and p.commence_at < now() + make_interval(days => greatest(1, p_days))
     order by 1
  loop
    foreach v_k in array p_legs loop
      foreach v_model in array array['llm', 'own'] loop
        v_rule := 'model:' || v_model || ':' || v_k;

        if exists (select 1 from accumulator_ticket t
                    where t.rule = v_rule and t.match_day = v_day) then
          v_skip := v_skip + 1;
          continue;
        end if;

        delete from _legs_tmp;

        -- ⚠️ ПРАВИЛО ОТБОРА, ВЫБРАННОЕ ЗАМЕРОМ: СОГЛАСИЕ ОБЕИХ АКТИВНЫХ МОДЕЛЕЙ, порог
        -- 0.47 по калиброванной вероятности, потом лучшие по вероятности
        -- ЭТОЙ модели. Числа и оговорка про значимость — в шапке файла.
        --
        -- ⚠️ ПОРОГ ЗДЕСЬ НЕ ДЛЯ КРАСОТЫ: он отсекает дни, когда сильных плеч
        -- вместо 150 — тридцать дней остались БЕЗ экспресса, и это правильный
        -- исход: доля проходов при этом выросла с 18.0 % до 18.3 %.
        insert into _legs_tmp
        select p.fixture_id, p.pick,
               calibrated_confidence(p.confidence, p.model),
               p.home_team, p.away_team, p.commence_at
          from forecast_pick p
         where p.model = v_model
           and p.commence_at > now()
           and (p.commence_at at time zone 'utc')::date = v_day
           and (select count(distinct p2.pick) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id) = 1
           and (select count(*) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                   and p2.model in ('llm', 'own')) = 2
           and calibrated_confidence(p.confidence, p.model) >= coalesce(p_floor, 0.47)
         -- ⚠️ ДОБОР ПО commence_at И fixture_id ОБЯЗАТЕЛЕН, и это видно на
         -- живых данных: у `own` калибровка сжала почти всё к 0.5500, то есть
         -- равенства сплошные. Без полного добора два прогона собрали бы
         -- РАЗНЫЕ билеты из одних и тех же данных.
         order by calibrated_confidence(p.confidence, p.model) desc,
                  p.commence_at asc, p.fixture_id asc
         limit v_k;

        if (select count(*) from _legs_tmp) < v_k then
          v_thin := v_thin + 1;
          continue;
        end if;

        select exp(sum(ln(greatest(prob, 0.0001)))) into v_prob from _legs_tmp;

        insert into accumulator_ticket
              (rule, model, legs, pass_prob, payout, match_day)
        values (v_rule, v_model, v_k, round(v_prob, 4), null, v_day)
        returning id into v_id;

        insert into accumulator_leg
              (ticket_id, fixture_id, pick, price, fair_prob,
               home_team, away_team, commence_at)
        select v_id, fixture_id, pick, null, round(prob, 4),
               home_team, away_team, commence_at
          from _legs_tmp;

        v_made := v_made + 1;
      end loop;
    end loop;
  end loop;

  return format('экспрессов собрано: %s, уже были: %s, не хватило плеч: %s',
                v_made, v_skip, v_thin);
end;
$$;

revoke all on function public.build_model_accumulators(integer, integer[], numeric) from public;
grant execute on function public.build_model_accumulators(integer, integer[], numeric) to service_role;

-- ⚠️ 07:10 — ПОСЛЕ ночного круга прогнозистов (forecast.yml идёт в 05:40 UTC
-- и заканчивается шагом `pick`). Собирать экспресс раньше значит собирать его
-- из вчерашних прогнозов. Дублируется шагом в player-stats.yml: cron и
-- workflow независимы, и если умрёт один, второй продолжит.
select cron.unschedule('build-model-accumulators')
 where exists (select 1 from cron.job where jobname = 'build-model-accumulators');
select cron.schedule('build-model-accumulators', '10 7 * * *',
                     $$select public.build_model_accumulators()$$);

-- ── 3) История задним числом ───────────────────────────────────────────────
--
-- ⚠️ ЗАЧЕМ ОНА ВООБЩЕ НУЖНА И ЧЕМ ЗА НЕЁ ПЛАТИТСЯ. Без неё экран истории
-- пуст до первых сыгранных туров, а владелец просил именно историю. Но у
-- билетов, собранных задним числом, ЕСТЬ ПОДДАВКИ: калибровка, которой
-- отбирались плечи, подогнана в том числе на этих же матчах. Поэтому они
-- помечены `backfilled`, экран их подписывает, а в сводке стоит отдельная
-- колонка. Честное число даёт только ход вперёд в
-- football_scraper/accumulator_backtest.py — и оно заметно скромнее:

create or replace function public.backfill_model_accumulators(p_floor numeric default 0.47)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_model text;
  v_k     int;
  v_day   date;
  v_rule  text;
  v_id    bigint;
  v_prob  numeric;
  v_made  int := 0;
  v_thin  int := 0;
begin
  create temp table if not exists _bf_tmp (
    fixture_id text, pick text, prob numeric, correct boolean,
    home_team text, away_team text, commence_at timestamptz
  ) on commit drop;

  for v_day in
    select distinct (p.commence_at at time zone 'utc')::date
      from forecast_pick p
     where p.correct is not null
     order by 1
  loop
    foreach v_k in array array[3, 4] loop
      foreach v_model in array array['llm', 'own'] loop
        v_rule := 'model:' || v_model || ':' || v_k;

        if exists (select 1 from accumulator_ticket t
                    where t.rule = v_rule and t.match_day = v_day) then
          continue;
        end if;

        delete from _bf_tmp;

        insert into _bf_tmp
        select p.fixture_id, p.pick,
               calibrated_confidence(p.confidence, p.model), p.correct,
               p.home_team, p.away_team, p.commence_at
          from forecast_pick p
         where p.model = v_model
           and p.correct is not null
           and (p.commence_at at time zone 'utc')::date = v_day
           and (select count(distinct p2.pick) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id) = 1
           and (select count(*) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id
                   and p2.model in ('llm', 'own')) = 2
           and calibrated_confidence(p.confidence, p.model) >= coalesce(p_floor, 0.47)
         order by calibrated_confidence(p.confidence, p.model) desc,
                  p.commence_at asc, p.fixture_id asc
         limit v_k;

        if (select count(*) from _bf_tmp) < v_k then
          v_thin := v_thin + 1;
          continue;
        end if;

        select exp(sum(ln(greatest(prob, 0.0001)))) into v_prob from _bf_tmp;

        insert into accumulator_ticket
              (rule, model, legs, pass_prob, payout, match_day, backfilled,
               placed_at, settled_at, won, legs_won)
        select v_rule, v_model, v_k, round(v_prob, 4), null, v_day, true,
               v_day::timestamptz, v_day::timestamptz + interval '1 day',
               bool_and(correct),
               count(*) filter (where correct)::smallint
          from _bf_tmp
        returning id into v_id;

        insert into accumulator_leg
              (ticket_id, fixture_id, pick, price, fair_prob,
               home_team, away_team, commence_at, correct)
        select v_id, fixture_id, pick, null, round(prob, 4),
               home_team, away_team, commence_at, correct
          from _bf_tmp;

        v_made := v_made + 1;
      end loop;
    end loop;
  end loop;

  return format('задним числом собрано: %s, не хватило плеч: %s', v_made, v_thin);
end;
$$;

revoke all on function public.backfill_model_accumulators(numeric) from public;
grant execute on function public.backfill_model_accumulators(numeric) to service_role;

-- ── 4) Чтение — без пароля, потому что цен в этих билетах нет ──────────────
--
-- ⚠️ ПАРОЛЬ ОСТАЁТСЯ ТАМ, ГДЕ ОСТАЮТСЯ ЦЕНЫ. Билеты, собранные моделями
-- (`model is not null`), цен не содержат — их можно показывать игроку.
-- Билеты `admin_accumulator` содержат и остаются за паролем. Разделение
-- сделано ФИЛЬТРОМ В ЗАПРОСЕ, а не доверием вызывающему.

drop function if exists public.model_accumulator_history(integer, text, timestamptz, bigint);

create function public.model_accumulator_history(
  p_limit     integer default 40,
  p_model     text    default null,
  p_before_at timestamptz default null,
  p_before_id bigint  default null
)
returns table (
  id          bigint,
  placed_at   timestamptz,
  match_day   date,
  model       text,
  legs        smallint,
  pass_prob   numeric,
  settled_at  timestamptz,
  won         boolean,
  legs_won    smallint,
  backfilled  boolean,
  teams       text
)
language sql stable security definer set search_path = public as $$
  select t.id, t.placed_at, t.match_day, t.model, t.legs, round(t.pass_prob, 4),
         t.settled_at, t.won, t.legs_won, t.backfilled,
         (select string_agg(l.home_team || ' – ' || l.away_team || ' (' || l.pick || ')',
                            ' · ' order by l.commence_at)
            from accumulator_leg l where l.ticket_id = t.id)
    from accumulator_ticket t
   where t.model is not null
     and (p_model is null or p_model = '' or t.model = p_model)
     and (p_before_at is null
          or (t.placed_at, t.id) < (p_before_at, coalesce(p_before_id, 9223372036854775807)))
   order by t.placed_at desc, t.id desc
   limit greatest(1, least(coalesce(p_limit, 40), 200));
$$;

revoke all on function public.model_accumulator_history(integer, text, timestamptz, bigint) from public;
grant execute on function public.model_accumulator_history(integer, text, timestamptz, bigint)
  to anon, authenticated, service_role;

drop function if exists public.model_accumulator_scoreboard();

create function public.model_accumulator_scoreboard()
returns table (
  model        text,
  legs         smallint,
  settled      integer,
  won          integer,
  hit_rate     numeric,
  expected     numeric,
  avg_legs_won numeric,
  pending      integer,
  backfilled   integer
)
language sql stable security definer set search_path = public as $$
  select t.model, t.legs,
         count(*) filter (where t.settled_at is not null)::int,
         count(*) filter (where t.won)::int,
         round(100.0 * avg((t.won)::int) filter (where t.settled_at is not null), 1),
         -- ⚠️ ОЖИДАЕМОЕ РЯДОМ С ФАКТИЧЕСКИМ — ОБЯЗАТЕЛЬНО. Доля проходов сама
         -- по себе не говорит ничего: 20 % это хорошо или плохо, зависит от
         -- того, сколько обещала калибровка.
         round(100.0 * avg(t.pass_prob) filter (where t.settled_at is not null), 1),
         round(avg(t.legs_won) filter (where t.settled_at is not null), 2),
         count(*) filter (where t.settled_at is null)::int,
         -- Сколько из них собрано задним числом. Пока это число равно
         -- `settled`, доля проходов выше честной, и экран обязан это сказать.
         count(*) filter (where t.backfilled)::int
    from accumulator_ticket t
   where t.model is not null
   group by t.model, t.legs
   order by t.model, t.legs;
$$;

revoke all on function public.model_accumulator_scoreboard() from public;
grant execute on function public.model_accumulator_scoreboard()
  to anon, authenticated, service_role;

create or replace function public.model_accumulator_legs(p_ticket bigint)
returns table (
  fixture_id  text,
  commence_at timestamptz,
  home_team   text,
  away_team   text,
  pick        text,
  prob        numeric,
  correct     boolean
)
language sql stable security definer set search_path = public as $$
  select l.fixture_id, l.commence_at, l.home_team, l.away_team,
         l.pick, round(l.fair_prob, 4), l.correct
    from accumulator_leg l
    join accumulator_ticket t on t.id = l.ticket_id
   where l.ticket_id = p_ticket
     -- та же граница: плечи билетов с ценами наружу не отдаются
     and t.model is not null
   order by l.commence_at, l.fixture_id;
$$;

revoke all on function public.model_accumulator_legs(bigint) from public;
grant execute on function public.model_accumulator_legs(bigint)
  to anon, authenticated, service_role;
