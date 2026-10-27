-- Add only the prerequisites that predate the migration under test.
alter table public.cards
  add column if not exists transfermarkt_id text,
  add column if not exists market_value_eur bigint;

create table if not exists public.player_season_stat (
  card_id uuid references public.cards(id),
  season_id smallint not null,
  fetched_at timestamptz not null default now()
);

insert into public.cards (id, name, category, active, transfermarkt_id, market_value_eur)
values
  ('00000000-0000-0000-0000-000000000101', 'Stats checkpoint existing', 'player', true, '101', 90000000),
  ('00000000-0000-0000-0000-000000000102', 'Stats checkpoint unchecked', 'player', true, '102', 80000000)
on conflict (id) do nothing;

insert into public.player_season_stat (card_id, season_id, fetched_at)
values ('00000000-0000-0000-0000-000000000101', 2026, '2026-10-25T12:00:00Z')
on conflict do nothing;
