-- Справочник клубов: считать дорогое ПОСЛЕ limit, а не до него
-- ============================================================================
--
-- ⚠️ ВТОРАЯ ФУНКЦИЯ, НЕ УКЛАДЫВАВШАЯСЯ В АНОНИМНЫЕ ТРИ СЕКУНДЫ. Первая —
-- `fixture_squad_strength` (club_squad_fame.sql). Эта попалась следом, и
-- попалась ИМЕННО ТАК, КАК И ОПИСАНО ТАМ: в прогоне выкладки №5 она была
-- зелёной, а через двадцать минут на том же боевом адресе дала
--
--     ✗ Эмблемы клубов    57014 canceling statement due to statement timeout
--
-- ⚠️ ЭТУ ЗОВЁТ ЭКРАН. Не легаси-шим: справочник клубов открывают из игры, и
-- «иногда не грузится» у владельца — это вот оно.
--
-- ЗАМЕР ДО:
--
--     Function Scan on club_directory  (actual rows=60 loops=1)
--       Buffers: shared hit=82210
--     Execution Time: 2249.811 ms
--
-- 82210 буферов ради шестидесяти строк. Причина видна в теле: два `left join
-- lateral` считались для КАЖДОГО клуба (их 3491) ещё ДО `limit 60`, и
-- `club_display_name` звался тоже 3491 раз вместо шестидесяти.
--
-- 2249 мс — это «прошло» на спокойной базе. Потолок anon — 3000 мс, а
-- инстанс на бесплатном тарифе режет процессор под нагрузкой (замерено в этом
-- проекте: один и тот же план, одни и те же буферы — 179 мс против 6297 мс).
-- То есть функция жила в полушаге от отказа и падала через раз.
--
-- ── ЧТО ИЗМЕНЕНО ───────────────────────────────────────────────────────────
--
-- 1. Счёт матчей (`club_match` за 400 дней) НЕ участвует в сортировке — он
--    только в ответе. Значит его можно посчитать после `limit`, для шестидесяти
--    строк вместо трёх с половиной тысяч.
-- 2. Счёт состава в сортировке участвует (третий ключ), поэтому остаётся до
--    `limit` — но из `lateral` на клуб превращается в один group by по
--    25 096 строкам.
-- 3. `club_display_name` зовётся после `limit`: шестьдесят раз вместо 3491.
--
-- ⚠️ ПОРЯДОК СТРОК СОХРАНЁН ДОСЛОВНО. Ключи сортировки (`стоимость, elo,
-- состав, имя`) вынесены сквозь подзапрос и применены второй раз после
-- `limit` — иначе `limit` отдал бы правильные шестьдесят клубов в
-- произвольном порядке. `elo` и `f.name` тянутся наверх только ради этого: в
-- ответе их нет и не было.
--
-- ЗАМЕР ПОСЛЕ и сверка ответа — в конце файла.

