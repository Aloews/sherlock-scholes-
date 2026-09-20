-- ANALYZE таблицы статистики после ночной загрузки.
--
-- Экран рейтинга игроков ходит АНОНИМОМ, а у анонима потолок в три секунды.
-- Замер 20.09.2026: сразу после догрузки 19 219 строк первый вызов
-- `player_ratings` стоил 3164 мс и падал с `statement timeout`, после
-- `analyze player_match_stats` — 179 мс, анонимом через прод — 746 мс.
-- Автовакуум добрался бы туда сам, но позже, а «позже» здесь значит «утром
-- экран не грузится».
--
-- ⚠️ ТАБЛИЦА ЗДЕСЬ ОДНА НАМЕРЕННО. `player_match_days` — представление над
-- `player_match_stats`, своей статистики у него нет.
--
-- Зовётся последним шагом `player-stats.yml`, с `if: always()`: строки лиг,
-- прошедших до падения на одной, уже записаны.
create or replace function public.refresh_stats_planner()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  analyze player_match_stats;
  return 'ok';
end;
$$;

-- Это шаг CI, а не экранная функция: анониму здесь делать нечего.
revoke all on function public.refresh_stats_planner() from public, anon, authenticated;
grant execute on function public.refresh_stats_planner() to service_role;
