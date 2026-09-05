-- ===========================================================================
-- Эмблемы ESPN: ключ считается ОДИН раз на имя, неоднозначность — отказ.
--
-- Этот файл ЗАМЕНЯЕТ сопоставление из supabase/migrations/apply_espn_crests.sql.
-- Применять тот поверх этого — значит вернуть обе поломки ниже.
--
-- ⚠️ ПОЛОМКА 1: ПРОГОН ПАДАЛ ЦЕЛИКОМ, И ЭТО НЕ ВИДНО БЫЛО НИКОМУ.
-- `apply_espn_crests` соединяла список ESPN со справочником по
-- `club_match_key(f.name) = club_match_key(s.espn_name)` — функция на ОБЕИХ
-- сторонах, значит индекс не применим, значит вложенный цикл: 1696 клубов ×
-- 1814 имён = три миллиона вызовов нормализатора плюс столько же проб
-- `club_alias`. Замер 04.09.2026 на боевом: пачка в 200 имён — 57014
-- statement timeout, пачка в 1814 — то же самое. То есть ночной шаг,
-- добавленный в daily-enrich.yml, упал бы КАЖДУЮ ночь, а в логе это выглядит
-- как одна строка про 500.
-- Лечится тем же приёмом, что уже записан в docs/MAP.md для
-- `fixture_team_rating`: ключ считается один раз на строку в `as materialized`
-- CTE, дальше обычное соединение по равенству. Замер после: **1.5 с** на все
-- 1814 имён против таймаута.
--
-- ⚠️ ПОЛОМКА 2: «ПОБЕЖДАЕТ САМОЕ КОРОТКОЕ ИМЯ» ОШИБАЛОСЬ ЦЕЛИКОМ.
-- Прежний `order by length(s.espn_name)` выбирал из нескольких кандидатов
-- самое короткое имя. Найдено ГЛАЗАМИ в предпросмотре: наш «Vitória S.C.»
-- (Гимарайнш, Португалия) получал герб ESPN-команды «Vitória» — это EC
-- Vitória из Салвадора, другой клуб в другой стране; верный лежит рядом под
-- именем «Vitória de Guimaraes». Короткое имя не «более общее», оно ЧУЖОЕ.
-- Теперь: больше одной РАЗНОЙ эмблемы на клуб — не берём ни одной, а
-- `espn_crest_ambiguous` показывает, какие именно отброшены. Пропуск виден в
-- отчёте, чужой герб на экране — нет.
--
-- ⚠️ ПОПРАВКА К ОБЕЩАНИЮ «587 КЛУБОВ ЗАКРОЮТСЯ САМИ». Не закроются, и вот
-- замер 04.09.2026 после боевого прогона (1814 команд у ESPN, 218 лиг):
--
--     клубов без эмблемы                       610
--     получили эмблему из ESPN                  30   (29 автоматом + 1 руками)
--     осталось без                             580
--       из них с name_en                        42
--       из них с латинским name                 24
--       ТОЛЬКО КИРИЛЛИЦА, name_en нет          514
--
-- Соединять 514 не с чем: `club_match_key` на кириллице отдаёт NULL, а
-- `club_norm_key` транслитерирует — и обратно не сходится, потому что имя
-- уже один раз транслитерировали В русский: «Аль-Айн» → `al ayn` против
-- ESPN `al ain`, «Адмира Ваккер» → `admira vakker` против `admira wacker`.
-- Проба сопоставления через `club_norm_key` с обеих сторон дала **0**
-- совпадений — это измерено, а не предположено.
--
-- Значит, ESPN тут ни при чём, и «взять другой источник эмблем» не поможет:
-- у этих клубов НЕТ латинского имени, по которому их можно узнать в любом
-- иностранном источнике. Настоящий следующий шаг — проставить им `name_en`
-- (резолв статьи клуба даёт английский sitelink), и это отдельная работа.
--
-- Гранты перечислены явно; только service_role — это запись в справочник.
-- ===========================================================================

drop function if exists public.preview_espn_crests(jsonb);
drop function if exists public.espn_crest_matches(jsonb);

-- Отбор — ОДИН, и его же читают предпросмотр и запись. Две копии правила
-- разошлись бы молча, и предпросмотр перестал бы что-либо доказывать.
create function public.espn_crest_matches(p_rows jsonb)
returns table (club_key text, club_name text, club_name_en text,
               espn_name text, logo text)
