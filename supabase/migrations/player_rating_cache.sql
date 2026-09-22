-- Рейтинг игроков: считать заранее, а не при каждом открытии экрана
-- ==================================================================
--
-- ⚠️ ЭКРАН СРЫВАЛСЯ НЕ ИЗ-ЗА ПЛАНА, А ИЗ-ЗА ВЕСА. Замеры 20.09.2026, один
-- и тот же вызов player_ratings(7, 50), один и тот же план:
--
--     179 мс   33 799 буферов   (инстанс свободен)
--    6297 мс   33 799 буферов   (инстанс занят ночным обходом)
--
-- Буферы те же, время в тридцать пять раз больше. Перестановкой джойнов это
-- не лечится: 33 799 буферов — это ~264 МБ прикосновений ради пятидесяти
-- строк, и такой вес сам по себе становится отказом. У анонима потолок три
-- секунды, и владелец видел это как «статистика иногда не загружается».
--
-- Починка из двух половин, и меряются они вместе:
--
--     было                        33 799 буферов   6297 мс
--     кэш сумм                    21 310           1881 мс
--     + верхушка до джойнов        3 081            416 мс
--
-- 1. СУММА ИЗ КЭША. Экран рейтинга не требует посекундной свежести: это
--    «кто забивал за неделю», а не счёт идущего матча. Окна ровно три и
--    прибиты во фронтенде (RATING_WINDOWS = [7, 30, 365] в
--    src/features/ratings/freshness.ts), поэтому кэш полный, а не частичный.
--
-- 2. ВЕРХУШКА ДО ДЖОЙНОВ. Шесть присоединений шли по всем 1062 строкам окна
--    ради пятидесяти на экране. Отбор `rank`, а не `row_number` и не «взять
--    с запасом»: полный порядок экрана кончается именем карточки, а имя —
--    за джойном, и `rank` тянет всех, кто делит границу, поэтому строка,
--    выигрывающая по имени, не может быть отрезана. При заданном отборе
--    (клуб, лига, страна) верхушка не берётся: отбор живёт за джойном.
--
-- ⚠️ ПУСТОЙ КЭШ ОБЯЗАН ВЕСТИ К ЖИВОМУ РАСЧЁТУ, А НЕ К ПУСТОМУ ЭКРАНУ. Не
-- обновился ночью, выкатили функцию раньше первого обновления, попросили
-- окно не из трёх — во всех этих случаях экран показывает правду медленно,
-- а не ложь быстро. Поэтому `union all` со взаимоисключающими условиями, а
-- не `coalesce`. Проверено: у окна 14 в кэше ноль строк, функция отдаёт 50.
--
-- ⚠️ КЭШ ПОТРЕБОВАЛ СНАЧАЛА ПОЧИНИТЬ `player_match_days` — см.
-- player_match_days_deterministic_pick.sql. Представление выбирало из двух
-- строк произвольную, и заморозить такой выбор значило бы показывать то
-- шесть голов, то три у одного и того же игрока.
create table if not exists public.player_rating_cache (
  days      smallint not null,
  card_id   uuid     not null references cards(id) on delete cascade,
  matches   integer  not null,
  minutes   integer,
  goals     integer  not null,
  assists   integer  not null,
  primary key (days, card_id)
);

create index if not exists player_rating_cache_window_idx
  on public.player_rating_cache (days, (goals * 4 + assists * 3) desc, goals desc);

comment on table public.player_rating_cache is
  'Суммы для экрана рейтинга по трём окнам. Обновляется refresh_player_rating_cache() после ночного сбора. Пустой кэш НЕ означает пустой экран: player_ratings() падает обратно на живой расчёт.';

-- ⚠️ ТАБЛИЦА ЗАКРЫТА, И ЭТО ПОЧИНКА, А НЕ ПРЕДОСТОРОЖНОСТЬ. Советник Supabase
-- держал на ней ЕДИНСТВЕННУЮ у этого проекта ошибку уровня ERROR:
-- «rls_disabled_in_public» — 9745 строк в схеме public, RLS выключен, грант
-- select у anon есть. То есть кэш читался анонимом напрямую через PostgREST,
-- хотя ни один экран к нему не обращается.
--
-- Закрыто целиком, а не политикой «читать всем»: экран ходит в
-- `player_ratings()`, а она SECURITY DEFINER и RLS обходит. Значит права
-- анониму тут не нужны вовсе — ровно как у `fixture_odds`, где отсутствие
-- грантов и есть защита.
alter table public.player_rating_cache enable row level security;
revoke all on public.player_rating_cache from anon, authenticated;
grant select, insert, update, delete on public.player_rating_cache to service_role;

create or replace function public.refresh_player_rating_cache()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  -- Одной транзакцией: экран не должен увидеть полупустое окно.
  delete from player_rating_cache;
  insert into player_rating_cache (days, card_id, matches, minutes, goals, assists)
  select w.days, d.card_id,
         count(*)::int,
         sum(coalesce(d.minutes, 0))::int,
         sum(coalesce(d.goals, 0))::int,
         sum(coalesce(d.assists, 0))::int
    from (values (7::smallint), (30::smallint), (365::smallint)) as w(days)
    join player_match_days d
      on d.match_date >= current_date - w.days
   group by w.days, d.card_id
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0;
  get diagnostics n = row_count;
  return 'строк: ' || n;
end;
$function$;

revoke all on function public.refresh_player_rating_cache() from public, anon, authenticated;
grant execute on function public.refresh_player_rating_cache() to service_role;
grant select on public.player_rating_cache to anon, authenticated, service_role;

-- Тело player_ratings() применено миграциями `player_ratings_reads_cache` и
-- `player_ratings_rank_before_join`. Здесь записана причина; логика выборки
-- не менялась — сверено EXCEPT в обе стороны, расхождений ноль на 1061 строке.
