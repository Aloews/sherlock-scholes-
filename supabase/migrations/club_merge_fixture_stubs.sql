-- Двойники, заведённые из РАСПИСАНИЯ, и починка мёртвых псевдонимов.
-- ===========================================================================
--
-- Владелец: «в рейтинге команд на первом месте оказалась и Барселона и Интер.
-- А в „ближайших матчах“ были составы Реала и Интера перед матчем ЛЧ, а
-- теперь пропали. Верни».
--
-- Второе оказалось настоящей поломкой, и вот какой. `add_clubs_from_fixtures`
-- заводит клуб, когда имя команды из расписания не резолвится. Так рядом с
-- «Интер» [internazionale] (Италия, Серия А, 67 матчей) появился
-- «Интер (Милан)» [inter milan] — без страны, без лиги, без единого матча и с
-- восемью карточками. Матч Лиги чемпионов резолвился в двойника, и вместо
-- состава на 733 млн экран показывал восемь человек. То же у «Аль-Ахли».
--
-- ⚠️ ОДНОГО ПЕРЕСЕЧЕНИЯ СОСТАВОВ ЗДЕСЬ МАЛО, И ЭТО ИЗМЕРЕНО. По «>= 3 общих
-- игрока» в пару попадают «Астон Вилла» и «Челси»: у них трое общих просто
-- потому, что заявки не поспели за трансферами. Отличают три условия сразу:
--
--   доля от МЕНЬШЕЙ заявки >= 40 %   Интер 50 %, Аль-Ахли 100 %, Вилла 9 %
--   ровно у одной стороны НОЛЬ сыгранных матчей
--   у неё же нет ни страны, ни лиги
--
-- На живых данных правило даёт ровно две пары — те самые — и не трогает
-- «Виллу» с «Челси».
--
-- ⚠️ ГЛАВНЫЙ УРОК ЭТОГО ФАЙЛА: `on conflict do nothing` НА ПСЕВДОНИМЕ БЫЛ
-- ОШИБКОЙ. У двойника уже был свой псевдоним, указывающий НА САМОГО СЕБЯ
-- (source = 'card'), и склейка молча его не тронула. Клуб удалён, а имя
-- по-прежнему ведёт в никуда: `resolve_club_key('Inter Milan')` отдавал
-- мёртвый ключ, и состав «Интера» пропадал ВТОРОЙ раз, уже после склейки.
-- Поэтому здесь `do update`, а в конце — уборка всех псевдонимов, ведущих на
-- несуществующий клуб: имя, указывающее в пустоту, хуже отсутствия имени.

create or replace function public.merge_fixture_stub_clubs(p_apply boolean default false)
returns table (пар integer, псевдонимов integer, карточек integer, заявок integer, строк integer)
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare v_pairs int; v_alias int := 0; v_card int := 0; v_squad int := 0; v_club int := 0;
begin
  create temporary table _stub on commit drop as
  with sz as (select club_key, count(*) n from club_squad group by 1),
  mt as (select f.club_key, (select count(*) from club_match m where f.club_key in (m.home_key, m.away_key)) as n
           from football_club f),
  ov as (
    select a.club_key as k1, b.club_key as k2, count(*) as common
      from club_squad a join club_squad b on b.card_id = a.card_id and b.club_key > a.club_key
     group by 1, 2
  )
  select case when m1.n = 0 then o.k1 else o.k2 end as dup_key,
         case when m1.n = 0 then o.k2 else o.k1 end as keep_key
    from ov o
    join sz s1 on s1.club_key = o.k1 join sz s2 on s2.club_key = o.k2
    join mt m1 on m1.club_key = o.k1 join mt m2 on m2.club_key = o.k2
    join football_club f1 on f1.club_key = o.k1
    join football_club f2 on f2.club_key = o.k2
   where o.common >= 3
     and o.common::numeric / least(s1.n, s2.n) >= 0.4
     and ((m1.n = 0) <> (m2.n = 0))
     and ((m1.n = 0 and f1.country is null and f1.league is null)
       or (m2.n = 0 and f2.country is null and f2.league is null));

  select count(*) into v_pairs from _stub;
  if not p_apply then
    return query select v_pairs, 0, 0, 0, 0;
    return;
  end if;

  -- ⚠️ do update, А НЕ do nothing — см. шапку файла.
  insert into club_alias (alias_key, scope, club_key, source)
  select d.dup_key, '', d.keep_key, 'fixture_stub_merge' from _stub d
  on conflict (alias_key, scope) do update
    set club_key = excluded.club_key, source = excluded.source;
  get diagnostics v_alias = row_count;

  insert into club_squad (club_key, card_id, shirt_number, position, joined_at, left_at, source, fetched_at)
  select d.keep_key, q.card_id, q.shirt_number, q.position, q.joined_at, q.left_at, q.source, q.fetched_at
    from club_squad q join _stub d on d.dup_key = q.club_key
  on conflict do nothing;
  get diagnostics v_squad = row_count;
  delete from club_squad q using _stub d where d.dup_key = q.club_key;

  update card_current_club c set club_key = d.keep_key from _stub d
   where d.dup_key = c.club_key
     and not exists (select 1 from card_current_club c2
                      where c2.card_id = c.card_id and c2.club_key = d.keep_key);
  get diagnostics v_card = row_count;
  update card_current_club c set resolved_key = d.keep_key from _stub d where d.dup_key = c.resolved_key;
  delete from card_current_club c using _stub d where d.dup_key = c.club_key;

  update soccerwiki_club k set club_key = d.keep_key from _stub d where d.dup_key = k.club_key;
  delete from club_manager g using _stub d where d.dup_key = g.club_key;
  delete from club_manager_spell s using _stub d where d.dup_key = s.club_key;
  delete from club_rating r using _stub d where d.dup_key = r.club_key;
  delete from football_club f using _stub d where d.dup_key = f.club_key;
  get diagnostics v_club = row_count;

  -- Псевдоним, ведущий на несуществующий клуб, снимается: решатель обязан
  -- честно не найти ничего, а не отдать мёртвый ключ.
  delete from club_alias a
   where not exists (select 1 from football_club f where f.club_key = a.club_key);

  return query select v_pairs, v_alias, v_card, v_squad, v_club;
end;
$$;

comment on function public.merge_fixture_stub_clubs(boolean) is
  'Склеивает клуб-заглушку из расписания с настоящим: пересечение заявок >= 40 % меньшей, ноль матчей и отсутствие страны у одной стороны. p_apply = false — сухой прогон.';

revoke all on function public.merge_fixture_stub_clubs(boolean) from public, anon, authenticated;
grant execute on function public.merge_fixture_stub_clubs(boolean) to service_role;

-- ⚠️ ТА ЖЕ ОШИБКА БЫЛА И В ПЕРВОЙ СКЛЕЙКЕ (club_merge.sql): там тоже стоял
-- `do nothing`. Исправлено там же; здесь остаётся уборка на случай, если
-- какой-то псевдоним пережил обе.
delete from club_alias a
 where not exists (select 1 from football_club f where f.club_key = a.club_key);
