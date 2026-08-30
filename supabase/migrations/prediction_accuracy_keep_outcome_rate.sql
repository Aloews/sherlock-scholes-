-- ============================================================================
-- ПОЧИНКА СТОЛКНОВЕНИЯ ДВУХ СЕССИЙ, а не новая возможность.
--
-- 30.08.2026 две сессии решали одну задачу («рейтинг прогнозистов по проценту
-- исходов») и применили свои миграции с разницей в одиннадцать минут:
--
--   17:06  prediction_outcome_rate         → колонки outcomes, outcome_rate
--   17:08  friend_prediction_outcome_rate  → то же для вкладки «Друзья»
--   17:17  prediction_accuracy             → колонки outcome_hits, accuracy,
--                                            rating; ДРОПНУЛА функции выше
--
-- Третья дропнула и пересоздала те же функции, и колонки `outcomes` и
-- `outcome_rate` исчезли. Клиент, который их читает, получил бы undefined —
-- то есть пустое место там, где стоял процент.
--
-- ⚠️ ЭТО НЕ ГИПОТЕТИЧЕСКАЯ ОПАСНОСТЬ, А СЛУЧИВШЕЕСЯ. Обе миграции лежат в
-- истории базы, обе про одно, и вторая молча съела первую: `drop function` +
-- `create` не спрашивает, кто был до тебя. Когда над одной базой работают
-- параллельно, расширять форму ответа безопасно, а дропать — нет.
--
-- Здесь форма ответа СКЛЕЕНА: возвращаются обе пары колонок. PostgREST отдаёт
-- объект, каждый клиент читает свои поля, и ни один не ломается.
--
-- ⚠️ ДА, ЭТО ИЗБЫТОЧНО: `outcome_hits` и `outcomes` — одно и то же число.
-- Избыточность, которая держит два работающих клиента, лучше чистой формы,
-- которая один из них роняет. Схлопывать — когда обе стороны договорятся, а
-- не в одностороннем порядке из миграции.
--
-- ⚠️ РАЗНИЦА МЕЖДУ `accuracy` И `outcome_rate` НЕ СЛУЧАЙНА, И ОБЕ ПРАВЫ:
--   accuracy      всегда число; 50% по двум прогнозам это честные 50%
--   outcome_rate  NULL до пяти закрытых; процент по двум — шум, а не оценка
-- Первая описывает прошлое, вторая отказывается делать вид, что предсказывает
-- будущее. НА ЭКРАНЕ ПОКАЗЫВАЕТСЯ ВТОРАЯ: там, где можно нарисовать прочерк,
-- прочерк честнее круглого числа, выведенного из двух наблюдений.
--
-- ПОРЯДОК СТРОК остаётся по `rating` (стянутые средние очки за прогноз) —
-- см. prediction_accuracy.sql. Сортировка по сумме очков, с процентом лишь как
-- вторым ключом, не решает исходную жалобу: первым всё равно оказывается тот,
-- кто чаще нажимал.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ 30.08.2026:
--   игрок с 70 закрытыми → accuracy 40, outcome_rate 40
--   игрок с  2 закрытыми → accuracy 50, outcome_rate NULL   ← порог работает
--   my_prediction_stats('not-a-real-init-data') → 28000 invalid init data
-- ============================================================================

drop function if exists public.prediction_leaderboard(integer);
drop function if exists public.friend_prediction_leaderboard(text, integer);
drop function if exists public.my_prediction_stats(text);

-- Порог, ниже которого процент не считается оценкой. Одним числом на файл.
create or replace function public.outcome_rate_min_settled()
returns integer language sql immutable as $$ select 5; $$;

create or replace function public.prediction_leaderboard(p_limit integer default 20)
returns table (
  player_id     bigint,
  first_name    text,
  last_name     text,
  avatar_url    text,
  points        integer,
  settled       integer,
  exact         integer,
  outcome_hits  integer,
  accuracy      integer,
  rating        integer,
  outcomes      integer,
  outcome_rate  integer
)
language sql stable
security definer
set search_path = public
as $$
  with totals as (
    select mp.player_id as pid,
           coalesce(sum(mp.points), 0)::int          as pts,
           count(*)::int                             as n_settled,
           count(*) filter (where mp.points = 5)::int as n_exact,
           count(*) filter (where mp.points >= 2)::int as n_outcome
      from match_predictions mp
     where mp.settled_at is not null
     group by mp.player_id
  )
  select pl.id, pl.first_name, pl.last_name, pl.avatar_url,
         t.pts, t.n_settled, t.n_exact, t.n_outcome,
         coalesce(round(t.n_outcome * 100.0 / nullif(t.n_settled, 0))::int, 0),
         prediction_rating(t.pts, t.n_settled, prediction_field_average()),
         t.n_outcome,
         case when t.n_settled >= outcome_rate_min_settled()
              then round(t.n_outcome * 100.0 / t.n_settled)::int end
    from totals t
    join players pl on pl.id = t.pid
   order by prediction_rating(t.pts, t.n_settled, prediction_field_average()) desc,
            t.n_settled desc,
            t.n_exact desc,
            pl.first_name
   limit greatest(coalesce(p_limit, 20), 1);
$$;

