-- ============================================================================
-- Забирать РАСПИСАНИЕ матчей по расписанию — а не только счета по нему.
--
-- ⚠️ ЭТОГО ЗАДАНИЯ НЕ БЫЛО ВООБЩЕ, и это обнаружилось не по догадке, а по
-- прямой проверке: `select * from cron.job` не содержала ни одной строки,
-- зовущей football-fixtures без `{"action":"scores"}`. `schedule_fetch_scores.sql`
-- существует и работает, но settle обслуживает только фикстуры, которые УЖЕ
-- есть в таблице — он их не заводит.
--
-- ПОСЛЕДСТВИЕ ИЗМЕРЕНО, а не предположено: РПЛ была настроена корректно
-- (`SPORT_KEYS` в football-fixtures/index.ts, все девять локалей, `broadcasts`)
-- и провайдер её несёт — `{"list": true}` 23.08.2026 вернул
-- `soccer_russia_premier_league` в списке живых конкурсов. При этом
-- `public.fixtures` держала по ней РОВНО НОЛЬ строк: настройка была верной,
-- а вызывать её было некому. Расписание росло лишь тогда, когда кто-то
-- вручную дёргал функцию в сессии — отсюда и обрывочные даты записи
-- (9 разных дней из 13, а не каждый день).
--
-- ⚠️ ЛОВУШКА, КОТОРАЯ ОБНАРУЖИЛАСЬ ПРИ ПРОВЕРКЕ: `pg_net` c таймаутом 30 с
-- отдал пустой ответ на первом же контрольном вызове, и по логам это выглядит
-- как отказ. Функция при этом ДОРАБОТАЛА на сервере и записала 11 строк РПЛ
-- через минуту после вызова — Edge Function не привязана к тому, дождался ли
-- её вызывающий. Таймаут ниже поэтому не «подстраховка», а измеренная
-- длительность с запасом: полный обход двадцати с лишним конкурсов занял
-- ~64 секунды (10:18:21 → 10:19:25), 150 секунд — это запас х2.
--
-- /events СТОИТ НОЛЬ КРЕДИТОВ (см. шапку football-fixtures/index.ts), поэтому
-- частота здесь не вопрос бюджета, а вопрос свежести. Раз в шесть часов — тот
-- же шаг, что у fetch_match_scores, и по той же причине: расписания турниров
-- объявляют не поминутно, а более частый опрос был бы работой без результата.
-- ============================================================================

create or replace function public.fetch_fixtures_list()
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_id  bigint;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'fixtures_invoke_key';

  -- Предупреждение, а не тишина: без ключа задание будет «отрабатывать»
  -- вхолостую каждые шесть часов, и на экране это будет выглядеть как
  -- «турнир исчез из календаря» — ровно то, что произошло с РПЛ.
  if v_key is null then
    raise warning 'fetch_fixtures_list: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-fixtures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.fetch_fixtures_list() from public, anon, authenticated;
grant execute on function public.fetch_fixtures_list() to service_role;

-- :35, чтобы не совпасть по минуте ни с fetch-match-scores (:05), ни с
-- rebuild-card-current-clubs (06:10), ни с прочими часовыми заданиями этого
-- проекта — все они уже делят один and тот же инстанс pg_cron.
select cron.schedule(
  'fetch-fixtures-list',
  '35 */6 * * *',
  $$select public.fetch_fixtures_list()$$
);

-- Ответ прошлого вызова, включая `failures` по каждому несобравшемуся
-- турниру, если такой был:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- ⚠️ Пустой ответ ЗДЕСЬ НЕ ЗНАЧИТ «сломалось» — таймаут `pg_net` не убивает
-- саму функцию. Если ответа нет, смотреть на `updated_at` в `fixtures`, а не
-- на пустую строку в `net._http_response`.
--
-- Снять с расписания:
--   select cron.unschedule('fetch-fixtures-list');
