create table public.cards (
  id uuid primary key,
  category text not null,
  active boolean not null default true,
  name_en text,
  top_league text
);

create table public.card_current_club (
  card_id uuid primary key references public.cards(id),
  club text not null,
  club_key text not null,
  fetched_at timestamptz not null default now()
);

create function public.club_match_key(p_name text)
returns text language sql immutable
as $$ select regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '', 'g') $$;

create function public.deck_leagues()
returns text[] language sql immutable
as $$ select array[
  'Premier League', 'La Liga', 'Serie A', 'Bundesliga',
  'Ligue 1', 'Eredivisie', 'Russian Premier League'
]::text[] $$;
