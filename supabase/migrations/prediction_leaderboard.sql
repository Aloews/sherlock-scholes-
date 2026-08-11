-- ============================================================================
-- Счётчик очков и рейтинг прогнозистов.
--
-- СЧИТАЕТСЯ ТОЛЬКО ПО ЗАКРЫТЫМ ПРОГНОЗАМ. Незакрытый прогноз стоит ноль очков
-- ровно так же, как неверный, и если смешать их в одну сумму, человек увидит
-- падение рейтинга за то, что матч ещё не сыгран. Поэтому `pending` — своя
-- цифра, а не слагаемое.
--
-- ТАБЛИЦА ЛИДЕРОВ ЧИТАЕТСЯ БЕЗ ПОДПИСИ, личная сводка — только с ней. Первая
-- публична по смыслу, как friends_with_rating; вторая про одного человека, и
-- клиенту нельзя дать назваться им.
--
-- Точные попадания вынесены отдельным числом: очки растут и от объёма, а «в
-- точку» отличает чутьё от количества поставленных прогнозов.
-- ============================================================================

create or replace function public.prediction_leaderboard(p_limit integer default 20)
returns table (
  player_id   bigint,
  first_name  text,
  last_name   text,
  avatar_url  text,
  points      integer,
  settled     integer,
  exact       integer
)
language sql stable
security definer
set search_path = public
as $$
  select pl.id, pl.first_name, pl.last_name, pl.avatar_url,
         coalesce(sum(mp.points), 0)::int,
         count(*)::int,
         count(*) filter (where mp.points = 5)::int
    from match_predictions mp
    join players pl on pl.id = mp.player_id
   where mp.settled_at is not null
   group by pl.id, pl.first_name, pl.last_name, pl.avatar_url
   order by coalesce(sum(mp.points), 0) desc,
            count(*) filter (where mp.points = 5) desc,
            pl.first_name
   limit greatest(coalesce(p_limit, 20), 1);
$$;

-- Всегда возвращает РОВНО ОДНУ строку, даже когда прогнозов нет вовсе: экран
-- показывает счётчик с нуля, чтобы поставивший первый прогноз видел, что он
-- посчитан. Отсюда `from (select 1)` и левые соединения.
create or replace function public.my_prediction_stats(p_init_data text)
returns table (
  points   integer,
  settled  integer,
  exact    integer,
  pending  integer,
  rank     integer
)
language plpgsql
security definer
set search_path = public
as $$
declare v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    with totals as (
      select mp.player_id,
             coalesce(sum(mp.points) filter (where mp.settled_at is not null), 0)::int as pts,
             count(*) filter (where mp.settled_at is not null)::int as settled_n,
             count(*) filter (where mp.points = 5)::int as exact_n,
             count(*) filter (where mp.settled_at is null)::int as pending_n
        from match_predictions mp
       group by mp.player_id
    ),
    ranked as (
      -- Плотный ранг: двое с одинаковыми очками делят место, а не выталкивают
      -- третьего на четвёртое.
      select t.*, dense_rank() over (order by t.pts desc)::int as rnk
        from totals t
       where t.settled_n > 0
    )
    select coalesce(r.pts, t.pts, 0),
           coalesce(r.settled_n, t.settled_n, 0),
           coalesce(r.exact_n, t.exact_n, 0),
           coalesce(r.pending_n, t.pending_n, 0),
           -- NULL, а не ноль: «места пока нет» и «последнее место» — разное,
           -- и экран рисует прочерк, а не номер, которого человек не заслужил.
           r.rnk
      from (select 1) one
      left join totals t on t.player_id = v_me
      left join ranked r on r.player_id = v_me;
end;
$$;

revoke all on function public.prediction_leaderboard(integer) from public;
revoke all on function public.my_prediction_stats(text)       from public;
grant execute on function public.prediction_leaderboard(integer) to anon, authenticated, service_role;
grant execute on function public.my_prediction_stats(text)       to anon, authenticated, service_role;
