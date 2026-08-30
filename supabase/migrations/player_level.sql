-- ============================================================================
-- УРОВЕНЬ ФУТБОЛИСТА — ОДНО ЧИСЛО, КОТОРОЕ ЧИТАЮТ ВСЕ ЭКРАНЫ.
--
-- ЗАЧЕМ. Владелец: «рейтинг футболистов и тиры в коллекциях не
-- синхронизируются». Он прав, и это не рассинхрон, а два разных вопроса,
-- поданных как один ответ:
--
--   `cards.tier`      строится из `fame` — перцентиля просмотров википедии;
--   `player_ratings`  считает голы и пасы за окно.
--
-- Игрок мог стоять первым в рейтинге и оставаться `common` в коллекции, и
-- объяснить это было нечем: экран показывал два числа про одного человека и
-- не говорил, что они про разное.
--
-- ⚠️ ТИР НЕ ПЕРЕОПРЕДЕЛЁН, И ЭТО НАМЕРЕННО. `tier` — редкость, она фильтрует
-- колоду (`cards_matching`, `pick_random_cards_tiers.sql`) и стоит за ценность
-- Pro. Переставить её основание значит переразметить 2918 карточек и изменить
-- игру: 2174 common, 583 rare, 117 epic, 44 legendary поедут все сразу.
-- Такое решение принимает владелец, а не миграция. Здесь заводится ОТДЕЛЬНОЕ
-- число, которое показывается везде одинаково; переключить на него тир —
-- одна строка в `cards_tier_build.py` и пересборка.
--
-- ИЗ ЧЕГО СКЛАДЫВАЕТСЯ:
--   fame_part  перцентиль известности (кого читают);
--   form_part  перцентиль отдачи за матч среди тех, у кого хотя бы 10 матчей
--              за год (кто играет);
--   пол для икон (кто изменил футбол) — см. football_icons.sql.
--
-- ⚠️ ПОЧЕМУ ПЕРЦЕНТИЛЬ, А НЕ СЫРЫЕ «ГОЛЫ ЗА МАТЧ». Они несравнимы между
-- нападающим и защитником и между лигами — РПЛ даёт 18–32 против 60–97 у АПЛ
-- (docs/MAP.md §9). Ранг внутри всех, кто играл, сравним. Та же причина, по
-- которой `fame` — перцентиль, а не число просмотров.
--
-- ⚠️ ПОЧЕМУ ПОРОГ В ДЕСЯТЬ МАТЧЕЙ, А НЕ В ТРИ. Первая версия ставила три, и в
-- верхушку тут же приехали Жуан Феликс с формой 98 по ТРЁМ матчам и Луис
-- Суарес с 99 по четырём — выше Винисиуса с 70 матчами. Отдача за матч это
-- среднее, а среднее по трём наблюдениям не мера игрока, а мера удачной
-- недели. Цена измерена: форму получают 624 игрока вместо 985, остальные
-- честно помечены basis = 'fame'.
-- ============================================================================

create table if not exists public.player_level (
  card_id     uuid primary key references public.cards(id) on delete cascade,
  level       smallint not null,
  fame_part   smallint,
  form_part   smallint,
  matches     integer not null default 0,
  basis       text not null,
  computed_at timestamptz not null default now()
);

alter table public.player_level drop constraint if exists player_level_basis_check;
alter table public.player_level add constraint player_level_basis_check
  check (basis in ('fame', 'fame+form', 'icon'));

create index if not exists player_level_idx on public.player_level (level desc);

comment on table public.player_level is
  'Уровень футболиста — ОДНО число, которое читают все экраны. Заведено '
  'потому, что рейтинг (голы и пасы) и тир коллекции (известность) отвечали '
  'на разные вопросы и расходились.';

comment on column public.player_level.basis is
  'fame — матчей мало, число построено только на известности; fame+form — '
  'есть и то и другое; icon — решил пол для икон. Экран ОБЯЗАН различать: при '
  'basis = fame число про то, как часто про человека читают, а не про игру.';

create or replace function public.rebuild_player_levels()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_min_matches constant int := 10;   -- см. шапку файла
  c_icon_floor  constant int := 80;   -- 'rare' начинается с 75
  v_count integer;
