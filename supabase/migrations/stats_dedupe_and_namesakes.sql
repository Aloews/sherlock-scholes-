-- ============================================================================
-- ЕДИНЫЕ ДАННЫЕ: дубли источников, тёзки, восстановление клуба.
--
-- ⚠️ СНАЧАЛА — ОПРОВЕРЖЕНИЕ ПРЕЖНЕГО ОТЧЁТА ЭТОГО ЖЕ ПРОЕКТА.
-- В data_consistency.sql записано «подозрение на тёзку: 351 карточка». Цифра
-- НЕВЕРНА, и вот чем она оказалась на самом деле.
--
-- 16.08.2026 к сборщику добавили второй источник, ESPN. Он пишет те же матчи,
-- что sports.ru, но ПО-АНГЛИЙСКИ:
--
--   Адриен Рабьо, 23.08.2026
--     Italian Serie A   Torino – AC Milan   голы 1  пасы 1  минуты —
--     Италия. Серия А   Торино – Милан      голы 1  пасы 1  минуты 34
--
-- Это ОДИН матч в двух строках. Прежняя проверка сравнивала названия команд
-- КАК СТРОКИ, поэтому «Torino» и «Торино» выглядели разными командами, и
-- карточка попадала в «ни одна команда не встречается во всех матчах» — то
-- есть в тёзки. Отсюда и взялись 351.
--
-- Если сравнивать команды по club_match_key (он для того и заведён), картина
-- другая:
--
--   дублей одного матча двумя источниками     577  (на 510 карточках)
--   лишних голов от этого                      75
--   лишних пасов                               45
--   НАСТОЯЩИХ тёзок (два клуба в ОДИН день)     3
--
-- Три, а не триста пятьдесят одна. Вот они, и они бесспорны:
--
--   Луис Альберто Суарес  22.08  Sporting CP – Alverca   и  Inter Miami – Toronto
--   Маркиньос             23.08  Rennes – PSG            и  Спартак – Зенит
--   Артур                 23.08  Chapecoense – São Paulo и  St. Louis – Houston
--
-- Человек не играет два матча на двух континентах в один день.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ И ЧЕГО НЕ ДЕЛАЕТ.
--
-- 1. Дубли НЕ УДАЛЯЮТСЯ. Обе строки — правда, просто разными словами, и у
--    ESPN есть то, чего нет у sports.ru (и наоборот: минуты). Вместо удаления
--    заводится представление `player_match_days` — одна строка на игрока и
--    день, — и читать статистику полагается ОТТУДА. Оба живых читателя
--    (player_ratings, player_collected_totals) уже свернуты через
--    `distinct on` вручную; представление даёт им общее место.
--
-- 2. Тёзки помечаются, а НЕ вычищаются. Столбец `disputed` на строке матча.
--    Владелец разрешил «оставить самого популярного» — популярным считается
--    кластер с БОЛЬШИМ числом матчей, остальное помечается. Помечается, а не
--    удаляется, потому что решение обратимо одним update, а удаление — нет.
--
-- 3. Автоматически решаются ТОЛЬКО бесспорные случаи — два разных клуба в
--    один день. Всё остальное уходит в отчёт. ⚠️ Так сделано намеренно:
--    игрок законно играет и за клуб, и за сборную, и «переход внутри окна»
--    от тёзки по одной лишь смене команды неотличим. Молчаливый выбор в таком
--    месте этот проект уже проходил — см. «Роналдо, игравший за Ростов и в
--    Бразилии одновременно» в шапке data_consistency.sql.
--
-- 4. Клуб восстанавливается там, где он ОДНОЗНАЧЕН. По ключу, а не по строке:
--    из-за той же двуязычности однозначных кандидатов было 37, по ключу их
--    105. ⚠️ Но в фэнтези из них попадут не все, а те, чей клуб имеет матч в
--    окне тура: таких 15. Узкое место — не клубы, а наполнение `fixtures`.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Спорные строки. Помечаются, не удаляются.
-- ---------------------------------------------------------------------------
alter table player_match_stats
  add column if not exists disputed boolean not null default false;

comment on column player_match_stats.disputed is
  'Строка приписана карточке ошибочно — почти всегда тёзка. Ставится '
  'resolve_same_day_namesakes() только для бесспорного случая: два разных '
  'клуба в ОДИН день. Обратимо одним update.';

-- ---------------------------------------------------------------------------
-- 2. Одна строка на игрока и день — общее место для всех читателей.
-- ---------------------------------------------------------------------------
create or replace view player_match_days as
  select distinct on (s.card_id, s.match_date)
         s.card_id, s.match_date, s.tournament, s.home_team, s.away_team,
         s.home_score, s.away_score, s.minutes, s.goals, s.assists,
         s.yellow, s.red, s.source
    from player_match_stats s
   where not s.disputed
   -- Побеждает строка, которая ЗНАЕТ БОЛЬШЕ: минуты есть у sports.ru и нет у
   -- ESPN. Имя источника дописано, чтобы порядок был полным — иначе ответ мог
   -- бы меняться от прогона к прогону.
   order by s.card_id, s.match_date, (s.minutes is not null) desc, s.source;

