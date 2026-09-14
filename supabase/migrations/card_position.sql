-- ============================================================================
-- Амплуа карточки: вратарь, защитник, полузащитник, нападающий.
--
-- Владелец: «разбей всех игроков по категориям, дай им ранг».
--
-- РАНГ У ПРОЕКТА УЖЕ БЫЛ — `player_index` отдаёт место в общем порядке по
-- любому из двенадцати показателей, с честным знаменателем. Чего не было —
-- КАТЕГОРИЙ: разрезать этот порядок было нечем, и «3820-й игрок» не говорит
-- ничего, тогда как «12-й нападающий» говорит всё. Эта таблица и есть разрез.
--
-- ⚠️ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ, А НЕ ПОДЗАПРОСОМ В `player_index`, И ЭТО НЕ ВКУС.
-- В шапке самой `player_index` записано, чем кончаются подзапросы на строку в
-- этом месте: `exists` на каждую из 25 тысяч строк стоил 131 258 буферов
-- против 7 006. Амплуа считается ночью и лежит колонкой — ровно как
-- `player_level`.
--
-- ⚠️ ИСТОЧНИКА ДВА, И ПОРЯДОК ВАЖЕН. `club_roster` (Transfermarkt) —
-- 24 492 строки и ровно четыре значения; `club_squad` (Soccer Wiki) — 423
-- строки вольным русским текстом. Первый авторитетнее и полнее, второй
-- добирает тех, кого в заявке нет.
--
-- ⚠️ «ПОЛУЗАЩИТНИК» СОДЕРЖИТ В СЕБЕ «ЗАЩИТНИК», и это ловушка, на которую
-- напороться легче лёгкого: проверка на «защитник» раньше проверки на
-- «полузащитник» записала бы в защитники ВСЕХ полузащитников — 152 строки из
-- 423. Порядок в `normalize_position` выбран под это и закреплён тестом в
-- `player_position.test.sql`.
-- ============================================================================

/**
 * Строка амплуа в одно из четырёх значений — или NULL, если не разобрали.
 *
 * NULL здесь честнее выдуманного амплуа: «без амплуа» это отдельная,
 * показываемая категория, а не молчаливая запись в полузащитники.
 */
create or replace function public.normalize_position(p_raw text)
returns text language sql immutable as $$
  select case
    when p_raw is null or btrim(p_raw) = '' then null
    -- Английские четыре значения Transfermarkt — точным совпадением.
    when lower(btrim(p_raw)) = 'goalkeeper' then 'goalkeeper'
    when lower(btrim(p_raw)) = 'defender'   then 'defender'
    when lower(btrim(p_raw)) = 'midfield'   then 'midfield'
    when lower(btrim(p_raw)) = 'attack'     then 'attack'
    -- Русский вольный текст. ⚠️ ПОЛУЗАЩИТНИК ПРОВЕРЯЕТСЯ РАНЬШЕ ЗАЩИТНИКА:
    -- второе — подстрока первого, и обратный порядок увёл бы в защитники
    -- каждого полузащитника.
    when lower(p_raw) like '%вратар%'                then 'goalkeeper'
    when lower(p_raw) like '%полузащитник%'          then 'midfield'
    when lower(p_raw) like '%плеймейкер%'            then 'midfield'
    when lower(p_raw) like '%защитник%'              then 'defender'
    when lower(p_raw) like '%стоппер%'               then 'defender'
    when lower(p_raw) like '%нападающ%'              then 'attack'
    when lower(p_raw) like '%вингер%'                then 'attack'
    when lower(p_raw) like '%форвард%'               then 'attack'
    else null
  end
$$;

comment on function public.normalize_position(text) is
  'Амплуа в одно из четырёх значений. NULL — не разобрали; это отдельная '
  'категория, а не запись наугад.';

create table if not exists public.card_position (
  card_id     uuid primary key references public.cards(id) on delete cascade,
  position    text not null
                check (position in ('goalkeeper', 'defender', 'midfield', 'attack')),
  -- Откуда взято: видно, чему верить, когда два источника разойдутся.
  source      text not null,
  computed_at timestamptz not null default now()
);

