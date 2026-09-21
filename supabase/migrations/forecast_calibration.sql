-- Калибровка уверенности: число рядом с прогнозом должно значить то, что говорит
-- ============================================================================
--
-- ⚠️ ГЛАВНАЯ ПОЛОМКА ЭКРАНА «ПРОГНОЗЫ» — НЕ ТОЧНОСТЬ, А ВРАНЬЁ О НЕЙ. Замер по
-- 2976 размеченным прогнозам на боевых данных:
--
--     модель   говорит   попадает   разрыв
--     own       78.6 %     46.0 %   +32.6 пункта
--     llm       60.9 %     47.6 %   +13.3
--     fly       10.2 %     46.2 %   −36.0
--
-- ⚠️ И ВОТ ЧИСЛО, ПОСЛЕ КОТОРОГО СПОРИТЬ НЕ О ЧЕМ. Brier предсказателя,
-- который ВСЕГДА называет одно и то же (долю попаданий 0.466), — 0.2488.
-- У наших моделей: llm 0.3406, fly 0.3803, own 0.4101. Все три ХУЖЕ, чем
-- постоянное число. Не «чуть хуже» — в полтора раза.
--
-- ⚠️ БЕЗ ЭТОГО ЭКСПРЕССЫ СЧИТАТЬ НЕЛЬЗЯ В ПРИНЦИПЕ. Вероятность прохода
-- экспресса — произведение вероятностей плеч. Четыре плеча по «0.786» обещают
-- 38 % проходов; настоящие 0.46 дают 4.5 %. Ошибка в восемь раз. Владелец
-- просил «добиться улучшения удачных экспрессов» — на некалиброванных числах
-- это измерение собственного самообмана, а не работа.
--
-- ── ЧТО КАЛИБРОВКА ДЕЛАЕТ И ЧЕГО НЕ ДЕЛАЕТ ─────────────────────────────────
--
-- НЕ делает: не меняет НИ ОДНОГО выбранного исхода. Преобразование монотонно,
-- порядок матчей по уверенности прежний. Это не новая модель.
--
-- Делает: приводит число к тому, что оно должно означать.
--
-- Способ — Платт (логистическая по логиту), выбран замером, а не по книжке.
-- Обе кандидатуры проверены на отложенной ПО ВРЕМЕНИ трети:
--
--     модель  без калибровки   изотоническая    Платт    константа
--     fly           0.3664     0.2432…0.3141   0.2470     0.2473
--     llm           0.3388     0.2438…0.2687   0.2438     0.2490
--     own           0.4387     0.2879…0.2977   0.2421     0.2470
--
-- У изотонической разброс зависит от числа корзин, то есть выбор корзин решает
-- исход, а данных выбрать его честно нет. У Платта два параметра, подгонять
-- нечего, и он единственный обошёл константу у всех трёх.
--
-- ⚠️ ЧЕСТНЫЙ ВЫВОД, КОТОРЫЙ ВАЖНЕЕ САМОЙ КАЛИБРОВКИ И КОТОРЫЙ НЕЛЬЗЯ
-- ЗАМАЗЫВАТЬ: выигрыш у константы — сотые доли (0.2470 → 0.2421). Наклоны
-- вышли крошечные (a ≈ 0.06…0.12). Это значит, что модели почти не несут
-- информации, и калибровка честно сжимает их к средней. Она убирает ложь, но
-- НЕ СОЗДАЁТ УМЕНИЯ. Разбор, что делать дальше, — в docs/NEXT_SESSION.md.
--
-- Подгонка живёт в football_scraper/calibration.py, проверки — в
-- football_scraper/tests/test_calibration.py (в том числе отрицательный
-- контроль: на заведомо лживом входе выигрыш обязан быть).

create table if not exists public.forecast_calibration (
  model        text primary key,
  -- sigmoid(a · logit(p) + b)
  a            numeric     not null,
  b            numeric     not null,
  trained_on   integer     not null,
  tested_on    integer     not null,
  -- ⚠️ ТРИ ЧИСЛА, А НЕ ОДНО. В базе лежит не «откалибровано», а НА СКОЛЬКО
  -- ИМЕННО это лучше, чем не делать ничего, и чем ставить константу. Без
  -- третьего столбца «стало лучше» ничего не значит: лучше вранья — не
  -- достижение.
  brier_raw    numeric     not null,
  brier_cal    numeric     not null,
  brier_const  numeric     not null,
  fitted_at    timestamptz not null default now()
);

comment on table public.forecast_calibration is
  'Платт-калибровка уверенности по моделям: sigmoid(a·logit(p)+b). '
  'brier_* измерены на отложенной ПО ВРЕМЕНИ части, не на учебной.';

alter table public.forecast_calibration enable row level security;
drop policy if exists forecast_calibration_read on public.forecast_calibration;
create policy forecast_calibration_read on public.forecast_calibration for select using (true);
grant select on public.forecast_calibration to anon, authenticated, service_role;

-- ⚠️ ОДНОГО ГРАНТА НА ЗАПИСЬ МАЛО — НУЖНА И ПОЛИТИКА. Первый прогон ночного
-- шага упал с «HTTP 403», потому что здесь стоял только `grant select`:
-- таблица под RLS, и сервисная роль, ходящая через PostgREST, подчиняется
-- политикам так же, как все. Забыть половину — значит получить шаг, который
-- считает правильно и молча не сохраняет.
grant insert, update, delete on public.forecast_calibration to service_role;
drop policy if exists forecast_calibration_write on public.forecast_calibration;
create policy forecast_calibration_write on public.forecast_calibration
  for all to service_role using (true) with check (true);