comment on view player_match_days is
  'Статистику игрока читать ОТСЮДА, а не из player_match_stats: в таблице '
  'один матч лежит дважды, если его прислали и sports.ru, и ESPN. Замер '
  '25.08.2026: 577 таких пар, 75 лишних голов.';

-- ---------------------------------------------------------------------------
-- 3. Бесспорные тёзки: один источник дал два матча в один день.
--
-- ⚠️ ПОЧЕМУ СРАВНЕНИЕ ИДЁТ ВНУТРИ ОДНОГО ИСТОЧНИКА, А НЕ ПО club_match_key.
-- Первая версия этой функции сравнивала команды через club_match_key и не
-- пометила НИЧЕГО у двух карточек из трёх. Причина: club_match_key вырезает
-- всё, кроме [a-z0-9], поэтому на КИРИЛЛИЦЕ отдаёт NULL, а sports.ru пишет
-- команды по-русски. Победителем становился NULL (14 «дней» у Маркиньоса
-- против 2 у настоящего клуба), а сравнение `<> NULL` уходило в ложную ветку
-- и не обновляло ни строки. Это ровно та ловушка, что записана в CLAUDE.md
-- про `if not NULL`, просто пришедшая с другой стороны.
--
-- Сравнение внутри одного источника решает обе беды сразу: оно доказывает
-- двух людей (источник сам себя не дублирует) и не зависит от языка, потому
-- что обе строки написаны одинаково.
--
-- ⚠️ И СЧИТАЕМ ПО КОМАНДЕ, А НЕ ПО ПАРЕ. Промежуточная версия брала самую
-- частую ПАРУ команд и на Маркиньосе выбросила его же законный матч
-- «Спартак — Зенит», оставив «Балтика — Спартак». Соперник у игрока меняется
-- каждый матч, поэтому пара не повторяется никогда; постоянен клуб, и он
-- стоит по одну из сторон.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_same_day_namesakes()
returns table (card_id uuid, name text, kept_team text, dropped text, rows_marked bigint)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with rows_ as (
    select s.ctid as rid, s.card_id, s.match_date, s.source, s.home_team, s.away_team,
           coalesce(s.home_team,'') || ' – ' || coalesce(s.away_team,'') as pair
      from player_match_stats s
      join cards c on c.id = s.card_id and c.active and c.category = 'player'
     where s.match_date > now() - interval '120 days'
  ),
  clash as (
    select r.card_id, r.match_date, r.source
      from rows_ r group by r.card_id, r.match_date, r.source
    having count(distinct r.pair) > 1
  ),
  teamfreq as (
    select t.card_id, t.source, t.team, count(distinct t.match_date) as days
      from (select r.card_id, r.source, r.match_date, r.home_team as team from rows_ r
            union all
            select r.card_id, r.source, r.match_date, r.away_team from rows_ r) t
      join clash cl on cl.card_id = t.card_id and cl.source = t.source
     where t.team is not null
     group by t.card_id, t.source, t.team
  ),
  winner as (
    select distinct on (tf.card_id, tf.source) tf.card_id, tf.source, tf.team, tf.days
      from teamfreq tf order by tf.card_id, tf.source, tf.days desc, tf.team
  ),
  victim as (
    select r.rid, r.card_id, r.pair
      from rows_ r
      join clash cl on cl.card_id = r.card_id and cl.match_date = r.match_date
                   and cl.source = r.source
      join winner w on w.card_id = r.card_id and w.source = r.source
     -- coalesce, а не голое сравнение: NULL-команда ушла бы в ложную ветку и
     -- строка молча уцелела бы.
     where coalesce(r.home_team, '') <> w.team and coalesce(r.away_team, '') <> w.team
  ),
  marked as (
    update player_match_stats s set disputed = true
      from victim v where s.ctid = v.rid
    returning s.card_id
  )
  select w.card_id, c.name, w.team,
         (select string_agg(distinct v.pair, '; ') from victim v where v.card_id = w.card_id),
         (select count(*) from marked mk where mk.card_id = w.card_id)
    from winner w join cards c on c.id = w.card_id
   where exists (select 1 from victim v where v.card_id = w.card_id);
end;
$$;

comment on function public.resolve_same_day_namesakes() is
  'Помечает disputed матчи чужого человека у карточек, где ОДИН источник дал '
  'два разных матча в один день. Победитель — КОМАНДА, встречающаяся в '
  'наибольшем числе дней: соперник меняется каждый матч, клуб — нет.';

