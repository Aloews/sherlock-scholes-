-- ============================================================================
-- СВЕРКА ПРОГНОЗОВ С ИСХОДАМИ — ОДНИМ ЗАПРОСОМ В БАЗЕ, А НЕ ПО СТРОКЕ ИЗ ПИТОНА.
--
-- ⚠️ ШАГ `grade` ПАДАЛ С 403, И ЭТО НЕ МЕЛОЧЬ: без него история прогнозов не
-- заполняется вовсе, а дофамин мухе не приходит — то есть «прогнозисты
-- учатся» перестаёт быть правдой, а выглядит всё по-прежнему. Питон читал
-- `fixtures` напрямую, а у `service_role` нет SELECT на эту таблицу:
--
--     42501 permission denied for table fixtures
--
-- ⚠️ ПОЧИНКА НЕ ГРАНТОМ, И ЭТО ОСОЗНАННО. Выдать `service_role` доступ к
-- `fixtures` — расширить права ради одного шага. Приложение и так читает
-- расписание только через функции с `security definer`; сверка становится ещё
-- одной такой функцией, и права остаются как были.
--
-- ⚠️ ЗАОДНО ЭТО ОДИН ЗАПРОС ВМЕСТО СОТЕН. Прежний шаг тянул все несверенные
-- прогнозы, потом пачками спрашивал `fixtures`, потом писал обратно.
--
-- ⚠️ СВЕРЯЮТСЯ ТОЛЬКО ЗАВЕРШЁННЫЕ МАТЧИ СО СЧЁТОМ, И ЭТО ВАЖНЕЕ, ЧЕМ КАЖЕТСЯ.
-- Счёт появляется в `fixtures` ЕЩЁ ДО КОНЦА МАТЧА: замер 15.09.2026 поймал
-- «Баия» — «Ремо» со счётом 1:0 через 23 минуты после начала, при
-- `completed = false`. Сверить такой прогноз значило бы записать исход по
-- первому голу. Поэтому условие — `completed`, а не «счёт появился»:
-- 645 матчей из 646 со счётом уже завершены, и флаг надёжен.
-- ============================================================================

create or replace function grade_forecast_picks()
returns table (graded integer, matches integer)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_graded  integer := 0;
  v_matches integer := 0;
begin
  with done as (
    select f.id, f.home_score, f.away_score,
           case when f.home_score > f.away_score then 'H'
                when f.home_score < f.away_score then 'A'
                else 'D' end as actual
      from fixtures f
     where f.completed
       and f.home_score is not null
       and f.away_score is not null
  ), upd as (
    update forecast_pick p
       set actual       = d.actual,
           actual_total = d.home_score + d.away_score,
           correct      = (p.pick = d.actual),
           graded_at    = now()
      from done d
     where p.fixture_id = d.id
       and p.correct is null
    returning p.fixture_id
  )
  select count(*)::int, count(distinct fixture_id)::int
    into v_graded, v_matches
    from upd;

  return query select v_graded, v_matches;
end;
$$;

revoke execute on function grade_forecast_picks() from public;
grant execute on function grade_forecast_picks() to service_role;
