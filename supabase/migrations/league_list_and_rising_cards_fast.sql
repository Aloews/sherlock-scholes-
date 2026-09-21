-- Ещё две функции у анонимного потолка: список лиг и «набирают ход»
-- ============================================================================
--
-- ⚠️ НАЙДЕНЫ НЕ ПО ПАДЕНИЮ, А ОБХОДОМ. `check-prod` их не ловил: они
-- отвечали 200. Обход всех RPC фронтенда с замером времени
-- (`anonRpcTiming()` в check-limits) показал, сколько это «200» стоит:
--
--     rising_cards   2936 мс      league_list   2218 мс
--
-- При потолке anon в 3000 мс это не «медленно», это очередь на отказ. Разбор
-- самого приёма и почему он в замере, а не в проверке, — в шапке
-- club_squad_fame.sql.
--
-- ── 1) `rising_cards`: статистика таблицы, а НЕ индекс ─────────────────────
--
-- ЗАМЕР ДО:
--
--     Buffers: shared hit=11745, temp read=238 written=793
--     Execution Time: 1691.473 ms
--
-- ⚠️ ЗДЕСЬ Я СНАЧАЛА ПОСТАВИЛ НЕВЕРНЫЙ ДИАГНОЗ, И ЭТО ВАЖНЕЕ САМОЙ ПРАВКИ.
-- Рассуждение выглядело безупречно: функция дважды делает
-- `distinct on (card_id, metric) … order by card_id, metric, taken_on desc`
-- по 142 110 строкам; ни один индекс не даёт такой порядок (в первичном
-- `taken_on` ВОЗРАСТАЕТ, а нужен убывающий при возрастающих первых двух),
-- значит нужен индекс со смешанным направлением. Я его завёл, замерил —
-- 1691 → 314 мс — и записал в коммит «вылечено индексом с нужным
-- направлением».
--
-- ⚠️ ЭТО БЫЛО НЕПРАВДОЙ, И ПРОВЕРИЛ Я ЭТО ТОЛЬКО ПОТОМУ, ЧТО СОВЕТНИК
-- SUPABASE НАЗВАЛ СОСЕДНИЙ ИНДЕКС НЕИСПОЛЬЗОВАННЫМ. Снял индекс совсем и
-- перемерил:
--
--     с индексом      314 мс, 286 мс
--     БЕЗ индекса     138 мс, 224 мс
--     буферы и выход на диск во всех случаях ОДИНАКОВЫ (temp 238/793)
--
-- То есть ускорения индекс не дал вовсе. Дал его `analyze`, который я
-- выполнил той же командой: статистика по `card_metric_history` протухла,
-- планировщик оценивал строки мимо и выбирал худший план. План с индексом
-- показывает это прямо — в `latest` по-прежнему используется старый
-- `card_metric_history_metric_idx`, а мой не берётся никогда.
--
-- Индекс удалён. Осталась причина: таблица растёт ночными вставками, и её
-- статистика должна обновляться. Автовакуум за пачечными вставками не
-- успевает — ровно как с `player_match_stats` в player_stats_freshness_fast.sql.
--
-- ⚠️ ВЫХОД СОРТИРОВКИ НА ДИСК ОСТАЛСЯ (temp read=238 written=793, external
-- merge Disk: 6080kB). Он не лечится индексом — по крайней мере тем, каким
-- я пробовал, включая покрывающий с `include (value)`: планировщик всё
-- равно идёт через метрику. При запасе в десять раз до потолка копать
-- дальше не за чем, но место известно и записано.

analyze public.card_metric_history;

-- ── 2) `league_list`: функция, вызванная 64 тысячи раз вместо тридцати ─────
--
-- ЗАМЕР ДО:
--
--     Buffers: shared hit=1887
--     Execution Time: 1592.047 ms
--
-- ⚠️ 1887 БУФЕРОВ И ПОЛТОРЫ СЕКУНДЫ — ЭТО НЕ ЧТЕНИЕ, ЭТО СЧЁТ. Диагноз виден
-- по несоответствию: данных прочитано с гулькин нос, а время огромное.
-- В `where` стояли `tournament_scope(m.tournament)` (дважды) и
-- `is_national_tournament(m.tournament)`, и обе звались НА КАЖДУЮ СТРОКУ
-- `club_match` — а строк 32 285, да ещё удвоенных `cross join lateral
-- unnest`. Плюс регулярное выражение по той же колонке на каждую строку.
--
-- Все три зависят ТОЛЬКО от названия турнира, а турниров в `league_season`
-- по одному на строку (первичный ключ). Значит их можно посчитать один раз
-- на турнир и присоединить.
--
-- ⚠️ ОТБОР НЕ ИЗМЕНИЛСЯ: `s.tournament = m.tournament` по условию соединения,
-- поэтому фильтр по `s.tournament` в подзапросе отбирает ровно те же
-- турниры, что фильтр по `m.tournament` отбирал строки.
--
-- ЗАМЕР ПОСЛЕ: 1592.047 мс → 88.282 мс, буферы 1887 → 1889 (не изменились —
-- подтверждение, что дело было не в чтении).
--
-- СВЕРКА: md5 ответа вместе с порядком строк, `league_list('ru', 30)`:
--
--     964b8ae271d7f830b65e4209246ee86d   до
--     964b8ae271d7f830b65e4209246ee86d   после   ✓ 30 строк

create or replace function public.league_list(p_lang text default 'ru', p_limit integer default 30)
returns table (
  tournament   text,
  country      text,
  teams        integer,
  matches      integer,
  season_start date
)
language sql stable security definer set search_path = public as $$
  -- Турниры и всё, что зависит только от их названия, — один раз.
  with t as (
    select s.tournament, s.season_start, tournament_scope(s.tournament) as scope
      from league_season s
     where not is_national_tournament(s.tournament)
       and s.tournament !~* 'кубок|суперкубок|товарищеск'
       and tournament_scope(s.tournament) is not null
  )
  select m.tournament, t.scope,
         count(distinct x.k)::int,
         count(distinct (m.match_date, m.home_key, m.away_key))::int,
         t.season_start
    from club_match m
    join t on t.tournament = m.tournament
    cross join lateral (select unnest(array[m.home_key, m.away_key]) as k) x
   where m.match_date >= t.season_start
     and m.home_score is not null
   group by m.tournament, t.scope, t.season_start
  -- Меньше шести команд — это не лига, а несколько матчей под общим названием.
  having count(distinct x.k) >= 6
   order by count(distinct (m.match_date, m.home_key, m.away_key)) desc
   limit greatest(coalesce(p_limit, 30), 1)
$$;

revoke all on function public.league_list(text, integer) from public;
grant execute on function public.league_list(text, integer) to anon, authenticated, service_role;
