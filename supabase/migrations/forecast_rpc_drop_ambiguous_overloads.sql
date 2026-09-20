-- Доска прогнозистов отвечала HTTP 300 ВСЕМ: и Telegram, и браузеру
-- ==================================================================
--
-- СИМПТОМ: «экран "кто лучше предсказывает" теперь не показывает и не
-- предсказывает будущие матчи» — и после починки доступа паролем тоже.
--
-- ПРИЧИНА. Добавление `p_password` создало ВТОРУЮ сигнатуру, а не заменило
-- первую. У обеих ВСЕ параметры с DEFAULT, поэтому любой вызов подходит
-- обеим, и PostgREST отвечает `300 Multiple Choices`, не выбирая:
--
--     forecast_scoreboard()                 и  forecast_scoreboard(p_password)
--     forecast_upcoming(p_limit)            и  forecast_upcoming(p_limit, p_password)
--     forecast_history(...4 параметра)      и  forecast_history(...4, p_password)
--     forecast_history_count(p_model)       и  forecast_history_count(p_model, p_password)
--
-- ⚠️ ЭТО НЕ ЗАВИСЕЛО ОТ ПАРОЛЯ И НЕ ЗАВИСЕЛО ОТ КЛЮЧА. 300 приходил и под
-- сервисным ключом в `check-prod`, и анониму, и из Telegram — то есть
-- проверка «без подписи не отдаётся» читала 300 как отказ и была ЗЕЛЁНОЙ,
-- пока экран был мёртв. Отрицательный контроль рядом с ней это и поймал:
-- «контроль проходящего пути — HTTP 300, 0 строк, ⚠ КОНТРОЛЬ НЕ СРАБОТАЛ».
--
-- РЕШЕНИЕ: снять старые сигнатуры. Новые покрывают их полностью — параметр
-- `p_password` необязателен, поведение при его отсутствии прежнее.
--
-- ⚠️ ПРАВИЛО НА БУДУЩЕЕ. Добавление необязательного параметра к функции,
-- которую зовут через PostgREST, — это НЕ совместимое изменение, а новая
-- перегрузка. Либо старую сигнатуру снимают в той же миграции, либо у новой
-- параметр обязателен. Проверить у себя:
--
--     select p.proname, count(*) from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.prokind = 'f'
--      group by p.proname having count(*) > 1;
drop function if exists public.forecast_scoreboard();
drop function if exists public.forecast_upcoming(integer);
drop function if exists public.forecast_history(text, integer, timestamptz, text);
drop function if exists public.forecast_history_count(text);
