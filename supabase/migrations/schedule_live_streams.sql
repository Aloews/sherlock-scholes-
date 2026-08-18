-- ============================================================================
-- Опрашивать официальные каналы по расписанию.
--
-- Тот же механизм, что у счетов и дайджеста, и по той же причине: GitHub
-- Actions в этом репозитории демонстративно теряет события (docs/MAP.md §8), а
-- планировщик, который иногда молча не срабатывает, для раздела «идёт сейчас»
-- означает пустой раздел посреди матча.
--
-- РАЗ В ДЕСЯТЬ МИНУТ, и это не про деньги — их здесь нет. Официального API не
-- задействовано (почему — в шапке функции), поэтому прогон стоит девять
-- обращений к публичной странице. Десять минут выбраны по содержанию: окно
-- чтения в `digest_live_matches` — час, то есть эфир успевает подтвердиться
-- шесть раз, прежде чем выпадет из окна. Реже значило бы, что один
-- пропущенный прогон уже заметен читателю; чаще — что мы стучимся к YouTube
-- ради строки, которая не изменится.
--
-- Ключ тот же, что у fetch_match_scores и fetch_football_digest: публикуемый,
-- лежит в Vault под именем fixtures_invoke_key, в репозиторий не попадает.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.fetch_live_streams()
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
  -- вхолостую каждые десять минут, и выглядеть это будет как «сейчас ничего
  -- не идёт» — то есть как правда, потому что чаще всего это и есть правда.
  if v_key is null then
    raise warning 'fetch_live_streams: vault secret fixtures_invoke_key is missing';
    return null;
  end if;

  select net.http_post(
    url := 'https://konoavrduynecxblqfvq.supabase.co/functions/v1/live-streams',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    -- Девять каналов подряд, а не разом: медленный канал двигает весь прогон.
    -- Последовательность выбрана намеренно — см. комментарий в функции.
    timeout_milliseconds := 50000
  ) into v_id;

  return v_id;
end;
$$;

revoke all on function public.fetch_live_streams() from public, anon, authenticated;
grant execute on function public.fetch_live_streams() to service_role;

select cron.schedule(
  'fetch-live-streams',
  '*/10 * * * *',
  $$select public.fetch_live_streams()$$
);

-- Ответ прошлого вызова — здесь же видно, сломался ли разбор страницы:
--   select status_code, content::text from net._http_response order by id desc limit 1;
-- Поле `parsed` отвечает на вопрос «пусто потому что футбола нет или потому
-- что YouTube поменял разметку». Ноль при девяти каналах — второе.
--
-- Снять с расписания:
--   select cron.unschedule('fetch-live-streams');
