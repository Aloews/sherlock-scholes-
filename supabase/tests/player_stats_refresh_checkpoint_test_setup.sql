create extension if not exists pgcrypto;

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  category text not null,
  transfermarkt_id text,
  market_value_eur bigint,
  player_stats_checked_at timestamptz
);

create table public.player_season_stat (
  card_id uuid references public.cards(id),
  season_id smallint not null,
  fetched_at timestamptz not null default now()
);

insert into public.cards (id, category, transfermarkt_id, market_value_eur)
values
  ('00000000-0000-0000-0000-000000000001', 'player', '101', 90000000),
  ('00000000-0000-0000-0000-000000000002', 'player', '102', 80000000),
  ('00000000-0000-0000-0000-000000000003', 'club', null, null);

insert into public.player_season_stat (card_id, season_id, fetched_at)
values ('00000000-0000-0000-0000-000000000001', 2026, '2026-10-25T12:00:00Z');
