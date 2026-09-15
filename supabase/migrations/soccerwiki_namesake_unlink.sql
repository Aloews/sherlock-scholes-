-- Однофамильцы Soccer Wiki: у карточки две привязки, клуб выбирался монеткой
-- ===========================================================================
--
-- СИМПТОМ, ВИДНЫЙ ИГРОКУ. На экране карточки стоит текущий клуб, и у легенд
-- он был чужой (замер на боевой базе 15.09.2026):
--
--   Тьерри Анри      известность 100  → São Paulo FC     (закончил в 2014)
--   Фернандо Торрес   97              → Patriotas Boyacá  (закончил в 2019)
--   Серхио Агуэро     96              → PSM Makassar      (закончил в 2021)
--   Патрик Виейра     96              → Betim Futebol     (закончил в 2011)
--   Алексис Санчес    93              → CF Montréal       (играет, но не там)
--
-- ⚠️ ПРИЧИНА НЕ В ТОМ, ЧТО ПРИВЯЗКА ОДНА И НЕВЕРНАЯ. У половины этих карточек
-- привязок ДВЕ, и верная среди них ЕСТЬ:
--
--   Мохаммед Салах    pid 52690  рейтинг 94  дата 1981-06-15 = дата карточки
--                     pid 136711 рейтинг 78  возраст 22, даты нет
--   Бруну Фернандеш   pid 64598  рейтинг 94  дата совпадает
--                     pid 164522 рейтинг 65  возраст 20, даты нет
--
-- А `fill_current_club_from_soccerwiki()` берёт ВСЕ строки с непустым card_id
-- и пишет `on conflict (card_id) do update` — то есть из двух клубов
-- побеждает тот, чья строка легла последней. Порядок ничем не задан, так что
-- клуб на экране выбирался подбрасыванием монеты, и ошибка была видна только
-- там, где однофамилец известен, а карточка знаменита.
--
-- Всего таких карточек 178, привязок у них ровно по две (больше не бывает).
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ — ДВЕ РАЗНЫЕ ВЕЩИ, И ВТОРАЯ ВАЖНЕЕ.
--
-- 1. Развязывает 43 карточки, где вопрос решён ДАТОЙ РОЖДЕНИЯ: одна строка
--    датирована и её дата совпадает с датой карточки, вторая даты не имеет.
--    Датированная — настоящий человек, недатированная — однофамилец.
--
--    Строка НЕ удаляется: у неё за спиной живой игрок, просто чужой. Гасится
--    только `card_id`, то есть связь с колодой.
--
-- 2. Учит сам шаг отказываться от догадки. Это чинит и те 135 карточек,
--    которые датой не решаются, и все будущие: при двух привязках без
--    подтверждения клуб НЕ пишется вовсе, а карточка остаётся на заявке
--    Transfermarkt, которую кладёт `rebuild_card_current_clubs()` до этого
--    шага. Тот же размен, что у гербов: чужой клуб хуже отсутствующего.
--
-- ЧЕГО ЭТА МИГРАЦИЯ НЕ ДЕЛАЕТ НАРОЧНО. Не трогает 7 карточек, где дата
-- датированной строки КОНФЛИКТУЕТ с датой карточки, и 50 одиночных привязок с
-- тем же конфликтом. Там неизвестно, чья дата неверна — в базе уже найдены
-- расхождения дат между Soccer Wiki и карточками, — а снимать связь по
-- неподтверждённому подозрению значит менять одну ошибку на другую.
-- ===========================================================================

begin;

-- ── 1. Развязать подтверждённых однофамильцев ────────────────────────────────
with pairs as (
  select card_id
    from soccerwiki_player
   where card_id is not null
   group by card_id
  having count(*) > 1
     and count(*) filter (where born_on is not null) = 1
),
confirmed as (
  -- Датированная строка подтверждена датой карточки — значит она настоящая.
  select p.card_id
    from pairs p
    join cards c on c.id = p.card_id
    join soccerwiki_player sw
      on sw.card_id = p.card_id and sw.born_on is not null
   where c.born_on is not null and c.born_on = sw.born_on
)
update soccerwiki_player sw
   set card_id = null
  from confirmed
 where sw.card_id = confirmed.card_id
   and sw.born_on is null;

-- Клуб, выставленный проигравшей строкой, снимается: пересборка ниже положит
-- верный. Трогаем только строки Soccer Wiki — заявка Transfermarkt и статья
-- кладутся другими шагами и к этой ошибке отношения не имеют.
delete from card_current_club cc
 where cc.source = 'soccerwiki'
   and not exists (select 1 from soccerwiki_player sw
                    where sw.card_id = cc.card_id);

