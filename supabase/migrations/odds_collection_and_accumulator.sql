-- Котировки: сбор, консенсус и сборщик экспрессов — ТОЛЬКО ДЛЯ АДМИНА
-- ===========================================================================
--
-- ⚠️ §4.4 docs/LIVE_FOOTBALL_HANDOFF.md НЕ ОТМЕНЁН, А СУЖЕН, И ГРАНИЦА
-- ОСТАЛАСЬ ТАМ ЖЕ. Там записано: игроку не показывать ни коэффициентов, ни
-- производных от них, и держать это не обещанием, а отсутствием политики RLS
-- у `fixture_odds`. Так и есть после этой миграции: ни `anon`, ни
-- `authenticated` таблицу не читают, и вью консенсуса им тоже не выдан.
--
-- Изменилось одно: владелец просил, чтобы АДМИН видел продуманные прогнозы.
-- Админ — не игрок. Юридическая часть §4.4 (возрастные рейтинги, правила
-- Telegram, ограничения на рекламу букмекеров) касается того, что видит
-- игрок, и она не тронута. Доступ к производным даёт функция с проверкой
-- пароля персонала, а не грант на таблицу.
--
-- ⚠️ ЕДИНСТВЕННАЯ ЧЕСТНАЯ ВЕРОЯТНОСТЬ ЗДЕСЬ — РЫНОЧНАЯ. Наши три прогнозиста
-- отдают `confidence`, и в их же коде записано, что это НЕ вероятность, а
-- отрыв первого варианта от второго. Перемножать такие числа в экспрессе
-- значило бы строить ожидание на том, что ничего не измеряет. Поэтому
-- вероятность берётся у рынка, а прогнозисты стоят рядом как согласие или
-- расхождение — это повод посмотреть, а не поправка к цене.
--
-- ЧТО ПОКАЗАЛ ПЕРВЫЙ ЖЕ СБОР (20.09.2026, 1873 строки, 106 матчей,
-- 26 букмекеров, средний overround 1.0775). Экспресс из самых надёжных ног,
-- какие вообще есть на доске:
--
--     ног  вероятность ноги  проходимость  выплата  ВОЗВРАТ
--      1        0.898           89.8 %      1.04     0.934
--      2        0.874           78.4 %      1.12     0.877
--      3        0.860           67.5 %      1.22     0.826
--      4        0.835           56.4 %      1.37     0.773
--      6        0.767           33.6 %      1.96     0.658
--
-- Проходимость в 90 % достижима РОВНО НА ОДНОЙ НОГЕ, и это уже не экспресс.
-- Каждая добавленная нога ухудшает и проходимость, и возврат одновременно —
-- маржа перемножается. Поэтому функция ниже ничего не советует: она печатает
-- ноги, совокупную вероятность, выплату и ожидаемый возврат, и последнее
-- число всегда меньше единицы. Это не пессимизм, это арифметика линии.

