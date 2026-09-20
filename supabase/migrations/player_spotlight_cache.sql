-- «О ком говорят больше, чем он играет»: считать ночью, а не при открытии
-- ============================================================================
--
-- ⚠️ ЭТА ФУНКЦИЯ НЕ ПАДАЛА — И ИМЕННО ПОЭТОМУ ЕЁ НИКТО НЕ ЧИНИЛ. В её теле
-- стоит `SET statement_timeout TO '30s'`, то есть анонимный потолок в три
-- секунды ей однажды уже мешал, и его обошли, подняв потолок вместо того,
-- чтобы ускорить запрос. Снаружи это выглядит не как отказ, а как экран,
-- который «просто долго думает».
--
-- Замер анонимным ключом по боевому адресу, вместе с сетью:
--
--     4682 мс  player_spotlight    ok  20 строк
--
-- Четыре с половиной секунды ожидания на открытии раздела. План на спокойной
-- базе объясняет, откуда они берутся:
--
--     Function Scan on player_spotlight  (actual rows=20 loops=1)
--       Buffers: shared hit=153378
--     Execution Time: 517.455 ms
--
-- 153 378 буферов — больше, чем у любого другого вызова в этом проекте.
-- Считается за год по 85 тысячам строк статистики, потом четыре
-- `percent_rank()` по всей выборке — и всё это заново на каждое открытие
-- экрана, ради двадцати строк. 517 мс на пустой базе превращаются в 4682 мс,
-- когда инстанс бесплатного тарифа режет процессор (в этом проекте замерено:
-- тот же план, те же буферы — 179 мс против 6297 мс).
--
-- ⚠️ КАК НАЙДЕНО. Не по жалобе и не по красному прогону: обходом ВСЕХ 120
-- RPC, которые зовёт фронтенд, анонимным ключом с замером времени. Две
-- функции до этого чинились по одной, когда падали; обход показал очередь
-- целиком за одну минуту. Скрипт обхода приложен — scripts/check-limits.mjs.
--
-- ── ЧТО СДЕЛАНО ────────────────────────────────────────────────────────────
--
-- Тяжёлое считается ночью и кладётся в таблицу на 2301 строку. Экран читает
-- её. Формула не тронута ни в одном знаке.
--
-- ⚠️ ФОРМУЛА ЖИВЁТ В ОДНОМ МЕСТЕ, А НЕ В ДВУХ. Ночная сборка и запасной путь
-- зовут одну и ту же `player_spotlight_scored(p_days)`. Соблазн скопировать
-- запрос в сборку, оставив в функции прежний, — это два правила под одним
-- именем: они разойдутся на первой же правке, и разойдутся молча.
--
-- ⚠️ ЗАПАСНОЙ ПУТЬ ОСТАЁТСЯ. Кэш построен за 365 дней — так зовёт экран
-- (`src/features/spotlight/spotlightApi.ts` передаёт только p_lang, p_limit,
-- p_mode). Вызов с другим `p_days` считается вживую, как и раньше, со своими
-- тридцатью секундами. Отрезать эту ветку значило бы тихо соврать тому, кто
-- попросит другое окно.

-- ── 1) Ядро: то самое вычисление, вынесенное под собственное имя ───────────

