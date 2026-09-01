-- ============================================================================
-- Новости грузились 1.8 секунды. Причина — O(n²) внутри digest_news.
--
-- ЧТО БЫЛО. Громкость сюжета (сколько РАЗНЫХ изданий о нём вышло) считалась
-- коррелированным подзапросом: для КАЖДОЙ свежей заметки перебирались ВСЕ
-- свежие заметки, и на каждой паре выполнялось пересечение массивов токенов.
-- За сутки приходит 881 заметка, из них на паре языков 485 — это 235 тысяч
-- пересечений массивов на один открытый экран.
--
-- Лимит при этом не помогал вовсе: громкость считалась для всех 485 строк и
-- только потом отрезались 60. Уменьшать p_limit было бесполезно.
--
-- ЧТО СТАЛО. Токены разворачиваются в пары (id, токен), и вся работа сводится
-- к ОДНОМУ соединению по токену. «Три общих токена» — это группа с
-- count(*) >= 3, а не пересечение массивов на каждой из 235 тысяч пар.
--
-- ЗАМЕР НА БОЕВОЙ БАЗЕ 30.08.2026, по три прогона подряд:
--
--            лучший   средний   худший
--     было    1751      1823     1945 мс
--     стало    118       124      133 мс      ≈ 14.7×
--
-- ⚠️ `select distinct` В tok — НЕ УКРАШЕНИЕ. Старая версия считала общие
-- токены через INTERSECT, а он дедуплицирует. Без distinct повторяющийся
-- токен в заголовке дал бы в соединении 2×2 = 4 строки на ОДИН общий токен, и
-- порог «три общих» брался бы двумя. Расхождение было бы тихим: лента
-- осталась бы живой, просто громкость поехала бы — а это порядок строк.
--
-- ⚠️ ГРУППИРОВКА ПО id, А НЕ ПО url. По url тот же запрос считался 240 мс и
-- сваливал HashAggregate на диск (15 МБ, 9 проходов): ключ группировки — две
-- длинные строки на пару, а пар сорок три тысячи. bigint убирает и
-- переливание на диск, и половину оставшегося времени.
--
-- ПРОВЕРЕНО НА БОЕВЫХ ДАННЫХ, ВСЕ 485 СТРОК, НЕ ТОЛЬКО ВЫДАННЫЕ 60:
--   старая и новая громкость совпали в 485 случаях из 485, расхождений 0.
--   ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: та же сверка с порогом 2 вместо 3 даёт 207
--   расхождений — значит сверка СПОСОБНА упасть, а не пуста. Зелёная пустая
--   проверка хуже красной.
--
-- Форма ответа здесь не меняется ни на колонку: это ускорение, а не новая
-- функция. Колонка lead_text появляется следующей миграцией.
-- ============================================================================

create or replace function public.digest_news(p_lang text default 'en', p_limit integer default 30)
returns table (
  title         text,
  url           text,
  source        text,
  lang          text,
  published_at  timestamptz,
  image_url     text,
  loudness      integer,
  summary_short text
)
language sql
stable
security definer
set search_path = public
as $$
  with fresh as (
    select n.id, n.title, n.url, n.source, n.lang, n.published_at, n.image_url,
           n.summary_short, digest_tokens(n.title) as toks
      from news_items n
     where n.published_at > now() - interval '24 hours'
       and n.lang in (p_lang, 'en')
       and not non_football_url(n.url)
  ),
  -- distinct: см. шапку — INTERSECT в прежней версии дедуплицировал сам.
  tok as (select distinct f.id, t from fresh f, unnest(f.toks) t),
  -- Пары заметок, у которых не меньше трёх ОБЩИХ токенов.
  pairs as (
    select a.id as aid, b.id as bid
      from tok a join tok b on a.t = b.t
     group by a.id, b.id
    having count(*) >= 3
  ),
  loud as (
    select p.aid, count(distinct fb.source)::int as loudness
      from pairs p
      join fresh fb on fb.id = p.bid
     group by p.aid
  )
  select f.title, f.url, f.source, f.lang, f.published_at, f.image_url,
         -- Заметка короче трёх токенов не совпадает даже сама с собой, и в
         -- loud её нет вовсе. Ноль, а не NULL: «о ней никто больше не писал».
         coalesce(l.loudness, 0),
         nullif(f.summary_short, '')
    from fresh f
    left join loud l on l.aid = f.id
   order by coalesce(l.loudness, 0) desc, f.published_at desc
   limit greatest(1, least(p_limit, 60));
$$;

revoke all on function public.digest_news(text, integer) from public;
grant execute on function public.digest_news(text, integer) to anon, authenticated, service_role;
