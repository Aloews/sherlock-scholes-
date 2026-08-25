-- ============================================================================
-- data_consistency_report — где данные РАСХОДЯТСЯ между экранами.
--
-- ЗАЧЕМ. Жалоба звучала так: «в фэнтези нет Жоао Педро, а он забил гол; в
-- коллекции у него статистика есть, а в фэнтези нет». Разбор показал не одну
-- поломку, а три, и все три невидимы, пока их специально не посчитать.
--
-- Замер 25.08.2026 по активным карточкам игроков:
--
--   активных игроков                                    2918
--   из них с текущим клубом                             1173  (40%)
--   БЕЗ клуба                                           1745  (60%)
--   без клуба, но сыграли матч за последние 30 дней      225
--
-- Последняя строка и есть жалоба. `fantasy_options` отбирает игроков через
-- `card_current_club` — нет клуба, нет игрока в заявке. А коллекция читает
-- `cards` и `player_match_stats` напрямую и показывает его статистику. Один
-- игрок, два экрана, разный ответ.
--
-- ⚠️ И ВТОРОЕ, ХУЖЕ ПЕРВОГО. Сам «Жуан Педро» держит на себе матчи ДВУХ
-- РАЗНЫХ ЛЮДЕЙ:
--
--   24.08  English Premier League  Fulham – Chelsea        1 гол, 1 пас
--   16.08  Brazilian Serie A       Corinthians – Cruzeiro  0
--
-- Это тёзка, приехавший в ту же карточку. У проекта уже есть защита от этого
-- на стороне сборщиков (`active_cards_by_key` в sports_ru_stats.py и
-- espn_stats.py), но она не чинит то, что успело попасть в базу раньше.
--
-- Признак ищется так: у игрока ОДНОГО клуба команда клуба стоит в КАЖДОМ его
-- матче — либо дома, либо в гостях. Нет команды, общей для всех матчей —
-- значит либо переход внутри окна, либо два человека на одной карточке.
-- Замер: 360 карточек из 1153 (31%), и 351 из них с тремя и более матчами,
-- где переходом столько уже не объяснить.
--
-- ⚠️ ОТЧЁТ НИЧЕГО НЕ ЧИНИТ И НИЧЕГО НЕ УДАЛЯЕТ. Он показывает расхождения и
-- называет их поимённо. Автоматическое «исправление» карточки, на которой
-- смешаны два человека, — это выбор, кого из них выбросить, и делать его
-- молча нельзя: в прошлый раз одно такое молчаливое решение стоило проекту
-- «Роналдо, игравшего за Ростов и в Бразилии одновременно».
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Команды, встречающиеся в матчах карточки за окно, и в скольких матчах.
-- Вынесено отдельно, потому что этим пользуются оба отчёта ниже.
-- ---------------------------------------------------------------------------
create or replace function public.card_team_spread(p_card_id uuid, p_days int default 120)
returns table (team text, in_matches bigint, of_matches bigint)
language sql stable security definer set search_path = public as $$
  with recent as (
    select distinct match_date, home_team, away_team
      from player_match_stats
     where card_id = p_card_id
       and match_date > now() - make_interval(days => greatest(1, p_days))
  ),
  t as (
    select home_team as team, match_date from recent
    union all
    select away_team, match_date from recent
  )
  select t.team,
         count(distinct t.match_date) as in_matches,
         (select count(*) from recent) as of_matches
    from t
   group by t.team
   order by count(distinct t.match_date) desc, t.team
$$;

comment on function public.card_team_spread(uuid, int) is
  'Команды из матчей карточки за окно. Клуб игрока обязан стоять в КАЖДОМ '
  'матче; команда с in_matches = of_matches и есть кандидат в клубы.';

-- ---------------------------------------------------------------------------
-- Игроки, которые играли, но в фэнтези не попадают: нет текущего клуба.
-- ---------------------------------------------------------------------------
create or replace function public.players_missing_club(p_days int default 30)
returns table (card_id uuid, name text, name_en text, matches bigint,
               last_match date, goals bigint, club_candidate text)
language sql stable security definer set search_path = public as $$
  with played as (
    select p.card_id,
           count(distinct p.match_date) as matches,
           max(p.match_date) as last_match,
           sum(coalesce(p.goals, 0)) as goals
      from player_match_stats p
      join cards c on c.id = p.card_id and c.active and c.category = 'player'
      left join card_current_club cc on cc.card_id = p.card_id
     where cc.card_id is null
       and p.match_date > now() - make_interval(days => greatest(1, p_days))
     group by p.card_id
  )
  select pl.card_id, c.name, c.name_en, pl.matches, pl.last_match, pl.goals,
         -- Кандидат только когда он ОДИН и стоит во всех матчах. Иначе null:
         -- «наверное, этот» здесь означает приписать игрока чужому клубу.
         (select s.team from card_team_spread(pl.card_id, 120) s
           where s.in_matches = s.of_matches and s.of_matches >= 2
           limit 1) as club_candidate
    from played pl
    join cards c on c.id = pl.card_id
   order by pl.goals desc, pl.matches desc
