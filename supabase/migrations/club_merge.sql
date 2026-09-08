-- Склейка клубов-двойников: один клуб — один ключ.
-- ===========================================================================
--
-- Владелец выбрал этот шаг первым из четырёх. Он и правда первый: пока
-- справочник двоится, Soccer Wiki нельзя сделать источником составов, а
-- «переход» половины «Баварии» читается как трансфер.
--
-- ЧТО БЫЛО. Сбор Soccer Wiki заводил клубу СВОЮ строку в `football_club`,
-- когда не находил его по имени. Так рядом с «Баварией» появился
-- «Bayern München», рядом с «Марселем» — «Olympique Marseille». Замер до
-- склейки: 1 207 клубов источника имели собственную строку, и переключение
-- текущего клуба на Soccer Wiki «перевело» бы 6 353 игрока — из них
-- подавляющее большинство в клуб-двойник с тем же составом.
--
-- ⚠️ ПАРЫ ИЩУТСЯ ПО ПЕРЕСЕЧЕНИЮ СОСТАВОВ, А НЕ ПО ИМЕНИ, И ЭТО ЕДИНСТВЕННЫЙ
-- СПОСОБ, КОТОРЫЙ ЗДЕСЬ РАБОТАЕТ. «Bayern München» и «Бавария» не совпадают
-- ни одной буквой; «Mamelodi Sundowns» и «Мамелоди Сандаунз» — ни одним
-- словом. Зато игроки у них общие, и это доказательство:
--
--   Mamelodi Sundowns  = Мамелоди Сандаунз  — общих 36 из 36
--   Bayern München     = Бавария            — общих 19 из 19
--   Olympique Marseille= Марсель            — общих 14 из 14
--
-- Порог: не меньше пяти общих игроков И не меньше 60 % состава Soccer Wiki.
-- На живых данных 289 пар и НИ ОДНОЙ неоднозначной — каждый клуб источника
-- ложится ровно на один наш.
--
-- ⚠️ ГЛАВНОЕ ЗДЕСЬ — ПСЕВДОНИМ, А НЕ УДАЛЕНИЕ СТРОКИ. `club_alias` делает
-- склейку постоянной: `resolve_club_key('Bayern München')` после неё отдаёт
-- наш ключ, и следующий сбор не заводит двойника заново. Удаление строки без
-- псевдонима починило бы вчерашний день и сломало завтрашний.
--
-- РЕЗУЛЬТАТ ПРИМЕНЕНИЯ: 289 пар, 263 новых псевдонима, 78 матчей и 32
-- карточки переехали на канонический ключ, 49 тренеров перенесены, 19
-- дублёвых рейтингов убрано, 163 строки-двойника из справочника удалены.
-- После склейки «переехало бы» при переходе на Soccer Wiki упало
-- с 6 353 до 871, и среди дороже 15 млн остался ровно один игрок.

create or replace function public.merge_club_duplicates(p_apply boolean default false)
returns table (пар integer, псевдонимов integer, заявок integer, матчей integer,
               карточек integer, тренеров integer, рейтингов integer, строк_справочника integer)
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare
  v_pairs int; v_alias int := 0; v_squad int := 0; v_match int := 0;
  v_card int := 0; v_mgr int := 0; v_rate int := 0; v_club int := 0;
