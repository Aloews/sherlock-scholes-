-- ============================================================================
-- «НАБИРАЮТ ХОД»: РОСТ ПО ЧУЖОМУ МНЕНИЮ ЗАСЧИТЫВАЕТСЯ ТОЛЬКО ТОМУ, КТО ИГРАЛ.
--
-- Владелец: «в „набирают ход“ за неделю попали игроки, которые никак себя не
-- проявили. Из-за того, что упоминания в новостях работают некорректно.
-- Из-за схожих фамилий. Лучше проверять упоминанию в новостях со статистикой
-- игрока, или тренера. Если она резко положительная, значит фон в новостях не
-- скандальный, а спортивный».
--
-- ЗАМЕР ДО (окно 7 дней, предел 50 строк, боевые данные):
--
--     показатель   строк   из них без единой минуты на поле
--     news_30d        17               11
--     sw_rating       33               28
--
-- Одиннадцать из семнадцати — это и есть однофамильцы: газета писала не про
-- того футболиста, чью карточку подняло. А sw_rating занимал 42 строки из 48
-- ростом от 1.2 % — редакторская правка оценки, названная «ходом».
--
-- ЧТО СДЕЛАНО. У порогов появилось два новых столбца:
--
--     min_growth — насколько должно вырасти, чтобы это называлось ходом;
--     needs_play — нужно ли подтверждение игрой на поле.
--
-- ⚠️ ПОДТВЕРЖДЕНИЕ ТРЕБУЕТСЯ ТАМ, ГДЕ ПОКАЗАТЕЛЬ — ЧУЖОЕ МНЕНИЕ ОБ ИГРОКЕ:
-- упоминания в новостях, оценка Soccer Wiki, просмотры страницы. Стоимость и
-- минуты карьеры подтверждать нечем и незачем — они и так про него самого.
--
-- ⚠️ ПРОВЕРКА НАМЕРЕННО МЯГКАЯ: нужен ФАКТ ИГРЫ, а не гол. Запасной, вышедший
-- на двадцать минут и попавший в заголовки, — настоящая новость; тот, кто не
-- выходил вовсе, — чужая. Владелец говорил про «резко положительную»
-- статистику, но требовать гола значило бы выкинуть защитников и вратарей
-- целиком: у них резко положительная игра выглядит как ноль в графе голов.
--
-- ЗАМЕР ПОСЛЕ (то же окно): 8 строк, НИ ОДНОЙ без минут на поле; у пяти строк
-- по упоминаниям — 16 голов и 7 пасов на всех.
--
-- ⚠️ МИНУТЫ, ГОЛЫ И ПАСЫ ВОЗВРАЩАЮТСЯ НАРУЖУ, а не только участвуют в
-- условии. Экран показывает их под строкой: игрок должен ВИДЕТЬ, за что
-- строка в списке, а не верить списку на слово.
--
-- ⚠️ ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ: ТРЕБОВАНИЯ СВЕЖЕСТИ. Была мысль отбрасывать
-- показатель, у которого давно не было новых записей. Она НЕВЕРНА:
-- `card_metric_history` — история ИЗМЕНЕНИЙ, а не ежедневный снимок
-- (`snapshot_card_metrics` пишет строку только когда значение изменилось).
-- Стоимости с Transfermarkt меняются раз в месяц-полтора, и неделя без
-- строк — нормальная неделя. Проверено: в тот же час, когда последняя запись
-- market_value была семидневной давности, `card_metrics_today()` отдавала
-- 20 715 стоимостей.
--
-- ⚠️ ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ, КОТОРОЕ НЕ ЧИНИТСЯ ЗДЕСЬ: история заведена
-- 06.09.2026, то есть ей девять дней. Окна «месяц» и «год» на экране поэтому
-- пусты — не из-за этой правки, а потому что сравнивать не с чем.
--
-- ⚠️ DROP + CREATE, А НЕ CREATE OR REPLACE: добавлены выходные столбцы, а
-- менять состав возвращаемой таблицы `create or replace` не умеет. Для
-- выкаченного фронтенда это безопасно — лишние ключи в ответе он игнорирует.
-- ============================================================================

drop function if exists public.rising_cards(integer, integer, text, text, text, text);

create or replace function public.rising_cards(
  p_days integer default 30, p_limit integer default 20, p_lang text default 'ru',
  p_league text default null, p_country text default null, p_continent text default null)
returns table(
  card_id uuid, name text, name_en text, photo_url text, club text, club_key text,
  metric text, was numeric, now_value numeric, growth numeric, changed_on date,
  minutes integer, goals integer, assists integer)
