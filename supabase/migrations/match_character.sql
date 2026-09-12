-- ============================================================================
-- Характер матча по кнопке.
--
-- Владелец: «в прогнозе, как будет разворачиваться характер игры используй все
-- метрики, новости, травмы, требования руководства и характер тренера, а так же
-- его состояние» и потом «доделай анализ характера матча по кнопке в
-- прогнозах».
--
-- ⚠️ ЭТО НЕ ПРОГНОЗ СЧЁТА И НЕ ФАВОРИТ, И ЭТО ГРАНИЦА, А НЕ СКРОМНОСТЬ. Шапка
-- FixtureCard запрещает выделенную сторону, вероятности и всё, производное от
-- коэффициентов. Здесь не обходной путь: функция отвечает на другой вопрос —
-- КАКИМ БУДЕТ МАТЧ (открытым или вязким, результативным или скупым), а не КТО
-- ВЫИГРАЕТ. Поэтому обе стороны отдаются симметрично, порядок всегда «хозяева,
-- потом гости», и ни одного числа, которое можно прочесть как шанс, здесь нет.
--
-- ⚠️ СЧИТАЕТ БАЗА, А НЕ МОДЕЛЬ. Соблазн был: отдать метрики языковой модели и
-- получить абзац прозы. Но модель здесь врала бы дважды — во-первых, ключ
-- NEWS_LLM_* уже однажды выжигали автоматическими вызовами (см. шапку
-- football-digest), и владелец прямо сказал «автоматически больше их не трать»;
-- во-вторых, красивый абзац неотличим от выдуманного, а число — отличимо: под
-- ним стоит `matches`, и читатель видит, на скольких матчах оно построено.
--
-- ЧЕГО ЗДЕСЬ НЕТ, И ЭТО ЧЕСТНО: травм и требований руководства. Ни того, ни
-- другого нет НИ В ОДНОМ нашем источнике — ни в ESPN, ни в лентах, ни в Soccer
-- Wiki. Придумать их было бы легко и незаметно; вместо этого их просто нет, и
-- когда источник появится, добавить сюда поле — одна строка.
--
-- Что есть: характер обоих клубов (`club_character` — измерен по их же
-- матчам), их тренеры, ожидаемая результативность и новости последних суток по
-- каждому клубу.
-- ============================================================================

drop function if exists match_character(text, text);

