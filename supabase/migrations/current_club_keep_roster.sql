-- Ночная пересборка клубов стирала то, что собрано из заявок.
--
-- СИМПТОМ, СЛОВАМИ ВЛАДЕЛЬЦА: «сейчас в „коллекциях“ ни один клуб не
-- заполнен. а в экране „команды и статистика“ есть данные». И карточка Леона
-- Классена: в описании немецкий «Дармштадт 98», в поле клуба — «Спартак», а
-- к полудню клуба не осталось вовсе.
--
-- ПРИЧИНА. `rebuild_card_current_clubs()` (крон, 06:10 UTC) заканчивался
-- DELETE по ОДНОМУ условию — «у карточки нет открытого периода в
-- career_stats / legend_career», — не глядя на `source`. А клуб приезжает не
-- только из статьи: `fill_current_club_from_roster` пишет его из ЗАЯВКИ
-- КЛУБА, и у таких карточек статьи нет вовсе. То есть каждую ночь пересборка
-- «из статьи» сносила ВСЁ, что собрано из составов.
--
-- ЗАМЕР 06.09.2026: утром заявками записано 12 491 клуб, к полудню осталось
-- 27. После правки: записано 16 626, прогон пересборки — осталось 16 653,
-- всего клубов у карточек 18 254 против 1 628 до починки.
--
-- ⚠️ СОСЕДНЯЯ ФУНКЦИЯ ЭТО ПРАВИЛО УЖЕ СОБЛЮДАЛА С ДРУГОЙ СТОРОНЫ: в шапке
-- current_club_from_roster.sql записано «Записи из статьи не трогаются:
-- перезапись более свежего менее свежим — не починка». Здесь была та же
-- ошибка, только зеркальная, и потому не видная при чтении одного файла.
--
-- ПРАВИЛО, ОДНО НА ОБЕ СТОРОНЫ: каждый сборщик убирает ТОЛЬКО СВОИ строки,
-- те, что помечены его `source`.

create or replace function public.rebuild_card_current_clubs()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer;
begin
  with open_ranges as (
    select c.id as card_id,
           e->>'club'          as club,
           (e->>'apps')::int   as apps,
           'career_stats'      as source
    from cards c
    cross join lateral jsonb_array_elements(c.career_stats) e
    where c.category = 'player'
      and jsonb_typeof(c.career_stats) = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
    union all
    select c.id, e->>'club', null::int, 'legend_career'
    from cards c
    cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
    where c.category = 'player'
      and jsonb_typeof(c.legend_career->'clubs') = 'array'
      and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
  ),
  best as (
    select distinct on (card_id) card_id, club, apps, source
    from open_ranges
    where club_match_key(club) is not null
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
    fetched_at = excluded.fetched_at;

  get diagnostics v_count = row_count;

  -- ⚠️ УБИРАЕМ ТОЛЬКО СВОЁ — см. шапку. Без этого условия ночь стирала
  -- 12 464 клуба, собранных из заявок.
  delete from card_current_club cc
   where cc.source in ('career_stats', 'legend_career')
     and not exists (
     select 1 from cards c
     cross join lateral jsonb_array_elements(c.career_stats) e
     where c.id = cc.card_id
       and jsonb_typeof(c.career_stats) = 'array'
       and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
   )
   and not exists (
     select 1 from cards c
     cross join lateral jsonb_array_elements(c.legend_career->'clubs') e
     where c.id = cc.card_id
       and jsonb_typeof(c.legend_career->'clubs') = 'array'
       and (e->>'years') ~ '^[0-9]{4}\s*[–-]\s*$'
   );

  return v_count;
end;
$function$;

revoke all on function public.rebuild_card_current_clubs() from public;
grant execute on function public.rebuild_card_current_clubs() to service_role;
