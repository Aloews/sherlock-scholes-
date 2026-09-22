-- Матчи сборных по расписанию: календарь дважды в сутки, счёт — каждые пять
-- минут, но только когда есть что спрашивать.
--
-- ПОЧЕМУ pg_cron, А НЕ GITHUB ACTION. Те же три довода, что в
-- schedule_espn_scores.sql: Actions в этом репозитории демонстративно теряет
-- события; соседние задания этой фичи уже живут в pg_cron; снаружи
-- понадобился бы секрет в ещё одном хранилище.
--
-- ⚠️ ДВА ЗАДАНИЯ, А НЕ ОДНО, И ЭТО ВОПРОС ЦЕНЫ. Полный обход — 13 турниров
-- на три месяца, 39 запросов к ESPN (замер 22.09.2026, 12 секунд). Звать его
-- каждые пять минут значило бы 11 232 запроса в сутки к чужому бесплатному
-- адресу. Ровно за такую цену — 2304 запроса в сутки — из этого проекта уже
-- выброшен раздел «идёт сейчас».
--
-- Поэтому счёт спрашивает РЕЖИМ `scores`: только турниры с матчем в окне и
-- только месяцы этого окна. Ночью окно пустое, и наружу не уходит ни одного
-- запроса — как у fetch_espn_scores, по той же причине и тем же способом.

-- ---------------------------------------------------------------------------
-- 1. У каких турниров сборных прямо сейчас идёт матч.
--
-- ⚠️ ЭТО НЕ КОПИЯ `espn_leagues_in_play`, А ЕГО ПАРА. Тот ходит в
-- `espn_league_slug` — реестр КЛУБНЫХ лиг, и счёт по нему пишет
-- `apply_espn_scores`, сводящий команды ПО ИМЕНАМ через словарь клубных
-- псевдонимов. «Burkina Faso» в том словаре не найдётся никогда. У сборных
-- сопоставление идёт по идентификатору события ESPN, и путь записи другой —
-- `apply_espn_fixtures`. Разные реестры и разные записывающие функции; общим
-- у них остаётся только окно.
--
-- Окно — те же четыре часа назад и четверть часа вперёд: матч с добавленным
-- и серией пенальти укладывается в них с запасом.
-- ---------------------------------------------------------------------------
create or replace function public.national_leagues_in_play()
returns table(espn_slug text, sport_key text, matches integer)
language sql stable security definer set search_path = public as $$
  select n.espn_slug, f.sport_key, count(*)::integer
    from public.fixtures f
    join public.espn_national_league n on n.sport_key = f.sport_key
   where n.active
     and not f.completed
     and f.commence_at between now() - interval '4 hours'
                           and now() + interval '15 minutes'
   group by n.espn_slug, f.sport_key;
$$;

revoke all on function public.national_leagues_in_play() from public, anon, authenticated;
grant execute on function public.national_leagues_in_play() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Вызов функции.
--
-- ⚠️ В РЕЖИМЕ `scores` ПУСТОЕ ОКНО ОСТАНАВЛИВАЕТ НАС ЗДЕСЬ, а не внутри
-- функции. Дешевле не поднимать Edge-функцию вовсе: 288 заходов в сутки
-- против 288 запусков контейнера ради ответа «матчей нет».
-- ---------------------------------------------------------------------------
create or replace function public.fetch_national_fixtures(p_mode text default 'calendar')
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_id  bigint;
  v_leagues integer;
begin
  if p_mode not in ('calendar', 'scores') then
    raise exception 'fetch_national_fixtures: неизвестный режим %', p_mode;
  end if;

  if p_mode = 'scores' then
    select count(*) into v_leagues from public.national_leagues_in_play();
    if v_leagues = 0 then
      return null;
    end if;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'fixtures_invoke_key';

  -- Предупреждение, а не тишина: без ключа задание «отрабатывало» бы каждый
  -- раз вхолостую, и на экране это выглядело бы как «матчей сборных нет».
  if v_key is null then
    raise warning 'fetch_national_fixtures: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-national',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 150000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.fetch_national_fixtures(text) from public, anon, authenticated;
grant execute on function public.fetch_national_fixtures(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Расписание.
--
-- 01:25 и 13:25 — минуты, свободные от остальных заданий этого инстанса
-- (:05 fetch-match-scores, :10 fetch-fixture-odds, :20 settle-match-predictions,
-- :35 fetch-fixtures-list, 3-58/5 fetch-espn-scores). Дважды в сутки хватает:
-- расписание сборных меняется турами, а не часами.
--
-- Счёт — тем же шагом в пять минут, что и у клубов, со сдвигом на две минуты,
-- чтобы два задания не будили один инстанс в одну секунду.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'fetch-national-fixtures',
  '25 1,13 * * *',
  $$select public.fetch_national_fixtures('calendar')$$
);

select cron.schedule(
  'fetch-national-scores',
  '1-56/5 * * * *',
  $$select public.fetch_national_fixtures('scores')$$
);

-- Ответ прошлого вызова:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- Что есть в календаре:
--   select * from public.national_fixtures_health();
-- Снять с расписания:
--   select cron.unschedule('fetch-national-fixtures');
--   select cron.unschedule('fetch-national-scores');
