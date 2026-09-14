-- ============================================================================
-- ГРОМКОСТЬ ПРОТИВ ИГРЫ: кого обсуждают больше, чем он играет, и наоборот.
--
-- Владелец: «в футболе очень много семей, а так же в руководстве фифа и
-- агентов. Проанализируй новости об этих связях, чтобы выявить
-- игроков-проектов, талант которых сложно понять и их продвигают для
-- искусственного поднятия стоимости. Нужно выявить реальных
-- „игроков-талантов“ и „игроков-проектов“».
--
-- ⚠️ ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: РАЗБОРА РОДСТВЕННЫХ И АГЕНТСКИХ СВЯЗЕЙ ПО
-- НОВОСТЯМ. Такая штука вытаскивала бы из газетного текста утверждения вида
-- «X продвигают, потому что он чей-то сын» и вешала их на живых людей с
-- именем и фотографией. Точность подобного разбора низкая по своей природе:
-- совпадения фамилий мы только что ловили в «набирают ход» — там из
-- семнадцати строк одиннадцать оказались однофамильцами. Ошибиться здесь
-- значит публично назвать конкретного человека чьим-то ставленником. Поэтому
-- сделана ИЗМЕРИМАЯ часть задачи, и только она.
--
-- ЧТО ИЗМЕРЯЕТСЯ. Два перцентиля внутри ОДНОЙ лиги, ОДНОГО возраста и ОДНОГО
-- амплуа:
--
--     внимание = стоимость и просмотры страницы в Википедии
--     игра     = сыгранные матчи, голы и пасы
--
-- Разрыв между ними и есть ответ: «громче, чем играет» — внимание сильно выше
-- игры, «тише, чем играет» — наоборот.
--
-- ⚠️ ЭТО ИЗМЕРЕНИЕ РАЗРЫВА, А НЕ УТВЕРЖДЕНИЕ О ЧЬИХ-ЛИБО НАМЕРЕНИЯХ. Первым в
-- списке «громче» вышел Родри — обладатель «Золотого мяча», пропустивший год
-- по травме колена. Формально он действительно громче, чем играет; по сути
-- это сказано про травму, а не про раздутую репутацию. Разрыв НЕ РАЗЛИЧАЕТ
-- травму, смену клуба, дыру в нашем сборе и настоящую накачку, и экран
-- обязан это говорить прямо — он и говорит.
--
-- ТРИ ОШИБКИ, КОТОРЫЕ БЫЛИ СДЕЛАНЫ ПРИ ПОСТРОЕНИИ ЭТОЙ ФУНКЦИИ, все три
-- найдены прогоном на боевых данных, и каждая называла бы людей в лицо:
--
--   1. LEFT JOIN к статистике матчей. Статистика собрана у 9 348 игроков из
--      25 508; у остальных ноль означает «не собрали», а не «не играл».
--      Первые восемь строк оказались игроками с нулём минут, среди них
--      Эсекьель Барко, который весь год играет. Это был список дыр в нашем
--      сборе. Теперь join внутренний.
--
--   2. Сравнение без амплуа. У вратаря и защитника голы структурно равны
--      нулю, и КАЖДЫЙ вратарь попадал в «громче, чем играет»: Диогу Кошта и
--      Диант Рамай стояли в первой пятёрке. Список, обвиняющий человека за
--      то, что он вратарь, — это не измерение.
--
--   3. Игровое время по МИНУТАМ. Из 85 684 строк статистики за год минуты
--      заполнены в 43 984 — у половины их нет вовсе. Время меряется числом
--      матчей, которое есть всегда; минуты идут на экран как уточнение.
--
-- ⚠️ ВОЗРАСТНЫЕ КОРЗИНЫ ОБЯЗАТЕЛЬНЫ. Семнадцатилетний на скамейке «Барселоны»
-- дорог и обсуждаем именно потому, что он семнадцатилетний в «Барселоне», —
-- это норма его возраста, а не раздутая карточка. Без корзин список
-- «проектов» состоял бы из молодёжи богатых клубов целиком.
-- ============================================================================

drop function if exists public.player_spotlight(text, integer, text, text, integer);

