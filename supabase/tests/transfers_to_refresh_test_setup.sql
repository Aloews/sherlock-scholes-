create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.cards (
  id uuid primary key,
  name_en text,
  category text not null,
  active boolean not null default true,
  transfermarkt_id text,
  market_value_eur bigint
);

create table public.player_transfer (
  tm_player_id text not null,
  fetched_at timestamptz not null
);

insert into public.cards (id, name_en, category, active, transfermarkt_id, market_value_eur) values
  ('10000000-0000-0000-0000-000000000001', 'New player', 'player', true, 'tm-new', 5000000),
  ('10000000-0000-0000-0000-000000000002', 'Stale player', 'player', true, 'tm-stale', 4000000),
  ('10000000-0000-0000-0000-000000000003', 'Fresh player', 'player', true, 'tm-fresh', 3000000),
  ('10000000-0000-0000-0000-000000000004', 'Low value player', 'player', true, 'tm-low', 100000);

insert into public.player_transfer (tm_player_id, fetched_at) values
  ('tm-stale', now() - interval '120 days'),
  ('tm-fresh', now() - interval '10 days');
