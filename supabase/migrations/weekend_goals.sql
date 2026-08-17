-- ============================================================================
-- weekend_goals — лучшие голы за выходные.
--
-- «ЛУЧШИЕ» ЗДЕСЬ НАКОНЕЦ ИЗМЕРИМЫ, и это меняет обещание экрана. Дайджест дня
-- честно отказывался ранжировать ролики: Atom-фид YouTube якобы не отдаёт ни
-- просмотров, ни лайков. Он отдаёт — media:statistics и media:starRating лежат
-- внутри media:group, бесплатно и без ключа. Их просто никто не прочитал.
--
--   <media:community>
--     <media:starRating count="163" average="5.00" .../>
--     <media:statistics views="4893"/>
--   </media:community>
--
-- Поэтому порядок роликов выходных — по настоящим просмотрам, а не по времени.
--
-- ПРОСМОТРЫ РАСТУТ, ПОЭТОМУ ОБНОВЛЯЮТСЯ. Конвейер пишет ролики с
-- resolution=merge-duplicates: строка, замороженная в момент первого забора,
-- к воскресенью врёт о том, что было лучшим. Заголовки новостей, наоборот,
-- пишутся с ignore — см. комментарий у insert() в функции.
--
-- ⚠️ MERGE ТРЕБУЕТ ПРАВА UPDATE. Первый грант выдал service_role только
-- insert/select/delete, и весь прогон молча записал ноль строк при 75
-- прочитанных — тот же класс отказа, что и с самим insert, и такой же
-- правдоподобный снаружи.
--
-- «ГОЛЫ», А НЕ «МОМЕНТЫ» — ОТДЕЛЬНАЯ ЗАДАЧА, и решается не просмотрами.
-- Самое смотримое видео прошедших выходных — сейв, второе место у отбора,
-- дальше документальный фильм. Сортировка по популярности даёт лучшие МОМЕНТЫ;
-- чтобы голы шли первыми, нужен разбор заголовка, и он ниже.
-- ============================================================================

alter table goal_clips add column if not exists views bigint not null default 0;
alter table goal_clips add column if not exists likes integer not null default 0;
create index if not exists goal_clips_views_idx on goal_clips (published_at desc, views desc);

grant update on goal_clips to service_role;

/**
 * Похоже ли название на гол.
 *
 * ПЕРЕЧИСЛЕНЫ ФОРМЫ, А НЕ ОБРУБКИ, и это выяснилось на первой же проверке.
 * Вариант с основами и правым якорем — `(goal|scor|golazo)([^a-z]|$)` — не
 * ловил ни «scor**ed**», ни «golazo**s**»: правый якорь режет ровно то, ради
 * чего брались основы. Перечисление форм с якорями с обеих сторон работает и
 * заодно спасает от беды в другую сторону: «голов» совпадает с «голов», но не
 * с «голова».
 *
 * Французское «but» в единственном числе не входит намеренно — оно совпадает с
 * английским союзом, а заголовки перемешаны по языкам. Лучше потерять
 * французский гол, чем объявить голом каждое английское «but».
 *
 * Вратарь исключён отдельно: «goalkeeper» содержит «goal», а сейв — не гол.
 *
 * ⚠️ ОБЗОР МАТЧА — ЭТО И ЕСТЬ ГОЛЫ ВЫХОДНЫХ, и без этого раздел показывал не
 * то. Голы лежат в «RESUMEN LALIGA», «Full Match Highlights», «HIGHLIGHTS |
 * COPPA ITALIA» — а слова «гол» в этих заголовках нет, и прежняя проверка их
 * отбрасывала. Замер за одни выходные:
 *
 *              роликов   средние просмотры   самый смотримый
 *   «гол»         9           20 905          56 442
 *   «не гол»    128           44 305         536 769  ← обзор Нэшвилл–Майами
 *
 * То есть раздел «Голы выходных» показывал девять роликов, которые смотрят
 * ВДВОЕ МЕНЬШЕ, чем те 128, что он отбросил, и прятал самый смотримый ролик
 * недели. Сортировка тут ни при чём: она ставит голы вперёд, а ошибался
 * ответ на вопрос «что такое гол».
 *
 * После расширения: прежние 9 сохранены все до одного, добавлено 47 роликов
 * со средними 78 206 просмотров. Верхние четырнадцать проверены глазами —
 * все до одного обзоры матчей со счётом в заголовке, ложных нет.
 *
 * ПОЧЕМУ НЕ ПРОСТО СОРТИРОВАТЬ ПО ПРОСМОТРАМ. Пробовал: тогда все восемь
 * верхних роликов оказываются помечены «момент», и раздел под заголовком
 * «Голы выходных» показывает восемь карточек с плашкой «не гол». Чинить надо
 * определение, а не порядок.
 *
 * Превью и пресс-конференции исключены рядом с вратарём: «PREVIEW | Highlights
 * of last season» — это анонс, а не выходные.
 */
