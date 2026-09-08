-- Составы — с Soccer Wiki, стоимость — с Transfermarkt.
-- ===========================================================================
--
-- Владелец: «заполни составы с Soccer Wiki, а стоимость отображай с
-- трансфермаркет. Другие метрики, как просмотры в вики и рейтинг Soccer Wiki
-- не используем, только в карточке игрока».
--
-- ПОЧЕМУ SOCCER WIKI ГЛАВНЫЙ ПО СОСТАВУ. Заявка Transfermarkt снята на дату
-- сбора и стареет между заходами; Soccer Wiki правят читатели в день
-- трансфера, и переходы там уже учтены. Это и был исходный симптом: «у тебя
-- после игры в Элиас написано, что Гарначо в Челси, а он уже перешёл».
--
-- ⚠️ ДО СКЛЕЙКИ СПРАВОЧНИКА ЭТОГО ДЕЛАТЬ БЫЛО НЕЛЬЗЯ, И ЭТО ИЗМЕРЕНО.
-- Тогда переключение «переводило» 6 353 игрока, и добрая половина — в
-- клуб-двойник с тем же составом («Bayern München» рядом с «Баварией»).
-- После склейки (club_merge.sql, club_merge_fixture_stubs.sql) клуб меняют
-- 603, и среди дороже 15 млн остаётся ровно один. Порядок шагов здесь не
-- вкусовщина: сперва склейка, потом источник.
--
-- ⚠️ СТОИМОСТЬ ПО-ПРЕЖНЕМУ TRANSFERMARKT, И ЭТО НЕ ПРОТИВОРЕЧИЕ. Soccer Wiki
-- цен не публикует вовсе; она отвечает на вопрос «кто сейчас в клубе», а не
-- «сколько он стоит». Источник назван на экране рядом с числом.
--
-- После применения: soccerwiki 14 317 строк против 10 245 из заявки TM —
-- источник стал главным по объёму, а не только по правилу.

drop function if exists public.fill_current_club_from_soccerwiki();

create or replace function public.fill_current_club_from_soccerwiki()
returns table (записано integer, сменили_клуб integer)
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare v_all int; v_moved int;
begin
  create temporary table _sw on commit drop as
  select p.card_id, k.club_key, k.name as club_name
    from soccerwiki_player p
    join soccerwiki_club k on k.club_id = p.club_id
   where p.card_id is not null and k.club_key is not null
     -- Клуб обязан существовать: ссылка на удалённую строку хуже отсутствия
     -- ссылки — экран показывает пустоту там, где был клуб.
     and exists (select 1 from football_club f where f.club_key = k.club_key);

  select count(*) into v_moved
    from _sw s join card_current_club cc on cc.card_id = s.card_id
   where cc.club_key <> s.club_key;

  insert into card_current_club (card_id, club, club_key, resolved_key, apps, source, fetched_at)
  select s.card_id, s.club_name, s.club_key, s.club_key, null, 'soccerwiki', now()
    from _sw s
  on conflict (card_id) do update set
    club = excluded.club,
    club_key = excluded.club_key,
    resolved_key = excluded.resolved_key,
    source = 'soccerwiki',
    fetched_at = now();

  get diagnostics v_all = row_count;
  return query select v_all, v_moved;
end;
$$;

comment on function public.fill_current_club_from_soccerwiki() is
  'Текущий клуб из Soccer Wiki — главный источник состава. Transfermarkt остаётся источником СТОИМОСТИ.';

revoke all on function public.fill_current_club_from_soccerwiki() from public, anon, authenticated;
grant execute on function public.fill_current_club_from_soccerwiki() to service_role;

-- ⚠️ ПОРЯДОК В НОЧНОМ ШАГЕ ВАЖЕН: сперва статья (она не трогает строки с
-- source in ('club_roster','soccerwiki')), потом Soccer Wiki поверх.
select cron.alter_job(2, command =>
  'select public.rebuild_card_current_clubs(); select public.fill_current_club_from_soccerwiki()');