begin
  -- ⚠️ ПАРЫ ПО ПЕРЕСЕЧЕНИЮ СОСТАВОВ, А НЕ ПО ИМЕНИ: «Bayern München» и
  -- «Бавария» не совпадают ни одной буквой, зато 19 из 19 игроков у них общие.
  -- Порог: >= 5 общих И >= 60 % состава Soccer Wiki. 289 пар, ни одной
  -- неоднозначной. Полный разбор — в шапке этого файла.
  create temporary table _dup on commit drop as
  with sw as (
    select k.club_key as sw_key, p.card_id
      from soccerwiki_player p join soccerwiki_club k on k.club_id = p.club_id
     where p.card_id is not null and k.club_key is not null
  ),
  pair as (
    select sw.sw_key, cc.club_key as our_key, count(*) as n_common
      from sw join card_current_club cc on cc.card_id = sw.card_id
     where cc.club_key <> sw.sw_key group by 1, 2
  ),
  sizes as (select sw_key, count(*) as n from sw group by 1),
  strong as (
    select p.sw_key, p.our_key, p.n_common
      from pair p join sizes s on s.sw_key = p.sw_key
     where p.n_common >= 5 and p.n_common::numeric / s.n >= 0.6
  )
  select sw_key, our_key from (
    select st.*, row_number() over (partition by st.sw_key order by st.n_common desc) as rn
      from strong st) t
   where rn = 1
     and exists (select 1 from football_club f where f.club_key = t.our_key);

  select count(*) into v_pairs from _dup;
  if not p_apply then
    return query select v_pairs, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  -- 1. Псевдоним делает склейку постоянной: resolve_club_key после него отдаёт
  --    наш ключ на имя из Soccer Wiki, и новый сбор не заводит двойника снова.
  -- ⚠️ do update, А НЕ do nothing. У двойника уже мог быть свой псевдоним,
  -- указывающий НА САМОГО СЕБЯ (source = 'card'): с `do nothing` склейка молча
  -- его не трогала, клуб удалялся, а имя продолжало вести в никуда. Так и
  -- вышло с «Inter Milan» — подробности в club_merge_fixture_stubs.sql.
  insert into club_alias (alias_key, scope, club_key, source)
  select d.sw_key, '', d.our_key, 'soccerwiki_merge' from _dup d
  on conflict (alias_key, scope) do update
    set club_key = excluded.club_key, source = excluded.source;
  get diagnostics v_alias = row_count;

  insert into club_squad (club_key, card_id, shirt_number, position, joined_at, left_at, source, fetched_at)
  select d.our_key, q.card_id, q.shirt_number, q.position, q.joined_at, q.left_at, q.source, q.fetched_at
    from club_squad q join _dup d on d.sw_key = q.club_key
  on conflict do nothing;
  get diagnostics v_squad = row_count;
  delete from club_squad q using _dup d where d.sw_key = q.club_key;

  -- ⚠️ СТОЛКНОВЕНИЯ УБИРАЮТСЯ ДО ПЕРЕЕЗДА, А НЕ ПОСЛЕ. Ключ club_match —
  -- (дата, хозяева, гости), и если тот же матч уже записан на канонический
  -- клуб, переезд дублёвой строки падает на 23505. Так и упало на
  -- «kolambus kryu — kf monreal» 20.08.2026.
  delete from club_match m using _dup d
   where d.sw_key = m.home_key
     and exists (select 1 from club_match m2
                  where m2.match_date = m.match_date
                    and m2.home_key = d.our_key and m2.away_key = m.away_key);
  update club_match m set home_key = d.our_key from _dup d where d.sw_key = m.home_key;
  get diagnostics v_match = row_count;

  delete from club_match m using _dup d
   where d.sw_key = m.away_key
     and exists (select 1 from club_match m2
                  where m2.match_date = m.match_date
                    and m2.home_key = m.home_key and m2.away_key = d.our_key);
  update club_match m set away_key = d.our_key from _dup d where d.sw_key = m.away_key;

  update card_current_club c set club_key = d.our_key from _dup d
   where d.sw_key = c.club_key
     and not exists (select 1 from card_current_club c2
                      where c2.card_id = c.card_id and c2.club_key = d.our_key);
  get diagnostics v_card = row_count;
  update card_current_club c set resolved_key = d.our_key from _dup d where d.sw_key = c.resolved_key;

  insert into club_manager (club_key, sw_mid, name, country, born_on, photo_url, seen_since, fetched_at)
  select d.our_key, g.sw_mid, g.name, g.country, g.born_on, g.photo_url, g.seen_since, g.fetched_at
    from club_manager g join _dup d on d.sw_key = g.club_key
  on conflict (club_key) do nothing;
  get diagnostics v_mgr = row_count;
  delete from club_manager g using _dup d where d.sw_key = g.club_key;
  delete from club_manager_spell s using _dup d where d.sw_key = s.club_key;

  -- Рейтинг пересобирается ночью целиком, поэтому дублёвый просто убираем.
  delete from club_rating r using _dup d where d.sw_key = r.club_key;
  get diagnostics v_rate = row_count;

  update soccerwiki_club k set club_key = d.our_key from _dup d where d.sw_key = k.club_key;

  delete from football_club f using _dup d where d.sw_key = f.club_key;
  get diagnostics v_club = row_count;

  return query select v_pairs, v_alias, v_squad, v_match, v_card, v_mgr, v_rate, v_club;
end;
$$;

comment on function public.merge_club_duplicates(boolean) is
  'Склеивает клубы-двойники Soccer Wiki с нашими по ПЕРЕСЕЧЕНИЮ СОСТАВОВ. '
  'p_apply = false — сухой прогон, только число пар.';

revoke all on function public.merge_club_duplicates(boolean) from public, anon, authenticated;
grant execute on function public.merge_club_duplicates(boolean) to service_role;
