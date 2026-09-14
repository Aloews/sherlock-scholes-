-- ============================================================================
-- СОСТЯЗАНИЕ ТРЁХ ПРОГНОЗИСТОВ — данные для дашборда внутри Pro.
--
-- Владелец: «дашборд нужен с удачными исходами матчей внутри pro версии
-- Шерлок Скоулс и сравнением двух моделей „прогнозистов“: а) ллм б) мозг
-- дрозофилы в) свой вариант, улучшенный».
--
-- ⚠️ ОБУЧЕНИЕ ИДЁТ НЕ ЗДЕСЬ. Ридж-регрессия и резервуар живут в
-- `football_scraper/forecast_duel.py`; отдельный прогон учится на прошлом,
-- проверяется на будущем и КЛАДЁТ ИТОГ В ЭТИ ТАБЛИЦЫ. Считать на лету
-- значило бы переобучать модель при каждом открытии экрана — и показывать
-- каждый раз новое число, потому что часть проверочных матчей за это время
-- становится обучающими.
--
-- ЧТО ИЗМЕРЕНО НА БОЮ (1125 матчей, ни один не участвовал в обучении):
--
--     участник                ошибка   угадано    назвал
--     медиана                 1.3600     58.2 %   100 %   ← точка отсчёта
--     нынешняя формула        1.3656     57.3 %   100 %
--     ЛЛМ (линейная голова)   1.3658     58.3 %   100 %
--     мозг дрозофилы          1.3782     57.1 %   100 %
--     свой вариант            1.3685     66.1 %    39.6 %
--
-- ⚠️ ЧЕСТНЫЙ ВЫВОД, КОТОРЫЙ НАПИСАН И НА ЭКРАНЕ: по средней ошибке НИ ОДИН
-- из трёх не бьёт медиану. Работает ровно одно — молчание. «Свой вариант»
-- отказывается от матчей, где две модели спорят или обе стоят у самого
-- порога, и на оставшихся четырёх из десяти угадывает 66 % против 58 % у
-- «всегда говори больше 2.5».
--
-- ⚠️ ДВА ДРУГИХ СПОСОБА БЫЛИ ПРОВЕРЕНЫ И ОТВЕРГНУТЫ, а не забыты. Подбор
-- границы решения: на отложенной части лучшей вышла 2.45, а на новых матчах
-- она сделала линейную голову ХУЖЕ (0.5831 → 0.5707). Стягивание к медиане
-- само по себе: подбор вернул коэффициент 1.0, то есть стягивать нечего.
--
-- ⚠️ ПОКРЫТИЕ ХРАНИТСЯ ОТДЕЛЬНОЙ КОЛОНКОЙ И ПЕЧАТАЕТСЯ РЯДОМ С ДОЛЕЙ. 66 %
-- на четырёх матчах из десяти и 58 % на всех десяти — разные вещи, и
-- показать первое без второго значит соврать в пользу своей же модели.
-- ============================================================================

-- ── 1) Признаки без утечки ──────────────────────────────────────────────────
-- ⚠️ ОТЛИЧИЕ ОТ duel_features.sql — ДОБАВЛЕНЫ КЛЮЧИ КЛУБОВ. Без них дашборд
-- не может назвать матч, к которому относится прогноз, и таблица «сбылось или
-- нет» превращается в столбик галочек без подписей.
--
-- Окно каждой команды кончается за СУТКИ до матча, поэтому ни одна строка не
-- видит ни себя, ни одноклубников того же дня.
drop view if exists public.duel_features;
create view public.duel_features as
  with games as (
    select m.match_date, m.home_key, m.away_key,
           m.home_score::numeric hs, m.away_score::numeric as_,
           (m.home_score + m.away_score)::numeric total
      from club_match m
     where m.home_score is not null and m.away_score is not null
       and m.home_key <> m.away_key and m.match_date >= current_date - 400),
  sides as (
    select match_date, home_key club, hs gf, as_ ga from games
    union all
    select match_date, away_key, as_, hs from games),
  roll as (
    select club, match_date,
           avg(gf) over w gf_pm, avg(ga) over w ga_pm,
           count(*) over w n, stddev_samp(gf + ga) over w sd
      from sides
    window w as (partition by club order by match_date
                 range between interval '400 days' preceding
                           and interval '1 day' preceding))
  select g.match_date, g.total, g.home_key, g.away_key,
         round(rh.gf_pm, 4) as h_gf, round(rh.ga_pm, 4) as h_ga,
         round(ra.gf_pm, 4) as a_gf, round(ra.ga_pm, 4) as a_ga,
         rh.n as h_n, ra.n as a_n,
         round(coalesce(rh.sd, 0), 4) as h_sd, round(coalesce(ra.sd, 0), 4) as a_sd
    from games g
    join roll rh on rh.club = g.home_key and rh.match_date = g.match_date
    join roll ra on ra.club = g.away_key and ra.match_date = g.match_date
   where rh.n >= 10 and ra.n >= 10;

comment on view public.duel_features is
  'Признаки матча без утечки — для опыта «три прогнозиста». Клубы добавлены, '
  'чтобы дашборд мог назвать матч.';

