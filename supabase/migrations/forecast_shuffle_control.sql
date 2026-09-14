-- ============================================================================
-- ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПРОГНОЗА БЫЛ ПОДДЕЛЬНЫМ: «чужой матч» брался по ФАКТУ.
--
-- `check-prod` держал красной строку «Точность прогноза: личность команд
-- что-то даёт»: выигрыш над перепутанным 0.0121 гола при se 0.0062, t = 1.95.
-- Выглядело это как замер о футболе — мол, кто играет, почти неважно. На деле
-- это был сбой в самом контроле.
--
-- КАК БЫЛО. `forecast_backtest` делал «перепутанный» прогноз так:
--
--     lag(predicted) over (order by match_date, actual)
--
-- ⚠️ В ПОРЯДКЕ СОРТИРОВКИ СТОИТ `actual` — ТО, ЧТО МЫ ПРЕДСКАЗЫВАЕМ. Соседями
-- в таком порядке оказываются матчи с ПОЧТИ ТЕМ ЖЕ СЧЁТОМ, и прогноз
-- «перекидывался» на матч, у которого ответ тот же самый. Замерено на тех же
-- 5623 матчах:
--
--     порядок                  средний разрыв по счёту   тот же счёт
--     order by (дата, ФАКТ)              0.38 гола          79.8 %
--     хеш от даты и клубов               1.93 гола          16.7 %
--
-- То есть в четырёх случаях из пяти «чужой матч» заканчивался ровно тем же
-- числом голов. Проигрывать такому контролю нечем — он не чужой.
--
-- КАК СТАЛО. Перестановка берётся по хешу от даты и двух клубов: чужой матч
-- выбирается независимо от ответа, но одинаково при каждом прогоне — ночное
-- число не должно гулять от запуска к запуску, поэтому `random()` не годится.
--
-- ЧТО ЭТО ДАЛО НА ТЕХ ЖЕ ДАННЫХ (модель не менялась ни на строку):
--
--     контроль                 выигрыш   se       t
--     по факту (как было)       0.0123   0.0062   1.98
--     честная перестановка      0.0430   0.0063   6.85
--
-- Личность команд несёт сигнал, и несла всегда; мерил его сломанный контроль.
--
-- ⚠️ И ЭТО НЕ ПОДГОНКА ПОД ЗЕЛЁНЫЙ. Сама модель и её ошибка не тронуты:
-- mae_model как был 1.3150, так и остался, и медиану он по-прежнему НЕ бьёт
-- (1.3109) — строка «не хуже тривиальной догадки» осталась ровно там же.
-- Изменился только тот, с кем модель сравнивают.
--
-- ⚠️ ЧТОБЫ ЭТО НЕ ВЕРНУЛОСЬ ТИХО, замер теперь отдаёт `donor_gap` — средний
-- разрыв по счёту между матчем и тем, у кого забрали прогноз. У сломанного
-- контроля он 0.38, у честного 1.93; `check-prod` требует >= 1.0. Вернуть
-- сортировку по факту, не уронив проверку, теперь нельзя.
-- ============================================================================

alter table forecast_quality add column if not exists donor_gap numeric;

-- ⚠️ МЕНЯЕТСЯ СОСТАВ ВОЗВРАЩАЕМЫХ КОЛОНОК, поэтому `create or replace` не
-- пройдёт: PostgreSQL не разрешает менять тип возврата на месте.
drop function if exists forecast_backtest(integer);

create function forecast_backtest(p_days integer default 400)
returns table (matches integer, mae_model numeric, mae_baseline numeric,
               mae_shuffled numeric, pct_closer numeric, gain numeric,
               gain_se numeric, donor_gap numeric)