create or replace function match_character(p_fixture_id text, p_lang text default 'ru')
returns table (
  fixture_id text,
  home_key text, home_name text,
  away_key text, away_name text,
  -- Характер каждой стороны — те же коды, что рисует экран клуба, и та же
  -- локаль. Вторая шкала оценок здесь означала бы, что «атакующий» на двух
  -- экранах считается по-разному.
  home_traits text[], away_traits text[],
  home_matches integer, away_matches integer,
  home_attack integer, home_defence integer, home_openness integer,
  away_attack integer, away_defence integer, away_openness integer,
  home_home_edge integer, away_home_edge integer,
  home_steadiness integer, away_steadiness integer,
  home_gf_pm numeric, home_ga_pm numeric,
  away_gf_pm numeric, away_ga_pm numeric,
  home_manager text, away_manager text,
  -- ⚠️ ОЖИДАЕМЫЕ ГОЛЫ — СУММА ДВУХ СТОРОН, А НЕ ЧЕЙ-ТО СЧЁТ. Забитые хозяев
  -- усредняются с пропущенными гостей и наоборот; отдельными числами это было
  -- бы предсказание счёта, то есть ровно то, что здесь запрещено.
  expected_goals numeric,
  -- Открытость игры — среднее двух открытостей. Обе построены на своих же
  -- матчах, шкала одна, поэтому среднее осмысленно.
  openness integer,
  home_news integer, away_news integer,
  home_headline text, away_headline text
)
language sql stable security definer set search_path = public
set statement_timeout to '10s'
as $$
  with want as materialized (
    -- ⚠️ ВТОРОЙ КОПИИ ПРАВИЛА СОПОСТАВЛЕНИЯ ЗДЕСЬ НЕТ — та же
    -- resolve_club_key, что в fixture_clubs и top_fixtures.
    select f.id,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.id = p_fixture_id
  ),
  news as materialized (
    select k.club_key,
           count(*)::integer as n,
           (array_agg(n.title order by n.published_at desc))[1] as headline
      from (select hk as club_key from want where hk is not null
            union select ak from want where ak is not null) k
      cross join lateral club_news(k.club_key, 5) n
     where n.published_at >= now() - interval '2 days'
     group by k.club_key
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
         -- ⚠️ ТОЛЬКО `club_manager`, И НИКОГДА СНИМОК. Разбор — ниже, в
         -- разделе про столбец, которого больше нет.
         hm.name, am.name,
         case when h.club_key is null or a.club_key is null then null
              else round(((h.gf_pm + a.ga_pm) / 2 + (a.gf_pm + h.ga_pm) / 2)::numeric, 1) end,
         case when h.club_key is null or a.club_key is null then null
              else ((h.openness + a.openness) / 2)::integer end,
         coalesce(hn.n, 0), coalesce(an.n, 0),
         hn.headline, an.headline
    from want w
    left join club_character h on h.club_key = w.hk
    left join club_character a on a.club_key = w.ak
    left join club_manager hm on hm.club_key = w.hk
    left join club_manager am on am.club_key = w.ak
    left join news hn on hn.club_key = w.hk
    left join news an on an.club_key = w.ak;
$$;

revoke all on function match_character(text, text) from public;
grant execute on function match_character(text, text) to anon, authenticated, service_role;


-- ─── Тренер перестаёт лежать в двух местах ──────────────────────────────────
--
-- ⚠️ ЭТО ПОЧИНКА, НАЙДЕННАЯ ПЕРВЫМ ЖЕ ПРОГОНОМ ФУНКЦИИ ВЫШЕ. `match_character`
-- сначала брала тренера из `club_character.manager` — и отдала по «Барселоне»
-- Ismael Rescalvo, тренера эквадорского «Барселона СК». Тот же чужой тренер,
-- которого уже вычищали из `club_manager` неделю назад.
--
-- Но `club_manager` в этот момент был УЖЕ ПРАВИЛЬНЫМ — «Ханси Флик», собран в
-- 21:04. Врал снимок в `club_character`, снятый в 15:42: сборщик тренеров
-- ходит непрерывно, а пересборка характера — раз в сутки, и между ними всегда
-- есть окно, в котором копия отстаёт. Замер: РАЗОШЛИСЬ 35 КЛУБОВ из 366.
--
-- Это не «надо чаще пересобирать»: чаще — это то же самое окно, только уже.
-- Это один факт в двух местах, ровно та болезнь, от которой в этом проекте
-- лечат везде. Столбец не читает ни один экран (экран клуба берёт тренера из
-- `club_profile`, а тот — из `club_manager`), поэтому он убирается: то, чего
-- нет, не может разойтись.
--
-- ⚠️ ТЕЛО ФУНКЦИИ НИЖЕ — БОЕВОЕ, СНЯТОЕ `pg_get_functiondef`, а не написанное
-- заново по памяти. Написанное заново уже разошлось с настоящим на двух
-- временных таблицах и на `statement_timeout`; поймано сверкой до выкладки.
-- Изменены ровно две строки: `manager` убран из списка столбцов вставки и
-- подзапрос `(select g.name from club_manager …)` убран из выборки.
alter table public.club_character drop column if exists manager;

CREATE OR REPLACE FUNCTION public.rebuild_club_character(p_days integer DEFAULT 400, p_min_matches integer DEFAULT 10)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '300s'
AS $function$
declare v_was integer; v_now integer;
begin
  select count(*) into v_was from club_character;

  create temporary table _cm on commit drop as
  select m.home_key as club_key, true as at_home, m.match_date,
         m.home_score as gf, m.away_score as ga
    from club_match m
   where m.match_date >= current_date - greatest(coalesce(p_days, 400), 30)
     and m.home_score is not null and m.away_score is not null
  union all
  select m.away_key, false, m.match_date, m.away_score, m.home_score
    from club_match m
   where m.match_date >= current_date - greatest(coalesce(p_days, 400), 30)
     and m.home_score is not null and m.away_score is not null;

  -- ⚠️ ТОЛЬКО КЛЮЧИ, КОТОРЫЕ ЕСТЬ В СПРАВОЧНИКЕ. В club_match попадают имена
  -- команд, которым мы клуба так и не завели («verder» и подобные): без этого
  -- условия вставка падает на внешнем ключе. Так и упало.
  create temporary table _raw on commit drop as
  select c.club_key,
         count(*)::int as matches,
         min(c.match_date) as from_on,
         max(c.match_date) as to_on,
         round(avg(c.gf), 3) as gf_pm,
         round(avg(c.ga), 3) as ga_pm,
         round(avg(c.gf + c.ga), 3) as goals_pm,
         round(avg(case when c.at_home then case when c.gf > c.ga then 3 when c.gf = c.ga then 1 else 0 end end), 3) as ppg_home,
         round(avg(case when not c.at_home then case when c.gf > c.ga then 3 when c.gf = c.ga then 1 else 0 end end), 3) as ppg_away,
         -- ⚠️ РАЗБРОС ПО РАЗНИЦЕ МЯЧЕЙ, А НЕ ПО ОЧКАМ: очки — три ступеньки, и
         -- ровная команда с рваной по ним похожи. Разница мячей различает
         -- «семь раз 1:0» и «то 5:0, то 0:4».
         round(coalesce(stddev_samp(c.gf - c.ga), 0), 3) as gd_sd
    from _cm c
   where exists (select 1 from football_club f where f.club_key = c.club_key)
   group by c.club_key
  having count(*) >= greatest(coalesce(p_min_matches, 10), 3);

  delete from club_character;

  insert into club_character (club_key, matches, gf_pm, ga_pm, goals_pm, ppg_home, ppg_away,
                              gd_sd, attack, defence, openness, home_edge, steadiness,
                              traits, window_days, from_on, to_on, computed_at)
  with p as (
    select r.*,
           round(100 * percent_rank() over (order by r.gf_pm))::int as attack,
           round(100 * percent_rank() over (order by r.ga_pm desc))::int as defence,
           round(100 * percent_rank() over (order by r.goals_pm))::int as openness,
           round(100 * percent_rank() over (
             order by coalesce(r.ppg_home, 0) - coalesce(r.ppg_away, 0)))::int as home_edge,
           round(100 * percent_rank() over (order by r.gd_sd desc))::int as steadiness
      from _raw r
  )
  select p.club_key, p.matches, p.gf_pm, p.ga_pm, p.goals_pm, p.ppg_home, p.ppg_away,
         p.gd_sd, p.attack, p.defence, p.openness, p.home_edge, p.steadiness,
         -- ⚠️ ЧЕРТА НАЗЫВАЕТСЯ ТОЛЬКО ПРИ ЯВНОМ ОТКЛОНЕНИИ. Порог 70/30, а не
         -- 50: половина клубов не может быть «атакующей» — тогда слово ничего
         -- не значит. Черт может не быть вовсе, и это честный ответ.
         (select coalesce(array_agg(t), '{}') from (
            select 'attacking' as t where p.attack >= 70 and p.defence < 70
            union all select 'defensive' where p.defence >= 70 and p.attack < 70
            union all select 'complete'  where p.attack >= 70 and p.defence >= 70
            union all select 'open'      where p.openness >= 75
            union all select 'closed'    where p.openness <= 25
            union all select 'home'      where p.home_edge >= 75
            union all select 'steady'    where p.steadiness >= 75
            union all select 'streaky'   where p.steadiness <= 25
         ) q),
         greatest(coalesce(p_days, 400), 30), p.from_on, p.to_on,
         now()
    from p;

  get diagnostics v_now = row_count;
  if v_was >= 50 and v_now < v_was / 2 then
    raise exception 'пересборка характера дала % строк вместо % — поломка источника, прежние данные сохранены',
                    v_now, v_was;
  end if;
  return v_now;
end;
$function$;

revoke all on function public.rebuild_club_character(integer, integer) from public, anon, authenticated;
grant execute on function public.rebuild_club_character(integer, integer) to service_role;