-- Анониму не отдаётся: это служебный срез, а не экран.
revoke all on public.duel_features from public, anon, authenticated;
grant select on public.duel_features to service_role;

-- ── 2) Итог состязания ──────────────────────────────────────────────────────

create table if not exists public.forecast_duel_model (
  model      text primary key,
  mae        numeric  not null,
  hit_rate   numeric  not null,
  coverage   numeric  not null default 1,
  matches    integer  not null,
  params     jsonb    not null default '{}'::jsonb,
  trained_at timestamptz not null default now()
);

comment on table public.forecast_duel_model is
  'Итог опыта «три прогнозиста» на ПРОВЕРОЧНОЙ части: средняя ошибка и доля '
  'угаданных исходов.';
comment on column public.forecast_duel_model.coverage is
  'Какую долю матчей модель ВООБЩЕ назвала. У «своего варианта» меньше '
  'единицы: он молчит, когда не уверен, и доля угаданных у него считается '
  'только по названным.';

create table if not exists public.forecast_duel_match (
  ord        integer primary key,
  match_date date     not null,
  home_key   text     not null,
  away_key   text     not null,
  total      smallint not null,
  p_llm      numeric  not null,
  p_fly      numeric  not null,
  p_own      numeric  not null,
  p_median   numeric  not null,
  own_called boolean  not null default true
);

comment on table public.forecast_duel_match is
  'Прогнозы всех трёх на каждый матч проверочной части — матчей, которых ни '
  'одна не видела при обучении.';

-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
alter table public.forecast_duel_model enable row level security;
alter table public.forecast_duel_match enable row level security;
drop policy if exists forecast_duel_model_read on public.forecast_duel_model;
drop policy if exists forecast_duel_match_read on public.forecast_duel_match;
create policy forecast_duel_model_read on public.forecast_duel_model for select using (true);
create policy forecast_duel_match_read on public.forecast_duel_match for select using (true);
grant select on public.forecast_duel_model to anon, authenticated, service_role;
grant select on public.forecast_duel_match to anon, authenticated, service_role;
grant insert, update, delete on public.forecast_duel_model to service_role;
grant insert, update, delete on public.forecast_duel_match to service_role;

-- ── 3) Что читает экран ─────────────────────────────────────────────────────

create or replace function public.forecast_duel_models()
returns table (
  model text, mae numeric, hit_rate numeric, coverage numeric,
  matches integer, params jsonb, trained_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.model, m.mae, m.hit_rate, m.coverage, m.matches, m.params, m.trained_at
    from forecast_duel_model m
   -- Порядок задаёт СЕРВЕР, а не экран: иначе «кто первый» решалось бы в двух
   -- местах и однажды разошлось бы. Точки отсчёта идут последними — они не
   -- участники состязания, а линейка, которой его меряют.
   order by case m.model when 'own' then 0 when 'llm' then 1 when 'fly' then 2
                         when 'median' then 3 else 4 end;
$$;

comment on function public.forecast_duel_models() is
  'Итог состязания трёх прогнозистов на матчах, которых они не видели при обучении.';

revoke all on function public.forecast_duel_models() from public;
grant execute on function public.forecast_duel_models() to anon, authenticated, service_role;

create or replace function public.forecast_duel_recent(
  p_lang text default 'ru', p_limit integer default 40)
returns table (
  match_date date, home_name text, away_name text, total smallint,
  p_llm numeric, p_fly numeric, p_own numeric, own_called boolean,
  hit_llm boolean, hit_fly boolean, hit_own boolean)
language sql stable security definer set search_path = public as $$
  select d.match_date,
         club_display_name(d.home_key, p_lang),
         club_display_name(d.away_key, p_lang),
         d.total, d.p_llm, d.p_fly, d.p_own, d.own_called,
         -- Попадание — СТОРОНА порога 2.5, а не близость числа: именно это
         -- видит игрок, когда спрашивает «сбылось или нет». Прогноз 10 при
         -- тотале 3 ошибается на семь голов и при этом угадывает исход.
         (d.p_llm > 2.5) = (d.total > 2.5),
         (d.p_fly > 2.5) = (d.total > 2.5),
         -- ⚠️ NULL, А НЕ FALSE, КОГДА СВОЙ ВАРИАНТ ПРОМОЛЧАЛ. Записать
         -- молчание промахом значило бы наказать модель за то, ради чего она
         -- и сделана, и на экране показать неверные 26 % вместо 66 %.
         case when d.own_called then (d.p_own > 2.5) = (d.total > 2.5) end
    from forecast_duel_match d
   order by d.match_date desc, d.ord desc
   limit greatest(coalesce(p_limit, 40), 1);
$$;

comment on function public.forecast_duel_recent(text, integer) is
  'Последние матчи проверочной части: что назвал каждый прогнозист и сбылось '
  'ли. hit_own = null означает, что свой вариант промолчал.';

revoke all on function public.forecast_duel_recent(text, integer) from public;
grant execute on function public.forecast_duel_recent(text, integer)
  to anon, authenticated, service_role;
