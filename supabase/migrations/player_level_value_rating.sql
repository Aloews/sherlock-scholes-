-- Уровень действующего игрока — из СТОИМОСТИ И РЕЙТИНГА, а не из известности.
-- ===========================================================================
--
-- Владелец: «уровень игроков, которые ещё не завершили карьеру, лучше
-- определять по стоимости и рейтингу whoscored (попробуй спарсить)».
--
-- ⚠️ РЕЙТИНГ ЗДЕСЬ SOCCER WIKI, А НЕ WHOSCORED, И ЭТО НЕ ПОДМЕНА МОЛЧКОМ.
-- whoscored.com отдаёт 403 с фаерволом Cloudflare («Sorry, you have been
-- blocked. You are unable to access whoscored.com») на любой запрос из этой
-- среды — не JS-проверку, которую проходит браузер, а блок по адресу. Обходить
-- защиту сайта тут никто не будет. Рейтинг Soccer Wiki уже собран и лежит в
-- `cards.sw_rating` у 13 725 карточек — им и считаем. Если whoscored когда-то
-- появится, он ляжет сюда же ещё одной долей, и формулу это не переписывает.
--
-- ЧТО БЫЛО НЕ ТАК. `level` строился из `fame` — перцентиля просмотров
-- википедии, — и наполовину из формы. Известность есть у 5 418 игроков из
-- 25 508. У остальных не было НИЧЕГО:
--
--   уровень 0 у 20 463 карточек из 25 508, средний уровень по колоде 10.2
--
-- То есть у четырёх игроков из пяти под карточкой стоял ноль, и читался он
-- как «слабый», хотя значил «мы про него ничего не знаем». Стоимость есть у
-- 20 715, рейтинг Soccer Wiki у 13 725, вместе — у 12 614. Это и есть
-- покрытие, которого не хватало.
--
-- ⚠️ ДЕЙСТВУЮЩИЙ — ЭТО «ЕСТЬ ТЕКУЩАЯ СТОИМОСТЬ», И ЭТО ИЗМЕРЕНО, А НЕ
-- ПРИДУМАНО. Transfermarkt оценивает заявки клубов, а не завершивших карьеру:
-- из 16 икон колоды стоимость есть ровно у одной. Ни нулевых стоимостей, ни
-- признака «завершил» в данных нет — есть 20 715 с ценой и 4 793 без. Возраст
-- признаком не работает: старше сорока в колоде 59 человек, и у 45 из них
-- цена есть.
--
-- ⚠️ ПЕРЦЕНТИЛЬ РЕЙТИНГА, А НЕ СЫРОЙ РЕЙТИНГ. Соблазн взять `sw_rating` как
-- есть — он уже 0..100 — обманчив: на живых данных он лежит в 60..96, медиана
-- 78, десятый перцентиль 67. Сырым числом игрок четвёртого дивизиона получил
-- бы «уровень 60», то есть выше среднего, а лучший в мире — 96. Ранг внутри
-- всех оценённых сравним, число — нет. Ровно та же причина, по которой
-- перцентилями считаются и `fame`, и отдача за матч, и стоимость.
--
-- ⚠️ ПРЕЖНЕЕ ОСНОВАНИЕ НЕ УДАЛЕНО. У кого цены нет — а это иконы и все, кто
-- доигрывал до наших сборов, — уровень по-прежнему строится из известности и
-- формы, и пол для икон на месте. Заменить его стоимостью значило бы обнулить
-- Пеле.
--
-- Замер перехода: меняется уровень у 20 422 карточек, в среднем на 33 пункта;
-- ноль остаётся у 3 443 — у тех, про кого правда ничего не известно. Верх
-- списка по стоимости: Холанд, Ямаль, Мбаппе, Беллингем, Винисиус — все 100,
-- и стоимость, и рейтинг у них в верхнем перцентиле.

alter table public.player_level
  add column if not exists rating_part smallint;

comment on column public.player_level.rating_part is
  'Перцентиль рейтинга Soccer Wiki (cards.sw_rating) среди оценённых. '
  'Сырой рейтинг лежит в 60..96 и как уровень читался бы неверно.';

alter table public.player_level drop constraint if exists player_level_basis_check;
alter table public.player_level add constraint player_level_basis_check
  check (basis in ('fame', 'fame+form', 'icon', 'value', 'value+rating'));

