-- ============================================================================
-- Наполнять дайджест по расписанию.
--
-- Тот же механизм, что и у счетов (schedule_fetch_scores.sql), и по тем же
-- причинам: pg_cron уже держит четыре задания этого проекта, а GitHub Actions
-- здесь демонстративно теряет события (docs/MAP.md §8). Планировщик, который
-- иногда молча не срабатывает, для ленты новостей означает вчерашние новости.
--
-- РАЗ В ЧАС, и это не про деньги — здесь их нет. Ленты бесплатны, и стоимость
-- прогона — полтора десятка HTTP-запросов. Час выбран по содержанию: экран
-- показывает сутки, читатель заходит несколько раз в день, а новость, которой
-- меньше часа, всё равно ещё не набрала громкость — её пишет одно издание.
-- Чаще значило бы платить трафиком за строки, которые встанут в тот же
-- порядок.
--
-- Ключ тот же, что у fetch_match_scores: публикуемый, лежит в Vault под именем
-- fixtures_invoke_key, в репозиторий не попадает. Отдельный секрет заводить не
-- за чем — обе функции вызываются одинаково и правами не различаются.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.fetch_football_digest()
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
  -- вхолостую каждый час, и выглядеть это будет как «сегодня нет новостей».
  if v_key is null then
    raise warning 'fetch_football_digest: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/football-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    -- Полтора десятка лент параллельно; медленная из них тянет весь прогон,
    -- поэтому запас больше, чем у счетов.
    timeout_milliseconds := 40000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.fetch_football_digest() from public, anon, authenticated;
grant execute on function public.fetch_football_digest() to service_role;

select cron.schedule(
  'fetch-football-digest',
  '20 * * * *',
  $$select public.fetch_football_digest()$$
);

-- Ответ прошлого вызова:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- Снять с расписания:
--   select cron.unschedule('fetch-football-digest');

-- ---------------------------------------------------------------------------
-- Учащение до каждых двадцати минут.
--
-- ЗАЧЕМ. Голы обновлялись редко не потому, что источник медленный, а потому
-- что прогон был раз в час на пять европейских каналов. Летом Европа не
-- играет, и лента вырождалась: за 6 августа — шесть роликов с трёх каналов.
--
-- ЧТО ПРИ ЭТОМ НЕ УЧАЩАЕТСЯ. Atom-фид YouTube закрыт его же robots.txt
-- (`Disallow: /feeds/videos.xml`), поэтому сама функция берёт ролики этим
-- путём по-прежнему раз в час — она смотрит на минуту прогона. Втрое чаще
-- ходят только RSS-ленты изданий, которые это разрешают, а все каналы каждый
-- прогон опрашиваются лишь при заданном YOUTUBE_API_KEY, то есть по
-- официальному API.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'fetch-football-digest',
  '*/20 * * * *',
  $$select public.fetch_football_digest()$$
);
