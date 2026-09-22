-- ============================================================================
-- МАТЧИ СБОРНЫХ В КАЛЕНДАРЕ И РЕЗУЛЬТАТАХ — ВТОРЫМ ИСТОЧНИКОМ, БЕСПЛАТНО.
--
-- ⚠️ ПЛАТНЫЙ ПРОВАЙДЕР РАСПИСАНИЯ СБОРНЫХ ПРОСТО НЕ НЕСЁТ, И ЭТО ЗАМЕР, А НЕ
-- ПРЕДПОЛОЖЕНИЕ. Запрос `{"list": true}` к `football-fixtures` 22.09.2026 вернул
-- весь его справочник футбола; из турниров сборных в нём РОВНО ОДИН:
--
--     soccer_uefa_nations_league    UEFA Nations League
--
-- Ни отбора чемпионата мира, ни товарищеских, ни Кубка Америки, ни Кубка
-- Африки, ни Золотого кубка. То есть «добавить сборные» через него нельзя в
-- принципе: их там нет. Владелец просил срочно — и срочным это делает не
-- отсутствие функции, а то, что прямо сейчас идёт перерыв на сборные.
--
-- ЧТО ЕСТЬ У ESPN, БЕСПЛАТНО И ОДНИМ ЗАПРОСОМ НА ТУРНИР ЗА МЕСЯЦ (замер тем
-- же днём, `/scoreboard?dates=YYYYMM`):
--
--     товарищеские          сен 42, окт 33, ноя 12   — пять УЖЕ сыграны
--     Лига наций CONCACAF   сен 37, окт 37
--     Лига наций UEFA       сен 52, окт 52           ← уже есть у провайдера
--     отбор ЧМ (все шесть)  0 — цикл 2026 закончился в марте плей-офф
--     Евро, Кубки Америки/Африки/Золотой — 0, межсезонье
--
-- То есть в календаре сейчас НЕ ХВАТАЕТ 161 матча сборных, и пять из них уже
-- сыграны — то есть отсутствуют и результаты.
--
-- ⚠️ НОЛЬ У ОТБОРА ЧМ — ЭТО НЕ ПОЛОМКА, А МЕЖСЕЗОНЬЕ, и отличать одно от
-- другого надо заранее. Тот же `fifa.worldq.uefa` за март 2026 отдаёт 12
-- матчей. Поэтому турниры вне сезона остаются в реестре ВКЛЮЧЁННЫМИ: они
-- ничего не стоят (пустой ответ) и появятся в календаре сами, как только
-- начнётся цикл. Выключенный турнир пришлось бы не забыть включить — а это
-- ровно тот способ ломаться, из-за которого здесь уже терялась Лига чемпионов.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Реестр: слаг ESPN → наш ключ турнира.
--
-- ⚠️ ЛИГА НАЦИЙ UEFA ЛЕЖИТ ЗДЕСЬ ВЫКЛЮЧЕННОЙ, А НЕ ОТСУТСТВУЕТ. Её ведёт
-- платный провайдер, и включи мы её здесь — каждый матч появился бы в
-- календаре ДВАЖДЫ, с разными id и одинаковыми командами. Строка с причиной
-- лучше отсутствия строки: отсутствие читается как «забыли».
-- ---------------------------------------------------------------------------
create table if not exists public.espn_national_league (
  espn_slug  text primary key,
  sport_key  text not null unique,
  title      text not null,
  -- Спрашивать ли ESPN про этот турнир.
  active     boolean not null default true,
  note       text
);

insert into public.espn_national_league (espn_slug, sport_key, title, active, note) values
  ('fifa.friendly',           'soccer_international_friendlies',
   'Товарищеские матчи сборных', true, null),
  ('concacaf.nations.league', 'soccer_concacaf_nations_league',
   'Лига наций CONCACAF', true, null),
  ('fifa.worldq.uefa',        'soccer_fifa_world_cup_qualifiers_europe',
   'Отбор ЧМ (Европа)', true, 'цикл 2026 закончился в марте; ждёт следующего'),
  ('fifa.worldq.conmebol',    'soccer_fifa_world_cup_qualifiers_south_america',
   'Отбор ЧМ (Южная Америка)', true, null),
  ('fifa.worldq.concacaf',    'soccer_fifa_world_cup_qualifiers_north_america',
   'Отбор ЧМ (Северная Америка)', true, null),
  ('fifa.worldq.afc',         'soccer_fifa_world_cup_qualifiers_asia',
   'Отбор ЧМ (Азия)', true, null),
  ('fifa.worldq.caf',         'soccer_fifa_world_cup_qualifiers_africa',
   'Отбор ЧМ (Африка)', true, null),
  ('fifa.world',              'soccer_fifa_world_cup',
   'Чемпионат мира', true, null),
  ('uefa.euroq',              'soccer_uefa_euro_qualification',
   'Отбор Евро', true, null),
  ('uefa.euro',               'soccer_uefa_european_championship',
   'Чемпионат Европы', true, null),
  ('conmebol.america',        'soccer_conmebol_copa_america',
   'Кубок Америки', true, null),
  ('concacaf.gold',           'soccer_concacaf_gold_cup',
   'Золотой кубок КОНКАКАФ', true, null),
  ('caf.nations',             'soccer_africa_cup_of_nations',
   'Кубок африканских наций', true, null),
  ('uefa.nations',            'soccer_uefa_nations_league',
   'Лига наций УЕФА', false,
   'ведёт платный провайдер расписания; включить — значит задвоить каждый матч')
