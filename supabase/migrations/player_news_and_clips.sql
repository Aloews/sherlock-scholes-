-- ============================================================================
-- Новости и видео ПРО ЭТОГО ИГРОКА — на досье карточки.
--
-- ⚠️ ЭТОГО НЕ БЫЛО ВООБЩЕ, и не потому, что не собирались: у рейтинга и у
-- дайджеста разные ключи. Рейтинг ищет по `card_id`, дайджест — по клубу и
-- языку заголовка; между «досье Неймара» и лентой новостей не было ни одного
-- общего поля, по которому их можно связать.
--
-- СВЯЗКА — ТА ЖЕ ТОКЕНИЗАЦИЯ, ЧТО УЖЕ КЛЕИТ ТЕМЫ ЧЕРЕЗ АЛФАВИТЫ. `digest_tokens`
-- и `digest_translit` были написаны для `digest_topics` (см. её шапку): свести
-- «Торрес» и «Torres» к одной пятибуквенной основе. Фамилия игрока — то же
-- самое приведение, применённое не к заголовку, а к имени из `cards`. Замер
-- на боевых новостях 23.08.2026, окно суток: Месси — 4 совпадения, Мбаппе —
-- 2, Холанн — 1, Неймар — 1. Механизм рабочий, а не гипотетический.
--
-- ⚠️ ФАМИЛИЯ, А НЕ ПОЛНОЕ ИМЯ. `split_part(name_en, ' ', -1)` — последнее
-- слово. Для «Erling Haaland» это «Haaland», для «Neymar» — само «Neymar»
-- (слово одно, `split_part` вернёт его же). Взять СНАЧАЛА, а не первое слово,
-- потому что у большинства футболистов именно фамилия попадает в заголовок,
-- а имя — реже.
--
-- ⚠️ ОДНОФАМИЛЬЦЫ — ИЗВЕСТНЫЙ ПРЕДЕЛ, А НЕ БАГ ЭТОГО КОДА. «Silva» носят
-- десятки профессионалов, и заметка про другого Сильву пройдёт как про
-- этого. Смириться с этим осознанно: правильный ответ для футбола, где
-- однофамильцев физически много, дороже, чем сама эта секция, и решать эту
-- задачу здесь не будем — как и `digest_topics` в своё время не решала её
-- для клубов (см. её же комментарий про 78 ложных рёбер из 104).
--
-- НЕТ СОВПАДЕНИЙ — ЗНАЧИТ СЕКЦИИ НЕТ, а не «загрузка» или пустая рамка.
-- `news_items` живёт трое суток (`prune_digest`), и для игрока без свежего
-- инфоповода это норма, а не поломка.
-- ============================================================================

/**
 * Фамилия для поиска — основа по той же таблице, что клеит темы.
 *
 * Возвращает NULL, если имени нет вовсе или основа короче четырёх букв:
 * `digest_tokens` токенизирует слова длиннее трёх, и фамилия на грани этого
 * порога («Kane» — 4) даёт слишком много случайных совпадений, чтобы быть
 * полезной, а не только правильной технически.
 */
create or replace function public.player_surname_stem(p_name_en text)
returns text language sql immutable as $$
  select nullif(left(public.digest_translit(split_part(trim(p_name_en), ' ', -1)), 5), '')
  where length(left(public.digest_translit(split_part(trim(p_name_en), ' ', -1)), 5)) >= 4
$$;

revoke all on function public.player_surname_stem(text) from public;
grant execute on function public.player_surname_stem(text) to anon, authenticated, service_role;

create or replace function public.player_news(p_card_id uuid, p_limit integer default 8)
returns table (
  title        text,
  url          text,
  source       text,
  lang         text,
  published_at timestamptz
)
language sql
stable
as $$
  with me as (
    select public.player_surname_stem(c.name_en) as stem
    from public.cards c where c.id = p_card_id
  )
  select n.title, n.url, n.source, n.lang, n.published_at
  from public.news_items n, me
  where me.stem is not null
    and not public.non_football_url(n.url)
    and exists (
      select 1 from unnest(public.digest_tokens(n.title)) t
      where left(t, 5) = me.stem
    )
  order by n.published_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

create or replace function public.player_clips(p_card_id uuid, p_limit integer default 6)
returns table (
  video_id     text,
  title        text,
  channel      text,
  published_at timestamptz,
  thumb_url    text
)
language sql
stable
as $$
  with me as (
    select public.player_surname_stem(c.name_en) as stem
    from public.cards c where c.id = p_card_id
  )
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url
  from public.goal_clips g, me
  where me.stem is not null
    and exists (
      select 1 from unnest(public.digest_tokens(g.title)) t
      where left(t, 5) = me.stem
    )
  order by g.published_at desc
  limit greatest(1, least(coalesce(p_limit, 6), 20));
$$;

revoke all on function public.player_news(uuid, integer) from public;
revoke all on function public.player_clips(uuid, integer) from public;
grant execute on function public.player_news(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.player_clips(uuid, integer) to anon, authenticated, service_role;
