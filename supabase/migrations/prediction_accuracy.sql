-- ============================================================================
-- Рейтинг прогнозистов: точность, а не объём.
--
-- ЧТО БЫЛО НЕ ТАК. `prediction_leaderboard` сортировала по сумме очков. Сумма
-- растёт от КОЛИЧЕСТВА прогнозов: сто прогнозов при 40% верных исходов дают
-- больше очков, чем двадцать при 90%, и в таблице лидеров первым оказывается
-- тот, кто просто чаще нажимал. Чутьё от усидчивости это не отличает вовсе —
-- а таблица лидеров существует ровно затем, чтобы их различать.
--
-- ЧТО СЧИТАЕТСЯ ТЕПЕРЬ. Средние очки за прогноз, СТЯНУТЫЕ к среднему по полю:
--
--     рейтинг = (сумма очков + 10 × среднее_по_полю) / (закрытых + 10) × 100
--
-- То есть каждому дописывается десять воображаемых прогнозов, сыгранных ровно
-- на уровне поля. Зачем — видно на боевых данных (30.08.2026, среднее по полю
-- 1.194 очка за прогноз):
--
--     игрок   очков  закрытых  в точку  исходов  средние  рейтинг
--     A          81        70        7      40%    1.157      116
--     B           5         2        1      50%    2.500      141
--
-- Голое среднее ставит B выше A более чем вдвое — за две попытки, одна из
-- которых угадана в точку. Стягивание сводит разрыв к 141 против 116 и
-- сокращает его дальше с каждым прогнозом B.
--
-- ⚠️ СТЯГИВАНИЕ НЕ ГАРАНТИРУЕТ, ЧТО ВЕТЕРАН БУДЕТ ВЫШЕ, и это не недоделка.
-- В примере B остаётся первым — потому что 70 прогнозов игрока A говорят, что
-- он предсказывает чуть ХУЖЕ среднего, а две попытки B не говорят почти
-- ничего и оставляют его у среднего. Убирается раздутая оценка, а не сама
-- возможность новичку стоять высоко на тонких данных. Ровно поэтому рядом с
-- рейтингом всегда показывается число закрытых прогнозов: читатель должен
-- видеть, на чём оценка построена.
--
-- Почему именно 10. К сорока настоящим прогнозам приставка весит четверть, к
-- сотне — десятую часть, то есть перестаёт мешать тем, кто действительно
-- играет; при этом двух-трёх попыток не хватает, чтобы улететь наверх.
-- Число это выбор, а не истина: меньше — резче качели у новичков, больше —
-- дольше всем сидеть у среднего. Порога «не меньше N прогнозов» здесь нет
-- намеренно: сегодня в таблице два игрока, и любой порог оставил бы её пустой.
--
-- ×100 — чтобы отдавать целое, а не дробь: «сколько очков ты набрал бы за
-- СТО прогнозов такого качества». Дробь в этом месте читается хуже и по
-- дороге в JSON превращается в строку.
--
-- ПРОЦЕНТ УДАЧНЫХ ИСХОДОВ отдаётся отдельным числом, `accuracy`. Исход угадан,
-- когда `prediction_points` дал 2 и больше:
--
--     5  точный счёт          → исход, разумеется, тоже
--     3  угадана разница мячей → знак разницы тот же, значит и исход
--     2  угадан знак разницы   → это и есть «угадал исход»
--     0  не угадан
--
-- ⚠️ Это СЛЕДСТВИЕ правила начисления, а не отдельное правило. Поменяется
-- `prediction_points` — порог `>= 2` надо перечитать здесь же.
--
-- ПРОВЕРЕНО НА БОЕВОЙ БАЗЕ 30.08.2026, БЕЗ МОКОВ, С ОТРИЦАТЕЛЬНЫМИ КОНТРОЛЯМИ.
--
--   1. Порог «исход угадан». Перебраны ВСЕ 1296 сочетаний счетов 0..5 × 0..5
--      против настоящих 0..5 × 0..5. `prediction_points(...) >= 2` совпало с
--      прямым определением исхода (`sign(ph-pa) = sign(rh-ra)`) в 1296 случаях
--      из 1296, расхождений нет.
--      Контроль контроля: заведомо неверный порог `>= 3` даёт 340 расхождений
--      на той же сетке — значит проверка СПОСОБНА упасть, а не пуста.
--
--   2. Рейтинг на живых данных: A(81 очко/70) → 116, B(5/2) → 141, новичок
--      (0/0) → 119, при среднем по полю 1.194. Совпадает с таблицей выше.
--
--   3. `my_prediction_stats('not-a-real-init-data')` падает с 28000
--      «invalid init data» — грант не открыл функцию мимо подписи.
--
-- ⚠️ ФОРМА ОТВЕТА ТОЛЬКО РАСШИРЕНА. Параметры прежние, старые колонки на
-- месте, добавлены новые: боевой фронтенд, который их не знает, просто их не
-- увидит (PostgREST отдаёт объект, клиент читает свои поля). Именно поэтому
-- здесь нет шима вроде легаси-`pick_random_cards` — ломать нечего.
-- ============================================================================