create or replace function public.upsert_fixture_odds(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  insert into fixture_odds (fixture_id, taken_at, bookmaker,
                            home_price, draw_price, away_price)
  select r->>'fixture_id',
         coalesce((r->>'taken_at')::timestamptz, now()),
         r->>'bookmaker',
         nullif(r->>'home_price','')::numeric,
         nullif(r->>'draw_price','')::numeric,
         nullif(r->>'away_price','')::numeric
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   -- Матч обязан существовать: внешний ключ и так бы не пустил, но отсеять
   -- заранее дешевле, чем уронить всю пачку из-за одной строки о матче,
   -- которого у нас нет (провайдер отдаёт лиги шире, чем мы храним).
   where exists (select 1 from fixtures f where f.id = r->>'fixture_id')
  on conflict (fixture_id, taken_at, bookmaker) do update
     set home_price = excluded.home_price,
         draw_price = excluded.draw_price,
         away_price = excluded.away_price;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.upsert_fixture_odds(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_fixture_odds(jsonb) to service_role;

-- Свежий снимок цен по матчу, усреднённый по букмекерам и очищенный от маржи.
create or replace view public.fixture_odds_consensus as
with latest as (
  select distinct on (fixture_id) fixture_id, taken_at
    from fixture_odds order by fixture_id, taken_at desc
),
avg_price as (
  -- Медиана, а не среднее: одна ошибочная цена у одного букмекера сдвигает
  -- среднее и не сдвигает медиану, а такие выбросы в линиях бывают.
  select o.fixture_id, l.taken_at,
         count(*) as books,
         percentile_cont(0.5) within group (order by o.home_price) as home_price,
         percentile_cont(0.5) within group (order by o.draw_price) as draw_price,
         percentile_cont(0.5) within group (order by o.away_price) as away_price
    from fixture_odds o
    join latest l on l.fixture_id = o.fixture_id and l.taken_at = o.taken_at
   where o.home_price > 1 and o.draw_price > 1 and o.away_price > 1
   group by o.fixture_id, l.taken_at
)
select a.fixture_id, a.taken_at, a.books,
       a.home_price, a.draw_price, a.away_price,
       -- Overround: сумма обратных величин. У честной монеты была бы 1.0,
       -- у линии букмекера ~1.08 — это и есть его маржа.
       (1/a.home_price + 1/a.draw_price + 1/a.away_price) as overround,
       -- Справедливые вероятности: обратные величины, поделённые на overround.
       -- Без этого деления три «вероятности» дают в сумме 1.08, и перемножать
       -- их в экспрессе нельзя.
       (1/a.home_price) / (1/a.home_price + 1/a.draw_price + 1/a.away_price) as p_home,
       (1/a.draw_price) / (1/a.home_price + 1/a.draw_price + 1/a.away_price) as p_draw,
       (1/a.away_price) / (1/a.home_price + 1/a.draw_price + 1/a.away_price) as p_away
  from avg_price a;

comment on view public.fixture_odds_consensus is
  'Свежие цены по матчу: медиана по букмекерам и вероятности без маржи. '
  'СЛУЖЕБНОЕ. Игроку не показывается ничего из этого и ничего производного.';

revoke all on public.fixture_odds_consensus from public, anon, authenticated;

create or replace function public.admin_accumulator(
  p_password text,
  p_legs integer default 4,
  p_min_prob numeric default 0.60,
  p_hours integer default 72)
returns table(
  fixture_id text, commence_at timestamptz, home_team text, away_team text,
  pick text, price numeric, fair_prob numeric, books integer,
  models_agree integer, model_picks text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not admin_check_password(p_password) then
    raise exception 'нет доступа' using errcode = '42501';
  end if;
  return query
  with best as (
    select c.fixture_id, f.commence_at, f.home_team, f.away_team, c.books,
           case when c.p_home >= greatest(c.p_draw, c.p_away) then 'H'
                when c.p_away >= c.p_draw then 'A' else 'D' end as pick,
           greatest(c.p_home, c.p_draw, c.p_away) as fair_prob,
           case when c.p_home >= greatest(c.p_draw, c.p_away) then c.home_price
                when c.p_away >= c.p_draw then c.away_price else c.draw_price end as price
      from fixture_odds_consensus c
      join fixtures f on f.id = c.fixture_id
     where f.commence_at > now()
       and f.commence_at < now() + make_interval(hours => greatest(1, p_hours))
       and not f.completed
  )
  select b.fixture_id, b.commence_at, b.home_team, b.away_team,
         b.pick, round(b.price, 2), round(b.fair_prob, 4), b.books,
         -- Сколько наших моделей назвали ТО ЖЕ, что рынок. Это не поправка к
         -- вероятности, а повод посмотреть: расхождение всех трёх с рынком
         -- либо находка, либо ошибка в данных, и чаще второе.
         (select count(*)::int from forecast_pick p
           where p.fixture_id = b.fixture_id and p.pick = b.pick)::int,
         (select string_agg(p.model || ':' || p.pick, ' ' order by p.model)
            from forecast_pick p where p.fixture_id = b.fixture_id)
    from best b
   where b.fair_prob >= coalesce(p_min_prob, 0.60)
   order by b.fair_prob desc
   limit greatest(1, least(coalesce(p_legs, 4), 12));
end;
$$;

revoke all on function public.admin_accumulator(text, integer, numeric, integer) from public;
grant execute on function public.admin_accumulator(text, integer, numeric, integer)
  to anon, authenticated, service_role;

-- Здоровье сбора, не выдавая самих котировок.
--
-- ⚠️ ПОЧЕМУ ФУНКЦИЯ, А НЕ ЗАПРОС К ТАБЛИЦЕ. У `fixture_odds` намеренно НЕТ
-- ГРАНТОВ вообще, поэтому через PostgREST её не читает даже service_role — и
-- это работающая защита, а не помеха, которую надо обойти грантом. Проверке
-- нужны три числа, а не цены; функция отдаёт ровно их.
-- ⚠️ ЧЕТЫРЁХ ЧИСЕЛ БЫЛО МАЛО, И ЭТО ВЫЯСНИЛОСЬ ЖАЛОБОЙ ВЛАДЕЛЬЦА.
-- 21.09.2026 `odds_health` показывала полное здоровье — 3212 строк, свежие,
-- 106 матчей, сбор час назад, — а панель экспресса не собирала НИ ОДНОГО
-- билета и советовала «понизьте порог». Оба утверждения были верны
-- одновременно: котировки есть, но ВСЕ на матчи с 9 октября, потому что у
-- десяти купленных лиг перерыв на сборные, а ближайшие две недели заняты
-- сборными, МЛС и Аргентиной.
--
-- То есть здоровье сбора и пригодность котировок — РАЗНЫЕ вопросы, и первый
-- зеленел при мёртвом втором. Поэтому добавлены `next_priced` (когда
-- начинается ближайший матч с котировками) и `priced_72h` (сколько их в
-- ближайшие трое суток). Печатает их `check-limits`: это замер, а не
-- проверка — на перерыве сборных ноль в окне НОРМАЛЕН, и падать тут нечему.
drop function if exists public.odds_health();

create function public.odds_health()
returns table(rows bigint, fresh_rows bigint, matches bigint, last_taken timestamptz,
              next_priced timestamptz, priced_72h bigint, priced_month bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from fixture_odds),
         (select count(*) from fixture_odds where taken_at > now() - interval '4 days'),
         (select count(distinct fixture_id) from fixture_odds),
         (select max(taken_at) from fixture_odds),
         (select min(f.commence_at) from fixtures f
           where f.commence_at > now() and not f.completed
             and exists (select 1 from fixture_odds o where o.fixture_id = f.id)),
         (select count(*) from fixtures f
           where f.commence_at > now() and not f.completed
             and f.commence_at < now() + interval '72 hours'
             and exists (select 1 from fixture_odds o where o.fixture_id = f.id)),
         (select count(*) from fixtures f
           where f.commence_at > now() and not f.completed
             and f.commence_at < now() + interval '30 days'
             and exists (select 1 from fixture_odds o where o.fixture_id = f.id));
$$;

revoke all on function public.odds_health() from public, anon, authenticated;
grant execute on function public.odds_health() to service_role;

-- Расписание: через день, и это упирается в бюджет, а не в свежесть.
--
-- `/odds` стоит 1 кредит за лигу за вызов при потолке 500 в месяц. Десять лиг
-- = 10 кредитов за обход. Замер 20.09.2026: живой счёт съедает ~8 кредитов в
-- сутки (161 за двадцать дней), то есть ~240 в месяц. Ежедневный обход дал бы
-- 10 × 30 = 300, итого 540 — НЕ ВЛЕЗАЕТ. Через день: 150, итого ~390, запас
-- 110 остаётся счёту на всплески. Он на экране, котировки внутри, и при
-- выборе жертвовать надо не им.
create or replace function public.fetch_fixture_odds()
returns bigint
language plpgsql security definer set search_path = public, extensions
as $$
declare v_key text; v_id bigint;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'fixtures_invoke_key';
  if v_key is null then
    raise warning 'fetch_fixture_odds: vault secret fixtures_invoke_key is missing';
    return null;
  end if;
  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-odds',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_id;
  return v_id;
end;
$$;

revoke all on function public.fetch_fixture_odds() from public, anon, authenticated;
grant execute on function public.fetch_fixture_odds() to service_role;

select cron.schedule('fetch-fixture-odds', '10 6 */2 * *',
                     'select public.fetch_fixture_odds()');

-- ── Сколько матчей с котировками в каждом окне ─────────────────────────────
--
-- ⚠️ ЗАВЕДЕНО ПО ВТОРОЙ ЖАЛОБЕ ВЛАДЕЛЬЦА НА ТУ ЖЕ ПАНЕЛЬ: «выбрал недельный
-- прогноз и месячный — он никак не поменялся». Так и было, и виновата моя же
-- предыдущая правка. Панель расширяла пустое окно САМА, до месяца; а матчи с
-- котировками сейчас есть ТОЛЬКО в месяце. Значит любой выбор — три дня,
-- неделя, две недели — молча превращался в месяц и давал один и тот же
-- список. Управление, которое не меняет ничего, неотличимо от сломанного.
--
-- Правильно так: выбор пользователя — ЗАКОН, пустое окно остаётся пустым и
-- объясняет себя. А чтобы выбирать осмысленно, рядом с каждым окном должно
-- стоять число матчей. Его и отдаёт эта функция.
--
-- ⚠️ ЦЕН ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ — только СЧЁТ матчей, у которых цена
-- существует. §4.4 LIVE_FOOTBALL_HANDOFF запрещает показывать игроку
-- коэффициенты и производные от них; количество матчей производной от цены не
-- является. Пароль персонала всё равно проверяется — панель за ним и живёт.
create or replace function public.admin_odds_windows(p_password text)
returns table(hours integer, matches integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not admin_check_password(p_password) then
    raise exception 'нет доступа' using errcode = '42501';
  end if;
  return query
  select w.h,
         (select count(*)::int
            from fixtures f
           where f.commence_at > now()
             and not f.completed
             and f.commence_at < now() + make_interval(hours => w.h)
             and exists (select 1 from fixture_odds o where o.fixture_id = f.id))
    from unnest(array[72, 168, 336, 720]) as w(h)
   order by w.h;
end;
$$;

revoke all on function public.admin_odds_windows(text) from public;
grant execute on function public.admin_odds_windows(text) to anon, authenticated, service_role;