create or replace function public.friend_prediction_leaderboard(
  p_init_data text,
  p_limit     integer default 20
)
returns table (
  player_id     bigint,
  first_name    text,
  last_name     text,
  avatar_url    text,
  points        integer,
  settled       integer,
  exact         integer,
  outcome_hits  integer,
  accuracy      integer,
  rating        integer,
  outcomes      integer,
  outcome_rate  integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me    bigint  := tg_validate_init_data(p_init_data);
  v_field numeric := prediction_field_average();
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    with totals as (
      select pl.id as pid, pl.first_name as fn, pl.last_name as ln,
             pl.avatar_url as av,
             coalesce(sum(mp.points), 0)::int             as pts,
             count(mp.player_id)::int                     as n_settled,
             count(*) filter (where mp.points = 5)::int   as n_exact,
             count(*) filter (where mp.points >= 2)::int  as n_outcome
        from players pl
        left join match_predictions mp
               on mp.player_id = pl.id and mp.settled_at is not null
       where pl.id = v_me
          or exists (
               select 1 from friendships f
                where f.player_id = v_me and f.friend_id = pl.id
             )
       group by pl.id, pl.first_name, pl.last_name, pl.avatar_url
    )
    select t.pid, t.fn, t.ln, t.av,
           t.pts, t.n_settled, t.n_exact, t.n_outcome,
           coalesce(round(t.n_outcome * 100.0 / nullif(t.n_settled, 0))::int, 0),
           prediction_rating(t.pts, t.n_settled, v_field),
           t.n_outcome,
           case when t.n_settled >= outcome_rate_min_settled()
                then round(t.n_outcome * 100.0 / t.n_settled)::int end
      from totals t
     order by (t.n_settled > 0) desc,
              prediction_rating(t.pts, t.n_settled, v_field) desc,
              t.n_settled desc,
              t.n_exact desc,
              t.fn
     limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

create or replace function public.my_prediction_stats(p_init_data text)
returns table (
  points        integer,
  settled       integer,
  exact         integer,
  outcome_hits  integer,
  accuracy      integer,
  rating        integer,
  pending       integer,
  rank          integer,
  outcomes      integer,
  outcome_rate  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    bigint  := tg_validate_init_data(p_init_data);
  v_field numeric := prediction_field_average();
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    with totals as (
      select mp.player_id as pid,
             coalesce(sum(mp.points) filter (where mp.settled_at is not null), 0)::int as pts,
             count(*) filter (where mp.settled_at is not null)::int as n_settled,
             count(*) filter (where mp.points = 5)::int             as n_exact,
             count(*) filter (where mp.points >= 2)::int            as n_outcome,
             count(*) filter (where mp.settled_at is null)::int     as n_pending
        from match_predictions mp
       group by mp.player_id
    ),
    ranked as (
      select t.*, dense_rank() over (
               order by prediction_rating(t.pts, t.n_settled, v_field) desc
             )::int as rnk
        from totals t
       where t.n_settled > 0
    ),
    -- Своя строка собирается ОДИН раз и дальше только читается: без этого
    -- `coalesce(r.…, t.…, 0)` пришлось бы повторить в каждой из десяти
    -- колонок, и одна забытая копия молча вернула бы NULL вместо нуля.
    me as (
      select coalesce(r.pts, t.pts, 0)             as pts,
             coalesce(r.n_settled, t.n_settled, 0) as n_settled,
             coalesce(r.n_exact, t.n_exact, 0)     as n_exact,
             coalesce(r.n_outcome, t.n_outcome, 0) as n_outcome,
             coalesce(r.n_pending, t.n_pending, 0) as n_pending,
             r.rnk                                 as rnk
        from (select 1) one
        left join totals t on t.pid = v_me
        left join ranked r on r.pid = v_me
    )
    select m.pts, m.n_settled, m.n_exact, m.n_outcome,
           coalesce(round(m.n_outcome * 100.0 / nullif(m.n_settled, 0))::int, 0),
           -- Рейтинг показываем и без закрытых прогнозов: он тогда равен
           -- среднему по полю, и это правда — «пока ничего не известно».
           prediction_rating(m.pts, m.n_settled, v_field),
           m.n_pending,
           -- NULL, а не ноль: «места пока нет» и «последнее место» — разное,
           -- и экран рисует прочерк, а не номер, которого человек не заслужил.
           m.rnk,
           m.n_outcome,
           case when m.n_settled >= outcome_rate_min_settled()
                then round(m.n_outcome * 100.0 / m.n_settled)::int end
      from me m;
end;
$$;

revoke all on function public.outcome_rate_min_settled()                   from public;
revoke all on function public.prediction_leaderboard(integer)              from public;
revoke all on function public.friend_prediction_leaderboard(text, integer) from public;
revoke all on function public.my_prediction_stats(text)                    from public;

grant execute on function public.outcome_rate_min_settled()                   to anon, authenticated, service_role;
grant execute on function public.prediction_leaderboard(integer)              to anon, authenticated, service_role;
grant execute on function public.friend_prediction_leaderboard(text, integer) to anon, authenticated, service_role;
grant execute on function public.my_prediction_stats(text)                    to anon, authenticated, service_role;

comment on function public.prediction_leaderboard(integer) is
  'Таблица лидеров прогнозов. Порядок — по rating (стянутые средние очки за '
  'прогноз). outcome_hits = outcomes = число угаданных исходов (points >= 2); '
  'accuracy — процент всегда, outcome_rate — процент, но NULL до пяти '
  'закрытых прогнозов. Обе пары возвращаются нарочно: их читают разные '
  'клиенты, см. prediction_accuracy_keep_outcome_rate.sql.';
