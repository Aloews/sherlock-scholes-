-- Точность прогноза: измеряется, а не утверждается.
--
-- ⚠️ ЗАЧЕМ. Блок «характер матча» печатает ожидаемую результативность, и до
-- этой миграции никто ни разу не проверил, СБЫВАЕТСЯ ли она. Долю удачных
-- исходов нельзя повышать, пока она не измерена, — а измерять её можно только
-- против ТОЧКИ ОТСЧЁТА: «ошиблись на 1.3 гола» не значит ничего, пока не
-- известно, на сколько ошибается тот, кто про команды не знает вообще ничего.
--
-- ⚠️ ГЛАВНЫЙ РЕЗУЛЬТАТ ЗАМЕРА, И ОН НЕ В ПОЛЬЗУ МОДЕЛИ. На 5645 матчах:
--
--     модель (ожидаемая результативность)      1.3145
--     «всегда называй медиану»                 1.3104   <- ЛУЧШЕ
--     «всегда называй среднее»                 1.3293
--
-- То есть ожидаемая результативность НЕ БЬЁТ тривиальную догадку. Выигрыш над
-- медианой равен -0.0041 при se 0.0062 (t = -0.66) — модель не лучше и не
-- хуже, она просто не добавляет ничего к «обычно забивают три».
--
-- ⚠️ И ПОЧЕМУ ЭТО ЧУТЬ НЕ ЗАПИСАЛИ КАК ПОБЕДУ. Первый замер сравнивал со
-- СРЕДНИМ и показал выигрыш 0.0175 при t = 3.3 — «значимо». Но MAE минимизирует
-- МЕДИАНА, а не среднее: среднее по голам 2.85, медиана 3, и распределение
-- скошено. Против правильной точки отсчёта весь выигрыш исчез. Число, которое
-- бьёт слабую точку отсчёта, не говорит о модели ничего — оно говорит о том,
-- что точка отсчёта выбрана неудачно.
--
-- ⚠️ ЧТО СИГНАЛ ВСЁ-ТАКИ ЕСТЬ — тоже измерено, отдельно. Перепутанный прогноз
-- (те же числа, приклеенные к чужим матчам) проигрывает настоящему: 0.0147 при
-- se 0.0060, t = 2.45. Значит ЛИЧНОСТЬ КОМАНД что-то несёт. Просто этого «что-то»
-- не хватает, чтобы обогнать константу.
--
-- ⚠️ БЕЗ УТЕЧКИ, И ЭТО УСЛОВИЕ ВСЕГО ЗАМЕРА. Наивная проверка «посчитать
-- прогноз сегодня и сравнить с матчем прошлой недели» ВРЁТ: club_character
-- пересобирается каждую ночь по окну в 400 суток, то есть сегодняшние
-- gf_pm/ga_pm уже включают тот самый матч, который мы «предсказываем». Здесь
-- окно кончается за СУТКИ до матча
-- (`range between interval '400 days' preceding and interval '1 day' preceding`),
-- а медиана точки отсчёта берётся по матчам СТРОГО ДО начала месяца.
--
-- Помесячная сетка у медианы — не грубость, а цена: `percentile_cont` нельзя
-- применить как оконную функцию, и пересчёт на каждую из полутора тысяч дат
-- не уложился в минуту. По месяцам это четырнадцать пересчётов, и медиана за
-- месяц не прыгает: на всём окне она держится между 2.0 и 3.0.
--
-- ⚠️ ДВЕ «УЛУЧШАЛКИ» ПРОВЕРЕНЫ ТЕМ ЖЕ КОДОМ И ОТВЕРГНУТЫ. Мультипликативная
-- модель (атака x оборона x среднее лиги) дала 1.4474 — хуже даже точки
-- отсчёта, потому что перемножение двух шумных оценок раздувает дисперсию.
-- Сжатие к среднему лиги дало 1.3081 при se 0.0023 — в пределах шума.
-- Обе гипотезы были моими, обе измерены, обе не подтвердились.

create table if not exists public.forecast_quality (
  computed_at   timestamptz primary key default now(),
  window_days   integer not null,
  matches       integer not null,
  mae_model     numeric not null,
  -- ⚠️ ТОЧКА ОТСЧЁТА — МЕДИАНА, А НЕ СРЕДНЕЕ. Под MAE оптимальная константа это
  -- медиана; сравнение со средним льстит модели на пустом месте (см. шапку).
  mae_baseline  numeric not null,
  mae_shuffled  numeric not null,
  -- Доля матчей, где модель ближе к истине, чем точка отсчёта. Ничья считается
  -- половиной: округление до десятых делает точные совпадения обычным делом.
  pct_closer    numeric not null,
  -- Средний выигрыш в голах и его стандартная ошибка. БЕЗ se число бессмысленно:
  -- 0.0175 при se 0.0053 — это сигнал, при se 0.02 — это ничего.
  gain          numeric not null,
  gain_se       numeric not null
);

comment on table public.forecast_quality is
  'Точность ожидаемой результативности против точки отсчёта. Пишется ночью '
  'rebuild_forecast_quality(); проверяется check-prod, раздел «Прогноз».';