language sql stable security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
  with games as materialized (
    select m.match_date, m.home_key, m.away_key,
           m.home_score::numeric as hs, m.away_score::numeric as as_,
           (m.home_score + m.away_score)::numeric as total
      from club_match m
     where m.home_score is not null and m.away_score is not null
       and m.home_key <> m.away_key
       and m.match_date >= current_date - greatest(coalesce(p_days, 400), 30)
  ),
  months as materialized (
    select distinct date_trunc('month', match_date)::date as m from games
  ),
  base as materialized (
    select mo.m,
           (select percentile_cont(0.5) within group (order by g2.total)
              from games g2 where g2.match_date < mo.m) as med
      from months mo
  ),
  sides as (
    select match_date, home_key as club, hs as gf, as_ as ga from games
    union all
    select match_date, away_key,         as_,      hs       from games
  ),
  roll as (
    select club, match_date,
           avg(gf) over w as gf_pm,
           avg(ga) over w as ga_pm,
           count(*) over w as n
      from sides
    window w as (partition by club order by match_date
                 range between interval '400 days' preceding
                           and interval '1 day' preceding)
  ),
  scored as (
    select g.match_date, g.home_key, g.away_key, g.total as actual,
           round(((rh.gf_pm + ra.ga_pm)/2 + (ra.gf_pm + rh.ga_pm)/2)::numeric, 1) as predicted,
           round(b.med::numeric, 1) as baseline
      from games g
      join roll rh on rh.club = g.home_key and rh.match_date = g.match_date
      join roll ra on ra.club = g.away_key and ra.match_date = g.match_date
      join base b  on b.m = date_trunc('month', g.match_date)::date
     where rh.n >= 10 and ra.n >= 10 and b.med is not null
  ),
  -- ⚠️ ПОРЯДОК ПЕРЕСТАНОВКИ НЕ ЗНАЕТ ОТВЕТА. Хеш берётся от даты и двух
  -- клубов — ни `actual`, ни `predicted` в него не входят. Раньше здесь
  -- стояло `order by match_date, actual`, и «чужой» матч в 79.8 % случаев
  -- заканчивался тем же счётом.
  mixed as (
    select s.*,
           lag(s.predicted) over (order by md5(s.match_date::text || '|' ||
                                               s.home_key || '|' || s.away_key)) as shuffled,
           lag(s.actual)    over (order by md5(s.match_date::text || '|' ||
                                               s.home_key || '|' || s.away_key)) as donor_actual
      from scored s
  ),
  d as (
    select *, abs(shuffled - actual) - abs(predicted - actual) as gain
      from mixed where shuffled is not null
  )
  select count(*)::integer,
         round(avg(abs(predicted - actual))::numeric, 4),
         round(avg(abs(baseline  - actual))::numeric, 4),
         round(avg(abs(shuffled  - actual))::numeric, 4),
         round((100.0 * avg(case when abs(predicted-actual) < abs(baseline-actual) then 1
                                 when abs(predicted-actual) > abs(baseline-actual) then 0
                                 else 0.5 end))::numeric, 2),
         round(avg(gain)::numeric, 4),
         round((stddev_samp(gain) / nullif(sqrt(count(*)::numeric), 0))::numeric, 4),
         -- сколько голов между матчем и донором прогноза: мера того, что
         -- контроль действительно ЧУЖОЙ.
         round(avg(abs(actual - donor_actual))::numeric, 4)
    from d
$$;

-- ⚠️ ПОСЛЕ `drop` ПРАВА СБРАСЫВАЮТСЯ К «МОЖНО ВСЕМ». У прежней функции ACL был
-- `{postgres=X/postgres}` — ходит только ночной `cron.job`, который и так
-- работает от postgres. Возвращаем ровно это, иначе замер открылся бы анониму.
revoke execute on function forecast_backtest(integer) from public;

create or replace function rebuild_forecast_quality(p_days integer default 400)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_row record;
begin
  select * into v_row from forecast_backtest(p_days);
  if v_row.matches is null or v_row.matches = 0 then
    return 0;
  end if;

  insert into forecast_quality (computed_at, window_days, matches, mae_model,
                                mae_baseline, mae_shuffled, pct_closer, gain,
                                gain_se, donor_gap)
  values (now(), greatest(coalesce(p_days, 400), 30), v_row.matches, v_row.mae_model,
          v_row.mae_baseline, v_row.mae_shuffled, v_row.pct_closer, v_row.gain,
          v_row.gain_se, v_row.donor_gap);

  delete from forecast_quality where computed_at < now() - interval '180 days';
  return v_row.matches;
end;
$$;

select rebuild_forecast_quality(400);
