-- Expose canonical league metadata for the squad picker.
create or replace function public.deck_squad_filters(p_min integer default 8)
returns table (
  club_key text,
  club text,
  players integer,
  card_id uuid,
  fetched_at timestamptz,
  league text
)
language sql
stable
security definer
set search_path = public
as $$
  with counted as (
    select cc.club_key,
           mode() within group (order by cc.club) as club,
           count(*)::int as players,
           max(cc.fetched_at) as fetched_at
    from public.card_current_club cc
    join public.cards c on c.id = cc.card_id and c.active
    group by cc.club_key
  )
  select n.club_key,
         n.club,
         n.players,
         (select k.id
            from public.cards k
           where k.category = 'club'
             and k.active
             and public.club_match_key(k.name_en) = n.club_key
           limit 1) as card_id,
         n.fetched_at,
         (select p.top_league
            from public.card_current_club cc2
            join public.cards p on p.id = cc2.card_id
           where cc2.club_key = n.club_key
             and p.active
             and p.category = 'player'
             and p.top_league = any(public.deck_leagues())
           group by p.top_league
           order by count(*) desc, p.top_league
           limit 1) as league
    from counted n
   where n.players >= greatest(coalesce(p_min, 8), 1)
   order by n.players desc, n.club;
$$;

revoke all on function public.deck_squad_filters(integer) from public;
grant execute on function public.deck_squad_filters(integer) to anon, authenticated, service_role;
