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
REM     Без --limit: идёт до конца очереди и сам останавливается на дневном
REM     бюджете Wikimedia, сохранив прогресс. Продолжить - просто запустить
REM     ещё раз (всё скачанное лежит в кеше и повторно не тянется).
set APPLY=1
python docs\cards_descriptions_build.py >> daily_enrich.log 2>&1
REM     Добор английских описаний там, где русское уже есть (строка выше их
REM     не видит: карточка уже не пустая). Без en интерфейс на остальных
REM     8 языках показывает русский текст.
python docs\cards_descriptions_build.py --missing-en >> daily_enrich.log 2>&1

REM --- Ревизия name_en у мононимов: чинит карточки, где однофамилец утащил
REM     статью («Данте» -> Dante Alighieri, «Адриан» -> Hadrian), и обнуляет
REM     доказанно чужие значения. Правильное имя берётся из enwiki-сайтлинка.
python docs\cards_name_en_audit.py --mononyms-only >> daily_enrich.log 2>&1

REM --- Пересчёт pageviews там, где счёт снят с чужой статьи: клуб
REM     «Краснодар» мерился статьёй о ГОРОДЕ (767k), «Сатурн» - о планете.
python docs\cards_pageviews_refix.py >> daily_enrich.log 2>&1
set APPLY=

python docs\cards_audit.py  >> daily_enrich.log 2>&1

echo [%date% %time%] ===== DONE ===== >> daily_enrich.log
