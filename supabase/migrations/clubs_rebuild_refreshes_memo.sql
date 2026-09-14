-- ============================================================================
-- ПАМЯТКА ИМЁН ОБНОВЛЯЕТСЯ ВМЕСТЕ С КЛУБАМИ, А НЕ ЧЕРЕЗ ПЯТЬ МИНУТ ПОСЛЕ.
--
-- ⚠️ ПОЙМАНО ПРОГОНОМ, А НЕ РАССУЖДЕНИЕМ. Сразу после `rebuild_clubs_all()`
-- (merged 29, pruned 19) `check-prod` дал:
--
--     ✗ RPC anon: известность состава   57014 canceling statement due to
--                                       statement timeout
--
-- То есть экран Pro у игрока в этот момент не грузился. После
-- `rebuild_club_name_resolved()` та же проверка: 120 строк, 271 мс.
--
-- ПОЧЕМУ. `fixture_squad_strength` (и её соседки) берут ключ клуба так:
--
--     coalesce(mh.club_key, resolve_club_key(f.home_team, null))
--
-- Памятка `club_name_resolved` — быстрый путь, `resolve_club_key` — запасной,
-- на строку. Пересбор клубов сливает и удаляет записи справочника, памятка
-- начинает промахиваться, и запасной путь исполняется на КАЖДУЮ строку — те
-- самые три секунды анонима, о которых написано в шапке самой функции.
--
-- ⚠️ В РАСПИСАНИИ ЭТО ОКНО ЕСТЬ КАЖДУЮ НОЧЬ: `rebuild_clubs_all` в 06:25,
-- `rebuild_club_name_resolved` в 06:30 — пять минут, в которые блок известности
-- состава отвечает отказом. Никакая проверка этого не видела: и до 06:25, и
-- после 06:30 всё зелено.
--
-- ⚠️ И РУКАМИ ЭТО ПОВТОРЯЕТСЯ МГНОВЕННО. Пересбор клубов вне расписания —
-- обычное дело при разборе справочника, а помнить про второй шаг никто не
-- обязан: как раз так этот отказ и был получен.
--
-- ЧТО СДЕЛАНО. Памятка пересобирается последним шагом самого
-- `rebuild_clubs_all()`. Отдельное задание в 06:30 остаётся: лишний пересбор
-- 437 строк ничего не стоит, а страховка на случай, если памятку понадобится
-- обновить отдельно, остаётся на месте.
-- ============================================================================

create or replace function rebuild_clubs_all()
returns table (clubs integer, merged integer, squad integer, matches integer, pruned integer)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_clubs integer; v_merged integer; v_squad integer; v_matches integer; v_pruned integer;
begin
  v_clubs   := rebuild_football_clubs();
  v_merged  := merge_seeded_clubs();
  v_squad   := rebuild_club_squads();
  v_matches := rebuild_club_matches();
  v_pruned  := prune_orphan_clubs();
  perform apply_club_crests();
  -- ⚠️ ПОСЛЕДНИМ ШАГОМ И ВНУТРИ ЭТОЙ ЖЕ ФУНКЦИИ. Памятка построена на
  -- `resolve_club_key` и на ключах справочника; после слияний и уборки она
  -- промахивается, а промах памятки стоит анонимных трёх секунд.
  perform rebuild_club_name_resolved();
  return query select v_clubs, v_merged, v_squad, v_matches, v_pruned;
end;
$$;