create or replace function public.player_spotlight(
  p_lang    text    default 'ru',
  p_limit   integer default 20,
  p_mode    text    default 'loud',
  p_league  text    default null,
  p_days    integer default 365)
returns table (
  card_id uuid, name text, name_en text, photo_url text,
  club text, club_key text, league text, age integer, band text,
  player_position text,
  attention numeric, output numeric, gap numeric,
  apps integer, minutes integer, goals integer, assists integer,
  market_value_eur bigint, pageviews integer, peers integer)
language sql stable security definer
set search_path = public set statement_timeout = '30s'
as $$
  with played as (
    select s.card_id,
           count(*)::int as apps,
           nullif(sum(coalesce(s.minutes, 0)), 0)::int as minutes,
           sum(coalesce(s.goals, 0))::int   as goals,
           sum(coalesce(s.assists, 0))::int as assists
      from player_match_stats s
     where s.match_date >= current_date - greatest(coalesce(p_days, 365), 30)
     group by s.card_id
  ),
  base as (
    select c.id, c.name, c.name_en, c.photo_url, c.market_value_eur, c.pageviews,
           cc.club_key, fc.league,
           extract(year from age(c.born_on))::int as age,
           case when extract(year from age(c.born_on)) <= 19 then 'u19'
                when extract(year from age(c.born_on)) <= 23 then 'u23'
                when extract(year from age(c.born_on)) <= 28 then 'prime'
                else 'senior' end as band,
           pos.position as player_position,
           p.apps, p.minutes, p.goals, p.assists
      from cards c
      join card_current_club cc on cc.card_id = c.id
      join football_club fc on fc.club_key = cc.club_key
      join played p on p.card_id = c.id
      join card_position pos on pos.card_id = c.id
     where c.active and c.category = 'player'
       and c.born_on is not null
       and c.market_value_eur is not null
       and c.pageviews is not null
       and fc.league is not null and fc.league <> ''
  ),
  ranked as (
    select b.*,
           count(*) over w as peers,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.market_value_eur) as r_value,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.pageviews)        as r_views,
           percent_rank() over (partition by b.league, b.band, b.player_position order by b.apps)             as r_apps,
           percent_rank() over (partition by b.league, b.band, b.player_position order by (b.goals + b.assists)) as r_ga
      from base b
    window w as (partition by b.league, b.band, b.player_position)
  ),
  scored as (
    select r.*,
           round(((r.r_value + r.r_views) / 2)::numeric, 3) as attention,
           round(((r.r_apps  + r.r_ga)    / 2)::numeric, 3) as output
      from ranked r
     -- Меньше восьми ровесников того же амплуа в лиге — перцентиль считать
     -- не из чего, и «выше девяноста процентов» сказано про семерых.
     where r.peers >= 8
  )
  select s.id, s.name, s.name_en, s.photo_url,
         club_display_name(s.club_key, p_lang), s.club_key, s.league,
         s.age, s.band, s.player_position,
         s.attention, s.output, round(s.attention - s.output, 3),
         s.apps, s.minutes, s.goals, s.assists,
         s.market_value_eur, s.pageviews, s.peers::int
    from scored s
   where (p_league is null or p_league = '' or s.league = p_league)
   order by case when p_mode = 'quiet' then s.output - s.attention
                 else s.attention - s.output end desc,
            s.market_value_eur desc
   limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.player_spotlight(text, integer, text, text, integer) is
  'Разрыв между ВНИМАНИЕМ (стоимость и просмотры страницы) и ИГРОЙ (матчи, голы '
  'и пасы) внутри одной лиги, одного возраста и одного амплуа. p_mode = loud — '
  'о ком пишут больше, чем он играет; quiet — наоборот. Только игроки, у которых '
  'статистика матчей ЕСТЬ. Это измерение разрыва, а НЕ утверждение о чьих-либо '
  'намерениях: травма выглядит здесь так же, как накачка.';

revoke all on function public.player_spotlight(text, integer, text, text, integer) from public;
grant execute on function public.player_spotlight(text, integer, text, text, integer)
  to anon, authenticated, service_role;
