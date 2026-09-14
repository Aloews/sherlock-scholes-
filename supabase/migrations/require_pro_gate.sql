-- Ворота подписки на СТОРОНЕ СЕРВЕРА.
--
-- ⚠️ ЗАЧЕМ, если экраны уже спрятаны. Спрятанный маршрут не закрывает данные:
-- мини-приложение живёт на клиенте, и кто откроет devtools — позовёт RPC
-- напрямую. Ворота экрана продают подписку; эти ворота её защищают.
--
-- ⚠️ ПОДПИСЬ ЕДЕТ ЗАГОЛОВКОМ, А НЕ ПАРАМЕТРОМ, И ЭТО РЕШЕНИЕ, А НЕ ЛЕНЬ.
-- Добавить `p_init_data` в двадцать RPC значит сменить сигнатуру каждой
-- (а `create or replace` с новым параметром заводит ВТОРУЮ функцию рядом —
-- этот проект уже ловил «function is not unique»), переписать каждый вызов на
-- фронте и сломать всех, кто зовёт их позиционно. PostgREST отдаёт заголовки
-- запроса в `request.headers` — проверено запросом, а не документацией:
--
--     x-tg-init-data: ПРОБА-123  ->  {"tg_header": "ПРОБА-123", "role": "anon"}
--
-- Заголовок ставится ОДИН раз, в src/shared/lib/supabase.ts.
--
-- ⚠️ СЕРВИСНАЯ РОЛЬ ПРОХОДИТ БЕЗ ПОДПИСИ, и это не дыра: этим ключом ходят бот,
-- ночные задания и проверки, и он никогда не уезжает в браузер. Дырой было бы
-- обратное — заставить бота подделывать подпись игрока.
--
-- ⚠️ ОТКАЗ — ЭТО 42501, А НЕ ПУСТОЙ ОТВЕТ. Пустой список неотличим от «данных
-- нет», и экран нарисовал бы «пока пусто» вместо «нужна подписка».
--
-- Проверено по бою, все три пути:
--     аноним без подписи        401  pro_required
--     аноним с hash=deadbeef    401  pro_required
--     сервисная роль            200  3 строки, первый — Ламин Ямаль

create or replace function public.require_pro()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_init text;
begin
  v_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  if v_role = 'service_role' then
    return;
  end if;

  v_init := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tg-init-data';
  if v_init is null or not public.tg_is_pro(v_init) then
    raise exception 'pro_required'
      using errcode = '42501',
            hint = 'Раздел открывается с подпиской Pro';
  end if;
end;
$$;

comment on function public.require_pro() is
  'Страж подписки. Пропускает service_role и Pro-игрока с подписью в заголовке '
  'x-tg-init-data; иначе 42501 pro_required.';

revoke all on function public.require_pro() from public;
grant execute on function public.require_pro() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ПЕРВЫЙ СРЕЗ: индекс игроков — самый большой массив данных проекта.
--
-- ⚠️ ПЕРЕИМЕНОВАНИЕ + ОБЁРТКА, А НЕ ПРАВКА ТЕЛА. Тело индекса — длинный запрос
-- с барьерами материализации (`as materialized`), ради которых он и
-- укладывается в лимит анонима: 229 708 буферов против 7 006 без них. Вписать
-- сторожа внутрь значит переписать запрос и рискнуть планом. Обёртка оставляет
-- тело нетронутым и добавляет ровно одну строку смысла.
--
-- Исходные тела живут под именем `*_open` и ЗАКРЫТЫ от anon.
--
-- Повторить для следующей функции — механика та же: переименовать, отобрать
-- права, завести обёртку с тем же `returns`. Ещё не закрыты и ждут очереди:
-- club_profile, club_squad_list, club_recent_matches, club_upcoming_fixtures,
-- league_table, league_list, match_character, player_ratings, best_players,
-- rising_cards, rising_clubs, club_news.

-- alter ... rename выполняется один раз; повторный прогон миграции пропускает
-- его, если обёртка уже на месте.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'player_index_open'
  ) then
    execute 'alter function public.player_index(text,text,text,text,text,integer,integer,text,text)
             rename to player_index_open';
    execute 'alter function public.player_index_count(text,text,text,text,text,text)
             rename to player_index_count_open';
  end if;
end $$;

revoke all on function public.player_index_open(text,text,text,text,text,integer,integer,text,text)
  from public, anon, authenticated;
revoke all on function public.player_index_count_open(text,text,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.player_index(
  p_sort text default null, p_league text default null, p_country text default null,
  p_club_key text default null, p_lang text default null, p_limit integer default null,
  p_offset integer default null, p_continent text default null, p_position text default null)
returns TABLE(card_id uuid, name text, name_en text, photo_url text, country text,
              continent text, club_key text, club text, league text, index_score smallint,
              parts smallint, value_part smallint, views_part smallint, stats_part smallint,
              news_part smallint, sort_value numeric, place integer, player_position text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_pro();
  return query select * from public.player_index_open(
    p_sort, p_league, p_country, p_club_key, p_lang, p_limit, p_offset, p_continent, p_position);
end;
$$;

create or replace function public.player_index_count(
  p_sort text default null, p_league text default null, p_country text default null,
  p_club_key text default null, p_continent text default null, p_position text default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_pro();
  return public.player_index_count_open(
    p_sort, p_league, p_country, p_club_key, p_continent, p_position);
end;
$$;

comment on function public.player_index(text,text,text,text,text,integer,integer,text,text) is
  'Индекс игроков ЗА ПОДПИСКОЙ. Тело — player_index_open, закрытое от anon.';

revoke all on function public.player_index(text,text,text,text,text,integer,integer,text,text) from public;
revoke all on function public.player_index_count(text,text,text,text,text,text) from public;
grant execute on function public.player_index(text,text,text,text,text,integer,integer,text,text)
  to anon, authenticated, service_role;
grant execute on function public.player_index_count(text,text,text,text,text,text)
  to anon, authenticated, service_role;