commit;

-- ── 2. Шаг перестаёт угадывать при неоднозначности ───────────────────────────
drop function if exists public.fill_current_club_from_soccerwiki();

create or replace function public.fill_current_club_from_soccerwiki()
returns table (записано integer, сменили_клуб integer, отказано_неоднозначных integer)
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare v_all int; v_moved int; v_skipped int;
begin
  -- ⚠️ ОДНА ПРИВЯЗКА НА КАРТОЧКУ, ИНАЧЕ НИ ОДНОЙ. Прежняя версия брала все
  -- строки и писала `on conflict do update`: при двух привязках выигрывала
  -- та, что легла последней, и клуб на экране выбирался порядком строк.
  -- Именно так у Тьерри Анри оказался «São Paulo FC».
  --
  -- Неоднозначность разрешается ДАТОЙ РОЖДЕНИЯ, а не рейтингом и не
  -- возрастом: рейтинг у известных карточек в среднем 89.2, но при
  -- известности ниже сорока у 425 карточек он ниже 80 и это норма — порог по
  -- нему резал бы живых. Дата либо подтверждает человека, либо нет.
  create temporary table _sw on commit drop as
  with linked as (
    select p.card_id, p.club_id, p.born_on,
           count(*)      over (partition by p.card_id) as links,
           -- Подтверждённая дата поднимает строку на первое место.
           row_number() over (
             partition by p.card_id
             order by (c.born_on is not null and p.born_on = c.born_on) desc,
                      p.born_on nulls last, p.pid) as rn
      from soccerwiki_player p
      join cards c on c.id = p.card_id
     where p.card_id is not null
  )
  select l.card_id, k.club_key, k.name as club_name
    from linked l
    join soccerwiki_club k on k.club_id = l.club_id
   where l.rn = 1
     -- Одна привязка — берём. Несколько — только если ПЕРВАЯ подтверждена
     -- датой карточки; иначе карточка остаётся на заявке Transfermarkt.
     and (l.links = 1 or l.born_on is not null)
     -- Клуб обязан существовать: ссылка на удалённую строку хуже отсутствия
     -- ссылки — экран показывает пустоту там, где был клуб.
     and exists (select 1 from football_club f where f.club_key = k.club_key);

  select count(distinct p.card_id) into v_skipped
    from soccerwiki_player p
   where p.card_id is not null
     and not exists (select 1 from _sw s where s.card_id = p.card_id);

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
  return query select v_all, v_moved, v_skipped;
end;
$$;

comment on function public.fill_current_club_from_soccerwiki() is
  'Текущий клуб из Soccer Wiki. При двух привязках на карточку берёт только '
  'подтверждённую датой рождения; неподтверждённую неоднозначность ПРОПУСКАЕТ, '
  'оставляя карточку на заявке Transfermarkt. Стоимость — по-прежнему TM.';

revoke all on function public.fill_current_club_from_soccerwiki() from public, anon, authenticated;
grant execute on function public.fill_current_club_from_soccerwiki() to service_role;

-- ── 3. Четыре легенды, у которых привязка ОДНА и она чужая ───────────────────
--
-- Датой их не решить: ни у строки Soccer Wiki, ни у карточки даты нет, и
-- второй строки для сверки тоже нет. Решено глазами по совокупности признаков
-- (правило и разбор — `football_scraper/legend_guard.py`):
--
--   pid 146273  «Thierry Henry»   19 лет, рейтинг 65 — São Paulo FC
--   pid 173275  «Fernando Torres» 22 года, рейтинг 70 — Patriotas Boyacá
--   pid  65279  «Patrick Vieira»  35 лет, рейтинг 75 — Betim Futebol
--   pid 141243  «Sergio Agüero»   32 года, рейтинг 76 — PSM Makassar
--
-- ⚠️ ФОРМАЛЬНЫЙ ОТБОР ЛОВИЛ ШЕСТЬ, И ДВОЕ ИЗ НИХ ЖИВЫЕ. Ёитиро Какитани (36,
-- «Tokushima Vortis») и Энди Кэрролл (37, «Dagenham & Redbridge») подходят под
-- те же признаки и играют по-настоящему. Поэтому правило названо ПОДОЗРЕНИЕМ,
-- а не приговором, снимают связь глазами, и оба они в тестах стоят
-- отрицательными контролями.
update soccerwiki_player set card_id = null
 where pid in (146273, 173275, 65279, 141243);

delete from card_current_club cc
 where cc.source = 'soccerwiki'
   and not exists (select 1 from soccerwiki_player sw where sw.card_id = cc.card_id);
