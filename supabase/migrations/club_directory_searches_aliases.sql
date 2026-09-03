-- ===========================================================================
-- club_directory — поиск смотрит и в ПСЕВДОНИМЫ.
--
-- Владелец прислал скриншот: в «Командах» набрано «Псж» — «Ничего не нашлось».
--
-- ⚠️ ДАННЫЕ БЫЛИ НА МЕСТЕ, ИХ ПРОСТО НЕ СПРАШИВАЛИ. В `club_alias` лежит
-- строка `pszh → paris saint germain` (source `same_match`, собрана из того,
-- как клуб называют в трансляциях). А поиск сверялся только с `name`,
-- `name_en` и префиксом `club_key`, то есть с «Пари Сен-Жермен» и
-- «Paris Saint-Germain FC». Ни одно из них на «Псж» не похоже.
--
-- Таблица псевдонимов заведена ровно для этого случая и не использовалась
-- нигде, кроме сопоставления имён из матчей. Замер 03.09.2026: 61 клуб
-- находится ТОЛЬКО по псевдониму — то есть каждый из них сегодня не находится.
--
-- Ключ поиска нормализуется тем же `club_norm_key`, которым построены сами
-- псевдонимы: `club_norm_key('Псж') = 'pszh'`, и регистр значения не имеет.
-- Сверять сырую строку с нормализованным ключом значило бы не находить ничего
-- и здесь.
--
-- ⚠️ ПОДЗАПРОС, А НЕ JOIN: у клуба псевдонимов несколько (у ПСЖ три), и join
-- размножил бы строку клуба по числу совпавших. Экран получил бы «Пари
-- Сен-Жермен» три раза подряд, а `limit` съел бы соседей.
-- ===========================================================================
create or replace function public.club_directory(p_lang text default 'ru',
                                                 p_query text default null,
                                                 p_limit integer default 60)
returns table (
  club_key text, name text, country text, league text, crest_url text,
  squad integer, matches integer
)
language sql stable security definer set search_path = public as $$
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.country, f.league, f.crest_url,
         coalesce(q.n, 0)::int, coalesce(m.n, 0)::int
    from football_club f
    left join lateral (select count(*) n from club_squad s
                        where s.club_key = f.club_key and s.left_at is null) q on true
    left join lateral (select count(*) n from club_match c
                        where (c.home_key = f.club_key or c.away_key = f.club_key)
                          and c.match_date >= current_date - 400) m on true
   where f.kind = 'club'
     and (p_query is null or btrim(p_query) = ''
       or f.name ilike '%' || btrim(p_query) || '%'
       or f.name_en ilike '%' || btrim(p_query) || '%'
       or f.club_key like club_norm_key(btrim(p_query)) || '%'
       -- «Псж», «Ман Юнайтед», «Бавария» — то, как клуб зовут на самом деле.
       or exists (select 1 from club_alias a
                   where a.club_key = f.club_key
                     and a.alias_key like club_norm_key(btrim(p_query)) || '%'))
   order by coalesce(q.n, 0) desc, coalesce(m.n, 0) desc, f.name
   limit greatest(coalesce(p_limit, 60), 1)
$$;

-- Грант перечислен явно: политика без гранта роняла этот проект дважды.
grant execute on function public.club_directory(text, text, integer)
  to anon, authenticated, service_role;
