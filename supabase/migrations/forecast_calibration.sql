-- Calibrate confidence for the two active forecast models.
-- Calibration is monotonic: it changes confidence values, not selected outcomes.
-- Fit and evaluate chronologically; compare against a constant baseline and do
-- not infer profitability without valid historical odds and settlement.

create table if not exists public.forecast_calibration (
  model        text primary key,
  -- sigmoid(a · logit(p) + b)
  a            numeric     not null,
  b            numeric     not null,
  trained_on   integer     not null,
  tested_on    integer     not null,
  -- ⚠️ ЧИСЛА ОЦЕНКИ, А НЕ ОДНА МЕТКА. В базе лежит не «откалибровано», а НА СКОЛЬКО
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
-- (p_limit, p_password) — то есть выкаченный фронтенд получит актуальный набор колонок и не заметит их. Тот случай, когда drop не повторяет историю
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
  own_pick    text,
  own_conf    numeric,
  exp_total   numeric,
  agree       integer,
  llm_cal     numeric,
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
             max(case when k.model='own' then k.pick end) as own_pick,
             max(case when k.model='own' then k.confidence end) as own_conf,
             max(k.exp_total) as exp_total,
             mode() within group (order by k.pick) as top_pick,
             count(*) filter (where k.pick = (
               select mode() within group (order by k2.pick)
                 from forecast_pick k2 where k2.fixture_id = k.fixture_id
                    and k2.model in ('llm', 'own')))::int as agree
        from forecast_pick k
       where k.commence_at > now()
       group by k.fixture_id, k.commence_at, k.home_team, k.away_team
    )
    select p.fixture_id, p.commence_at, p.home_team, p.away_team,
           p.llm_pick, p.llm_conf,
           p.own_pick, p.own_conf, p.exp_total, p.agree,
           calibrated_confidence(p.llm_conf, 'llm'),
           calibrated_confidence(p.own_conf, 'own')
      from p
     order by p.commence_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$function$;

revoke all on function public.forecast_upcoming(integer, text) from public;
grant execute on function public.forecast_upcoming(integer, text)
  to anon, authenticated, service_role;