create or replace function public.player_spotlight_scored(p_days integer default 365)
returns table (
  card_id          uuid,
  name             text,
  name_en          text,
  photo_url        text,
  club_key         text,
  league           text,
  age              integer,
  band             text,
  player_position  text,
  attention        numeric,
  output           numeric,
  apps             integer,
  minutes          integer,
  goals            integer,
  assists          integer,
  market_value_eur bigint,
  pageviews        integer,
  peers            integer
)
language sql stable security definer set search_path = public
set statement_timeout to '30s'
as $$
  with played as (
    select s.card_id,
           count(*)::int as apps,
           -- ⚠️ МИНУТЫ — ДОБАВКА, А НЕ ОСНОВА. Из 85 684 строк статистики за
           -- год минуты заполнены в 43 984, то есть у половины их нет. Игровое
           -- время меряется ЧИСЛОМ МАТЧЕЙ, которое есть всегда; минуты идут на
           -- экран как уточнение и не участвуют в сравнении.
           nullif(sum(coalesce(s.minutes, 0)), 0)::int as minutes,
           sum(coalesce(s.goals, 0))::int   as goals,
           sum(coalesce(s.assists, 0))::int as assists
      from player_match_stats s
     where s.match_date >= current_date - greatest(coalesce(p_days, 365), 30)
     group by s.card_id
  ),
  base as (
    select c.id, c.name, c.name_en, c.photo_url, c.market_value_eur, c.pageviews,
           cc.club_key, fc.league,
           extract(year from age(c.born_on))::int as age,
           case when extract(year from age(c.born_on)) <= 19 then 'u19'
                when extract(year from age(c.born_on)) <= 23 then 'u23'
                when extract(year from age(c.born_on)) <= 28 then 'prime'
                else 'senior' end as band,
           -- ⚠️ АМПЛУА ОБЯЗАТЕЛЬНО, И ЭТО НЕ ПРИДИРКА. Без него у вратаря и
           -- защитника голы структурно равны нулю, и КАЖДЫЙ вратарь попадал в
           -- список «о нём пишут больше, чем он играет». Так и вышло в первом
           -- прогоне: Диогу Кошта и Диант Рамай, оба вратари, стояли в первой
           -- пятёрке. Список, обвиняющий человека за то, что он вратарь, —
           -- это не измерение.
           pos.position as player_position,
           p.apps, p.minutes, p.goals, p.assists
      from cards c
      join card_current_club cc on cc.card_id = c.id
      join football_club fc on fc.club_key = cc.club_key
      -- ⚠️ INNER JOIN, А НЕ LEFT. Статистика матчей собрана у 9 348 игроков из
      -- 25 508; у остальных ноль означает «не собрали», а не «не играл». Первая
      -- версия звала left join — и первые восемь строк оказались игроками с
      -- нулём минут, среди них Эсекьель Барко, который весь год играет. Это был
      -- список дыр в нашем сборе, и он называл людей в лицо.
      join played p on p.card_id = c.id
      join card_position pos on pos.card_id = c.id
     where c.active and c.category = 'player'
       and c.born_on is not null
       and c.market_value_eur is not null
       and c.pageviews is not null
       and fc.league is not null and fc.league <> ''
  ),
  -- ⚠️ СРАВНЕНИЕ ТОЛЬКО ВНУТРИ ЛИГИ, ВОЗРАСТА И АМПЛУА. Деньги и внимание
  -- различаются между лигами на порядки; юниор и ветеран несравнимы по
  -- игровому времени; вратарь и нападающий — по голам.
  ranked as (
    select b.*,
           count(*) over w as peers,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.market_value_eur) as r_value,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.pageviews)        as r_views,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.apps)             as r_apps,
           percent_rank() over (partition by b.league, b.band, b.player_position order by (b.goals + b.assists)) as r_ga
      from base b
    window w as (partition by b.league, b.band, b.player_position)
  )
  select r.id, r.name, r.name_en, r.photo_url, r.club_key, r.league,
         r.age, r.band, r.player_position,
         round(((r.r_value + r.r_views) / 2)::numeric, 3),
         round(((r.r_apps  + r.r_ga)    / 2)::numeric, 3),
         r.apps, r.minutes, r.goals, r.assists,
         r.market_value_eur, r.pageviews, r.peers::int
    from ranked r
   -- Меньше восьми ровесников того же амплуа в лиге — перцентиль считать
   -- не из чего.
   where r.peers >= 8
$$;

revoke all on function public.player_spotlight_scored(integer) from public;
grant execute on function public.player_spotlight_scored(integer) to service_role;

-- ── 2) Памятка ─────────────────────────────────────────────────────────────

create table if not exists public.player_spotlight_cache (
  card_id          uuid primary key,
  name             text,
  name_en          text,
  photo_url        text,
  club_key         text,
  league           text,
  age              integer,
  band             text,
  player_position  text,
  attention        numeric,
  output           numeric,
  apps             integer,
  minutes          integer,
  goals            integer,
  assists          integer,
  market_value_eur bigint,
  pageviews        integer,
  peers            integer,
  built_at         timestamptz not null default now()
);

comment on table public.player_spotlight_cache is
  'Готовые перцентили внимания и отдачи за 365 дней, пересобираются ночью в '
  '06:55. Только окно 365: другое p_days считается вживую.';

alter table public.player_spotlight_cache enable row level security;
drop policy if exists player_spotlight_cache_read on public.player_spotlight_cache;
create policy player_spotlight_cache_read on public.player_spotlight_cache for select using (true);
grant select on public.player_spotlight_cache to anon, authenticated, service_role;

create index if not exists player_spotlight_cache_league on public.player_spotlight_cache (league);

create or replace function public.rebuild_player_spotlight()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout to '120s'
as $$
declare v_count integer;
begin
  -- Две команды, а не data-modifying CTE: все CTE делят один снимок.
  delete from player_spotlight_cache;
  insert into player_spotlight_cache (
    card_id, name, name_en, photo_url, club_key, league, age, band,
    player_position, attention, output, apps, minutes, goals, assists,
    market_value_eur, pageviews, peers)
  select * from player_spotlight_scored(365);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.rebuild_player_spotlight() from public;
grant execute on function public.rebuild_player_spotlight() to service_role;

