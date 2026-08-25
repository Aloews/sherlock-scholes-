-- ============================================================================
-- digest_recent_goals / digest_earlier_goals — СКОЛЬЗЯЩЕЕ ОКНО ВМЕСТО ВЫХОДНЫХ.
--
-- ЗАЧЕМ. «Хочу больше видео, из кубков и ЛЧ, которые играются не в выходные.
-- Некоторые матчи играются в пн, а ЛЧ во вт и ср».
--
-- Данные для этого БЫЛИ, их просто некуда было положить. Главный блок экрана
-- звался «ГОЛЫ ВЫХОДНЫХ» и брал окно из weekend_bounds() — последние
-- ЗАВЕРШИВШИЕСЯ субботу и воскресенье. Замер во вторник 25.08.2026, 17:04 UTC:
--
--   окно выходных            22.08 00:00 — 24.08 00:00   (Сб и Вс)
--   роликов за последние 24ч 83, из них 26 голов          ← понедельник и вторник
--
-- То есть во вторник экран открывался позавчерашним, а понедельничные кубки и
-- вторничная ЛЧ лежали ВТОРЫМ блоком, ниже. Ровно то, на что жалоба.
--
-- ⚠️ ПОЧЕМУ ПРОСТО РАСШИРИТЬ ОКНО — МАЛО, И ЭТО ИЗМЕРЕНО. Если взять три дня
-- и оставить прежний порядок «сначала голы, внутри по просмотрам», свежее всё
-- равно не поднимется: ролик, висящий шесть часов, не может набрать столько
-- же, сколько висящий три дня. Просмотры — наполовину мера ВОЗРАСТА.
--
-- А если, наоборот, сортировать по свежести, тонет крупное. Проверено на тех
-- же данных, первая восьмёрка:
--
--   по просмотрам:  3.6М Эспаньол–Реал, 3.2М Эльче–Барса, 2.0М Бавария …
--   по свежести:    664К, 176К, 160К, 56К, 38К, 36К, 19К, 19К
--                   ← Реал за 3.6 млн из первой восьмёрки ИСЧЕЗ вовсе
--
-- Ни один из двух порядков не годится: один прячет вчерашнее, другой прячет
-- главное.
--
-- ЧТО ВЗЯТО — ПО КРУГУ ПО ДНЯМ. Сначала лучший ролик каждого дня окна, потом
-- вторые по каждому дню, потом третьи. Внутри одного круга — по просмотрам.
-- Правило формулируется одной фразой и не содержит ни одной подобранной
-- константы: «по одному лучшему от каждого дня, потом по второму».
--
-- Та же восьмёрка после изменения:
--
--   1. 22.08  LALIGA    3 628 660  Эспаньол — Реал Мадрид   ← лучшее субботы
--   2. 23.08  LALIGA    3 237 489  Эльче — Барселона        ← лучшее воскресенья
--   3. 24.08  Serie A     664 483  Рома — Фиорентина        ← лучшее понедельника
--   4. 22.08  Bundesliga 2 065 963  Бавария                  ← вторые по кругу
--   5. 23.08  LALIGA    1 117 861  Эльче — Барселона
--   6. 24.08  Serie A     175 583  Болонья — Лацио
--
-- Крупное осталось наверху, и при этом понедельник виден с третьей строки, а
-- не с двадцать пятой.
--
-- ⚠️ СТАРЫЕ ФУНКЦИИ НЕ ТРОГАЕМ. digest_weekend_goals и digest_week_goals
-- остаются как есть: их зовёт ВЫКАЧЕННЫЙ фронтенд, а миграция применяется
-- раньше, чем Vercel соберёт новый. Уронить живое приложение на время сборки
-- этот проект уже умеет — см. легаси-обёртку pick_random_cards в deck_rpc.sql.
-- Снять их можно после выкатки фронтенда:
--
--   drop function if exists digest_weekend_goals(int);
--   drop function if exists digest_week_goals(int);
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Главный блок: последние p_days суток, по кругу по дням.
-- ---------------------------------------------------------------------------
create or replace function digest_recent_goals(p_days int default 3, p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  window_start timestamptz, window_end timestamptz, title_generated text
)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select now() - make_interval(days => greatest(1, least(p_days, 7))) as starts_at,
           now() as ends_at
  ),
  win as (
    select g.*, looks_like_goal(g.title) as goal,
           -- Сколько ЦЕЛЫХ суток назад. Не календарная дата: матч, кончившийся
           -- в 23:00, даёт ролики и в 23:30, и в 01:00 — по календарю это два
           -- разных дня, по смыслу один и тот же вечер.
           (extract(epoch from now() - g.published_at) / 86400)::int as days_ago
      from goal_clips g, bounds b
     where g.published_at >= b.starts_at
  ),
  ranked as (
    select w.*,
           row_number() over (partition by w.days_ago, w.goal order by w.views desc) as in_day
      from win w
  )
  select r.video_id, r.title, r.channel, r.published_at, r.thumb_url,
         r.views, r.likes, r.goal,
         b.starts_at, b.ends_at, nullif(r.title_generated, '')
    from ranked r, bounds b
   -- Голы раньше моментов, дальше — по кругу по дням, внутри круга по просмотрам.
   order by r.goal desc, r.in_day, r.views desc
   limit greatest(1, least(p_limit, 40))
$$;

comment on function digest_recent_goals(int, int) is
  'Главный блок дайджеста: последние N суток, порядок — по одному лучшему '
  'ролику от каждого дня, потом по второму. Заменяет digest_weekend_goals, '
  'который показывал во вторник субботу. Обоснование — в шапке файла.';

-- ---------------------------------------------------------------------------
-- Второй блок: остаток недели, мимо главного окна.
-- ---------------------------------------------------------------------------
create or replace function digest_earlier_goals(p_days int default 3, p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text
)
language sql stable security definer set search_path = public as $$
  with bounds as (
    select now() - make_interval(days => greatest(1, least(p_days, 7))) as starts_at
  )
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, '')
    from goal_clips g, bounds b
   -- Граница ТА ЖЕ, что у главного блока, поэтому один ролик не может попасть
   -- в оба списка. Вычитание по общей границе, а не «примерно неделя».
   where g.published_at >= now() - interval '7 days'
     and g.published_at < b.starts_at
   order by looks_like_goal(g.title) desc, g.views desc
   limit greatest(1, least(p_limit, 40))
$$;

comment on function digest_earlier_goals(int, int) is
  'Остаток недели мимо главного окна. Границу берёт ту же, что '
  'digest_recent_goals, поэтому ролик не может оказаться в обоих блоках.';

revoke all on function digest_recent_goals(int, int) from public;
revoke all on function digest_earlier_goals(int, int) from public;
grant execute on function digest_recent_goals(int, int) to anon, authenticated, service_role;
grant execute on function digest_earlier_goals(int, int) to anon, authenticated, service_role;