language sql stable security definer set search_path = public as $$
  with src as materialized (
    select distinct on (r->>'espn_name')
           r->>'espn_name'                as espn_name,
           r->>'logo'                     as logo,
           club_match_key(r->>'espn_name') as mkey,
           club_norm_key(r->>'espn_name')  as nkey
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'espn_name', '') <> ''
       and coalesce(r->>'logo', '') <> ''
  ),
  fc as materialized (
    select f.club_key, f.name, f.name_en,
           club_match_key(f.name_en) as mkey_en,
           club_match_key(f.name)    as mkey_ru
      from football_club f
     where f.kind = 'club' and f.crest_url is null
  ),
  hits as (
    select fc.club_key, fc.name, fc.name_en, s.espn_name, s.logo
      from fc join src s on s.mkey is not null
                        and (s.mkey = fc.mkey_en or s.mkey = fc.mkey_ru)
    union
    select fc.club_key, fc.name, fc.name_en, s.espn_name, s.logo
      from fc
      join club_alias a on a.club_key = fc.club_key
      join src s on s.nkey = a.alias_key
  ),
  unambiguous as (
    select h.club_key from hits h
     group by h.club_key having count(distinct h.logo) = 1
  )
  select distinct on (h.club_key)
         h.club_key, h.name, h.name_en, h.espn_name, h.logo
    from hits h join unambiguous u on u.club_key = h.club_key
   order by h.club_key, h.espn_name;
$$;

revoke all on function public.espn_crest_matches(jsonb) from public, anon, authenticated;
grant execute on function public.espn_crest_matches(jsonb) to service_role;

-- Что ОТБРОШЕНО как неоднозначное. Без этого отчёта пропуск неотличим от
-- «совпадения не было», и дыра выглядит меньше, чем она есть.
create or replace function public.espn_crest_ambiguous(p_rows jsonb)
returns table (club_key text, club_name text, club_name_en text,
               espn_names text[], logos integer)
language sql stable security definer set search_path = public as $$
  with src as materialized (
    select distinct on (r->>'espn_name')
           r->>'espn_name'                as espn_name,
           r->>'logo'                     as logo,
           club_match_key(r->>'espn_name') as mkey,
           club_norm_key(r->>'espn_name')  as nkey
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'espn_name', '') <> ''
       and coalesce(r->>'logo', '') <> ''
  ),
  fc as materialized (
    select f.club_key, f.name, f.name_en,
           club_match_key(f.name_en) as mkey_en,
           club_match_key(f.name)    as mkey_ru
      from football_club f
     where f.kind = 'club' and f.crest_url is null
  ),
  hits as (
    select fc.club_key, fc.name, fc.name_en, s.espn_name, s.logo
      from fc join src s on s.mkey is not null
                        and (s.mkey = fc.mkey_en or s.mkey = fc.mkey_ru)
    union
    select fc.club_key, fc.name, fc.name_en, s.espn_name, s.logo
      from fc
      join club_alias a on a.club_key = fc.club_key
      join src s on s.nkey = a.alias_key
  )
  select h.club_key, h.name, h.name_en,
         array_agg(distinct h.espn_name), count(distinct h.logo)::int
    from hits h
   group by h.club_key, h.name, h.name_en
  having count(distinct h.logo) > 1;
$$;

revoke all on function public.espn_crest_ambiguous(jsonb) from public, anon, authenticated;
grant execute on function public.espn_crest_ambiguous(jsonb) to service_role;

create function public.preview_espn_crests(p_rows jsonb)
returns table (club_key text, club_name text, club_name_en text,
               espn_name text, logo text)
language sql stable security definer set search_path = public as $$
  select * from espn_crest_matches(p_rows);
$$;

revoke all on function public.preview_espn_crests(jsonb) from public, anon, authenticated;
grant execute on function public.preview_espn_crests(jsonb) to service_role;

-- Пишется ТОЛЬКО туда, где эмблемы не было: ручной герб не перетирается
-- (см. «Vitória» выше — он проставлен руками и повтором не сбивается),
-- повторный прогон — no-op.
create or replace function public.apply_espn_crests(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update football_club f set crest_url = m.logo, fetched_at = now()
    from espn_crest_matches(p_rows) m
   where f.club_key = m.club_key and f.crest_url is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_espn_crests(jsonb) from public, anon, authenticated;
grant execute on function public.apply_espn_crests(jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