-- Возвращаемый тип меняется, поэтому `create or replace` не годится: Postgres
-- не переписывает функцию с другой формой ответа.
drop function if exists public.prediction_leaderboard(integer);
drop function if exists public.friend_prediction_leaderboard(text, integer);
drop function if exists public.my_prediction_stats(text);

-- ---------------------------------------------------------------------------
-- Средние очки за прогноз по всему полю — точка, к которой стягиваются все.
--
-- Отдельной функцией, чтобы три места считали ОДНО И ТО ЖЕ. Разойдутся — и
-- место игрока в личной сводке перестанет совпадать с его строкой в таблице,
-- а объяснить это будет нечем.
-- ---------------------------------------------------------------------------
create or replace function public.prediction_field_average()
returns numeric
language sql stable
security definer
set search_path = public
as $$
  -- Ноль, когда закрытых прогнозов нет вовсе: тогда стягивать не к чему, и
  -- рейтинг у всех выходит нулевым — что и правда.
  select coalesce(avg(mp.points), 0)::numeric
    from match_predictions mp
   where mp.settled_at is not null;
$$;

-- Сколько воображаемых прогнозов дописывается каждому. Одно число на весь
-- файл: подпирать его копиями по функциям — верный способ однажды поправить
-- одну и забыть две.
create or replace function public.prediction_prior()
returns numeric
language sql immutable
as $$ select 10::numeric; $$;

-- ---------------------------------------------------------------------------
-- Сам рейтинг. Целое, «очки за сто прогнозов такого качества».
-- ---------------------------------------------------------------------------
create or replace function public.prediction_rating(
  p_points numeric, p_settled numeric, p_field_avg numeric
) returns integer
language sql immutable
as $$
  select round(
    (coalesce(p_points, 0) + prediction_prior() * coalesce(p_field_avg, 0))
    / (coalesce(p_settled, 0) + prediction_prior()) * 100
  )::int;
$$;

-- ---------------------------------------------------------------------------
-- Таблица лидеров.
--
-- ⚠️ ИМЕНА В CTE НАРОЧНО НЕ СОВПАДАЮТ С КОЛОНКАМИ ОТВЕТА (`pts`, а не
-- `points`). В SQL-функции с `returns table` имена колонок ответа видны
-- внутри запроса, и `points` там становится двусмысленным — Postgres валит
-- такую функцию на «column reference is ambiguous». Прежняя версия обходила
-- это тем, что всюду писала `mp.points`; здесь то же самое достигается
-- разными именами, и обойти его случайно уже нельзя.
-- ---------------------------------------------------------------------------
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
  rating        integer
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
         -- Делить не на что, если закрытых нет; сюда такие не попадают
         -- (inner join по totals), но nullif дешевле веры.
         coalesce(round(t.n_outcome * 100.0 / nullif(t.n_settled, 0))::int, 0),
         prediction_rating(t.pts, t.n_settled, prediction_field_average())
    from totals t
    join players pl on pl.id = t.pid
   order by prediction_rating(t.pts, t.n_settled, prediction_field_average()) desc,
            -- При равном рейтинге впереди тот, кто наиграл больше: он это
            -- качество ПОДТВЕРДИЛ, а не показал на трёх прогнозах.
            t.n_settled desc,
            t.n_exact desc,
            pl.first_name
   limit greatest(coalesce(p_limit, 20), 1);
$$;