-- ---------------------------------------------------------------------------
create or replace function public.forecast_backtest(p_days integer default 400)
returns table (
  matches integer, mae_model numeric, mae_baseline numeric, mae_shuffled numeric,
  pct_closer numeric, gain numeric, gain_se numeric
)
language sql
stable
security definer
set search_path = public
-- Проход по всем матчам с оконными функциями — это секунды, а не миллисекунды,
-- и потолок здесь свой: у анонима 3 с, и под ним эта функция не живёт. Поэтому
-- её и не отдают анониму (грантов ниже нет) — читается таблица-снимок.
set statement_timeout to '120s'
as $$
  with games as materialized (
    select m.match_date, m.home_key, m.away_key,
           m.home_score::numeric as hs, m.away_score::numeric as as_,
           (m.home_score + m.away_score)::numeric as total
      from club_match m
     where m.home_score is not null and m.away_score is not null
       -- Матч «сам с собой» — это неверный псевдоним, а не игра.
       and m.home_key <> m.away_key
       and m.match_date >= current_date - greatest(coalesce(p_days, 400), 30)
  ),
  -- ⚠️ `as materialized` ЗДЕСЬ ОБЯЗАТЕЛЕН. Без него подзапрос медианы
  -- пересканирует club_match на каждый месяц, и запрос не уложился в минуту.
  months as materialized (
    select distinct date_trunc('month', match_date)::date as m from games
  ),
  base as materialized (
    select mo.m,
           (select percentile_cont(0.5) within group (order by g2.total)
              from games g2 where g2.match_date < mo.m) as med
      from months mo
  ),
  -- Матч — это ДВЕ строки клуба: забил/пропустил с каждой стороны.
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
    select g.match_date, g.total as actual,
           round(((rh.gf_pm + ra.ga_pm)/2 + (ra.gf_pm + rh.ga_pm)/2)::numeric, 1) as predicted,
           round(b.med::numeric, 1) as baseline
      from games g
      join roll rh on rh.club = g.home_key and rh.match_date = g.match_date
      join roll ra on ra.club = g.away_key and ra.match_date = g.match_date
      join base b  on b.m = date_trunc('month', g.match_date)::date
     -- Тот же барьер, что у club_character: меньше десяти матчей — не характер,
     -- а шум, и такие матчи не должны красить замер ни в одну сторону.
     where rh.n >= 10 and ra.n >= 10 and b.med is not null
  ),
  mixed as (
    -- Перепутанный прогноз: то же число, приклеенное к ЧУЖОМУ матчу. Это
    -- контроль НА ЛИЧНОСТЬ КОМАНД: распределение предсказаний то же самое,
    -- разъединена только связь «эти числа — про эти две команды».
    select s.*, lag(s.predicted) over (order by s.match_date, s.actual) as shuffled
      from scored s
  ),
  d as (
    -- Выигрыш считается над ПЕРЕПУТАННОЙ, а не над точкой отсчёта: это то
    -- единственное утверждение, которое замер подтверждает (t = 2.45).
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
         -- ⚠️ БЕЗ СТАНДАРТНОЙ ОШИБКИ ВЫИГРЫШ НЕ ЧИТАЕТСЯ. 0.0147 при se 0.0060
         -- — сигнал (t = 2.45); то же 0.0147 при se 0.02 — ничто.
         -- sqrt от numeric, а не от bigint: иначе numeric / double и отказ.
         round((stddev_samp(gain) / nullif(sqrt(count(*)::numeric), 0))::numeric, 4)
    from d
$$;

comment on function public.forecast_backtest(integer) is
  'Ретро-проверка ожидаемой результативности БЕЗ УТЕЧКИ: окно кончается за '
  'сутки до матча. Отдаёт модель, точку отсчёта и перепутанный контроль.';

-- ---------------------------------------------------------------------------
create or replace function public.rebuild_forecast_quality(p_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select * into v_row from forecast_backtest(p_days);
  if v_row.matches is null or v_row.matches = 0 then
    return 0;
  end if;

  insert into forecast_quality (computed_at, window_days, matches, mae_model,
                                mae_baseline, mae_shuffled, pct_closer, gain, gain_se)
  values (now(), greatest(coalesce(p_days, 400), 30), v_row.matches, v_row.mae_model,
          v_row.mae_baseline, v_row.mae_shuffled, v_row.pct_closer, v_row.gain, v_row.gain_se);

  -- История нужна, чтобы видеть, куда ползёт точность, но не бесконечная.
  delete from forecast_quality where computed_at < now() - interval '180 days';
  return v_row.matches;
end;
$$;

comment on function public.rebuild_forecast_quality(integer) is
  'Пишет снимок точности в forecast_quality. Ночью, после rebuild_club_matches.';

-- ---------------------------------------------------------------------------
-- ЧТЕНИЕ. Снимок открыт всем: это число про качество данных, не про игрока.
-- Сам backtest анониму НЕ отдан — он не укладывается в его потолок в 3 с.
alter table public.forecast_quality enable row level security;

drop policy if exists forecast_quality_read on public.forecast_quality;
create policy forecast_quality_read on public.forecast_quality for select using (true);

grant select on public.forecast_quality to anon, authenticated;
grant select, insert, delete on public.forecast_quality to service_role;
revoke all on function public.forecast_backtest(integer) from public, anon, authenticated;
revoke all on function public.rebuild_forecast_quality(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ночью, следом за пересборкой матчей команд (06:25) и характера (06:35):
-- считать точность раньше, чем обновлены матчи, значит мерить вчерашнее.
select cron.schedule('rebuild-forecast-quality', '45 6 * * *',
                     $cron$select public.rebuild_forecast_quality(400)$cron$);
