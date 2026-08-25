-- ============================================================================
-- digest_weekend_goals / digest_week_goals — поднять потолок с 12 до 40.
--
-- ИЗМЕРЕНО, А НЕ ГИПОТЕТИЧНО. Выходные 22–24.08.2026: у LALIGA в эти сутки
-- вышел «RCD ESPANYOL 1 - 2 REAL MADRID» — 3.6 млн просмотров, и следом ещё
-- пять её же роликов и роликов Bundesliga/Serie A с сотнями тысяч. Оба клипа
-- Premier League этих же выходных («The First Premier League Goal Of The
-- Season», «ALL The Goals From Opening Weekend | Matchweek 1») настоящие,
-- отмечены looks_like_goal и лежат в goal_clips — но по просмотрам они 17-е и
-- 19-е из сорока, то есть НИЖЕ старого предела в 12. Клипы есть, канал в
-- digest_source включён (`Premier League`, kind='channel', digest_sources.sql)
-- — а на экране и в фильтре лиг АПЛ не было вовсе.
--
-- ПОЧЕМУ ЭТО НЕ ТОЛЬКО ПРО СПИСОК. `leagues` на DigestScreen считается ИЗ
-- ТЕХ ЖЕ weekend/week (см. комментарий у useMemo в DigestScreen.tsx), а не из
-- отдельного справочника лиг — так и задумано, чтобы чип и список не могли
-- разойтись. Но это значит, что лига, чьи ролики не попали в топ-12 по
-- просмотрам, не получает даже ЧИПА: выбрать её и посмотреть её же голы
-- неоткуда, хотя в базе они есть. Поднять только чип отдельно от списка было
-- бы хуже: чип появился бы, а нажатие на него показывало бы пустой экран.
--
-- ПОЧЕМУ 40, А НЕ ДРУГОЕ ЧИСЛО. Обе функции уже клэмпят p_limit потолком в 40
-- (`least(p_limit, 40)`, не тронуто здесь) — он проверен и стоит в проде.
-- Новый умолчательный запрос забирает этот же потолок целиком, а не
-- придумывает третье число где-то между 12 и 40.
--
-- Сигнатуры функций не меняются (один int-параметр остался int-параметром,
-- набор столбцов — тот же, что digest_llm_content.sql оставил последним,
-- title_generated включительно), поэтому здесь годится create or replace —
-- в отличие от того файла, где менялся сам набор столбцов и требовался drop.
-- Гранты `create or replace` не трогает, но они перечислены явно ниже, тем
-- же приёмом, что и в исходных файлах: грант без политики этот проект уже
-- ронял дважды, повторять на глаз здесь не стоит.
-- ============================================================================

create or replace function digest_weekend_goals(p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  weekend_start timestamptz, weekend_end timestamptz, title_generated text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title), b.starts_at, b.ends_at,
         nullif(g.title_generated, '')
  from goal_clips g, b
  where g.published_at >= b.starts_at and g.published_at < b.ends_at
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

create or replace function digest_week_goals(p_limit int default 40)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  title_generated text
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title),
         nullif(g.title_generated, '')
  from goal_clips g, b
  where g.published_at >= now() - interval '7 days'
    and not (g.published_at >= b.starts_at and g.published_at < b.ends_at)
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

revoke all on function digest_weekend_goals(int) from public;
revoke all on function digest_week_goals(int) from public;
grant execute on function digest_weekend_goals(int) to anon, authenticated, service_role;
grant execute on function digest_week_goals(int) to anon, authenticated, service_role;