create or replace function public.club_directory(
  p_lang  text default 'ru',
  p_query text default null,
  p_limit int  default 60,
  p_kind  text default 'club'
)
returns table (
  club_key     text,
  name         text,
  country      text,
  league       text,
  crest_url    text,
  squad        integer,
  matches      integer,
  level        integer,
  squad_value  bigint
)
language sql stable security definer set search_path = public as $$
  -- ⚠️ ПОРЯДОК — ПО СТОИМОСТИ СОСТАВА. Владелец: «давай пока сделаем основным
  -- рейтингом всего для всех экранов именно стоимость. А с набором данных
  -- сможем понять и проверим, какой лучше показатель отображает силу игрока».
  --
  -- Прежде сортировал elo. Он остаётся вторым ключом — там, где стоимость
  -- неизвестна (у клуба нет ни одной оценённой карточки), порядок всё равно
  -- нужен, и сыгранные матчи знают о команде больше, чем ничего.
  --
  -- ⚠️ elo НЕ ВЫБРОШЕН И level ПО-ПРЕЖНЕМУ ОТДАЁТСЯ: владелец хочет позже
  -- сравнить, какой показатель вернее. Выбросить сейчас — значит нечего будет
  -- сравнивать.
  with val as (
    select cc.club_key, sum(c.market_value_eur)::bigint as v
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  ),
  sq as (
    -- Был `left join lateral … on true` — то есть отдельный поиск на каждый из
    -- 3491 клуба. Стал один проход по 25 096 строкам состава.
    select s.club_key, count(*)::int as n
      from club_squad s
     where s.left_at is null
     group by s.club_key
  ),
  top as (
    select f.club_key, f.name as raw_name, f.country, f.league, f.crest_url,
           coalesce(sq.n, 0)::int as squad,
           r.level::int as level, v.v as squad_value,
           r.elo as ord_elo
      from football_club f
      left join sq on sq.club_key = f.club_key
      left join club_rating r on r.club_key = f.club_key
      left join val v on v.club_key = f.club_key
     where f.kind = case when coalesce(p_kind, 'club') = 'national' then 'national' else 'club' end
       and (p_query is null or btrim(p_query) = ''
         or f.name ilike '%' || btrim(p_query) || '%'
         or f.name_en ilike '%' || btrim(p_query) || '%'
         or f.club_key like club_norm_key(btrim(p_query)) || '%'
         or exists (select 1 from club_alias a
                     where a.club_key = f.club_key
                       and a.alias_key like club_norm_key(btrim(p_query)) || '%'))
     order by v.v desc nulls last,
              r.elo desc nulls last,
              coalesce(sq.n, 0) desc,
              f.name
     limit greatest(coalesce(p_limit, 60), 1)
  )
  select t.club_key,
         club_display_name(t.club_key, p_lang),
         t.country, t.league, t.crest_url,
         t.squad,
         coalesce(m.n, 0)::int,
         t.level, t.squad_value
    from top t
    -- Счёт матчей — только здесь, по шестидесяти клубам. В сортировке его нет
    -- и не было, поэтому перенос за `limit` ответ не меняет.
    left join lateral (select count(*) n from club_match c
                        where (c.home_key = t.club_key or c.away_key = t.club_key)
                          and c.match_date >= current_date - 400) m on true
   order by t.squad_value desc nulls last,
            t.ord_elo desc nulls last,
            t.squad desc,
            t.raw_name
$$;

revoke all on function public.club_directory(text, text, int, text) from public;
grant execute on function public.club_directory(text, text, int, text)
  to anon, authenticated, service_role;

-- ── ЗАМЕР ПОСЛЕ ────────────────────────────────────────────────────────────
--
--     Function Scan on club_directory  (actual rows=60 loops=1)
--       Buffers: shared hit=10601
--     Execution Time: 84.560 ms
--
--     2249.811 мс → 84.560 мс,  82210 буферов → 10601,  строк 60 → 60
--
-- ── СВЕРКА ОТВЕТА ──────────────────────────────────────────────────────────
--
-- ⚠️ СРАВНИВАЛСЯ НЕ НАБОР СТРОК, А ОТВЕТ ЦЕЛИКОМ ВМЕСТЕ С ПОРЯДКОМ: md5 от
-- строк, склеенных в том порядке, в котором функция их отдаёт. Порядок здесь
-- и есть смысл функции — это витрина «самые дорогие составы сверху», и
-- перестановка была бы поломкой, которую `except` не увидел бы.
--
--   вызов                 md5 до и после
--   ru/null/60/club       396f81152872103fa89adc6b273c2c63   ✓ совпал
--   en/null/60/club       396f81152872103fa89adc6b273c2c63   ✓ совпал
--   ru/null/40/national   efa378ee74855dd137b9c4972fd7fdab   ✓ совпал
--   ru/«зенит»/60/club    a75f885853dc543656080abe619a8103   ✓ совпал  (4 строки)
--   ru/«man»/10/club      3e1ab871539d9bfa39ca8811e2e1e451   ✓ совпал  (10 строк)
--
-- Взяты все четыре развилки тела: язык (влияет на club_display_name), kind
-- (другая ветка where), поиск кириллицей и латиницей (ilike + club_norm_key +
-- club_alias), маленький limit (проверяет, что перенос счёта матчей за limit
-- не сдвинул границу отсечения).