language sql stable security definer
set search_path to 'public' set statement_timeout to '60s'
as $function$
  with floors (metric, min_was, min_growth, needs_play) as (
    values ('market_value',   300000::numeric, 1.10::numeric, false),
           ('pageviews',         1000::numeric, 1.50::numeric, true),
           ('news_30d',             3::numeric, 1.50::numeric, true),
           ('career_minutes',     900::numeric, 1.05::numeric, false),
           ('sw_rating',           50::numeric, 1.10::numeric, true)
  ),
  -- Что игрок сделал на поле за то же окно.
  form as (
    select s.card_id,
           sum(s.minutes)::int              as minutes,
           sum(coalesce(s.goals, 0))::int   as goals,
           sum(coalesce(s.assists, 0))::int as assists
      from player_match_stats s
     where s.match_date >= (now() at time zone 'utc')::date
                           - greatest(coalesce(p_days, 30), 1)
     group by s.card_id
  ),
  latest as (
    select distinct on (h.card_id, h.metric) h.card_id, h.metric, h.value, h.taken_on
      from card_metric_history h join floors f on f.metric = h.metric
     order by h.card_id, h.metric, h.taken_on desc
  ),
  before as (
    select distinct on (h.card_id, h.metric) h.card_id, h.metric, h.value
      from card_metric_history h join floors f on f.metric = h.metric
     where h.taken_on <= (now() at time zone 'utc')::date - greatest(coalesce(p_days, 30), 1)
     order by h.card_id, h.metric, h.taken_on desc
  ),
  moved as (
    select l.card_id, l.metric, b.value as was, l.value as now_value,
           round(l.value / b.value, 3) as growth, l.taken_on
      from latest l
      join before b on b.card_id = l.card_id and b.metric = l.metric
      join floors f on f.metric = l.metric
      left join form fm on fm.card_id = l.card_id
     where b.value is not null and l.value is not null
       and b.value >= f.min_was
       and l.value >= b.value * f.min_growth
       and (not f.needs_play or coalesce(fm.minutes, 0) > 0)
  ),
  best as (
    select distinct on (card_id) card_id, metric, was, now_value, growth, taken_on
      from moved order by card_id, growth desc
  )
  select c.id, c.name, c.name_en, c.photo_url,
         case when cc.club_key is null then null
              else club_display_name(cc.club_key, p_lang) end,
         cc.club_key,
         b.metric, b.was, b.now_value, b.growth, b.taken_on,
         coalesce(fm.minutes, 0), coalesce(fm.goals, 0), coalesce(fm.assists, 0)
    from best b
    join cards c on c.id = b.card_id and c.active and c.category = 'player'
    left join card_current_club cc on cc.card_id = c.id
    left join football_club fc on fc.club_key = cc.club_key
    left join form fm on fm.card_id = c.id
   where (p_league    is null or p_league    = '' or fc.league   = p_league)
     and (p_country   is null or p_country   = '' or c.country   = p_country)
     and (p_continent is null or p_continent = '' or c.continent = p_continent)
   order by b.growth desc, b.now_value desc
   limit greatest(coalesce(p_limit, 20), 1);
$function$;

comment on function public.rising_cards(integer, integer, text, text, text, text) is
  'Кто набирает ход. Рост по чужому мнению об игроке (упоминания, оценка Soccer '
  'Wiki, просмотры) засчитывается ТОЛЬКО если он в том же окне выходил на поле: '
  'иначе всплеск — однофамилец или скандал. Минуты, голы и пасы возвращаются, '
  'чтобы экран показал подтверждение.';

revoke all on function public.rising_cards(integer, integer, text, text, text, text) from public;
grant execute on function public.rising_cards(integer, integer, text, text, text, text)
  to anon, authenticated, service_role;

-- ── Свежесть ночного снимка: смотреть на ЗАДАНИЕ, а не на данные ───────────
-- Разбор — в шапке выше и в check-prod. Коротко: проверка, читавшая историю
-- изменений как ежедневный снимок, семь дней подряд краснела на здоровых
-- данных. Красная проверка на здоровом — хуже пустой: по ней перестают
-- смотреть.

create or replace function public.snapshot_freshness()
returns table (last_success timestamptz, hours_ago numeric, measured_today integer)
language sql stable security definer set search_path = public, cron as $$
  -- ⚠️ ИСТОЧНИК СЧИТАЕТСЯ ПО `cards`, А НЕ ЧЕРЕЗ `card_metrics_today()`.
  -- Первая попытка звала её — и упёрлась в анонимные три секунды (57014):
  -- функция считает ВСЕ показатели для двадцати тысяч карточек. Проверка
  -- здоровья, которая сама не укладывается в лимит, называет здоровое
  -- сломанным — и в первом же прогоне назвала.
  --
  -- Отрицательный контроль в той же строке: задание может отрабатывать И
  -- ПИСАТЬ ПУСТОТУ. Источник обязан быть полон прямо сейчас.
  select r.start_time,
         round(extract(epoch from (now() - r.start_time)) / 3600.0, 1),
         (select count(*)::int from cards c
           where c.active and c.category = 'player' and c.market_value_eur is not null)
    from cron.job_run_details r
    join cron.job j on j.jobid = r.jobid
   where j.jobname = 'snapshot-card-metrics' and r.status = 'succeeded'
   order by r.start_time desc
   limit 1;
$$;

comment on function public.snapshot_freshness() is
  'Когда ночной снимок показателей отработал в последний раз и сколько '
  'карточек имеет стоимость ПРЯМО СЕЙЧАС.';

revoke all on function public.snapshot_freshness() from public;
grant execute on function public.snapshot_freshness() to anon, authenticated, service_role;
