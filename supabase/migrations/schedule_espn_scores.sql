-- Счёт раз в два часа — тем же планировщиком, что и остальные задания.
--
-- ПОЧЕМУ pg_cron, А НЕ GITHUB ACTION. Ровно те же три довода, что в
-- schedule_fetch_scores.sql: Actions в этом репозитории демонстративно теряет
-- события; три задания этой фичи уже живут в pg_cron; снаружи понадобился бы
-- секрет в ещё одном хранилище. Один планировщик — одно место, куда смотреть.
--
-- ⚠️ КАЖДЫЕ ДВА ЧАСА ЗДЕСЬ БЕСПЛАТНО, И ТОЛЬКО ПОЭТОМУ ВОЗМОЖНО. Функция
-- сперва спрашивает `espn_leagues_in_play()`; ночью тот отвечает пустотой, и
-- наружу не уходит ни одного запроса. Днём уходит по одному на КАЖДУЮ ИГРАЮЩУЮ
-- лигу — замер 05.09.2026 дал 8–11 лиг, то есть десяток бесплатных запросов
-- к ESPN вместо десятка платных кредитов у the-odds-api.
--
-- ⚠️ ЭТО НЕ ЗАМЕНА fetch-match-scores. Тот разбирает ПРОГНОЗЫ и остаётся на
-- своих шести часах: у него другая работа и другая цена. Здесь только счёт в
-- `fixtures`, и он никого не рассчитывает.
--
-- :50, чтобы не совпасть по минуте ни с fetch-match-scores (:05), ни с
-- fetch-fixtures-list (:35), ни с rebuild-card-current-clubs (06:10) — все они
-- делят один инстанс pg_cron.

create or replace function public.fetch_espn_scores()
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
  -- Ночью не ходим вовсе: пустое окно — это не отказ, это отсутствие матчей.
  select count(*) into v_leagues from espn_leagues_in_play();
  if v_leagues = 0 then
    return null;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'fixtures_invoke_key';

  -- Предупреждение, а не тишина: без ключа задание «отрабатывало» бы каждые
  -- два часа вхолостую, и на экране это выглядело бы как «счёт не приходит».
  if v_key is null then
    raise warning 'fetch_espn_scores: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-scores-espn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.fetch_espn_scores() from public, anon, authenticated;
grant execute on function public.fetch_espn_scores() to service_role;

select cron.schedule(
  'fetch-espn-scores',
  '50 */2 * * *',
  $$select public.fetch_espn_scores()$$
);

-- Ответ прошлого вызова:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- Снять с расписания:
--   select cron.unschedule('fetch-espn-scores');
