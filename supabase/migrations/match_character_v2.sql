-- ============================================================================
-- «Характер матча», переделанный: сухие числа вместо общих слов и отбор новостей.
--
-- Владелец: «Описание нужно не такое общее, либо просто добавить сухую
-- статистику. Комментарий "Голов ожидаемо столько же, сколько в обычном матче"
-- звучит так же поиздевательски и несёт очень мало информации. Так же в
-- "пишут" везде новости об анонсе матча и где его посмотреть, это не относится
-- к "прогнозу характера матча" — лучше глубже проанализировать новости и найти
-- комментарии о том, как тренер видит новый стиль игры. Так же строчка про
-- травмы и требования неинформативная, если нет данных её лучше не писать.»
--
-- Он прав во всех трёх пунктах, и каждый чинится по-своему.
--
-- ⚠️ 1. ОБЩАЯ ФРАЗА УБРАНА, ВМЕСТО НЕЁ ЧИСЛО С ТОЧКОЙ ОТСЧЁТА. «Столько же,
-- сколько в обычном матче» — это пересказ середины шкалы, и он не несёт
-- ничего: читатель уже знает, что бывают обычные матчи. Теперь отдаётся
-- `goals_median` — медиана результативности по ВСЕМ измеренным клубам, — и
-- экран пишет «2.9 против 2.7 обычных». Два числа рядом проверяемы; прилагательное нет.
--
-- ⚠️ 2. НОВОСТИ ОТБИРАЮТСЯ, А НЕ БЕРУТСЯ ПОСЛЕДНИЕ. Замер по ленте за трое
-- суток показал ровно то, о чём писал владелец: в свежих заголовках клуба
-- преобладают анонсы и трансляции —
--
--   «"Леванте" — "Барселона": во сколько начало матча Ла Лиги, где смотреть»
--   «"Спартак" — "Ростов": онлайн-трансляция матча 8-го тура начнётся в 17:00»
--   «Celta de Vigo - Málaga, en directo | Sigue en vivo»
--   «Coventry vs Brighton team news LIVE!»
--
-- а рядом в той же ленте лежит то, что к характеру игры ОТНОСИТСЯ:
--
--   «"Мы хотим сделать небо голубым". Буадди — о манчестерском дерби»
--   «Кварацхелия: стоит допустить ошибку — можно оказаться на скамейке»
--   «Le Borussia Mönchengladbach se sépare déjà de son entraîneur»
--
-- Отсюда `news_about_play`: анонс отбрасывается совсем, цитата и слова тренера
-- поднимаются наверх. Имя тренера в заголовке — самый сильный признак, потому
-- что именно его владелец и просил искать.
--
-- ⚠️ 3. СТРОКА ПРО ТРАВМЫ УБРАНА СОВСЕМ. Она печаталась всегда и говорила
-- «данных о травмах и дисквалификациях у нас нет» — то есть занимала место,
-- сообщая об отсутствии. Источника травм у проекта по-прежнему нет ни одного;
-- когда появится, появится и строка. Правило владельца шире одной строки и
-- принято целиком: НЕТ ДАННЫХ — НЕТ СТРОКИ.
-- ============================================================================

/**
 * Насколько заголовок относится к ИГРЕ, а не к её расписанию.
 *
 * 0 — не показывать вовсе. Больше нуля — можно, и чем больше, тем раньше.
 *
 * ⚠️ ОТКАЗ ПРОВЕРЯЕТСЯ ПЕРВЫМ И ПЕРЕВЕШИВАЕТ ВСЁ. «Coventry vs Brighton team
 * news LIVE!» содержит и «team news», и, в других заголовках того же вида,
 * имена тренеров — но это всё равно анонс. Отрицание сильнее утверждения:
 * тот же порядок, что у `looks_like_goal` и у снятого `is_studio_talk`.
 *
 * ⚠️ ЯЗЫКОВ ДЕВЯТЬ, И СПИСКИ ТОЖЕ. Лента приходит на девяти языках (замер:
 * ru, en, es, pt, fr в одной выборке за трое суток). Список из одной кириллицы
 * отбрасывал бы только русские анонсы, а испанские «en directo» пропускал —
 * и читатель Ла Лиги видел бы ровно то, на что жаловался владелец.
 */
create or replace function public.news_about_play(
  p_title   text,
  p_manager text default null
)
returns integer
language plpgsql
immutable
as $$
declare
  s        text := lower(coalesce(p_title, ''));
  surname  text;
  score    integer := 0;