-- ── Применение ─────────────────────────────────────────────────────────────
--
-- ⚠️ НЕТ ПОДГОНКИ — ВОЗВРАЩАЕТСЯ ИСХОДНОЕ ЧИСЛО, А НЕ NULL И НЕ НОЛЬ. Пока
-- ночной шаг ни разу не отработал (или у модели слишком мало размеченного),
-- экран обязан показывать то же, что показывал вчера, а не пустоту.
--
-- ⚠️ SECURITY INVOKER, А НЕ DEFINER, И ЭТО НЕ МЕЛОЧЬ. Здесь нет ничего, что
-- нужно было бы открывать чужими правами: `forecast_calibration` и так
-- читается анонимом (политика `using (true)`), потому что калиброванное
-- число видно на экране. Первая версия стояла `definer` по привычке — и
-- советник Supabase честно назвал это лишним правом. DEFINER там, где
-- достаточно INVOKER, ничего не даёт функции и однажды даёт лишнее тому,
-- кто её позовёт. Вызов из `forecast_upcoming` (она DEFINER и за подпиской)
-- от этого не страдает: внутри DEFINER-функции INVOKER-функция исполняется
-- уже с её правами — проверено, 20 строк из 20 приходят пересчитанными.
create or replace function public.calibrated_confidence(p numeric, p_model text)
returns numeric
language sql stable security invoker set search_path = public as $$
  select case
    when p is null then null
    when c.a is null then round(p, 3)
    -- Границы нужны логиту: на 0 и 1 он уходит в бесконечность.
    else round((1.0 / (1.0 + exp(-(c.a * ln(
           least(greatest(p, 0.0001), 0.9999)
           / (1 - least(greatest(p, 0.0001), 0.9999))) + c.b))))::numeric, 3)
  end
  from (select 1) _
  left join forecast_calibration c on c.model = p_model
$$;

revoke all on function public.calibrated_confidence(numeric, text) from public;
grant execute on function public.calibrated_confidence(numeric, text)
  to anon, authenticated, service_role;

-- ── Экран ──────────────────────────────────────────────────────────────────
--
-- ⚠️ КАЛИБРОВАННОЕ ЧИСЛО ДОБАВЛЕНО ОТДЕЛЬНЫМИ КОЛОНКАМИ, А НЕ ПОДМЕНЕНО НА
-- МЕСТЕ. Подменить `llm_conf` было бы на строку короче и на одну тихую ложь
-- больше: выкаченный фронтенд продолжил бы подписывать это число прежними
-- словами, а в истории прогнозов рядом лежало бы сырое. Пусть обе величины
-- будут видны и различимы.
--
-- ⚠️ DROP ПЕРЕД CREATE НЕИЗБЕЖЕН: `create or replace` не умеет добавлять
-- колонки в `returns table` («cannot change return type of existing
-- function»). Это безопасно ровно потому, что drop и create идут одной
-- транзакцией миграции, а вызывают функцию ПО ИМЕНАМ аргументов
-- (p_limit, p_password) — то есть выкаченный фронтенд просто получит три
-- новые колонки и не заметит их. Тот случай, когда drop не повторяет историю
-- легаси-шима `pick_random_cards`: там функцию убирали НАСОВСЕМ.
drop function if exists public.forecast_upcoming(integer, text);

create function public.forecast_upcoming(
  p_limit integer default 20, p_password text default null)
returns table (
  fixture_id  text,
  commence_at timestamptz,
  home_team   text,
  away_team   text,
  llm_pick    text,
  llm_conf    numeric,
  fly_pick    text,
  fly_conf    numeric,
  own_pick    text,
  own_conf    numeric,
  exp_total   numeric,
  agree       integer,
  llm_cal     numeric,
  fly_cal     numeric,
  own_cal     numeric
)
language plpgsql stable security definer set search_path = public
set statement_timeout to '4s'
as $function$
begin
  if p_password is null or not admin_check_password(p_password) then
    perform require_pro();
  end if;
  return query
    with p as (
      select k.fixture_id, k.commence_at, k.home_team, k.away_team,
             max(case when k.model='llm' then k.pick end) as llm_pick,
             max(case when k.model='llm' then k.confidence end) as llm_conf,
             max(case when k.model='fly' then k.pick end) as fly_pick,
             max(case when k.model='fly' then k.confidence end) as fly_conf,
             max(case when k.model='own' then k.pick end) as own_pick,
             max(case when k.model='own' then k.confidence end) as own_conf,
             max(k.exp_total) as exp_total,
             mode() within group (order by k.pick) as top_pick,
             count(*) filter (where k.pick = (
               select mode() within group (order by k2.pick)
                 from forecast_pick k2 where k2.fixture_id = k.fixture_id))::int as agree
        from forecast_pick k
       where k.commence_at > now()
       group by k.fixture_id, k.commence_at, k.home_team, k.away_team
    )
    select p.fixture_id, p.commence_at, p.home_team, p.away_team,
           p.llm_pick, p.llm_conf, p.fly_pick, p.fly_conf,
           p.own_pick, p.own_conf, p.exp_total, p.agree,
           calibrated_confidence(p.llm_conf, 'llm'),
           calibrated_confidence(p.fly_conf, 'fly'),
           calibrated_confidence(p.own_conf, 'own')
      from p
     order by p.commence_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

revoke all on function public.forecast_upcoming(integer, text) from public;
grant execute on function public.forecast_upcoming(integer, text)
  to anon, authenticated, service_role;
