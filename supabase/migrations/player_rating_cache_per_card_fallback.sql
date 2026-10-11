-- A partially populated rating cache must not hide players whose rows are missing.
-- Keep the cache fast path, but fall back to live aggregation PER CARD, not only
-- when the entire requested window is empty. This is safe for both standard
-- windows and arbitrary p_days values. No refresh or data mutation is run here.

create or replace function public.player_ratings(
  p_days integer default 7,
  p_limit integer default 50,
  p_club_key text default null,
  p_league text default null,
  p_country text default null
)
returns table (
  card_id uuid,
  name text,
  name_en text,
  photo_url text,
  country text,
  club text,
  club_key text,
  level smallint,
  basis text,
  matches integer,
  minutes integer,
  goals integer,
  assists integer,
  points integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with agg as (
    -- Rows present in cache use the fast path.
    select c.card_id, c.matches, c.minutes, c.goals, c.assists
      from public.player_rating_cache c
     where c.days = p_days

    union all

    -- A missing cache row is not evidence that the player scored nothing.
    -- Recompute only card_ids absent from this window's cache. The former
    -- whole-window NOT EXISTS check silently dropped every missing card as
    -- soon as ANY other player had a cached row.
    select d.card_id,
           count(*)::int,
           sum(coalesce(d.minutes, 0))::int,
           sum(coalesce(d.goals, 0))::int,
           sum(coalesce(d.assists, 0))::int
      from public.player_match_days d
     where d.match_date >= current_date - greatest(coalesce(p_days, 7), 1)
       and not exists (
         select 1
           from public.player_rating_cache k
          where k.days = p_days
            and k.card_id = d.card_id
       )
     group by d.card_id
    having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
  ),
  ranked as (
    select a.*,
           case when coalesce(p_club_key, '') = ''
                  and coalesce(p_league, '') = ''
                  and coalesce(p_country, '') = ''
                then rank() over (
                  order by (a.goals * 4 + a.assists * 3) desc,
                           a.goals desc,
                           a.minutes asc nulls last
                )
                else 1
           end as place
      from agg a
  ),
  top as (
    select * from ranked
     where place <= greatest(coalesce(p_limit, 50), 1)
  )
  select c.id, c.name, c.name_en, c.photo_url, c.country,
         coalesce(f.name, fq.name), coalesce(f.club_key, fq.club_key),
         l.level, l.basis,
         a.matches, nullif(a.minutes, 0), a.goals, a.assists,
         (a.goals * 4 + a.assists * 3)::int
    from top a
    join public.cards c on c.id = a.card_id and c.active and c.category = 'player'
    left join public.card_current_club cc on cc.card_id = c.id
    left join public.football_club f on f.club_key = cc.club_key
    left join public.club_squad q on q.card_id = c.id and q.left_at is null
    left join public.football_club fq on fq.club_key = q.club_key
    left join public.player_level l on l.card_id = c.id
   where (p_club_key is null or p_club_key = ''
          or coalesce(cc.club_key, q.club_key) = p_club_key)
     and (p_league is null or p_league = ''
          or coalesce(f.league, fq.league) = p_league)
     and (p_country is null or p_country = '' or c.country = p_country)
   order by (a.goals * 4 + a.assists * 3) desc,
            a.goals desc,
            a.minutes asc nulls last,
            c.name
   limit greatest(coalesce(p_limit, 50), 1);
$function$;

revoke all on function public.player_ratings(integer, integer, text, text, text)
  from public;
grant execute on function public.player_ratings(integer, integer, text, text, text)
  to anon, authenticated, service_role;