-- ---------------------------------------------------------------------------
-- 4. Восстановление клуба из матчей — ЗАБЛОКИРОВАНО РАЗНЫМИ АЛФАВИТАМИ.
--
-- Функция оставлена, но на сегодняшних данных возвращает НОЛЬ, и вот почему.
-- Она берёт команду, стоящую во ВСЕХ днях игрока, и это требует сравнивать
-- названия. Сравнивать их нечем:
--
--   club_match_key('Зенит')  → NULL   (вырезает всё, кроме [a-z0-9])
--   club_match_key('Zenit St Petersburg') → 'zenit st petersburg'
--
-- А `player_match_days` при свёртке дубля предпочитает строку, которая знает
-- больше, то есть С МИНУТАМИ, — а минуты есть только у sports.ru, который
-- пишет по-русски. Значит после свёртки почти все строки кириллические,
-- ключей у них нет, и выводить клуб не из чего.
--
-- Замеры по дороге, чтобы следующий не повторял:
--   без фильтра NULL-ключей     95 кандидатов, из них 74 с club_key = NULL
--   с фильтром только в keys      0  (знаменатель считал и кириллические дни)
--   с фильтром и там и там        0  (после свёртки латиницы почти не осталось)
--
-- ⚠️ Чинится НЕ здесь. Нужна таблица соответствий «Зенит» = «Zenit St
-- Petersburg» либо транслитерация в club_match_key. Пока её нет, писать в
-- card_current_club нечего: строка с club_key = NULL не соединится с fixtures
-- никогда, игрок остался бы вне фэнтези, но выглядел бы заполненным и выпал
-- бы из отчёта о недостающих — то есть стало бы хуже, чем пусто.
--
-- Цена вопроса измерена и она невелика: клуб восстановим у 105 игроков, но
-- матч в окне тура есть только у 15. Узкое место фэнтези — наполнение
-- `fixtures`, а не клубы.
-- ---------------------------------------------------------------------------
create or replace function public.fill_missing_clubs()
returns table (out_card_id uuid, out_name text, out_club text, out_key text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with played as (
    select d.card_id
      from player_match_days d
      join cards c on c.id = d.card_id and c.active and c.category = 'player'
      left join card_current_club cc on cc.card_id = d.card_id
     where cc.card_id is null and d.match_date > now() - interval '30 days'
     group by d.card_id
  ),
  m as (
    select d.card_id, d.match_date, d.home_team, d.away_team
      from player_match_days d join played p on p.card_id = d.card_id
     where d.match_date > now() - interval '120 days'
       and (club_match_key(d.home_team) is not null
         or club_match_key(d.away_team) is not null)
  ),
  days as (select m.card_id, count(distinct m.match_date) as total from m group by m.card_id),
  keys as (
    select t.card_id, t.k, t.team, count(distinct t.match_date) as seen
      from (select m.card_id, m.match_date, club_match_key(m.home_team) as k, m.home_team as team from m
            union all
            select m.card_id, m.match_date, club_match_key(m.away_team), m.away_team from m) t
     where t.k is not null
     group by t.card_id, t.k, t.team
  ),
  cand as (
    select distinct on (k.card_id) k.card_id, k.k, k.team, k.seen, d.total
      from keys k join days d on d.card_id = k.card_id
     where k.seen = d.total and d.total >= 2
     order by k.card_id, k.seen desc, k.team
  ),
  ins as (
    insert into card_current_club as t (card_id, club, club_key, apps, source, fetched_at)
    select c2.card_id, c2.team, c2.k, c2.seen, 'derived:matches', now()
      from cand c2
    on conflict (card_id) do nothing
    returning t.card_id
  )
  select i.card_id, c.name, cc.club, cc.club_key
    from ins i join cards c on c.id = i.card_id
    join card_current_club cc on cc.card_id = i.card_id;
end;
$$;

comment on function public.fill_missing_clubs() is
  'Достраивает card_current_club из матчей. На сегодняшних данных отдаёт '
  'ноль: источники пишут команды разными алфавитами. См. шапку файла.';

revoke all on function public.resolve_same_day_namesakes() from public, anon, authenticated;
revoke all on function public.fill_missing_clubs() from public, anon, authenticated;
grant execute on function public.resolve_same_day_namesakes() to service_role;
grant execute on function public.fill_missing_clubs() to service_role;

-- ⚠️ Игрокам представление НЕ отдаётся. Читатели статистики — функции
-- security definer, они читают его правами владельца. Дать select напрямую
-- anon значило бы открыть чужие матчи в обход этих функций, то есть
-- расширить доступ заодно с починкой дублей.
revoke all on player_match_days from public, anon, authenticated;
grant select on player_match_days to service_role;