$$;

comment on function public.players_missing_club(int) is
  'Играли за последние N дней, но `card_current_club` пуст — значит в '
  'fantasy_options их нет, хотя в коллекции статистика видна. Ровно жалоба '
  'про Жоао Педро.';

-- ---------------------------------------------------------------------------
-- Карточки, на которых, похоже, смешаны два человека.
-- ---------------------------------------------------------------------------
create or replace function public.cards_suspect_namesake(p_min_matches int default 3)
returns table (card_id uuid, name text, name_en text, matches bigint,
               tournaments bigint, top_team text, top_team_matches bigint)
language sql stable security definer set search_path = public as $$
  with per_card as (
    select p.card_id,
           count(distinct p.match_date) as matches,
           count(distinct p.tournament) as tournaments
      from player_match_stats p
      join cards c on c.id = p.card_id and c.active and c.category = 'player'
     where p.match_date > now() - interval '120 days'
     group by p.card_id
    having count(distinct p.match_date) >= greatest(2, p_min_matches)
  ),
  best as (
    select pc.card_id, pc.matches, pc.tournaments,
           s.team, s.in_matches
      from per_card pc
      cross join lateral (
        select team, in_matches from card_team_spread(pc.card_id, 120)
         order by in_matches desc limit 1
      ) s
  )
  select b.card_id, c.name, c.name_en, b.matches, b.tournaments,
         b.team, b.in_matches
    from best b
    join cards c on c.id = b.card_id
   -- Ни одна команда не стоит во всех матчах: либо переход внутри окна,
   -- либо два человека. Отчёт называет обоих — решает человек.
   where b.in_matches < b.matches
   order by b.matches - b.in_matches desc, b.matches desc
$$;

comment on function public.cards_suspect_namesake(int) is
  'Ни одна команда не встречается во ВСЕХ матчах карточки. У игрока одного '
  'клуба так не бывает: либо переход внутри окна, либо на карточке два '
  'человека. Не чинит — показывает.';

-- ---------------------------------------------------------------------------
-- Сводка одной строкой: её удобно звать из проверки перед выкаткой.
-- ---------------------------------------------------------------------------
create or replace function public.data_consistency_report()
returns table (metric text, value bigint, note text)
language sql stable security definer set search_path = public as $$
  select 'активных игроков', count(*)::bigint,
         'категория player, active'
    from cards where active and category = 'player'
  union all
  select 'из них с текущим клубом', count(*)::bigint,
         'только они попадают в fantasy_options'
    from cards c join card_current_club cc on cc.card_id = c.id
   where c.active and c.category = 'player'
  union all
  select 'играли, но клуба нет', count(*)::bigint,
         'видны в коллекции, отсутствуют в фэнтези — это и есть расхождение'
    from players_missing_club(30)
  union all
  select 'из них клуб восстановим', count(*)::bigint,
         'одна команда стоит во всех матчах — можно заполнить'
    from players_missing_club(30) where club_candidate is not null
  union all
  select 'подозрение на тёзку', count(*)::bigint,
         'ни одна команда не во всех матчах: переход или два человека'
    from cards_suspect_namesake(3)
$$;

comment on function public.data_consistency_report() is
  'Расхождения между экранами одной таблицей. Ничего не чинит.';

-- ---------------------------------------------------------------------------
-- Гранты. ⚠️ Политика без гранта роняла этот проект дважды — перечисляем явно.
-- Отчёты читают чужие карточки целиком, поэтому игрокам они не отдаются:
-- только service_role, то есть конвейер и админ.
-- ---------------------------------------------------------------------------
revoke all on function public.card_team_spread(uuid, int) from public, anon, authenticated;
revoke all on function public.players_missing_club(int) from public, anon, authenticated;
revoke all on function public.cards_suspect_namesake(int) from public, anon, authenticated;
revoke all on function public.data_consistency_report() from public, anon, authenticated;

grant execute on function public.card_team_spread(uuid, int) to service_role;
grant execute on function public.players_missing_club(int) to service_role;
grant execute on function public.cards_suspect_namesake(int) to service_role;
grant execute on function public.data_consistency_report() to service_role;