comment on table public.card_position is
  'Амплуа карточки игрока, пересобирается ночью. Разрез для player_index.';

-- Под отбор «все нападающие»: без него это seq scan по 25 тысячам на каждое
-- нажатие кнопки.
create index if not exists card_position_pos_idx on public.card_position (position);

alter table public.card_position enable row level security;
drop policy if exists card_position_read on public.card_position;
create policy card_position_read on public.card_position for select using (true);
grant select on public.card_position to anon, authenticated;
grant select, insert, update, delete on public.card_position to service_role;

/**
 * Пересобрать амплуа всем карточкам. Возвращает, скольким проставлено.
 *
 * ⚠️ ПОЛНАЯ ПЕРЕСБОРКА, А НЕ ДОПИСЫВАНИЕ. Игрок меняет клуб и иногда амплуа;
 * заявка обновляется целиком, и строка, оставшаяся от прежней, была бы
 * ложью без срока годности. Таблица маленькая (25 тысяч строк), пересбор
 * стоит один проход.
 */
create or replace function public.rebuild_card_positions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  -- ⚠️ ДВА ОПЕРАТОРА, А НЕ CTE С `delete ... returning` ВНУТРИ `insert`. Все
  -- изменяющие CTE в Postgres видят ОДИН снимок и выполняются как бы
  -- одновременно: вставка проверяла бы первичный ключ по состоянию ДО
  -- удаления и падала бы на конфликте. Соблазн написать это одним запросом
  -- велик ровно настолько, насколько ошибка невидима в маленькой таблице.
  delete from card_position;

  insert into card_position (card_id, position, source)
  select b.card_id, b.pos, b.src
    from (
      select c.id as card_id,
             coalesce(
               (select normalize_position(r.position)
                  from club_roster r
                 where r.card_id = c.id and normalize_position(r.position) is not null
                 -- Свежая строка заявки важнее старой: игрок мог сменить клуб.
                 order by r.fetched_at desc nulls last
                 limit 1),
               (select normalize_position(s.position)
                  from club_squad s
                 where s.card_id = c.id and normalize_position(s.position) is not null
                 order by s.fetched_at desc nulls last
                 limit 1)
             ) as pos,
             case when exists (select 1 from club_roster r
                                where r.card_id = c.id
                                  and normalize_position(r.position) is not null)
                  then 'roster' else 'squad' end as src
        from cards c
       where c.active and c.category = 'player'
    ) b
   where b.pos is not null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.rebuild_card_positions() is
  'Ночная пересборка амплуа из club_roster (Transfermarkt) и club_squad '
  '(Soccer Wiki). Полная, а не дописывание: амплуа меняется вместе с клубом.';

revoke all on function public.normalize_position(text) from public;
revoke all on function public.rebuild_card_positions() from public;
grant execute on function public.normalize_position(text) to anon, authenticated, service_role;
grant execute on function public.rebuild_card_positions() to service_role;

-- ---------------------------------------------------------------------------
-- Разрез общего рейтинга по амплуа.
--
-- ⚠️ АМПЛУА ВХОДИТ В `pool`, А ФИЛЬТР СТОИТ В `scoped` — И ЭТО НЕ ПЕРЕСТАНОВКА
-- РАДИ КРАСОТЫ. В шапке `player_index` записано, чем кончается параметр-фильтр
-- внутри `pool as materialized`: оценка падает до одной строки, планировщик
-- берёт вложенный цикл и делает 25 тысяч заходов в индекс — 229 708 буферов
-- против 7 006. Поэтому `card_position` подсоединяется БЕЗ параметра, как
-- обычная колонка, а сравнение с `p_position` живёт там же, где сравнение с
-- `p_country`, и в той же форме `is null or = '' or =`.
--
-- ⚠️ СНАЧАЛА DROP: у функции меняется набор выходных колонок (добавился
-- `position`), а `create or replace` этого не разрешает — 42P13.
-- ---------------------------------------------------------------------------
-- ⚠️ СТАРЫЕ ПОДПИСИ СНОСЯТСЯ ЯВНО, ОБЕ. `create or replace` с новым
-- параметром не заменяет функцию, а ЗАВОДИТ ВТОРУЮ рядом: так и вышло с
-- `player_index_count` — пяти- и шестипараметрическая ужились, и Postgres на
-- вызов ответил «function is not unique» (42725). Для PostgREST это опаснее
-- обычного: он зовёт по именам и молча выберет не ту.
drop function if exists public.player_index(text, text, text, text, text, integer, integer, text);
drop function if exists public.player_index_count(text, text, text, text, text);

