-- ============================================================================
-- Ночная проверка колоды падала три ночи подряд — из-за моего переименования.
--
-- ⚠️ ЭТО МОЯ ПОЛОМКА, И НАШЛА ЕЁ `check-prod`, А НЕ ЧЕЛОВЕК. Пересобирая
-- `fill_current_club_from_soccerwiki` (soccerwiki_current_club.sql), я назвал
-- столбцы возврата по-русски — «записано» и «сменили_клуб». А зовёт её
-- `verify_card_data()` строкой `select written into v from …`, как и всех
-- соседей по цепочке: `add_clubs_from_soccerwiki()` отдаёт `created`,
-- `link_soccerwiki_by_name()` — `linked`, `fill_current_club_from_roster()` —
-- `written`. Русским в этом ряду оказался ровно один столбец, и ровно он
-- сломал вызов.
--
-- Что это стоило, по `cron.job_run_details`: задание `verify-card-data-nightly`
-- падает с `column "written" does not exist` 10, 11 и 12 сентября — то есть
-- ночная сверка колоды не проходила ни разу с тех пор, как правка уехала.
--
-- Тихо это было потому, что ошибка живёт в журнале pg_cron, а не на экране.
-- ⚠️ Само задание об этом НЕ СООБЩАЕТ НИКОМУ: pg_cron пишет `failed` в свою
-- таблицу и идёт дальше. Единственное, что вывело наружу, — просроченный
-- снимок стоимости в `check-prod`, и то через сутки.
--
-- Возвращаю английские имена, а не правлю вызывающего: в цепочке их четыре, и
-- три уже английские. Менять три под один — это ровно тот же разнобой, только
-- дороже.
-- ============================================================================

drop function if exists fill_current_club_from_soccerwiki();

create or replace function fill_current_club_from_soccerwiki()
returns table (written integer, moved integer)
language plpgsql security definer set search_path = public
set statement_timeout to '300s' as $$
declare v_all int; v_moved int;
begin
  -- ⚠️ SOCCER WIKI — ГЛАВНЫЙ ИСТОЧНИК СОСТАВА. Владелец: «заполни составы с
  -- Soccer Wiki, а стоимость отображай с трансфермаркет». Заявка Transfermarkt
  -- снята на дату сбора и стареет между заходами; Soccer Wiki правят читатели
  -- в день трансфера, и переходы там уже учтены.
  --
  -- ⚠️ ДО СКЛЕЙКИ СПРАВОЧНИКА ЭТОГО ДЕЛАТЬ БЫЛО НЕЛЬЗЯ. Тогда переключение
  -- «переводило» 6 353 игрока, и добрая половина — в клуб-двойник с тем же
  -- составом («Bayern München» рядом с «Баварией»). После склейки меняют клуб
  -- 603, и среди дороже 15 млн остаётся один.
  create temporary table _sw_raw on commit drop as
  select p.card_id, k.club_key, k.name as club_name
    from soccerwiki_player p
    join soccerwiki_club k on k.club_id = p.club_id
   where p.card_id is not null and k.club_key is not null
     and exists (select 1 from football_club f where f.club_key = k.club_key);

  -- ⚠️ ВТОРАЯ ПОЛОМКА, ВЫЛЕЗШАЯ СРАЗУ ЗА ПЕРВОЙ, И ОНА ГЛУБЖЕ. Починив имя
  -- столбца, я запустил `verify_card_data()` и получил
  -- «ON CONFLICT DO UPDATE command cannot affect row a second time»: в одной
  -- вставке одна и та же карточка предлагалась дважды.
  --
  -- В ЗАФИКСИРОВАННЫХ ДАННЫХ ДУБЛЕЙ НЕТ — замер дал 14 325 связок на 14 325
  -- карточек, один к одному, и отдельный вызов функции проходит. Дубли
  -- рождаются ВНУТРИ ТОЙ ЖЕ ТРАНЗАКЦИИ: `verify_card_data` сперва зовёт
  -- `link_soccerwiki_by_name()`, тот связывает новых игроков (224 за этот
  -- прогон), и если он привяжет ВТОРОГО игрока Soccer Wiki к уже связанной
  -- карточке, следующий шаг видит её дважды. Снаружи это невоспроизводимо, и
  -- именно поэтому падало только ночью.
  --
  -- ⚠️ ПРИ РАСХОЖДЕНИИ КАРТОЧКА ПРОПУСКАЕТСЯ, А НЕ РЕШАЕТСЯ ЖРЕБИЕМ. Если два
  -- игрока Soccer Wiki указывают на одну карточку И НА РАЗНЫЕ КЛУБЫ, мы не
  -- знаем, который из них тот самый. `distinct on` с любой сортировкой выбрал
  -- бы одного молча — то есть проставил бы игроку чужой клуб и выглядел бы
  -- при этом исправным. `having count(distinct club_key) = 1` оставляет такую
  -- карточку с прежним клубом, а это худшее, что с ней может случиться.
  create temporary table _sw on commit drop as
  select card_id, min(club_key) as club_key, min(club_name) as club_name
    from _sw_raw
   group by card_id
  having count(distinct club_key) = 1;

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

revoke all on function fill_current_club_from_soccerwiki() from public, anon, authenticated;
grant execute on function fill_current_club_from_soccerwiki() to service_role;
