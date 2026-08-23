-- ============================================================================
-- Игровая серия (streak) — сколько дней подряд сыграна хотя бы одна игра.
--
-- ЗАВЁРНУТО В increment_player_stats(), ТРЕТИЙ СЛОЙ НАД ТЕМ ЖЕ ВЫЗОВОМ. XP
-- (player_progression_xp.sql) и прогресс недельных заданий (weekly_quests.sql)
-- уже кредитуются здесь же, одним и тем же PERFORM award_room_stats() из
-- award_stats_on_finish.sql — по той же причине: значение нельзя подделать из
-- консоли, если считать его из входов, которым функция уже доверяет, а не
-- заводить отдельный «отметить день» эндпойнт с клиента.
--
-- ГРАНИЦА ДНЯ — UTC, а не локальное время игрока, тем же приёмом, что и
-- current_week_start() в weekly_quests.sql: клиенту нельзя доверять честно
-- сообщить свой часовой пояс, а игрок, который летит через полночь, не
-- обязан терять серию из-за смены дня по границе, которую сам не выбирал.
--
-- ПОЧЕМУ SELECT ПЕРЕД INSERT, А НЕ ОДНО ВЫРАЖЕНИЕ В ON CONFLICT DO UPDATE.
-- Новое значение серии зависит от СТАРОГО last_played_date, а EXCLUDED в
-- ON CONFLICT видит только то, что передано в VALUES, не текущую строку.
-- Прочитать текущую строку и посчитать серию заранее проще и нагляднее, чем
-- дважды повторять один и тот же CASE — один в SET current_streak, другой
-- внутри GREATEST(...) для longest_streak, рискуя однажды поправить только
-- одну копию.
--
-- ГОНКА БЕЗОПАСНА БЕЗ БЛОКИРОВКИ. Два конкурентных вызова для одного игрока
-- в один день оба читают одно и то же last_played_date ДО записи и оба
-- считают ОДНО И ТО ЖЕ новое значение серии — в отличие от голого
-- `streak = streak + 1`, который в гонке удвоил бы прирост, здесь дублей
-- нет: оба обновления пишут один и тот же результат.
-- ============================================================================

ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS current_streak   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS longest_streak   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS last_played_date DATE;

COMMENT ON COLUMN player_stats.current_streak IS
  'Дней подряд с игрой, включая сегодня. Считается в increment_player_stats() '
  'по UTC-дню (current_play_date()), не по часовому поясу клиента.';
COMMENT ON COLUMN player_stats.longest_streak IS
  'Рекорд current_streak за всё время. Не убывает.';
COMMENT ON COLUMN player_stats.last_played_date IS
  'UTC-дата последней засчитанной игры. NULL — ещё не играл ни разу.';

-- Названа отдельно от current_week_start(), хотя оборачивает то же самое
-- выражение: там счёт идёт неделями, здесь днями, и общее имя на двоих
-- было бы неверным для обоих читателей.
CREATE OR REPLACE FUNCTION public.current_play_date(p_at TIMESTAMPTZ DEFAULT NOW())
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_at AT TIME ZONE 'UTC')::date;
$$;

CREATE OR REPLACE FUNCTION increment_player_stats(
  p_player_id     BIGINT,
  p_games_played  INT DEFAULT 1,
  p_games_won     INT DEFAULT 0,
  p_cards_guessed INT DEFAULT 0,
  p_total_score   INT DEFAULT 0
) RETURNS VOID AS $$
DECLARE
  v_xp_gained INT  := p_cards_guessed * 10 + p_games_won * 50;
  v_week      DATE := current_week_start();
  v_today     DATE := current_play_date();
  v_last      DATE;
  v_streak    INT;
BEGIN
  -- p_games_played отовсюду в проекте зовётся с 1 (award_stats_on_finish.sql)
  -- — проверка на > 0 на будущее: вызов с нулём не должен трогать серию.
  IF p_games_played > 0 THEN
    SELECT last_played_date, current_streak INTO v_last, v_streak
    FROM player_stats WHERE player_id = p_player_id;

    v_streak := CASE
      WHEN v_last = v_today     THEN COALESCE(v_streak, 1)     -- вторая игра за тот же день — серия уже посчитана
      WHEN v_last = v_today - 1 THEN COALESCE(v_streak, 0) + 1 -- продолжение
      ELSE 1                                                    -- разрыв или самая первая игра
    END;
  END IF;

  INSERT INTO player_stats (player_id, games_played, games_won, cards_guessed, total_score, xp,
                             current_streak, longest_streak, last_played_date)
  VALUES (p_player_id, p_games_played, p_games_won, p_cards_guessed, p_total_score, v_xp_gained,
          COALESCE(v_streak, 0), COALESCE(v_streak, 0),
          CASE WHEN p_games_played > 0 THEN v_today END)
  ON CONFLICT (player_id) DO UPDATE SET
    games_played     = player_stats.games_played  + EXCLUDED.games_played,
    games_won        = player_stats.games_won     + EXCLUDED.games_won,
    cards_guessed    = player_stats.cards_guessed + EXCLUDED.cards_guessed,
    total_score      = player_stats.total_score   + EXCLUDED.total_score,
    xp               = player_stats.xp            + EXCLUDED.xp,
    current_streak   = CASE WHEN p_games_played > 0 THEN v_streak ELSE player_stats.current_streak END,
    longest_streak   = GREATEST(player_stats.longest_streak,
                                 CASE WHEN p_games_played > 0 THEN v_streak ELSE 0 END),
    last_played_date = CASE WHEN p_games_played > 0 THEN v_today ELSE player_stats.last_played_date END,
    updated_at       = NOW();

  -- Прогресс недельных заданий — без изменений (weekly_quests.sql §4).
  INSERT INTO player_weekly_tasks (player_id, task_code, week_start, progress)
  SELECT
    p_player_id,
    t.code,
    v_week,
    LEAST(
      t.target,
      CASE t.metric
        WHEN 'cards_guessed' THEN p_cards_guessed
        WHEN 'games_played'  THEN p_games_played
        WHEN 'games_won'     THEN p_games_won
      END
    )
  FROM weekly_tasks t
  WHERE t.code IN (SELECT code FROM weekly_task_codes(v_week))
  ON CONFLICT (player_id, task_code, week_start) DO UPDATE SET
    progress = LEAST(
      (SELECT target FROM weekly_tasks WHERE code = EXCLUDED.task_code),
      player_weekly_tasks.progress + EXCLUDED.progress
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- player_stats уже открыта на публичное чтение и закрыта на запись с клиента
-- (rls_lockdown.sql) — новые колонки наследуют то же самое, добавлять нечего.

NOTIFY pgrst, 'reload schema';
