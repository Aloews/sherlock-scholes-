-- ============================================================================
-- Забирать счета по расписанию — из Postgres, а не снаружи.
--
-- ПОЧЕМУ SUPABASE, А НЕ GITHUB ACTION. Три довода, и первый решающий:
--
--   1. У этого проекта Actions ДЕМОНСТРАТИВНО теряет события — это записано в
--      docs/MAP.md §8 и происходило в этой же сессии: пуш остался вообще без
--      проверок. Планировщик, который иногда не срабатывает и молчит об этом,
--      для денег и расчётов не годится.
--   2. Три из четырёх заданий этой фичи уже живут в pg_cron (пересборка
--      составов, начисление прогнозов, подметание комнат). Один планировщик —
--      одно место, куда смотреть, когда что-то не сработало.
--   3. Снаружи нужен секрет в ещё одном хранилище. Здесь ключ уже лежит в
--      Vault, рядом с telegram_bot_token, и репозитория не касается.
--
-- pg_net не был установлен — это и был единственный довод за Action. Он есть
-- в списке доступных (0.20.3), поставлен, и вызов проверен целиком: pg_cron →
-- fetch_match_scores → net.http_post → Edge Function → 200.
--
-- РАЗ В ШЕСТЬ ЧАСОВ, И ЭТО ПРО ДЕНЬГИ. Каждый прогон тратит по кредиту на
-- турнир, у которого есть незакрытый прогноз на завершившийся матч. Провайдер
-- обычно финализирует счёт за пару часов, так что турнир платится один-два
-- раза за игровой день. Чаще — значит платить за то же самое несколько раз;
-- реже — значит держать людей без очков до завтра.
--
-- Худший случай ограничен не расписанием, а потолком: spend_odds_credits
-- резервирует ДО вызова, поэтому кончившийся бюджет останавливает работу, а не
-- перерасходует. Это и позволяет держать шаг умеренно частым.
--
-- ⚠️ СЕКРЕТ В РЕПОЗИТОРИЙ НЕ ПОПАДАЕТ. Перед этой миграцией один раз:
--
--     select vault.create_secret('<publishable key>', 'fixtures_invoke_key',
--            'Publishable key used by pg_cron to invoke football-fixtures');
--
-- Ключ публикуемый — тот же, что едет в браузерный бандл, прав он не даёт,
-- только проходит verify_jwt. Но и такому месту не в git.
--
-- ВТОРОЕ ЗАДАНИЕ, РАЗ В СУТКИ: история матчей, а не только прогнозы —
-- см. recent_scores.sql. Раздельные задания, а не общее правило внутри
-- fetch_match_scores(), потому что у них разная цена частоты: прогнозный путь
-- почти всегда бесплатен (спрашивает 0–1 турнир), а путь истории трогает
-- потенциально дюжину турниров разом — на его частоте и держится бюджет.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.fetch_match_scores(p_include_recent boolean default false)
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
  -- вхолостую каждые шесть часов, и это ровно тот отказ, который выглядит как
  -- «просто нет матчей».
  if v_key is null then
    raise warning 'fetch_match_scores: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-fixtures',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('action', 'scores', 'include_recent', p_include_recent),
    timeout_milliseconds := 25000
  ) into v_id;

  return v_id;
end;
$$;

-- Только service_role: функция тратит деньги, и вызывать её из клиента нельзя
-- даже без вреда для данных.
revoke all on function public.fetch_match_scores(boolean) from public, anon, authenticated;
grant execute on function public.fetch_match_scores(boolean) to service_role;

select cron.schedule(
  'fetch-match-scores',
  '5 */6 * * *',
  $$select public.fetch_match_scores()$$
);

-- Раз в сутки, не каждые шесть часов — та же причина, по которой
-- recent_scores.sql не расширяет sports_awaiting_scores(): дюжина турниров
-- четыре раза в день — это тот же порядок счёта, которым заголовок
-- functions/football-fixtures/index.ts уже отверг «спрашивать все двадцать
-- ежедневно» (600 кредитов против потолка в 500). Раз в сутки держит расход
-- в разы дешевле бюджета даже в максимально насыщенный игровой день.
select cron.schedule(
  'fetch-recent-scores',
  '20 5 * * *',
  $$select public.fetch_match_scores(true)$$
);

-- Ответ прошлого вызова:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- Снять с расписания:
--   select cron.unschedule('fetch-match-scores');
--   select cron.unschedule('fetch-recent-scores');