begin
  if s = '' then
    return 0;
  end if;

  -- ОТКАЗ: анонс, трансляция, «где смотреть», готовый счёт, составы.
  if s ~ ('во сколько|где смотреть|онлайн-?трансляц|прямая трансляц|начн[еёo]тся в'
       || '|стартовые составы|анонс матча|превью|превью матча|сч[её]т и результат'
       || '|en directo|en vivo|minuto a minuto|c[oó]mo ver|a qu[eé] hora|alineaciones'
       || '|ao vivo|onde assistir|que horas|escala[cç][aã]o'
       || '|en direct|o[uù] voir|[aà] quelle heure|compositions probables'
       || '|live-?ticker|wo l[aä]uft|aufstellung'
       || '|how to watch|where to watch|kick-?off time|team news|live blog|as it happened'
       || '|\mlive\M|\mlivestream\M|\mpreview\M|\mline-?ups?\M|\mvs\M.*\mlive\M')
  then
    return 0;
  end if;

  -- Цитата в кавычках — прямая речь, а не пересказ ленты.
  if s ~ '«[^»]{6,}»|"[^"]{6,}"|“[^”]{6,}”' then
    score := score + 2;
  end if;

  -- «Фамилия — о чём-то» и «Фамилия: ...» — два способа, которыми русские
  -- издания подписывают прямую речь. Оба встретились в замере.
  if s ~ '(^|[^[:alnum:]])— ?об? |[[:alpha:]]{3,}: ' then
    score := score + 2;
  end if;

  -- Глаголы речи на языках ленты.
  if s ~ ('заявил|рассказал|объяснил|признал|высказал|ответил|назвал|раскритиков'
       || '|\msays\M|\msaid\M|explains|admits|insists|reveals'
       || '|dice|explica|asegura|afirma|reconoce'
       || '|diz|garante'
       || '|d[eé]clare|explique|affirme')
  then
    score := score + 1;
  end if;

  -- Тренер сам по себе повод: смена, слова, решение по составу.
  if s ~ ('тренер|наставник|\mcoach\M|\mmanager\M|entra[iî]neur|t[eé]cnico'
       || '|treinador|allenatore|\mtrainer\M')
  then
    score := score + 2;
  end if;

  -- Стиль и тактика — то, ради чего блок и открывают.
  if s ~ ('тактик|схем[аеуы]|стил[ьея]|прессинг|расстановк|перестро'
       || '|t[aá]ctic|esquema|estilo|presi[oó]n'
       || '|tactique|syst[eè]me|pressing'
       || '|\mtactic|formation|\mstyle\M|high press')
  then
    score := score + 2;
  end if;

  -- ⚠️ ИМЯ ТРЕНЕРА В ЗАГОЛОВКЕ — САМЫЙ ПРЯМОЙ ПРИЗНАК, и именно его владелец
  -- просил искать: «комментарии о том, как тренер видит новый стиль игры».
  -- Берётся ФАМИЛИЯ (последнее слово) и только от четырёх букв: «Луис» или
  -- «Ten» совпали бы с половиной ленты.
  if p_manager is not null and btrim(p_manager) <> '' then
    surname := lower(split_part(btrim(p_manager), ' ',
                                array_length(string_to_array(btrim(p_manager), ' '), 1)));
    if length(surname) >= 4 and position(surname in s) > 0 then
      score := score + 3;
    end if;
  end if;

  return score;
end;
$$;

comment on function public.news_about_play(text, text) is
  'Насколько заголовок про ИГРУ, а не про расписание. 0 — не показывать. '
  'Анонсы и трансляции отбрасываются первыми, слова тренера поднимаются.';

