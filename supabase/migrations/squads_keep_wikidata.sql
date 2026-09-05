-- ===========================================================================
-- Ночная пересборка составов СТИРАЛА БЫ собранное из Викиданных.
--
-- ⚠️ Найдено до того, как случилось, — но случилось бы в ту же ночь.
-- `rebuild_club_squads` собирает свидетельства ровно из трёх источников:
-- `wiki_career` (из card_current_club), `matches` и `sports_ru`. Источника
-- `wikidata` среди них НЕТ, и отсюда две поломки, обе тихие:
--
--   1. `update ... set left_at = ...` закрывает КАЖДУЮ открытую строку, чью
--      пару (card_id, club_key) не подтвердил один из трёх. Все 441
--      wikidata-строки, не подтверждённые независимо, закрылись бы.
--   2. `on conflict ... set source = excluded.source` у выживших ПЕРЕЗАПИСАЛ
--      бы 'wikidata' на 'matches'. А `recent_transfers` читает только
--      wikidata-строки (у остальных joined_at — дата матча, не перехода), и
--      лента переходов молча опустела бы к утру.
--
-- Лечится добавлением четвёртого источника с НАИВЫСШИМ доверием.
--
-- ⚠️ ПОЧЕМУ ДОВЕРИЕ ВЫШЕ ВСЕХ (trust 0). Остальные три ВЫВОДЯТ клуб: «сыграл
-- за него дважды за 400 дней». Викиданные его УТВЕРЖДАЮТ и приносят дату
-- перехода (P580). Вывод по матчам отстаёт от перехода на несколько туров —
-- ровно в трансферное окно, когда лента переходов и нужна.
--
-- Цена честная: если игрок сменит клуб ПОСЛЕ сбора, он останется в старом до
-- следующего прогона сборщика. Это видно и чинится прогоном; а вот
-- перезапись каждую ночь не видна никак.
--
-- ⚠️ ЦЕНА ОКАЗАЛАСЬ ВЫШЕ НАПИСАННОГО, И ВОТ ПОПРАВКА. «Чинится прогоном» —
-- неправда: сборщик перечитывает те же Викиданные, а они и отстают. Строка не
-- чинится ничем и живёт вечно. Замер 03.09.2026, боевые данные:
--
--   открытых wikidata-строк                          441
--   из них ОПРОВЕРГНУТЫХ матчем за другой клуб        65
--   у скольких есть верный клуб в другом источнике    29
--
--   Гонду      показан в «Зените» с 2024-01-01, играет за ЦСКА с 2026-08-22
--   Маркиньос  показан в «Арсенале» с 2022-01-01, играет за ПСЖ с 2026-08-28
--   Траффорд   показан в «Ман Сити»,              играет за «Лидс» с 2026-08-12
--
-- Владелец увидел это как «нет трансферов мелких команд» — но дело не в
-- размере клуба: любой переход, который Викиданные не успели записать,
-- прятался за их же вечным первенством.
--
-- ПОЭТОМУ ДОВЕРИЕ ТЕПЕРЬ УСЛОВНОЕ. Викиданные остаются первыми, ПОКА их не
-- опроверг МАТЧ: игрок вышел за другой клуб позже даты, которую они называют
-- датой перехода. Это не догадка и не эвристика — сыгранный матч сильнее
-- любой записи о намерении.
--
-- ⚠️ ПОНИЖЕНИЕ — НЕ УДАЛЕНИЕ, и на этом держится безопасность правки. Строка
-- уходит в конец очереди, а не из неё: если другого источника у игрока нет
-- (16 случаев из 65), она остаётся единственной и по-прежнему выигрывает.
-- Поломка #145, ради которой весь этот файл, вернуться не может.
-- ===========================================================================
create or replace function public.rebuild_club_squads()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  create temporary table _pm on commit drop as
    select d.card_id, d.match_date, d.tournament,
           is_national_tournament(d.tournament) as is_nat,
           sh.club_key as home_key, sa.club_key as away_key
      from player_match_days d
      left join club_name_seen sh
        on sh.team = d.home_team and sh.scope = coalesce(tournament_scope(d.tournament), '')
      left join club_name_seen sa
        on sa.team = d.away_team and sa.scope = coalesce(tournament_scope(d.tournament), '');
  create index on _pm (card_id);

  create temporary table _squad_evidence on commit drop as
  -- ⚠️ ЧЕТВЁРТЫЙ ИСТОЧНИК И ПЕРВЫЙ ПО ДОВЕРИЮ. Без него вся ветка ниже
  -- закрывает собранные составы, потому что «не подтверждено» она понимает
  -- как «игрок ушёл».
  with from_wikidata as (
    select q.card_id, q.club_key,
           -- Первое доверие — пока запись не опровергнута СЫГРАННЫМ матчем за
           -- другой клуб позже названной даты перехода. См. шапку: иначе
           -- «Гонду в Зените» переживает его переход в ЦСКА навсегда.
           case when exists (
                  select 1 from _pm p
                   where p.card_id = q.card_id
                     and not p.is_nat
                     and p.match_date > q.joined_at
                     and coalesce(p.home_key, '') <> q.club_key
                     and coalesce(p.away_key, '') <> q.club_key)
                then 4 else 0 end as trust,
           'wikidata' as source
      from club_squad q
      join cards c on c.id = q.card_id and c.active and c.category = 'player'
     where q.left_at is null and q.source = 'wikidata'
  ),
  wiki as (
    select cc.card_id, cc.club_key, 1 as trust, 'wiki_career' as source
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     where cc.club_key is not null
  ),
  from_matches as (
    select distinct on (x.card_id) x.card_id, x.club_key, 2, 'matches'
      from (
        select p.card_id, t.club_key, count(*) as n
          from _pm p
          cross join lateral (values (p.home_key), (p.away_key)) as t(club_key)
          join cards c on c.id = p.card_id and c.active and c.category = 'player'
         where p.match_date >= current_date - 400
           and not p.is_nat
           and t.club_key is not null
         group by p.card_id, t.club_key
        having count(*) >= 2
      ) x
     order by x.card_id, x.n desc, x.club_key
  ),
  from_sports_ru as (
    select s.card_id, resolve_club_key(s.club_slug, null), 3, 'sports_ru'
      from sports_ru_player s
      join cards c on c.id = s.card_id and c.active and c.category = 'player'
     where s.club_slug is not null
  )
  select * from from_wikidata
  union all select * from wiki
  union all select * from from_matches
  union all select * from from_sports_ru;

  create temporary table _squad_now on commit drop as
  select distinct on (e.card_id) e.card_id, e.club_key, e.source
    from _squad_evidence e
    join football_club f on f.club_key = e.club_key and f.kind = 'club'
   where e.club_key is not null
   order by e.card_id, e.trust;
  create index on _squad_now (card_id);

  create temporary table _squad_dates on commit drop as
  select n.card_id, n.club_key, min(p.match_date) as first_match
    from _squad_now n
    join _pm p on p.card_id = n.card_id
   where p.home_key = n.club_key or p.away_key = n.club_key
   group by n.card_id, n.club_key;

  update club_squad q
     set left_at = coalesce(
           (select max(d.match_date) from player_match_days d where d.card_id = q.card_id),
           current_date)
   where q.left_at is null
     and not exists (
       select 1 from _squad_now n
        where n.card_id = q.card_id and n.club_key = q.club_key);

  insert into club_squad (club_key, card_id, joined_at, left_at, source, fetched_at)
  select n.club_key, n.card_id, d.first_match, null, n.source, now()
    from _squad_now n
    left join _squad_dates d on d.card_id = n.card_id and d.club_key = n.club_key
  on conflict (club_key, card_id) do update set
    left_at    = null,
    joined_at  = coalesce(club_squad.joined_at, excluded.joined_at),
    -- ⚠️ 'wikidata' НЕ ПОНИЖАЕТСЯ. Даже когда строку подтвердил и более
    -- слабый источник, метку менять нельзя: по ней recent_transfers отличает
    -- дату ПЕРЕХОДА от даты матча, и понижение выбрасывает игрока из ленты.
    source     = case when club_squad.source = 'wikidata' then 'wikidata'
                      else excluded.source end,
    fetched_at = now();

  select count(*) into v_count from club_squad where left_at is null;
  return v_count;
end;
$$;

-- Грант перечислен ЯВНО: политика без гранта роняла этот проект дважды.
revoke all on function public.rebuild_club_squads() from public;
grant execute on function public.rebuild_club_squads() to service_role;
