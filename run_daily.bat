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
python docs\cards_audit.py  >> daily_enrich.log 2>&1

echo [%date% %time%] ===== DONE ===== >> daily_enrich.log