begin
  create temporary table _out on commit drop as
  select d.card_id,
         count(*)::int as matches,
         sum(coalesce(d.goals,0) * 4 + coalesce(d.assists,0) * 3)::numeric as pts
    from player_match_days d
    join cards c on c.id = d.card_id and c.active and c.category = 'player'
   where d.match_date >= current_date - 365
   group by d.card_id
  having count(*) >= c_min_matches;

  create temporary table _form on commit drop as
  select card_id, matches,
         round(100 * percent_rank() over (order by pts / matches))::int as form_part
    from _out;

  delete from player_level;

  insert into player_level (card_id, level, fame_part, form_part, matches, basis, computed_at)
  select c.id,
         greatest(
           case when f.form_part is null then coalesce(c.fame, 0)
                -- Поровну: известность говорит, кого знают, отдача — кто
                -- играет, и ни одна сама по себе не отвечает «насколько он
                -- хорош». Перевес в любую сторону пришлось бы обосновывать
                -- замером, которого у нас нет.
                else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part)
           end,
           case when 'icon' = any(coalesce(c.tags, '{}')) then c_icon_floor else 0 end
         )::smallint,
         c.fame,
         f.form_part,
         -- Матчи считаются ВСЕГДА, даже когда их мало для формы: экран должен
         -- уметь сказать «сыграл 4 матча», а не молчать о них.
         coalesce(f.matches, (select count(*) from player_match_days d
                               where d.card_id = c.id
                                 and d.match_date >= current_date - 365), 0),
         case
           -- Икона называется иконой, только когда ПОЛ И ЕСТЬ то, что решило.
           -- У Пеле fame = 99, и подписать его «икона» вместо честного
           -- «известность» значило бы объяснять число не тем.
           when 'icon' = any(coalesce(c.tags, '{}'))
                and c_icon_floor > case when f.form_part is null then coalesce(c.fame, 0)
                                        else round(0.5 * coalesce(c.fame, 0) + 0.5 * f.form_part) end
             then 'icon'
           when f.form_part is null then 'fame'
           else 'fame+form'
         end,
         now()
    from cards c
    left join _form f on f.card_id = c.id
   where c.category = 'player' and c.active
     -- Ни известности, ни матчей, ни признания — уровня нет. Ноль означал бы
     -- «слабый», а правда — «мы про него ничего не знаем».
     and (c.fame is not null or f.form_part is not null
          or 'icon' = any(coalesce(c.tags, '{}')));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.rebuild_player_levels() is
  'Пересобирает player_level. Форма — ПЕРЦЕНТИЛЬ отдачи среди тех, у кого '
  'хотя бы десять матчей за год.';

alter table public.player_level enable row level security;
drop policy if exists player_level_read on public.player_level;
create policy player_level_read on public.player_level
  for select to anon, authenticated using (true);
grant select on public.player_level to anon, authenticated;
grant select, insert, update, delete on public.player_level to service_role;
revoke all on function public.rebuild_player_levels() from public, anon, authenticated;
grant execute on function public.rebuild_player_levels() to service_role;

-- ---------------------------------------------------------------------------
-- Рейтинг отдаёт уровень и КЛЮЧ КЛУБА.
--
-- Ключ — чтобы строка рейтинга ВЕЛА на экран команды, а не только называла
-- клуб; уровень — чтобы число под футболистом было тем же, что в коллекции.
-- Клуб берётся из `club_squad`, а не из `card_current_club`: там он с ключом.
--
-- ⚠️ DROP перед CREATE — меняется тип возврата (42P13). Обе команды в одной
-- транзакции, окна без функции не возникает.
-- ---------------------------------------------------------------------------
drop function if exists public.player_ratings(integer, integer);

create or replace function public.player_ratings(p_days integer default 7,
                                                 p_limit integer default 50)
returns table (
  card_id   uuid,
  name      text,
  name_en   text,
  photo_url text,
  country   text,
  club      text,
  club_key  text,
  level     smallint,
  basis     text,
  matches   integer,
  minutes   integer,
  goals     integer,
  assists   integer,
  points    integer
)
language sql stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.name_en, c.photo_url, c.country,
         f.name, f.club_key,
         l.level, l.basis,
         count(*)::int,
         -- NULL, а не ноль: минут нет у ESPN вовсе, и выдуманный ноль выиграл
         -- бы ничью «меньше минут при той же отдаче» у того, кто её заслужил.
         nullif(sum(coalesce(d.minutes, 0)), 0)::int,
         sum(coalesce(d.goals, 0))::int,
         sum(coalesce(d.assists, 0))::int,
         (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3)::int
    from player_match_days d
    join cards c on c.id = d.card_id and c.active and c.category = 'player'
    left join club_squad q on q.card_id = c.id and q.left_at is null
    left join football_club f on f.club_key = q.club_key
    left join player_level l on l.card_id = c.id
   where d.match_date >= current_date - greatest(coalesce(p_days, 7), 1)
   group by c.id, c.name, c.name_en, c.photo_url, c.country,
            f.name, f.club_key, l.level, l.basis
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
   order by (sum(coalesce(d.goals, 0)) * 4 + sum(coalesce(d.assists, 0)) * 3) desc,
            sum(coalesce(d.goals, 0)) desc,
            sum(coalesce(d.minutes, 0)) asc nulls last,
            c.name
   limit greatest(coalesce(p_limit, 50), 1);
$$;

comment on function public.player_ratings(integer, integer) is
  'Рейтинг футболистов за окно в днях. Отдаёт club_key и level, чтобы строка '
  'вела на экран команды и показывала ТОТ ЖЕ уровень, что коллекция.';

grant execute on function public.player_ratings(integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Пересборка — в 06:40 UTC, ПОСЛЕ конвейера клубов (06:25) и card_current_clubs
-- (06:10).
--
-- ПОЧЕМУ ПОСЛЕ. Форма считается по player_match_days — он не зависит от
-- клубов, — но `player_ratings` соединяется с `club_squad`, и запуск раньше
-- клубов давал бы рейтинг со вчерашними клубами при сегодняшних числах.
--
-- ПОЧЕМУ ИКОНЫ В ТОМ ЖЕ ЗАДАНИИ И ПЕРВЫМИ. Пол для икон читается из
-- `cards.tags`, а ставит его apply_football_icons(). Порознь они однажды
-- разъедутся, и уровень будет посчитан по вчерашнему списку.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'rebuild-player-levels',
  '40 6 * * *',
  $$select public.apply_football_icons(); select public.rebuild_player_levels()$$
);

--   select cron.unschedule('rebuild-player-levels');
