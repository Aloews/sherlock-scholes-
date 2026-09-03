-- ===========================================================================
-- apply_espn_crests — эмблемы клубам из ESPN, сопоставление НА СЕРВЕРЕ.
--
-- Владелец: «эмблемы клубов бери с ESPN и его сделай основным».
--
-- ⚠️ ПОЧЕМУ СОПОСТАВЛЯЕТ БАЗА, А НЕ СБОРЩИК. Сборщик приносит пары «имя ESPN →
-- ссылка», и связать их с `football_club` можно только правилами, которые уже
-- живут здесь: `club_match_key`, `club_norm_key`, `club_alias`. Копия этих
-- правил в питоне разошлась бы с оригиналом МОЛЧА, и клуб получил бы чужой
-- герб — ровно так этот проект уже ошибался, когда клубы резолвились по
-- ярлыку и «Барселона» уезжала на многоспортивный клуб.
--
-- ⚠️ ПИШЕТСЯ ТОЛЬКО ТУДА, ГДЕ ЭМБЛЕМЫ НЕ БЫЛО. Ручной герб и 707 уже
-- собранных не перетираются, повторный прогон — no-op. Это же делает шаг
-- безопасным для ночного workflow: он идёт каждую ночь и ничего не портит.
--
-- Замер 03.09.2026 до внедрения:
--     клубов в справочнике   1521
--     с эмблемой              934   (ESPN 707, Викимедиа 0)
--     без эмблемы             587
--
-- Возвращает, сколько строк реально заполнено, — «прогон прошёл» без числа
-- ничего не значит.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- Только service_role: это запись в справочник, игроку она не нужна.
-- ===========================================================================
create or replace function public.apply_espn_crests(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  with src as (
    select r->>'espn_name' as espn_name, r->>'logo' as logo
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'espn_name', '') <> ''
       and coalesce(r->>'logo', '') <> ''
  ),
  -- distinct on: у ESPN встречаются тёзки в разных турнирах («Athletic»,
  -- «Arsenal»), и без этого UPDATE упёрся бы в несколько кандидатов на клуб.
  matched as (
    select distinct on (f.club_key) f.club_key, s.logo
      from football_club f
      join src s
        on club_match_key(f.name_en) = club_match_key(s.espn_name)
        or club_match_key(f.name)    = club_match_key(s.espn_name)
        or exists (select 1 from club_alias a
                    where a.club_key = f.club_key
                      and a.alias_key = club_norm_key(s.espn_name))
     where f.kind = 'club' and f.crest_url is null
     order by f.club_key, length(s.espn_name)
  )
  update football_club f set crest_url = m.logo, fetched_at = now()
    from matched m
   where f.club_key = m.club_key and f.crest_url is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_espn_crests(jsonb) from public, anon, authenticated;
grant execute on function public.apply_espn_crests(jsonb) to service_role;
