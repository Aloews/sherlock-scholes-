-- Характер команды — ИЗМЕРЕННЫЙ, а не приписанный.
-- ===========================================================================
--
-- Владелец: «характер тренера определяет характер команды, но характера
-- тренеров меняются со временем».
--
-- Второе — главное, и оно решает форму. Ярлык, поставленный однажды, стареет
-- МОЛЧА: тренер сменил подход, а подпись осталась и продолжает выглядеть
-- уверенно. Поэтому характер здесь не хранится словами, а СЧИТАЕТСЯ из
-- сыгранных матчей в скользящем окне и пересобирается ночью — значит меняется
-- сам, без чьего-либо решения.
--
-- ИЗ ЧЕГО СЧИТАЕТСЯ. Пять осей, все перцентили среди клубов, у которых за
-- окно набралось не меньше десяти матчей (таких 366 из 2 556):
--
--   attack     забито за матч
--   defence    пропущено за матч, порядок обратный: меньше — выше
--   openness   всего голов в матче, обе стороны — открытый футбол против закрытого
--   home_edge  очки за матч дома минус в гостях
--   steadiness разброс разницы мячей, порядок обратный: меньше — ровнее
--
-- ⚠️ РАЗБРОС СЧИТАЕТСЯ ПО РАЗНИЦЕ МЯЧЕЙ, А НЕ ПО ОЧКАМ. Очки — три ступеньки,
-- и по ним ровная команда с рваной похожи. Разница мячей различает «семь раз
-- 1:0» и «то 5:0, то 0:4».
--
-- ⚠️ ЧЕРТА НАЗЫВАЕТСЯ ТОЛЬКО ПРИ ЯВНОМ ОТКЛОНЕНИИ: порог 70/30, а не 50.
-- Половина клубов не может быть «атакующей» — тогда слово ничего не значит.
-- Черт может не быть вовсе, и это честный ответ, а не пустота.
--
-- ⚠️ ЧЕРТЫ ХРАНЯТСЯ КОДАМИ, А НЕ ТЕКСТОМ. Строка на русском в базе означала бы
-- девять переводов внутри SQL; переводит экран.
--
-- ⚠️ ЭТО ОКНО, А НЕ СРОК ТРЕНЕРА, И РАЗНИЦУ НАДО ДЕРЖАТЬ В ГОЛОВЕ. Soccer Wiki
-- не отдаёт истории назначений — `club_manager_spell` копится у нас с первого
-- сбора. Пока она короткая, окно шире срока, и колонка `manager` значит «кто
-- ведёт команду сейчас», а не «все эти матчи его». Когда периоды накопятся,
-- окно можно будет сузить до срока, и формула от этого не меняется.
--
-- Проверка на живых данных: «Бавария» — забито 3.24, атака 100, открытость 99,
-- черты attacking + open. «Арсенал» — пропущено 0.73, оборона 95, ровность 80,
-- черты complete + steady. «Интер» — оборона 84, complete. Читается как правда.

create table if not exists public.club_character (
  club_key    text primary key references public.football_club(club_key) on delete cascade,
  matches     integer not null,
  gf_pm       numeric,
  ga_pm       numeric,
  goals_pm    numeric,
  ppg_home    numeric,
  ppg_away    numeric,
  gd_sd       numeric,
  attack      smallint,
  defence     smallint,
  openness    smallint,
  home_edge   smallint,
  steadiness  smallint,
  traits      text[] not null default '{}',
  window_days integer not null,
  from_on     date,
  to_on       date,
  manager     text,
  computed_at timestamptz not null default now()
);

comment on table public.club_character is
  'Характер команды — ИЗМЕРЕННЫЙ, а не подписанный. Пересчитывается ночью в скользящем окне, поэтому меняется со временем сам. ⚠️ ОКНО, А НЕ СРОК ТРЕНЕРА: Soccer Wiki не отдаёт истории назначений, club_manager_spell копится с 08.09.2026.';
comment on column public.club_character.traits is
  'Коды черт, а не текст: переводит экран. Строка на русском в базе означала бы девять переводов в SQL.';
comment on column public.club_character.manager is
  'Кто вёл команду на момент расчёта. НЕ значит, что все матчи окна — его.';

alter table public.club_character enable row level security;
drop policy if exists club_character_read on public.club_character;
create policy club_character_read on public.club_character for select to anon, authenticated using (true);
grant select on public.club_character to anon, authenticated;
grant select, insert, update, delete on public.club_character to service_role;

create or replace function public.rebuild_club_character(p_days integer default 400,
                                                        p_min_matches integer default 10)
returns integer
language plpgsql security definer set search_path = public
set statement_timeout = '300s' as $$
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
         -- ⚠️ РАЗБРОС ПО РАЗНИЦЕ МЯЧЕЙ, А НЕ ПО ОЧКАМ — см. шапку файла.
         round(coalesce(stddev_samp(c.gf - c.ga), 0), 3) as gd_sd
    from _cm c
   where exists (select 1 from football_club f where f.club_key = c.club_key)
   group by c.club_key
  having count(*) >= greatest(coalesce(p_min_matches, 10), 3);

  delete from club_character;

  insert into club_character (club_key, matches, gf_pm, ga_pm, goals_pm, ppg_home, ppg_away,
                              gd_sd, attack, defence, openness, home_edge, steadiness,
                              traits, window_days, from_on, to_on, manager, computed_at)
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
         -- ⚠️ ПОРОГ 70/30, А НЕ 50 — см. шапку файла.
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
         (select g.name from club_manager g where g.club_key = p.club_key),
         now()
    from p;

  get diagnostics v_now = row_count;
  if v_was >= 50 and v_now < v_was / 2 then
    raise exception 'пересборка характера дала % строк вместо % — поломка источника, прежние данные сохранены',
                    v_now, v_was;
  end if;
  return v_now;
end;
$$;

comment on function public.rebuild_club_character(integer, integer) is
  'Пересобирает club_character: пять осей перцентилями и коды черт при отклонении 70/30.';

revoke all on function public.rebuild_club_character(integer, integer) from public, anon, authenticated;
grant execute on function public.rebuild_club_character(integer, integer) to service_role;

-- Ночью — вместе с рейтингами клубов, они читают те же club_match.
select cron.alter_job(17, command =>
  'select public.rebuild_league_seasons(); select public.rebuild_club_ratings_guarded(); select public.rebuild_club_character()');