create or replace function public.player_index(
  p_sort      text    default 'index',
  p_league    text    default null,
  p_country   text    default null,
  p_club_key  text    default null,
  p_lang      text    default 'ru',
  p_limit     integer default 50,
  p_offset    integer default 0,
  p_continent text    default null,
  p_position  text    default null
)
returns table (
  card_id uuid, name text, name_en text, photo_url text, country text,
  continent text, club_key text, club text, league text,
  index_score smallint, parts smallint, value_part smallint, views_part smallint,
  stats_part smallint, news_part smallint, sort_value numeric, place integer,
  -- ⚠️ `player_position`, А НЕ `position`: последнее — зарезервированное слово
  -- SQL (`position(подстрока in строка)`), и объявление выходной колонки с
  -- таким именем не разбирается вовсе — 42601. Имя выбрано не новое: ровно так
  -- же называется колонка у `club_squad_view`, по той же причине.
  player_position text
)
language sql stable security definer
set search_path to 'public'
set statement_timeout to '60s'
set work_mem to '8MB'
as $function$
  with pool as materialized (
    select c.id, c.name, c.country, c.continent, pl.parts, cp.position as pos,
           case coalesce(nullif(p_sort, ''), 'index')
             when 'value'     then c.market_value_eur::numeric
             when 'views'     then c.pageviews::numeric
             when 'rating'    then c.sw_rating::numeric
             when 'news'      then (select h.value from card_metric_history h
                                     where h.card_id = c.id and h.metric = 'news_30d'
                                     order by h.taken_on desc limit 1)
             when 'stats'     then (select sum(s.minutes)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             when 'goals'     then (select sum(s.goals)::numeric from player_season_stat s
                                      left join tm_club k on k.id = s.club_id
                                     where s.card_id = c.id
                                       and not coalesce(k.is_national_team, false))
             when 'growth'    then pl.value_growth
             when 'caps'      then pl.caps::numeric
             when 'countries' then pl.countries::numeric
             when 'cards'     then pl.foul_cards::numeric
             when 'young'     then extract(epoch from c.born_on)::numeric
             else pl.index_score::numeric
           end as sort_value
      from cards c
      join player_level pl on pl.card_id = c.id
      left join card_position cp on cp.card_id = c.id
     where c.active and c.category = 'player'
  ),
  by_club as materialized (
    select cc.card_id from card_current_club cc where cc.club_key = p_club_key
  ),
  by_league as materialized (
    select cc.card_id from card_current_club cc
       join football_club fc on fc.club_key = cc.club_key
     where fc.league = p_league
  ),
  scoped as (
    select p.id, p.name, p.parts, p.sort_value, p.pos
      from pool p
     where p.sort_value is not null
       and (p_country   is null or p_country   = '' or p.country   = p_country)
       and (p_continent is null or p_continent = '' or p.continent = p_continent)
       and (p_position  is null or p_position  = '' or p.pos       = p_position)
       and (p_club_key  is null or p_club_key  = '' or p.id in (select card_id from by_club))
       and (p_league    is null or p_league    = '' or p.id in (select card_id from by_league))
  ),
  ranked as (
    select s.id, s.sort_value, s.pos,
           row_number() over (
             order by s.sort_value desc nulls last,
                      s.parts desc nulls last, s.name)::integer as place
      from scoped s
  ),
  page as (
    select r.id, r.sort_value, r.place, r.pos
      from ranked r
     order by r.place
     limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select c.id, c.name, c.name_en, c.photo_url, c.country, c.continent,
         cc.club_key,
         case when cc.club_key is null then null
              else club_display_name(cc.club_key, p_lang) end,
         fc.league,
         pl.index_score, pl.parts, pl.value_part, pl.views_part,
         pl.stats_part, pl.news_part, p.sort_value, p.place, p.pos
    from page p
    join cards c on c.id = p.id
    join player_level pl on pl.card_id = p.id
    left join card_current_club cc on cc.card_id = p.id
    left join football_club fc on fc.club_key = cc.club_key
   order by p.place;
$function$;

create or replace function public.player_index_count(
  p_sort      text default 'index',
  p_league    text default null,
  p_country   text default null,
  p_club_key  text default null,
  p_continent text default null,
  p_position  text default null
)
returns integer
language sql stable security definer
set search_path to 'public'
as $function$
  with pool as materialized (
    select c.id, c.country, c.continent, cp.position as pos,
           c.market_value_eur, c.pageviews, c.sw_rating, c.born_on,
           pl.value_growth, pl.caps, pl.countries, pl.foul_cards, pl.index_score
      from cards c
      join player_level pl on pl.card_id = c.id
      left join card_position cp on cp.card_id = c.id
     where c.active and c.category = 'player'
  ),
  by_club as materialized (
    select cc.card_id from card_current_club cc where cc.club_key = p_club_key
  ),
  by_league as materialized (
    select cc.card_id from card_current_club cc
       join football_club fc on fc.club_key = cc.club_key
     where fc.league = p_league
  )
  select count(*)::integer
    from pool p
   where (p_country   is null or p_country   = '' or p.country   = p_country)
     and (p_continent is null or p_continent = '' or p.continent = p_continent)
     and (p_position  is null or p_position  = '' or p.pos       = p_position)
     and (p_club_key  is null or p_club_key  = '' or p.id in (select card_id from by_club))
     and (p_league    is null or p_league    = '' or p.id in (select card_id from by_league))
     and case coalesce(nullif(p_sort, ''), 'index')
           when 'value'     then p.market_value_eur is not null
           when 'views'     then p.pageviews is not null
           when 'rating'    then p.sw_rating is not null
           when 'young'     then p.born_on is not null
           when 'growth'    then p.value_growth is not null
           when 'caps'      then p.caps is not null
           when 'countries' then p.countries is not null
           when 'cards'     then p.foul_cards is not null
           when 'stats'     then exists (select 1 from player_season_stat s where s.card_id = p.id)
           when 'goals'     then exists (select 1 from player_season_stat s where s.card_id = p.id)
           else p.index_score is not null
         end;
$function$;

revoke all on function public.player_index(text, text, text, text, text, integer, integer, text, text) from public;
revoke all on function public.player_index_count(text, text, text, text, text, text) from public;
grant execute on function public.player_index(text, text, text, text, text, integer, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.player_index_count(text, text, text, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- В ночную пересборку, рядом с уровнями.
--
-- ⚠️ ТЕМ ЖЕ ЗАДАНИЕМ, А НЕ НОВЫМ, И ЭТО НЕ ЭКОНОМИЯ СТРОКИ. Амплуа читается из
-- `club_roster` и `club_squad` — тех же таблиц, что наполняет ночной сбор
-- заявок. Отдельное задание пришлось бы ставить ПОСЛЕ него по времени, и
-- каждый сдвиг сбора молча ломал бы этот порядок. В одной команде с уровнями
-- порядок задан самим оператором, а не расписанием.
--
-- ⚠️ `cron.schedule` С ТЕМ ЖЕ ИМЕНЕМ ПЕРЕЗАПИСЫВАЕТ ЗАДАНИЕ, а не заводит
-- второе — это поведение pg_cron, и на него здесь и рассчитано: файл можно
-- применить повторно.
select cron.schedule(
  'rebuild-player-levels',
  '40 6 * * *',
  $cron$select public.apply_football_icons(); select public.rebuild_player_levels(); select public.rebuild_card_positions()$cron$
);