revoke all on function public.news_about_play(text, text) from public;
grant execute on function public.news_about_play(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Сама справка: те же числа, но с точкой отсчёта, с формой и с отобранной
-- новостью.
--
-- ⚠️ СНАЧАЛА DROP: набор выходных колонок изменился (ушли `home_news`/
-- `away_news`, пришли `goals_median`, `home_form`/`away_form`,
-- `home_headline_score`/`away_headline_score`), а `create or replace` этого не
-- разрешает — 42P13.
-- ---------------------------------------------------------------------------
drop function if exists match_character(text, text);

create or replace function match_character(p_fixture_id text, p_lang text default 'ru')
returns table (
  fixture_id text,
  home_key text, home_name text,
  away_key text, away_name text,
  home_traits text[], away_traits text[],
  home_matches integer, away_matches integer,
  home_attack integer, home_defence integer, home_openness integer,
  away_attack integer, away_defence integer, away_openness integer,
  home_home_edge integer, away_home_edge integer,
  home_steadiness integer, away_steadiness integer,
  home_gf_pm numeric, home_ga_pm numeric,
  away_gf_pm numeric, away_ga_pm numeric,
  home_manager text, away_manager text,
  expected_goals numeric,
  -- ⚠️ ТОЧКА ОТСЧЁТА, БЕЗ КОТОРОЙ ЧИСЛО НЕ ЧИТАЕТСЯ. «Ожидается 2.9» само по
  -- себе не говорит ничего — много это или мало. Медиана результативности по
  -- всем измеренным клубам отвечает на это одним числом рядом, и оба числа
  -- читатель может сверить. Прежде тут стояло прилагательное «как в обычном
  -- матче», и владелец назвал его издевательским — справедливо: оно
  -- пересказывало середину шкалы и не добавляло ни одного факта.
  goals_median numeric,
  openness integer,
  -- Последние пять матчей буквами, старые слева: WWDLW. Порядок важен —
  -- «три победы подряд, потом два поражения» и обратное это разные команды,
  -- а три-два-ноль одинаковы.
  home_form text, away_form text,
  -- ⚠️ ЗАГОЛОВОК ТЕПЕРЬ ОТОБРАННЫЙ, А НЕ ПОСЛЕДНИЙ, и рядом лежит его оценка:
  -- по ней видно, ПОЧЕМУ он выбран, и видно снаружи, что отбор работает.
  -- NULL значит «ничего про игру не нашлось» — и тогда строки на экране нет
  -- вовсе, а не «новостей нет».
  home_headline text, away_headline text,
  home_headline_score integer, away_headline_score integer
)
language sql stable security definer set search_path = public
set statement_timeout to '10s'
as $$
  with want as materialized (
    select f.id,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.id = p_fixture_id
  ),
  keys as (
    select k.club_key, cm.name as manager
      from (select hk as club_key from want where hk is not null
            union select ak from want where ak is not null) k
      left join club_manager cm on cm.club_key = k.club_key
  ),
  -- ⚠️ ОКНО ПЯТЬ СУТОК И ДВАДЦАТЬ ЗАГОЛОВКОВ, А БЫЛО ДВОЕ И ПЯТЬ. После
  -- отбора из пяти свежих заголовков не остаётся НИЧЕГО в половине случаев:
  -- анонсы и трансляции как раз самые свежие. Брать шире и отбирать строже —
  -- это и есть «глубже проанализировать новости», о котором просил владелец.
  news as materialized (
    select k.club_key,
           (array_agg(n.title order by news_about_play(n.title, k.manager) desc,
                                       n.published_at desc))[1] as headline,
           max(news_about_play(n.title, k.manager)) as score
      from keys k
      cross join lateral club_news(k.club_key, 20) n
     where n.published_at >= now() - interval '5 days'
       and news_about_play(n.title, k.manager) > 0
     group by k.club_key
  ),
  form as (
    select k.club_key,
           (select string_agg(case when x.gf > x.ga then 'W'
                                   when x.gf = x.ga then 'D' else 'L' end, ''
                              order by x.match_date)
              from (select m.match_date,
                           case when m.home_key = k.club_key then m.home_score
                                else m.away_score end as gf,
                           case when m.home_key = k.club_key then m.away_score
                                else m.home_score end as ga
                      from club_match m
                     where (m.home_key = k.club_key or m.away_key = k.club_key)
                       and m.home_score is not null and m.away_score is not null
                     order by m.match_date desc
                     limit 5) x) as letters
      from keys k
  )
  select w.id,
         w.hk, case when w.hk is null then null else club_display_name(w.hk, p_lang) end,
         w.ak, case when w.ak is null then null else club_display_name(w.ak, p_lang) end,
         coalesce(h.traits, '{}'), coalesce(a.traits, '{}'),
         h.matches, a.matches,
         h.attack, h.defence, h.openness,
         a.attack, a.defence, a.openness,
         h.home_edge, a.home_edge,
         h.steadiness, a.steadiness,
         h.gf_pm, h.ga_pm, a.gf_pm, a.ga_pm,
         hm.name, am.name,
         case when h.club_key is null or a.club_key is null then null
              else round(((h.gf_pm + a.ga_pm) / 2 + (a.gf_pm + h.ga_pm) / 2)::numeric, 1) end,
         -- Медиана по всем измеренным клубам. 366 строк — считается даром, и
         -- считается ЗДЕСЬ, чтобы экран не знал, откуда берётся «обычный матч».
         (select round(percentile_cont(0.5) within group (order by c.goals_pm)::numeric, 1)
            from club_character c),
         case when h.club_key is null or a.club_key is null then null
              else ((h.openness + a.openness) / 2)::integer end,
         hf.letters, af.letters,
         hn.headline, an.headline,
         hn.score, an.score
    from want w
    left join club_character h on h.club_key = w.hk
    left join club_character a on a.club_key = w.ak
    left join club_manager hm on hm.club_key = w.hk
    left join club_manager am on am.club_key = w.ak
    left join news hn on hn.club_key = w.hk
    left join news an on an.club_key = w.ak
    left join form hf on hf.club_key = w.hk
    left join form af on af.club_key = w.ak;
$$;

revoke all on function match_character(text, text) from public;
grant execute on function match_character(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- И ЗАОДНО ГЛАВНОЕ ЧИСЛО ЭТОЙ ПРАВКИ: `club_news` стоила 750 мс НА КЛУБ.
--
-- ⚠️ НАШЛОСЬ ПО ЖАЛОБЕ ПРОВЕРКИ, А НЕ ПО ПОДОЗРЕНИЮ. `check-prod` краснел на
-- «Характер матча укладывается в лимит anon»: 1795 мс при пороге 1500. Первая
-- догадка была «это нагрузка от моих же сборщиков» — догадка оказалась
-- НЕВЕРНОЙ, и хорошо, что её проверили: замер в самой базе дал те же 1620 мс
-- без всякой сети.
--
-- EXPLAIN показал виновника одной строкой:
--
--   Function Scan on club_news  (actual time=785.291..785.292 rows=1 loops=2)
--
-- `club_news` перебирала ВСЕ строки `news_items` и на каждой считала
-- `digest_tokens(title)` — разбор с транслитерацией. 1850 заметок, около
-- 0.4 мс на заметку: 750 мс за клуб, полторы секунды за матч.
--
-- ⚠️ ОКНО ПО ВРЕМЕНИ ЗДЕСЬ НЕ ПОМОГЛО БЫ, и это стоило проверить прежде, чем
-- писать: лента чистится, и ВСЕ 1850 заметок моложе пяти суток. Помогает
-- другое — `digest_tokens` объявлена IMMUTABLE, а значит по ней строится
-- индекс, и разбор считается ОДИН РАЗ на заметку при записи, а не на каждый
-- заход читателя.
--
-- Замер после:
--
--   club_news        750 мс → 5 мс   (на клубе с двумя именами;
--                                     у клуба с одним см. ниже)
--   match_character 1620 мс → 17 мс
--
-- Это чинит не только этот блок: `club_news` читают ещё экран клуба и комната
-- болельщиков.
-- ---------------------------------------------------------------------------
create index if not exists news_items_tokens_idx
  on public.news_items using gin (digest_tokens(title));

-- ⚠️ ОПЕРАТОР ПЕРЕВЁРНУТ НА `@>`, И ЭТО НЕ СТИЛЬ. GIN индексирует ЛЕВУЮ
-- сторону: `digest_tokens(title) @> me.ru` берёт индекс, а
-- `me.ru <@ digest_tokens(title)` планировщик обязан сначала переписать сам.
-- Писать так, как ищется, дешевле, чем надеяться на переписывание.
create or replace function public.club_news(p_club_key text, p_limit integer default 12)
returns table (title text, url text, source text, lang text,
               published_at timestamptz, lead_text text)
language sql stable security definer
set search_path to 'public'
set statement_timeout to '10s'
as $function$
  -- ⚠️ ПУСТАЯ СТОРОНА ОТСЕКАЕТСЯ `nullif`, А НЕ `cardinality(...)` ВНУТРИ OR —
  -- И ЭТО ВТОРАЯ ПОЛОВИНА ТОЙ ЖЕ ПОЧИНКИ, НАЙДЕННАЯ ПОЗЖЕ. Перевёрнутый `@>`
  -- сам по себе индекс ещё не даёт: guard внутри OR лишает планировщика права
  -- им воспользоваться — он не знает заранее, что одна сторона пуста, и обе
  -- ветки вырождаются в полный проход по news_items с `digest_tokens` на
  -- каждой заметке. Поймано порогом проверки: «характер матча» снова покраснел
  -- на 634 мс, и виноват оказался клуб «Атлетико» — основа имени одна
  -- (`{atlet}`), а `name_en` у него пуст, то есть вторая ветка всегда пустая.
  --
  --   club_news('atletiko', 20)   425 мс -> 5.9 мс   (те же 20 строк)
  --   match_character             773 мс -> 20 мс
  --
  -- Отсекать пустую сторону ОБЯЗАТЕЛЬНО: `x @> '{}'` истинно для ЛЮБОЙ строки,
  -- то есть без отсечения клуб без имени собрал бы всю ленту. `nullif` даёт
  -- `x @> NULL` = NULL — ветка не срабатывает, а обе остаются обычными `@>` и
  -- складываются в BitmapOr по одному индексу. Проверено контролем: по
  -- выдуманному ключу по-прежнему НОЛЬ заметок.
  with me as (
    select nullif(club_name_stems(f.name), '{}')    as ru,
           nullif(club_name_stems(f.name_en), '{}') as en
      from football_club f where f.club_key = p_club_key
  )
  select n.title, n.url, n.source, n.lang, n.published_at,
         coalesce(n.summary_short, news_lead(n.description))
    from news_items n, me
   where not non_football_url(n.url)
     and (digest_tokens(n.title) @> me.ru or digest_tokens(n.title) @> me.en)
   order by n.published_at desc
   limit greatest(1, least(coalesce(p_limit, 12), 40));
$function$;