-- ---------------------------------------------------------------------------
-- То же среди друзей. Полный состав, включая тех, кто не прогнозировал ни
-- разу, — см. шапку friend_prediction_leaderboard.sql, это там не меняется.
--
-- ⚠️ У ДРУГА БЕЗ ПРОГНОЗОВ РЕЙТИНГ РАВЕН СРЕДНЕМУ ПО ПОЛЮ, А НЕ НУЛЮ. Так
-- устроено стягивание: ноль настоящих прогнозов — остаются одни воображаемые.
-- Это честно («о нём ничего не известно»), но в списке друзей он окажется не
-- последним, а посередине. Поэтому сортировка сначала по тому, играл ли он
-- вообще: не игравшие уходят вниз, а между собой уже по рейтингу.
-- ---------------------------------------------------------------------------
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
  rating        integer
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
           prediction_rating(t.pts, t.n_settled, v_field)
      from totals t
     order by (t.n_settled > 0) desc,
              prediction_rating(t.pts, t.n_settled, v_field) desc,
              t.n_settled desc,
              t.n_exact desc,
              t.fn
     limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Личная сводка. Всегда ровно одна строка, даже без единого прогноза.
-- ---------------------------------------------------------------------------
create or replace function public.my_prediction_stats(p_init_data text)
returns table (
  points        integer,
  settled       integer,
  exact         integer,
  outcome_hits  integer,
  accuracy      integer,
  rating        integer,
  pending       integer,
  rank          integer
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
      -- Плотный ранг по ТОМУ ЖЕ рейтингу, что и таблица лидеров: двое с
      -- одинаковым рейтингом делят место, а не выталкивают третьего.
      select t.*, dense_rank() over (
               order by prediction_rating(t.pts, t.n_settled, v_field) desc
             )::int as rnk
        from totals t
       where t.n_settled > 0
    )
    select coalesce(r.pts, t.pts, 0),
           coalesce(r.n_settled, t.n_settled, 0),
           coalesce(r.n_exact, t.n_exact, 0),
           coalesce(r.n_outcome, t.n_outcome, 0),
           coalesce(round(
             coalesce(r.n_outcome, t.n_outcome, 0) * 100.0
             / nullif(coalesce(r.n_settled, t.n_settled, 0), 0)
           )::int, 0),
           -- Рейтинг показываем и без закрытых прогнозов: он тогда равен
           -- среднему по полю, и это правда — «пока ничего не известно».
           prediction_rating(
             coalesce(r.pts, t.pts, 0), coalesce(r.n_settled, t.n_settled, 0), v_field),
           coalesce(r.n_pending, t.n_pending, 0),
           -- NULL, а не ноль: «места пока нет» и «последнее место» — разное,
           -- и экран рисует прочерк, а не номер, которого человек не заслужил.
           r.rnk
      from (select 1) one
      left join totals t on t.pid = v_me
      left join ranked r on r.pid = v_me;
end;
$$;

-- ⚠️ ПОЛИТИКА БЕЗ ГРАНТА — ЗАПРЕТ. Функция за `security definer` без явного
-- execute недоступна ни anon, ни authenticated: этим проект уже ломался.
revoke all on function public.prediction_field_average()                   from public;
revoke all on function public.prediction_prior()                           from public;
revoke all on function public.prediction_rating(numeric, numeric, numeric) from public;
revoke all on function public.prediction_leaderboard(integer)              from public;
revoke all on function public.friend_prediction_leaderboard(text, integer) from public;
revoke all on function public.my_prediction_stats(text)                    from public;

grant execute on function public.prediction_field_average()                   to anon, authenticated, service_role;
grant execute on function public.prediction_prior()                           to anon, authenticated, service_role;
grant execute on function public.prediction_rating(numeric, numeric, numeric) to anon, authenticated, service_role;
grant execute on function public.prediction_leaderboard(integer)              to anon, authenticated, service_role;
grant execute on function public.friend_prediction_leaderboard(text, integer) to anon, authenticated, service_role;
grant execute on function public.my_prediction_stats(text)                    to anon, authenticated, service_role;

comment on function public.prediction_rating(numeric, numeric, numeric) is
  'Средние очки за прогноз, стянутые к среднему по полю на prediction_prior() '
  'воображаемых прогнозов, ×100. Ранжирует по точности, а не по объёму.';