create or replace function looks_like_goal(p_title text)
returns boolean language sql immutable as $$
  select lower(p_title) ~ ('(^|[^[:alnum:]])('
      || 'goals?|scor(ed|es|ing|er)'
      || '|gol|goles|golazos?|golaç?os?'
      || '|golos?'
      || '|buts'
      || '|гол|голы|голов|гола|голом'
      -- Обзор матча — на пяти языках лент плюс транслит.
      || '|highlights?|resumen|resumo|r[ée]sum[ée]|obzor|обзор'
      || '|melhores momentos|best goals|top goals'
      || ')([^[:alnum:]]|$)')
     and lower(p_title) !~ 'goalkeep|goalie|preview|pre-match|conferencia|press'
$$;

/**
 * Последние ЗАВЕРШИВШИЕСЯ выходные: суббота 00:00 — понедельник 00:00 UTC.
 *
 * Именно завершившиеся. В субботу вечером «голы выходных» — это половина
 * субботы, и показывать её как итог значит показывать неполный список как
 * полный. До конца воскресенья экран смотрит на прошлую неделю, и это
 * честнее, чем растущий на глазах рейтинг.
 *
 * СЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ: в субботу и воскресенье секция показывает
 * ПРОШЛЫЕ выходные, к вечеру воскресенья — восьмидневной давности. Это не
 * недосмотр: даты стоят в заголовке секции, а свежие ролики этих же выходных
 * видны ниже, в суточной подборке. Менять это значило бы ранжировать по
 * просмотрам, которые ещё набираются.
 *
 * Проверено на восьми моментах недели (date_trunc('week') в Postgres начинает
 * неделю с понедельника, поэтому +5 дней — суббота):
 *
 *   пт 7-го 20:00   → 1–3 авг      вс 9-го 23:59   → 1–3 авг
 *   сб 8-го 00:00   → 1–3 авг      пн 10-го 00:00  → 8–10 авг  ← переключение
 *   сб 8-го 18:00   → 1–3 авг      чт 13-го 12:00  → 8–10 авг
 *                                  сб 15-го 12:00  → 8–10 авг
 *
 * ОКНО В UTC. Матч в субботу в 01:00 по Москве — это пятница 22:00 UTC, и в
 * окно он не попадёт. Для футбольного расписания случай редкий, а окно,
 * зависящее от часового пояса читателя, означало бы разный «лучший гол
 * выходных» у двух людей в одной комнате.
 */
create or replace function weekend_bounds(p_now timestamptz default now())
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable as $$
  select w.sat, w.sat + interval '2 days'
  from (select date_trunc('week', p_now) + interval '5 days' as sat) w
  where w.sat + interval '2 days' <= p_now
  union all
  select w.sat - interval '7 days', w.sat - interval '5 days'
  from (select date_trunc('week', p_now) + interval '5 days' as sat) w
  where w.sat + interval '2 days' > p_now
$$;

/**
 * Голы выходных, лучшие сверху.
 *
 * Два ключа сортировки, и порядок между ними — весь смысл: сначала то, что
 * похоже на гол, и уже внутри — по просмотрам. Обратный порядок дал бы список,
 * который открывается сейвом на миллион просмотров.
 *
 * Не-голы не выброшены, а сдвинуты вниз: разбор по заголовку ошибается в обе
 * стороны, и выбросить «ISCO tiene un imán en el pie» значило бы выбросить гол,
 * в названии которого просто нет слова «гол». Экран помечает их как моменты.
 */
create or replace function digest_weekend_goals(p_limit int default 12)
returns table (
  video_id text, title text, channel text, published_at timestamptz,
  thumb_url text, views bigint, likes integer, is_goal boolean,
  weekend_start timestamptz, weekend_end timestamptz
)
language sql stable security definer set search_path = public as $$
  with b as (select starts_at, ends_at from weekend_bounds() limit 1)
  select g.video_id, g.title, g.channel, g.published_at, g.thumb_url,
         g.views, g.likes, looks_like_goal(g.title), b.starts_at, b.ends_at
  from goal_clips g, b
  where g.published_at >= b.starts_at and g.published_at < b.ends_at
  order by looks_like_goal(g.title) desc, g.views desc
  limit greatest(1, least(p_limit, 40))
$$;

revoke all on function looks_like_goal(text) from public;
revoke all on function weekend_bounds(timestamptz) from public;
revoke all on function digest_weekend_goals(int) from public;
grant execute on function looks_like_goal(text) to anon, authenticated, service_role;
grant execute on function weekend_bounds(timestamptz) to anon, authenticated, service_role;
grant execute on function digest_weekend_goals(int) to anon, authenticated, service_role;

-- Ролики живут десять дней, а не три: выходные должны дожить до следующих.
create or replace function prune_digest()
returns void language sql security definer set search_path = public as $$
  delete from news_items where published_at < now() - interval '3 days';
  delete from goal_clips where published_at < now() - interval '10 days';
$$;
revoke all on function prune_digest() from public;
grant execute on function prune_digest() to service_role;
