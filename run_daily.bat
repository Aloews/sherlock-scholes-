@echo off
REM ============================================================================
REM  Sherlock Scholes - ежедневное обогащение колоды из Wikipedia.
REM  Тратит дневной бюджет (5000 запросов) с пользой: новые игроки -> факты ->
REM  фото -> переводы -> tier. Идемпотентно и резюмируемо: что не успело
REM  сегодня - добьётся завтра. В конце - аудит здоровья колоды.
REM ============================================================================

REM --- ПУТЬ к проекту (поправь, если у тебя другой) ---
set PROJECT=C:\Users\giafr\Documents\Sherlock_Scholes_Project_Package\sherlock_scholes_project

cd /d "%PROJECT%"

echo. >> daily_enrich.log
echo [%date% %time%] ===== START ===== >> daily_enrich.log

python docs\daily_enrich.py >> daily_enrich.log 2>&1

REM --- Описания неигровых карточек (клубы, стадионы, тренеры, судьи,
REM     комментаторы, дерби, трофеи): короткий блёрб из преамбулы статьи
REM     в Википедии. Игроков не трогает - у них facts/career_stats.
REM     Пишет только там, где descriptions пуст, поэтому повтор безопасен.
REM     --limit 120 - как в ночном CI; поставь 0, чтобы добрать всё за раз.
set APPLY=1
python docs\cards_descriptions_build.py --limit 120 >> daily_enrich.log 2>&1
REM     Добор английских описаний там, где русское уже есть (строка выше их
REM     не видит: карточка уже не пустая). Без en интерфейс на остальных
REM     8 языках показывает русский текст.
python docs\cards_descriptions_build.py --missing-en --limit 120 >> daily_enrich.log 2>&1
set APPLY=

python docs\cards_audit.py  >> daily_enrich.log 2>&1

echo [%date% %time%] ===== DONE ===== >> daily_enrich.log
