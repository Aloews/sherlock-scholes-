-- Фан-клуб: новости именно о своей команде, и сборные наравне с клубами.
--
-- Владелец: «добавь возможность добавляться в фан клуб команды и отслеживать
-- новости именно о ней, так же добавь сборные».
--
-- ЧТО УЖЕ БЫЛО И ЧЕГО НЕ БЫЛО. Сам фан-клуб (`fan_clubs.sql`) существует с
-- таблицами, вступлением и списком «наши онлайн» — но экрана у него нет ни
-- одного, новостей он не отдаёт вовсе, а сборные в него не пускает
-- `is_real_club`. Здесь чинятся вторая и третья части; экран — во фронтенде.

-- ---------------------------------------------------------------------------
-- 1. Сборные — настоящие команды.
--
-- ⚠️ АВТОРИТЕТ — СПРАВОЧНИК, А НЕ ДВА КОСВЕННЫХ ПРИЗНАКА. Прежняя проверка
-- признавала клуб настоящим, если он есть у карточек игроков или в расписании.
-- У сборной нет ни того ни другого: карточка игрока стоит за клубом, а
-- `fixtures` берёт лиги. При этом в `football_club` сборных 175, с гербами и
-- переводами — то есть настоящее их некуда девать. Справочник и есть ответ на
-- вопрос «команда ли это», косвенные признаки остаются запасными.
-- ---------------------------------------------------------------------------
create or replace function public.is_real_club(p_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_key is not null and (
       exists (select 1 from football_club where club_key = p_key)
    or exists (select 1 from card_current_club where club_key = p_key)
    or exists (select 1 from fixtures
                where club_match_key(home_team) = p_key
                   or club_match_key(away_team) = p_key)
  )
$$;

comment on function public.is_real_club(text) is
  'Команда есть в справочнике (клуб ИЛИ сборная), либо у карточек игроков, '
  'либо в расписании. Без этой проверки фан-клубом можно было бы объявить '
  'любую строку.';

-- ---------------------------------------------------------------------------
-- 2. Справочник команд умеет отдавать сборные.
--
-- ⚠️ ПАРАМЕТР, А НЕ СНЯТИЕ ФИЛЬТРА. Ссыпать 175 сборных в общий список клубов
-- значило бы поставить «Бахрейн» между «Барселоной» и «Баварией»: это разные
-- вопросы — «за какой клуб болеть» и «за какую страну». Экран спрашивает то
-- или другое явно.
--
-- ⚠️ У СБОРНОЙ ПОРЯДОК СЧИТАЕТСЯ ИНАЧЕ, И ЭТО НЕ ПРИДИРКА. Сортировка по
-- размеру состава и числу матчей у сборных даёт нули у всех: `club_squad` и
-- `club_match` собраны по клубам. Нулевой сортировкой список выродился бы в
-- алфавит по внутреннему ключу — поэтому у сборных порядок по имени, честно.
-- ---------------------------------------------------------------------------
create or replace function public.club_directory(p_lang  text    default 'ru',
                                                 p_query text    default null,
                                                 p_limit integer default 60,
                                                 p_kind  text    default 'club')
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
   where f.kind = case when coalesce(p_kind, 'club') = 'national' then 'national' else 'club' end
     and (p_query is null or btrim(p_query) = ''
       or f.name ilike '%' || btrim(p_query) || '%'
       or f.name_en ilike '%' || btrim(p_query) || '%'
       or f.club_key like club_norm_key(btrim(p_query)) || '%'
       -- «Псж», «Ман Юнайтед», «Бавария» — то, как клуб зовут на самом деле.
       or exists (select 1 from club_alias a
                   where a.club_key = f.club_key
                     and a.alias_key like club_norm_key(btrim(p_query)) || '%'))
   order by case when coalesce(p_kind, 'club') = 'national' then 0
                 else coalesce(q.n, 0) end desc,
            case when coalesce(p_kind, 'club') = 'national' then 0
                 else coalesce(m.n, 0) end desc,
            f.name
   limit greatest(coalesce(p_limit, 60), 1)
$$;

comment on function public.club_directory(text, text, integer, text) is
  'Справочник команд с поиском. p_kind: club (по умолчанию) или national — '
  'сборные отдельным списком, потому что «за какой клуб болеть» и «за какую '
  'страну» это разные вопросы.';

revoke all on function public.club_directory(text, text, integer, text) from public;
grant execute on function public.club_directory(text, text, integer, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Основы имени команды — та же машинка, что режет заголовки.
--
-- ⚠️ `phraseto_tsquery` ЗДЕСЬ НЕ РАБОТАЕТ, И ЭТО ЗАМЕР, А НЕ ДОГАДКА. Первая
-- версия `club_news` искала по GIN-индексу `search_tsv`, собранному словарём
-- `simple`, — то есть без стемминга. Живой прогон: «Реал Мадрид» — НОЛЬ
-- новостей, потому что в заголовках стоит «Реала Мадрид», «Реалу», «Реал»
-- порознь. Словарь `simple` не склоняет и не знает, что это одно слово.
--
-- `digest_tokens` уже решает ровно эту задачу для заголовков: транслитерирует
-- (кириллица и латиница сходятся) и режет до пяти букв (склонение отпадает).
-- Здесь та же операция для ИМЕНИ КОМАНДЫ — и второй копии правила нет, обе
-- стороны сравнения считаются одинаково.
-- ---------------------------------------------------------------------------
create or replace function public.club_name_stems(p_name text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct left(public.digest_translit(w), 5)), '{}')
    from unnest(regexp_split_to_array(lower(coalesce(p_name, '')), '[^[:alnum:]]+')) as w
   where length(w) >= 4 and w !~ '^[0-9]+$'
$$;

comment on function public.club_name_stems(text) is
  'Имя команды в те же основы, в какие digest_tokens режет заголовок: '
  'транслит и первые 5 букв. Так «Реал» и «Real» становятся одним токеном.';

-- ⚠️ ВСЕ ОСНОВЫ, А НЕ ЛЮБАЯ (`<@`, а не пересечение). «Манчестер Сити» и
-- «Манчестер Юнайтед» делят первое слово: по любой основе Сити собирал бы
-- новости Юнайтед, и болельщик читал бы про чужую команду на своём экране.
-- Проверено на бою: с `<@` Сити получает «Мареска ввёл в „Манчестер Сити“
-- тренировки под музыку», Юнайтед — свой заголовок.
create or replace function public.club_news(
  p_club_key text,
  p_limit    integer default 12)
returns table (
  title        text,
  url          text,
  source       text,
  lang         text,
  published_at timestamptz,
  lead_text    text)
language sql
stable
security definer
set search_path = public
set statement_timeout = '10s'
as $function$
  with me as (
    select club_name_stems(f.name)    as ru,
           club_name_stems(f.name_en) as en
      from football_club f where f.club_key = p_club_key
  )
  select n.title, n.url, n.source, n.lang, n.published_at,
         coalesce(n.summary_short, news_lead(n.description))
    from news_items n, me
   where (cardinality(me.ru) > 0 or cardinality(me.en) > 0)
     and not non_football_url(n.url)
     and (
          (cardinality(me.ru) > 0 and me.ru <@ digest_tokens(n.title))
       or (cardinality(me.en) > 0 and me.en <@ digest_tokens(n.title))
     )
   order by n.published_at desc
   limit greatest(1, least(coalesce(p_limit, 12), 40));
$function$;

comment on function public.club_news(text, integer) is
  'Новости о команде: заголовок обязан содержать ВСЕ основы её имени — '
  'русского или английского.';

revoke all on function public.club_news(text, integer) from public;
grant execute on function public.club_news(text, integer) to anon, authenticated, service_role;
revoke all on function public.club_name_stems(text) from public;
grant execute on function public.club_name_stems(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. К фан-клубу сборной тоже можно присоединиться.
--
-- ⚠️ ЭТА ФУНКЦИЯ ЖИЛА ТОЛЬКО В ПРОДЕ. В репозитории её не было ни в одной
-- миграции — снята через `pg_get_functiondef` и записана сюда целиком, чтобы
-- следующая правка не начиналась с археологии.
--
-- ⚠️ СБОРНЫЕ НИЖЕ КЛУБОВ ПРИ РАВНОМ СЧЁТЕ, и это не пренебрежение. У сборной
-- нет ни состава в колоде (карточка игрока стоит за клубом), ни строки в
-- `fixtures` (там лиги) — то есть оба числа, по которым идёт сортировка, у неё
-- нули. Без явного ключа 175 сборных встали бы вперемешку с настоящими нулями
-- и вытеснили бы клубы, у которых просто нет матча на неделе.
-- ---------------------------------------------------------------------------
create or replace function public.joinable_clubs(
  p_init_data text,
  p_query     text default null,
  p_limit     integer default 30)
returns table(club_key text, club text, has_fixture boolean, cards integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
  v_q  text   := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
  with fx as (
    select distinct club_match_key(t.team) as k, t.team
      from (select home_team as team from fixtures where commence_at >= now()
            union all
            select away_team from fixtures where commence_at >= now()) t
     where club_match_key(t.team) is not null
  ),
  cc as (
    select cc.club_key as k, min(cc.club) as team, count(*)::int as n
      from card_current_club cc
     where cc.club_key is not null
     group by cc.club_key
  ),
  nat as (
    select f.club_key as k, f.name as team
      from football_club f
     where f.kind = 'national'
  ),
  merged as (
    select coalesce(fx.k, cc.k, nat.k)          as k,
           coalesce(fx.team, cc.team, nat.team) as team,
           fx.k is not null                     as has_fx,
           coalesce(cc.n, 0)                    as n,
           nat.k is not null                    as is_nat
      from fx
      full outer join cc  on cc.k  = fx.k
      full outer join nat on nat.k = coalesce(fx.k, cc.k)
  )
  select m.k, m.team, m.has_fx, m.n
    from merged m
   where m.k is not null
     and (v_q is null or m.team ilike '%' || v_q || '%')
   order by m.has_fx desc, m.n desc, m.is_nat, m.team
   limit greatest(1, least(p_limit, 100));
end;
$function$;

revoke all on function public.joinable_clubs(text, text, integer) from public;
grant execute on function public.joinable_clubs(text, text, integer) to anon, authenticated, service_role;
