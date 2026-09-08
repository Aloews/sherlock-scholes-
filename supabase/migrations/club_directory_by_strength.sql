-- Список команд — от сильной к слабой, а не по размеру нашей выгрузки.
-- ===========================================================================
--
-- Владелец: «рейтинг команд не сортируется от лучшей к самой не
-- результативной».
--
-- Прежде первым ключом порядка стояло ЧИСЛО ИГРОКОВ В ЗАЯВКЕ. Это мера того,
-- сколько мы успели собрать, а не того, насколько команда хороша: клуб с
-- сорока оцифрованными карточками обгонял «Реал», у которого их тридцать
-- четыре. Список читался как случайный, и это ровно та жалоба.
--
-- ⚠️ ОДНОГО club_rating.level НЕ ХВАТАЕТ, И ЭТО ИЗМЕРЕНО: уровень есть у 507
-- клубов из 2 719. Сортировка только по нему увела бы 2 212 команд — четыре
-- пятых списка — в общий хвост без всякого порядка. Поэтому вторым ключом
-- идёт СТОИМОСТЬ СОСТАВА: она известна там, где сыгранных матчей нет, и это
-- мера силы клуба, а не размера выгрузки.
--
-- ⚠️ ПОРЯДОК ДЕРЖИТСЯ НА СТОИМОСТИ СОСТАВА. Владелец: «давай пока сделаем
-- основным рейтингом всего для всех экранов именно стоимость. А с набором
-- данных сможем понять и проверим, какой лучше показатель отображает силу
-- игрока». elo остался ВТОРЫМ ключом — там, где стоимость неизвестна, порядок
-- всё равно нужен. Ни elo, ни level не выброшены: сравнивать потом будет
-- нечем. Ниже — почему сортировать по level нельзя было и раньше.
--
-- ⚠️ ПОРЯДОК НЕ ДЕРЖИТСЯ НА level, А ОН ПОКАЗЫВАЕТСЯ. Это не расхождение, а
-- починка: `level` — перцентиль, округлённый до целого, и на верхушке в сотню
-- упираются СЕМЬ клубов сразу (Реал, Ман Сити, Арсенал, Барселона, Бавария,
-- Интер, Аль-Хилаль). Владелец увидел это как «на первом месте оказалась и
-- Барселона и Интер». Сортировать по числу, у которого нет разрешения
-- различить верхушку, нельзя; `elo` — то же самое до округления.
--
-- ⚠️ ЧИСЛО, ПО КОТОРОМУ СПИСОК УПОРЯДОЧЕН, ВОЗВРАЩАЕТСЯ НАРУЖУ. Порядок, чью
-- причину не видно, читается как отсутствие порядка — с этого и началось.
-- Экран показывает уровень, а где его нет — стоимость состава.
--
-- Первая десятка после правки: Реал Мадрид, Манчестер Сити, Арсенал,
-- Барселона, Бавария, Интер, Аль-Хилаль, ПСЖ, Порту, Спортинг.
--
-- ⚠️ DROP ПЕРЕД CREATE: в `returns table` добавились колонки, а на это
-- Postgres отвечает «cannot change return type of existing function».
drop function if exists public.club_directory(text, text, integer, text);

create or replace function public.club_directory(
  p_lang  text default 'ru',
  p_query text default null,
  p_limit integer default 60,
  p_kind  text default 'club'
) returns table (
  club_key text, name text, country text, league text, crest_url text,
  squad integer, matches integer,
  level integer, squad_value bigint
)
language sql stable security definer set search_path = public as $$
  with val as (
    select cc.club_key, sum(c.market_value_eur)::bigint as v
      from card_current_club cc
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  )
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.country, f.league, f.crest_url,
         coalesce(q.n, 0)::int, coalesce(m.n, 0)::int,
         r.level::int, v.v
    from football_club f
    left join lateral (select count(*) n from club_squad s
                        where s.club_key = f.club_key and s.left_at is null) q on true
    left join lateral (select count(*) n from club_match c
                        where (c.home_key = f.club_key or c.away_key = f.club_key)
                          and c.match_date >= current_date - 400) m on true
    left join club_rating r on r.club_key = f.club_key
    left join val v on v.club_key = f.club_key
   where f.kind = case when coalesce(p_kind, 'club') = 'national' then 'national' else 'club' end
     and (p_query is null or btrim(p_query) = ''
       or f.name ilike '%' || btrim(p_query) || '%'
       or f.name_en ilike '%' || btrim(p_query) || '%'
       or f.club_key like club_norm_key(btrim(p_query)) || '%'
       -- «Псж», «Ман Юнайтед», «Бавария» — то, как клуб зовут на самом деле.
       or exists (select 1 from club_alias a
                   where a.club_key = f.club_key
                     and a.alias_key like club_norm_key(btrim(p_query)) || '%'))
   order by v.v desc nulls last,
            r.elo desc nulls last,
            coalesce(q.n, 0) desc,
            coalesce(m.n, 0) desc,
            f.name
   limit greatest(coalesce(p_limit, 60), 1)
$$;

comment on function public.club_directory(text, text, integer, text) is
  'Справочник команд с поиском, ОТ СИЛЬНОЙ К СЛАБОЙ: elo (level округлён и на верхушке не различает), затем стоимость состава.';

revoke all on function public.club_directory(text, text, integer, text) from public;
grant execute on function public.club_directory(text, text, integer, text)
  to anon, authenticated, service_role;