comment on column public.player_level.basis is
  'value+rating — действующий игрок, уровень из стоимости и рейтинга Soccer '
  'Wiki; value — то же, но рейтинга нет; fame — карьера завершена или цены '
  'нет, число построено на известности; fame+form — плюс отдача за матч; '
  'icon — решил пол для икон. Экран ОБЯЗАН различать: при basis = fame число '
  'про то, как часто про человека читают, а не про игру.';

create or replace function public.rebuild_player_levels()
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
declare
  c_min_matches constant int := 10;
  c_icon_floor  constant int := 80;
  c_prior_n     constant numeric := 1;
  c_prior_v     constant numeric := 50;
  v_count integer;
  v_was   integer;
begin
  select count(*) into v_was from player_level;

  create temporary table _form on commit drop as
  with played as (
    select d.card_id, count(*)::int as matches,
           sum(coalesce(d.goals,0) * 4 + coalesce(d.assists,0) * 3)::numeric as pts
      from player_match_days d
      join cards c on c.id = d.card_id and c.active and c.category = 'player'
     where d.match_date >= current_date - 365
     group by d.card_id
    having count(*) >= c_min_matches
  )
  select card_id, matches,
         round(100 * percent_rank() over (order by pts / matches))::int as form_part
    from played;

  create temporary table _career on commit drop as
  select s.card_id,
         sum(s.minutes) filter (where not coalesce(k.is_national_team, false)) as minutes,
         (sum(s.yellow) + sum(s.yellow_red) + sum(s.red))::integer as foul_cards,
         count(distinct t.country_id) filter (
           where not coalesce(k.is_national_team, false)
             and t.country_id is not null and t.country_id > 0)::integer as countries
    from player_season_stat s
    left join tm_club k on k.id = s.club_id
    left join tm_competition t on t.id = s.competition_id
   where s.card_id is not null
   group by s.card_id;

  -- Матчи за ГЛАВНУЮ сборную: ту, за которую сыграно больше всего. Сумма по
  -- всем сборным давала Роналду 259 вместо 246 — юношеские в неё попадали.
  create temporary table _caps on commit drop as
  select distinct on (card_id) card_id, apps::integer as caps from (
    select s.card_id, k.name, sum(s.apps) as apps
      from player_season_stat s
      join tm_club k on k.id = s.club_id and k.is_national_team
     where s.card_id is not null
     group by s.card_id, k.name
  ) t order by card_id, apps desc;

  -- Рост стоимости: последнее значение против последнего не позже 90 дней
  -- назад. Хранятся ИЗМЕНЕНИЯ, поэтому обе точки ищутся как «последняя не
  -- позже даты», а не как «строка за эту дату».
  create temporary table _growth on commit drop as
  with latest as (
    select distinct on (h.card_id) h.card_id, h.value
      from card_metric_history h where h.metric = 'market_value'
     order by h.card_id, h.taken_on desc
  ), before as (
    select distinct on (h.card_id) h.card_id, h.value
      from card_metric_history h
     where h.metric = 'market_value'
       and h.taken_on <= (now() at time zone 'utc')::date - 90
     order by h.card_id, h.taken_on desc
  )
  select l.card_id, round(l.value / b.value, 3) as growth
    from latest l join before b on b.card_id = l.card_id
   where b.value is not null and b.value > 0 and l.value is not null;

  create temporary table _parts on commit drop as
  with pool as (
    select c.id as card_id, c.market_value_eur, c.pageviews, c.sw_rating,
           cr.minutes as career_minutes,
           coalesce((select h.value from card_metric_history h
                      where h.card_id = c.id and h.metric = 'news_30d'
                      order by h.taken_on desc limit 1), 0) as news
      from cards c
      left join _career cr on cr.card_id = c.id
     where c.active and c.category = 'player'
  )
  select card_id,
         case when market_value_eur is null then null else
           round(100 * percent_rank() over (
             partition by (market_value_eur is null) order by market_value_eur))::int end as value_part,
         case when pageviews is null then null else
           round(100 * percent_rank() over (
             partition by (pageviews is null) order by pageviews))::int end as views_part,
         case when career_minutes is null then null else
           round(100 * percent_rank() over (
             partition by (career_minutes is null) order by career_minutes))::int end as stats_part,
         -- ⚠️ ПЕРЦЕНТИЛЬ, А НЕ СЫРОЙ РЕЙТИНГ — см. шапку файла: sw_rating
         -- лежит в 60..96, и как уровень сырое число врёт.
         case when sw_rating is null then null else
           round(100 * percent_rank() over (
             partition by (sw_rating is null) order by sw_rating))::int end as rating_part,
         round(100 * percent_rank() over (order by news))::int as news_part
    from pool;

  create temporary table _out on commit drop as
  select p.card_id, p.value_part, p.views_part, p.stats_part, p.news_part, p.rating_part,
         round(((coalesce(p.value_part, 0) + coalesce(p.views_part, 0)
                 + coalesce(p.stats_part, 0) + p.news_part) + c_prior_n * c_prior_v)
               / ((p.value_part is not null)::int + (p.views_part is not null)::int
                  + (p.stats_part is not null)::int + 1 + c_prior_n))::int as index_score,
         ((p.value_part is not null)::int + (p.views_part is not null)::int
          + (p.stats_part is not null)::int + 1)::int as parts
    from _parts p;

  -- ⚠️ ФОРМУЛА УРОВНЯ ЖИВЁТ В ОДНОМ МЕСТЕ. Прежде она была выписана дважды —
  -- в самом уровне и в `basis`, который её же и пересчитывал, чтобы решить,
  -- перебил ли пол для икон. Две копии одного выражения расходятся на первой
  -- же правке, и подпись начинает называть не то число, что стоит рядом.
  create temporary table _lvl on commit drop as
  select c.id as card_id,
         (c.market_value_eur is not null) as playing,
         (o.rating_part is not null)      as rated,
         (f.form_part is not null)        as formed,
         case
           -- Действующий: стоимость и рейтинг, поровну. Ни одна из двух долей
           -- сама по себе не отвечает «насколько он хорош»: цена — это рынок,
           -- рейтинг — это игра.
           when c.market_value_eur is not null then
             round((coalesce(o.value_part, 0) + coalesce(o.rating_part, 0))::numeric
                   / ((o.value_part is not null)::int + (o.rating_part is not null)::int))
           -- Карьера позади: прежнее основание, слово в слово.
           when f.form_part is null then coalesce(c.fame, 0)
           else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part)
         end::int as base
    from cards c
    join _out o on o.card_id = c.id
    left join _form f on f.card_id = c.id
   where c.category = 'player' and c.active;

  select count(*) into v_count from _out;
  if v_was >= 100 and v_count < v_was / 2 then
    raise exception 'пересборка рейтинга дала % строк вместо % — это поломка источника, а не ночь без данных; прежние данные сохранены',
                    v_count, v_was;
  end if;

  delete from player_level;

  insert into player_level (card_id, level, fame_part, form_part, matches, basis,
                            value_part, views_part, stats_part, news_part, rating_part,
                            index_score, parts,
                            value_growth, caps, countries, foul_cards, computed_at)
  select c.id,
         greatest(l.base,
                  case when 'icon' = any(coalesce(c.tags, '{}')) then c_icon_floor else 0 end
         )::smallint,
         c.fame, f.form_part, coalesce(f.matches, 0),
         case
           -- Икона называется иконой, только когда ПОЛ И ЕСТЬ то, что решило.
           when 'icon' = any(coalesce(c.tags, '{}')) and c_icon_floor > l.base then 'icon'
           when l.playing and l.rated then 'value+rating'
           when l.playing              then 'value'
           when not l.formed           then 'fame'
           else 'fame+form'
         end,
         o.value_part, o.views_part, o.stats_part, o.news_part, o.rating_part,
         o.index_score, o.parts,
         g.growth, cp.caps, cr.countries, cr.foul_cards,
         now()
    from cards c
    join _out o on o.card_id = c.id
    join _lvl l on l.card_id = c.id
    left join _form f on f.card_id = c.id
    left join _growth g on g.card_id = c.id
    left join _caps cp on cp.card_id = c.id
    left join _career cr on cr.card_id = c.id
   where c.category = 'player' and c.active;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.rebuild_player_levels() is
  'Пересобирает player_level. Уровень действующего игрока (есть цена на '
  'Transfermarkt) — поровну перцентиль стоимости и перцентиль рейтинга Soccer '
  'Wiki; у остальных прежнее основание — известность и отдача за матч.';

revoke all on function public.rebuild_player_levels() from public, anon, authenticated;
grant execute on function public.rebuild_player_levels() to service_role;
