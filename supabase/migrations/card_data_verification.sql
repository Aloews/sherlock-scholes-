-- Сведение источников в карточку и перепроверка данных ВСЕХ карточек.
--
-- Владелец: «нужно установить тесты на проверки данных всех карточек и
-- перепроверку каждые 2 месяца». Повод — карточка Леона Классена: в прогнозах
-- «Спартак», хотя два года как в другом клубе, и это заметили проверяющие
-- люди, а не мы. Замер 06.09.2026: 618 карточек с тем же расхождением.
--
-- ПРИЧИНА КЛАССА. Открытый период карьеры из статьи («2022–») не умеет
-- устаревать: у него нет способа сказать «он больше здесь не играет». А заявка
-- клуба снята со страницы клуба на дату и связана идентификатором. Поэтому
-- порядок доверия теперь: заявка Transfermarkt → Soccer Wiki → статья.
--
-- Определения ВЫГРУЖЕНЫ ИЗ ПРОДА (pg_get_functiondef), а не перепечатаны:
-- перепечатка исходника уже портила этот проект однажды.

CREATE OR REPLACE FUNCTION public.add_clubs_from_soccerwiki()
 RETURNS TABLE(created integer, matched integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_created integer := 0;
  v_matched integer := 0;
begin
  -- ⚠️ БЕЗ ЭТОГО ШАГА ЦЕПОЧКА РВЁТСЯ НА ПОСЛЕДНЕМ ЗВЕНЕ. Состав Soccer Wiki
  -- связывается с карточкой, но клуб карточке не ставится, если такого клуба
  -- нет в НАШЕМ справочнике: `club_key` остаётся NULL. Поймано на живой
  -- карточке: Леон Классен связан с игроком «Grazer AK», а «Grazer AK» в
  -- `football_club` отсутствует вовсе — и карточка осталась без клуба, тогда
  -- как в прогнозах у неё стоял «Спартак» из устаревшей статьи.
  --
  -- Заводим клуб, только если его действительно нет: ключ считает
  -- `resolve_club_key`, словарь псевдонимов у базы, второй копии нет.
  with cand as (
    select sc.club_id, btrim(sc.name) as name, sc.country_code,
           resolve_club_key(sc.name, null) as key
      from soccerwiki_club sc
     where sc.club_key is null and coalesce(btrim(sc.name), '') <> ''
  ),
  missing as (
    select distinct on (key) key, name, country_code
      from cand
     where key is not null
       and not exists (select 1 from football_club fc where fc.club_key = cand.key)
     order by key, name
  ),
  ins as (
    insert into football_club (club_key, name, name_en, kind)
    select m.key, m.name, m.name, 'club' from missing m
    returning 1
  )
  select count(*) into v_created from ins;

  -- Дописать ключ тем строкам Soccer Wiki, для которых клуб теперь есть.
  with upd as (
    update soccerwiki_club sc
       set club_key = fc.club_key
      from football_club fc
     where sc.club_key is null
       and fc.club_key = resolve_club_key(sc.name, null)
    returning 1
  )
  select count(*) into v_matched from upd;

  return query select v_created, v_matched;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.card_club_conflicts()
 RETURNS TABLE(card_id uuid, name_en text, article_club text, squad_club text, squad_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with article as (
    select c.id as card_id, c.name_en,
           e->>'club' as art_club, club_match_key(e->>'club') as art_key
      from cards c cross join lateral jsonb_array_elements(c.career_stats) e
     where c.active and c.category = 'player'
       and jsonb_typeof(c.career_stats) = 'array'
       and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
  ),
  squad as (
    select r.card_id, r.club_key as sq_key, 'club_roster'::text as src
      from club_roster r where r.card_id is not null
    union
    select sp.card_id, sc.club_key, 'soccerwiki'::text
      from soccerwiki_player sp
      join soccerwiki_club sc on sc.club_id = sp.club_id
     where sp.card_id is not null and sc.club_key is not null
  )
  select distinct a.card_id, a.name_en, a.art_club, s.sq_key, s.src
    from article a
    join squad s on s.card_id = a.card_id
   where a.art_key is distinct from s.sq_key;
$function$
;

CREATE OR REPLACE FUNCTION public.fill_current_club_from_roster()
 RETURNS TABLE(written integer, ambiguous integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_written integer := 0;
  v_amb     integer := 0;
begin
  -- ⚠️ ИГРОК В ДВУХ ЗАЯВКАХ — ЭТО ПОЧТИ ВСЕГДА КЛУБ И СБОРНАЯ, А НЕ АРЕНДА.
  -- Прежнее правило отказывалось выбирать и оставляло карточку без клуба —
  -- а на её месте в прогнозах оставался клуб из УСТАРЕВШЕЙ статьи. Так Педри
  -- значился в «Барселоне» из статьи, потому что заявок у него две:
  -- «Барселона» и «Испания».
  --
  -- Отличить сборную структурно нечем, и это проверено: у сборных есть и
  -- герб, и id на Transfermarkt, и пустые лига со страной — ровно как у сотен
  -- настоящих клубов. Зато отличает ПОВЕДЕНИЕ СОСТАВА:
  --
  --     Англия, Испания, Франция  100% игроков состоят ещё где-то
  --     «Арсенал»                  38%,  «Реал»  19%,  «Челси» 18%
  --
  -- То есть у клуба большинство игроков — только его, у сборной таких нет ни
  -- одного. Побеждает команда, для которой БОЛЬШЕ игроков не имеют другой.
  create temp table _sole on commit drop as
  select r.club_key,
         count(*) filter (
           where not exists (select 1 from club_roster r2
                              where r2.card_id = r.card_id
                                and r2.club_key <> r.club_key)) as sole_players
    from club_roster r
   where r.card_id is not null
   group by r.club_key;

  create index on _sole (club_key);

  create temp table _rc on commit drop as
  select distinct on (r.card_id) r.card_id, r.club_key,
         count(*) over (partition by r.card_id) as clubs
    from club_roster r
    left join pg_temp._sole s on s.club_key = r.club_key
   where r.card_id is not null
   order by r.card_id, coalesce(s.sole_players, 0) desc, r.club_key;

  -- Неоднозначным считается только то, что не развела и эта мера: две
  -- команды с ОДИНАКОВЫМ числом «только наших» игроков.
  select count(*) into v_amb
    from (select r.card_id
            from club_roster r
            left join pg_temp._sole s on s.club_key = r.club_key
           where r.card_id is not null
           group by r.card_id
          having count(distinct r.club_key) > 1
             and count(distinct coalesce(s.sole_players, 0)) = 1) z;

  with src as (
    select c.card_id, c.club_key, coalesce(fc.name, fc.name_en, c.club_key) as club
      from pg_temp._rc c
      join football_club fc on fc.club_key = c.club_key
  ),
  ins as (
    insert into card_current_club (card_id, club, club_key, source, fetched_at)
    select s.card_id, s.club, s.club_key, 'club_roster', now() from src s
    on conflict (card_id) do update
       set club = excluded.club, club_key = excluded.club_key,
           source = excluded.source, fetched_at = now()
     -- Статью перебиваем: у открытого периода «2022–» нет способа устареть.
     where card_current_club.source is distinct from 'club_roster'
        or card_current_club.club_key is distinct from excluded.club_key
    returning 1
  )
  select count(*) into v_written from ins;

  return query select v_written, v_amb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fill_current_club_from_soccerwiki()
 RETURNS TABLE(written integer, ambiguous integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_written integer := 0;
  v_amb     integer := 0;
begin
  create temp table _sw on commit drop as
  select p.card_id, min(sc.club_key) as club_key, count(distinct sc.club_key) as clubs
    from soccerwiki_player p
    join soccerwiki_club sc on sc.club_id = p.club_id
   where p.card_id is not null and sc.club_key is not null
   group by p.card_id;

  select count(*) into v_amb from pg_temp._sw where clubs > 1;

  with src as (
    select s.card_id, s.club_key, coalesce(fc.name, fc.name_en, s.club_key) as club
      from pg_temp._sw s
      join football_club fc on fc.club_key = s.club_key
     where s.clubs = 1
  ),
  ins as (
    insert into card_current_club (card_id, club, club_key, source, fetched_at)
    select s.card_id, s.club, s.club_key, 'soccerwiki', now() from src s
    on conflict (card_id) do update
       set club = excluded.club, club_key = excluded.club_key,
           source = excluded.source, fetched_at = now()
     -- Заявка клуба (club_roster) остаётся главнее: она с идентификатором и
     -- с ценой. Статью же перебиваем — см. fill_current_club_from_roster.
     where card_current_club.source not in ('club_roster', 'soccerwiki')
    returning 1
  )
  select count(*) into v_written from ins;

  drop table pg_temp._sw;
  return query select v_written, v_amb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.link_soccerwiki_by_name()
 RETURNS TABLE(linked integer, ambiguous integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_linked integer := 0;
  v_amb    integer := 0;
begin
  create temp table _pair on commit drop as
  with sw as (
    select lower(btrim(p.name)) as key, p.pid
      from soccerwiki_player p where p.card_id is null
  ),
  sw1 as (select key, min(pid) as pid from sw group by key having count(*) = 1),
  ck as (
    select lower(btrim(c.name_en)) as key, c.id
      from cards c
     where c.active and c.category = 'player' and c.name_en is not null
  ),
  -- min() у uuid нет; берём единственный id тем же условием «ровно один».
  ck1 as (select key, (array_agg(id))[1] as card_id from ck group by key having count(*) = 1)
  select sw1.pid, ck1.card_id from sw1 join ck1 on ck1.key = sw1.key;

  with upd as (
    update soccerwiki_player p set card_id = k.card_id
      from pg_temp._pair k where p.pid = k.pid and p.card_id is null
    returning 1
  )
  select count(*) into v_linked from upd;

  select count(*) into v_amb
    from (select lower(btrim(name)) k from soccerwiki_player where card_id is null
          group by 1 having count(*) > 1) z;

  drop table pg_temp._pair;
  return query select v_linked, v_amb;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rebuild_card_current_clubs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  with open_ranges as (
    select c.id as card_id, e->>'club' as club, (e->>'apps')::int as apps,
           'career_stats' as source
    from cards c cross join lateral jsonb_array_elements(c.career_stats) e
    where c.category = 'player' and jsonb_typeof(c.career_stats) = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
    union all
    select c.id, e->>'club', null::int, 'legend_career'
    from cards c cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
    where c.category = 'player' and jsonb_typeof(c.legend_career->'clubs') = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
  ),
  best as (
    select distinct on (card_id) card_id, club, apps, source
    from open_ranges where club_match_key(club) is not null
    order by card_id, apps desc nulls last, (source = 'career_stats') desc
  )
  insert into card_current_club (card_id, club, club_key, apps, source, fetched_at)
  select card_id, club, club_match_key(club), apps, source, now()
  from best
  on conflict (card_id) do update set
    club       = excluded.club,
    club_key   = excluded.club_key,
    apps       = excluded.apps,
    source     = excluded.source,
    fetched_at = excluded.fetched_at
  -- ⚠️ ЗАЯВКА ГЛАВНЕЕ СТАТЬИ, И ЭТО ГЛАВНОЕ УСЛОВИЕ ЭТОЙ ФУНКЦИИ.
  -- `club_roster` связан с карточкой ИДЕНТИФИКАТОРОМ (id на Transfermarkt /
  -- QID) и снят со страницы клуба на дату. Статья же обновляется, когда до
  -- неё дойдут руки, и у неё нет способа сказать «он больше здесь не играет»:
  -- открытый период «2022–» остаётся открытым навсегда.
  --
  -- Замер 06.09.2026: 391 карточка, где открытый период статьи называет НЕ
  -- ТОТ клуб, что собранная заявка. Одну из них владелец увидел в проде —
  -- Леон Классен показывался в «Спартаке», хотя два года как не там, и
  -- проверяющие люди сказали об этом прямо. Он попал так и в ПРОГНОЗЫ.
  where card_current_club.source is distinct from 'club_roster';

  get diagnostics v_count = row_count;

  -- Убираем только своё: строки, собранные из заявок, не трогаем.
  delete from card_current_club cc
   where cc.source in ('career_stats', 'legend_career')
     and not exists (
     select 1 from cards c cross join lateral jsonb_array_elements(c.career_stats) e
      where c.id = cc.card_id and jsonb_typeof(c.career_stats) = 'array'
        and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$')
     and not exists (
     select 1 from cards c cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
      where c.id = cc.card_id and jsonb_typeof(c.legend_career->'clubs') = 'array'
        and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$');

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_card_data()
 RETURNS TABLE(step text, n integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v integer;
begin
  -- ⚠️ ПОРЯДОК ЗДЕСЬ — ЧАСТЬ ПРАВИЛА, А НЕ ОФОРМЛЕНИЕ.
  --   1) завести клубы источника, иначе состав есть, а клуба у карточки нет
  --      (на этом застрял Леон Классен: «Grazer AK» не было в справочнике);
  --   2) связать игроков источника с карточками;
  --   3) клуб из заявки Transfermarkt — она с идентификатором и с ценой;
  --   4) клуб из Soccer Wiki — там, где заявки нет.
  -- Статью перебивают оба: у открытого периода «2022–» нет способа устареть.
  select created into v from add_clubs_from_soccerwiki();
  step := 'клубов заведено'; n := v; return next;

  select linked into v from link_soccerwiki_by_name();
  step := 'игроков связано'; n := v; return next;

  select written into v from fill_current_club_from_roster();
  step := 'клуб из заявки'; n := v; return next;

  select written into v from fill_current_club_from_soccerwiki();
  step := 'клуб из Soccer Wiki'; n := v; return next;

  select count(*)::integer into v from card_club_conflicts();
  step := 'расхождений осталось'; n := v; return next;
end;
$function$
;

-- Ночью, ПОСЛЕ пересборки из статьи (06:10) — чтобы собранное имело последнее
-- слово. И раз в два месяца — полная перепроверка.
select cron.schedule('verify-card-data-nightly', '30 6 * * *',
                     $$select public.verify_card_data()$$);
select cron.schedule('verify-card-data-bimonthly', '0 4 1 */2 *',
                     $$select public.verify_card_data()$$);