-- ⚠️ 06:55 — ПОСЛЕ ВСЕЙ УТРЕННЕЙ ЦЕПОЧКИ, и это значимо. Считать перцентили
-- по составам, которые пересоберутся через пять минут, — значит показывать
-- вчерашнее под сегодняшней датой. Цепочка: 06:10 составы карточек →
-- 06:25 словарь клубов → 06:30 памятка имён → 06:40 уровни игроков →
-- 06:42 уровни составов → 06:45 качество прогнозов → 06:50 признаки дуэлей.
select cron.unschedule('rebuild-player-spotlight')
 where exists (select 1 from cron.job where jobname = 'rebuild-player-spotlight');
select cron.schedule('rebuild-player-spotlight', '55 6 * * *',
                     $$select public.rebuild_player_spotlight()$$);

-- ── 3) Сама функция ────────────────────────────────────────────────────────

create or replace function public.player_spotlight(
  p_lang   text    default 'ru',
  p_limit  integer default 20,
  p_mode   text    default 'loud',
  p_league text    default null,
  p_days   integer default 365
)
returns table (
  card_id          uuid,
  name             text,
  name_en          text,
  photo_url        text,
  club             text,
  club_key         text,
  league           text,
  age              integer,
  band             text,
  player_position  text,
  attention        numeric,
  output           numeric,
  gap              numeric,
  apps             integer,
  minutes          integer,
  goals            integer,
  assists          integer,
  market_value_eur bigint,
  pageviews        integer,
  peers            integer
)
language plpgsql stable security definer set search_path = public
set statement_timeout to '30s'
as $$
begin
  -- ⚠️ ОКНО РЕШАЕТ, ОТКУДА ЧИТАТЬ. 365 (и null) — из памятки, всё прочее
  -- считается вживую. Развилка ровно одна и стоит здесь, а не размазана по
  -- телу: иначе не видно, какой ответ откуда взялся.
  if coalesce(p_days, 365) = 365 then
    return query
      select s.card_id, s.name, s.name_en, s.photo_url,
             club_display_name(s.club_key, p_lang), s.club_key, s.league,
             s.age, s.band, s.player_position,
             s.attention, s.output, round(s.attention - s.output, 3),
             s.apps, s.minutes, s.goals, s.assists,
             s.market_value_eur, s.pageviews, s.peers
        from player_spotlight_cache s
       where (p_league is null or p_league = '' or s.league = p_league)
       order by case when p_mode = 'quiet' then s.output - s.attention
                     else s.attention - s.output end desc,
                s.market_value_eur desc
       limit greatest(coalesce(p_limit, 20), 1);
  else
    return query
      select s.card_id, s.name, s.name_en, s.photo_url,
             club_display_name(s.club_key, p_lang), s.club_key, s.league,
             s.age, s.band, s.player_position,
             s.attention, s.output, round(s.attention - s.output, 3),
             s.apps, s.minutes, s.goals, s.assists,
             s.market_value_eur, s.pageviews, s.peers
        from player_spotlight_scored(p_days) s
       where (p_league is null or p_league = '' or s.league = p_league)
       order by case when p_mode = 'quiet' then s.output - s.attention
                     else s.attention - s.output end desc,
                s.market_value_eur desc
       limit greatest(coalesce(p_limit, 20), 1);
  end if;
end;
$$;

revoke all on function public.player_spotlight(text, integer, text, text, integer) from public;
grant execute on function public.player_spotlight(text, integer, text, text, integer)
  to anon, authenticated, service_role;

-- Заполнить сразу: до 06:55 иначе пусто, а пустой экран хуже медленного.
select public.rebuild_player_spotlight();

-- ── ЗАМЕР ПОСЛЕ ────────────────────────────────────────────────────────────
--
--     Function Scan on player_spotlight  (actual rows=20 loops=1)
--       Buffers: shared hit=805
--     Execution Time: 12.854 ms
--
--     517.455 мс → 12.854 мс,  153378 буферов → 805
--
-- ── СВЕРКА ОТВЕТА ──────────────────────────────────────────────────────────
--
-- md5 от ответа целиком вместе с порядком строк, до и после:
--
--   ru/20/loud            970a39cd7323d7a52b4c28afdae0b701   ✓ совпал
--   ru/20/quiet           4628a366b758f0dba0cb0eac49d03fdf   ✓ совпал
--   en/50/loud            0070a8d519acf38952b43c16aba53553   ✓ совпал
--   ru/20/«Англия. ПЛ»    6db8cd2d497b9b31fc939ede9e180420   ✓ совпал
--   ru/20/loud/180 дней   72f24d3b6f95154fed42040f32faf294   ✓ совпал
--
-- ⚠️ ПОСЛЕДНЯЯ СТРОКА ВАЖНЕЕ ОСТАЛЬНЫХ: 180 дней — это ЗАПАСНОЙ путь, мимо
-- памятки. Совпадение доказывает, что вынесенное ядро считает ровно то же,
-- что считало прежнее тело, а не «примерно то же». Без неё сверка проверяла
-- бы только кэш против кэша.
