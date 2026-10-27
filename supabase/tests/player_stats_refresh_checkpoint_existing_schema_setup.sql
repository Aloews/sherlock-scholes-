-- Add only the prerequisites that predate the migration under test.
alter table public.cards
  add column if not exists transfermarkt_id text,
  add column if not exists market_value_eur bigint;

create table if not exists public.player_season_stat (
  tm_player_id text not null,
  season_id smallint not null,
  competition_id text not null,
  club_id text not null,
  card_id uuid references public.cards(id),
  apps smallint not null default 0,
  starts smallint not null default 0,
  sub_in smallint not null default 0,
  sub_out smallint not null default 0,
  minutes integer not null default 0,
  goals smallint not null default 0,
  assists smallint not null default 0,
  own_goals smallint not null default 0,
  penalty_goals smallint not null default 0,
  yellow smallint not null default 0,
  yellow_red smallint not null default 0,
  red smallint not null default 0,
  team_goals smallint not null default 0,
  opponent_goals smallint not null default 0,
  fetched_at timestamptz not null default now(),
  unique (tm_player_id, season_id, competition_id, club_id)
);

alter table public.player_season_stat
  add column if not exists tm_player_id text,
  add column if not exists season_id smallint,
  add column if not exists competition_id text,
  add column if not exists club_id text,
  add column if not exists card_id uuid references public.cards(id),
  add column if not exists apps smallint not null default 0,
  add column if not exists starts smallint not null default 0,
  add column if not exists sub_in smallint not null default 0,
  add column if not exists sub_out smallint not null default 0,
  add column if not exists minutes integer not null default 0,
  add column if not exists goals smallint not null default 0,
  add column if not exists assists smallint not null default 0,
  add column if not exists own_goals smallint not null default 0,
  add column if not exists penalty_goals smallint not null default 0,
  add column if not exists yellow smallint not null default 0,
  add column if not exists yellow_red smallint not null default 0,
  add column if not exists red smallint not null default 0,
  add column if not exists team_goals smallint not null default 0,
  add column if not exists opponent_goals smallint not null default 0,
  add column if not exists fetched_at timestamptz not null default now();

insert into public.cards (id, name, category, active, transfermarkt_id, market_value_eur)
values
  ('00000000-0000-0000-0000-000000000101', 'Stats checkpoint existing', 'player', true, '101', 90000000),
  ('00000000-0000-0000-0000-000000000102', 'Stats checkpoint unchecked', 'player', true, '102', 80000000)
on conflict (id) do nothing;

insert into public.player_season_stat
  (tm_player_id, season_id, competition_id, club_id, card_id, apps, goals, fetched_at)
values
  ('101', 2020, 'GB1', '11', '00000000-0000-0000-0000-000000000101', 184, 37, '2026-10-25T12:00:00Z'),
  ('101', 2026, 'UNLA', '3440', '00000000-0000-0000-0000-000000000101', 4, 0, '2026-10-25T12:00:00Z')
on conflict do nothing;