on conflict (espn_slug) do update set
  sport_key = excluded.sport_key,
  title     = excluded.title,
  note      = excluded.note;
  -- ⚠️ `active` НЕ ОБНОВЛЯЕТСЯ: это переключатель человека. Повторное
  -- применение миграции не имеет права включить то, что выключили руками.

alter table public.espn_national_league enable row level security;
drop policy if exists espn_national_league_read on public.espn_national_league;
create policy espn_national_league_read on public.espn_national_league for select using (true);
grant select on public.espn_national_league to anon, authenticated;
grant select, insert, update, delete on public.espn_national_league to service_role;

-- ---------------------------------------------------------------------------
-- 2. Запись матчей сборных.
--
-- ⚠️ ЭТА ФУНКЦИЯ СОЗДАЁТ СТРОКИ, И ЭТИМ ОНА ОТЛИЧАЕТСЯ ОТ `apply_espn_scores`.
-- У той в шапке записано: «ни одной строки не создаётся, расписание ведёт
-- провайдер». Для клубов это верно и остаётся верным. Для сборных провайдера
-- НЕТ ВООБЩЕ — значит либо их создаёт этот источник, либо их нет на экране.
--
-- ⚠️ ID С ПРИСТАВКОЙ `espn:`, И ЭТО НЕ УКРАШЕНИЕ. У провайдера id — это его
-- собственный хеш; у ESPN — числовая строка. Без приставки однажды совпадут,
-- и один матч затрёт другой молча.
--
-- ⚠️ СЧЁТ ПИШЕТСЯ ТОЛЬКО У СЫГРАННОГО. До свистка ESPN отдаёт «0:0» со
-- STATUS_SCHEDULED — записать это значило бы объявить несыгранный матч
-- ничьей. Та же ловушка уже описана в football-scores-espn.
-- ---------------------------------------------------------------------------
create or replace function public.apply_espn_fixtures(p_rows jsonb)
returns table(inserted integer, updated integer)
language plpgsql security definer set search_path = public as $$
declare v_before bigint; v_after bigint; v_touched integer;
begin
  select count(*) into v_before from public.fixtures where id like 'espn:%';

  with incoming as (
    select 'espn:' || (r->>'event_id')            as id,
           r->>'sport_key'                        as sport_key,
           (r->>'commence_at')::timestamptz       as commence_at,
           r->>'home_team'                        as home_team,
           r->>'away_team'                        as away_team,
           nullif(r->>'home_score', '')::smallint as home_score,
           nullif(r->>'away_score', '')::smallint as away_score,
           coalesce((r->>'completed')::boolean, false) as completed
      from jsonb_array_elements(p_rows) r
     where r->>'event_id' is not null
       and r->>'home_team' is not null
       and r->>'away_team' is not null
  ), written as (
    insert into public.fixtures as f
      (id, sport_key, commence_at, home_team, away_team,
       home_score, away_score, completed, scores_at, updated_at)
    select i.id, i.sport_key, i.commence_at, i.home_team, i.away_team,
           i.home_score, i.away_score, i.completed,
           case when i.home_score is not null then now() end, now()
      from incoming i
    on conflict (id) do update set
      commence_at = excluded.commence_at,
      home_team   = excluded.home_team,
      away_team   = excluded.away_team,
      -- ⚠️ СЧЁТ НЕ СТИРАЕТСЯ ПУСТОТОЙ. ESPN убирает завершённый матч из
      -- ответа за прошлый месяц, и пустой ответ не повод забыть результат.
      home_score  = coalesce(excluded.home_score, f.home_score),
      away_score  = coalesce(excluded.away_score, f.away_score),
      -- И `completed` только ВПЕРЁД: сыгранный матч не становится несыгранным.
      completed   = f.completed or excluded.completed,
      scores_at   = coalesce(excluded.scores_at, f.scores_at),
      updated_at  = now()
    returning 1
  )
  select count(*)::integer into v_touched from written;

  select count(*) into v_after from public.fixtures where id like 'espn:%';
  inserted := (v_after - v_before)::integer;
  updated  := v_touched - inserted;
  return next;
end $$;

revoke all on function public.apply_espn_fixtures(jsonb) from public, anon, authenticated;
grant execute on function public.apply_espn_fixtures(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Что спрашивать: активные турниры реестра.
-- ---------------------------------------------------------------------------
create or replace function public.espn_national_leagues()
returns table(espn_slug text, sport_key text, title text)
language sql stable security definer set search_path = public as $$
  select n.espn_slug, n.sport_key, n.title
    from public.espn_national_league n
   where n.active
   order by n.espn_slug;
$$;

revoke all on function public.espn_national_leagues() from public, anon, authenticated;
grant execute on function public.espn_national_leagues() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Сколько матчей сборных у нас есть — для проверок и для админки.
-- ---------------------------------------------------------------------------
create or replace function public.national_fixtures_health()
returns table(sport_key text, total bigint, upcoming bigint,
              played bigint, next_at timestamptz, last_update timestamptz)
language sql stable security definer set search_path = public as $$
  select f.sport_key,
         count(*),
         count(*) filter (where f.commence_at > now()),
         count(*) filter (where f.completed),
         min(f.commence_at) filter (where f.commence_at > now()),
         max(f.updated_at)
    from public.fixtures f
    join public.espn_national_league n on n.sport_key = f.sport_key
   group by f.sport_key
   order by 2 desc;
$$;

revoke all on function public.national_fixtures_health() from public, anon, authenticated;
grant execute on function public.national_fixtures_health() to service_role;
