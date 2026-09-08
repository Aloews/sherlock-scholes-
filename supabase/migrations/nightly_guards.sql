-- Ночные шаги не должны стирать то, что собрали другие.
-- ===========================================================================
--
-- Владелец: «возможно старые парсеры удаляют дубли и стирают новую
-- информацию, проверь чтобы они не конфликтовали».
--
-- Обход всех ночных функций дал две настоящие беды и одну ложную тревогу.
--
-- 1. `rebuild_club_ratings` НАЧИНАЕТСЯ С `delete from club_rating`, И
--    ПРЕДОХРАНИТЕЛЯ У НЕЁ НЕТ. Одна ночь без матчей — таблица пустеет молча.
--    Раньше это было полбеды, теперь на `club_rating.level` держится порядок
--    всего списка команд (см. club_directory_by_strength.sql), и пустая
--    таблица разваливает экран.
--
--    ⚠️ ПРОВЕРКА ПОСЛЕ, А НЕ ДО, И ЭТО НЕ НЕДОСМОТР. Узнать, сколько строк
--    получится, можно только собрав их. Исключение откатывает ВСЮ транзакцию
--    вызова, то есть и удаление тоже: прежние рейтинги остаются нетронутыми.
--    Тот же приём уже стоял в `rebuild_player_levels` — здесь его не было.
--
-- 2. `link_soccerwiki_cards` СВЯЗЫВАЛА КАРТОЧКУ С ИГРОКОМ ПО ОДНОМУ ИМЕНИ.
--    Однофамильцев имя не различает по построению: у них оно буква в букву.
--    Живой пример — карточка Бруну Фернандеша, связанная и с pid 64598
--    «Manchester United» (дата 1994-09-08 совпадает), и с pid 164522
--    «Sheffield Wednesday» (даты нет вовсе): экран называл вторым.
--    Теперь известны обе даты и они разошлись — связывать нельзя.
--
-- 3. ЛОЖНАЯ ТРЕВОГА, И ЕЁ СТОИТ ЗАПИСАТЬ, ЧТОБЫ НЕ ИСКАТЬ ЗАНОВО.
--    `rebuild_card_current_clubs` тоже начинается с удаления, но удаляет
--    ТОЛЬКО СВОИ строки — `source in ('career_stats','legend_career')` — и
--    никогда не трогает собранные заявки и Soccer Wiki. Конфликта нет.
--
-- Расписание после правки (`cron.job` 17):
--   35 6 * * *  select rebuild_league_seasons(); select rebuild_club_ratings_guarded()

create or replace function public.rebuild_club_ratings_guarded()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare v_was integer; v_now integer;
begin
  select count(*) into v_was from club_rating;
  perform public.rebuild_club_ratings();
  select count(*) into v_now from club_rating;

  if v_was >= 100 and v_now < v_was / 2 then
    raise exception 'пересборка рейтингов клубов дала % строк вместо % — это поломка источника, а не ночь без матчей; прежние рейтинги сохранены',
                    v_now, v_was;
  end if;
  return v_now;
end;
$$;

revoke all on function public.rebuild_club_ratings_guarded() from public, anon, authenticated;
grant execute on function public.rebuild_club_ratings_guarded() to service_role;

create or replace function public.link_soccerwiki_cards()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '240s' as $$
declare
  v_linked integer := 0;
begin
  with cand as (
    select p.pid, c.id as card_id
      from soccerwiki_player p
      join soccerwiki_club sc on sc.club_id = p.club_id
      join card_current_club cc on cc.resolved_key = sc.club_key
      join cards c on c.id = cc.card_id
     where p.card_id is null
       and c.active and c.name_en is not null
       and lower(btrim(c.name_en)) = lower(btrim(p.name))
       -- ⚠️ ДАТА РОЖДЕНИЯ РЕШАЕТ, А НЕ ИМЯ. См. шапку файла: Бруну Фернандеш
       -- и его однофамилец из «Шеффилд Уэнсдей». Известны обе даты и они
       -- разошлись — это чужой человек. Неизвестна хотя бы одна — связываем,
       -- но проверка уникальности ниже не даст взять двоих.
       and (p.born_on is null or c.born_on is null or p.born_on = c.born_on)
  ),
  clean as (
    select d.* from cand d
     where 1 = (select count(*) from cand x where x.pid = d.pid)
       and 1 = (select count(*) from cand y where y.card_id = d.card_id)
       and not exists (select 1 from soccerwiki_player p2 where p2.card_id = d.card_id)
  ),
  upd as (
    update soccerwiki_player p set card_id = k.card_id
      from clean k where p.pid = k.pid and p.card_id is null
    returning 1
  )
  select count(*) into v_linked from upd;

  return v_linked;
end;
$$;

comment on function public.link_soccerwiki_cards() is
  'Связывает карточку с игроком Soccer Wiki по имени И ДАТЕ РОЖДЕНИЯ. Имя однофамильцев не различает.';

revoke all on function public.link_soccerwiki_cards() from public, anon, authenticated;
grant execute on function public.link_soccerwiki_cards() to service_role;

-- Расписание: ночью зовётся защищённая обёртка, а не голая пересборка.
select cron.alter_job(17,
  command => 'select public.rebuild_league_seasons(); select public.rebuild_club_ratings_guarded()');
