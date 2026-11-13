-- 0005_squad_contracts.sql
-- Campaign-scoped players and contracts for Football Dynasty squads.

create table if not exists fd.players (
  id bigint generated always as identity primary key,
  campaign_id bigint not null references fd.campaigns(id) on delete cascade,
  club_id bigint not null,
  first_name text not null,
  last_name text not null,
  position text not null check (position in ('GK', 'DEF', 'MID', 'FWD')),
  seed_index int not null,
  created_at timestamptz not null default now(),
  foreign key (campaign_id, club_id) references fd.clubs(campaign_id, id),
  unique (campaign_id, club_id, seed_index)
);

create index players_campaign_club_idx on fd.players(campaign_id, club_id);

create table if not exists fd.contracts (
  id bigint generated always as identity primary key,
  campaign_id bigint not null,
  player_id bigint not null,
  club_id bigint not null,
  weekly_wage int not null check (weekly_wage > 0 and weekly_wage <= 1000000),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'expired', 'released')),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, player_id) references fd.players(campaign_id, id),
  foreign key (campaign_id, club_id) references fd.clubs(campaign_id, id),
  check (end_date > start_date),
  check (end_date <= start_date + interval '10 years')
);

create index contracts_campaign_player_idx on fd.contracts(campaign_id, player_id);
create unique index contracts_one_active_per_player on fd.contracts(campaign_id, player_id) where status = 'active';

alter table fd.players enable row level security;
alter table fd.contracts enable row level security;

create policy players_owner_scope on fd.players
  for all
  using (
    campaign_id in (
      select c.id from fd.campaigns c
      where c.telegram_id = nullif(current_setting('fd.telegram_id', true), '')::bigint
    )
  )
  with check (
    campaign_id in (
      select c.id from fd.campaigns c
      where c.telegram_id = nullif(current_setting('fd.telegram_id', true), '')::bigint
    )
  );

create policy contracts_owner_scope on fd.contracts
  for all
  using (
    campaign_id in (
      select c.id from fd.campaigns c
      where c.telegram_id = nullif(current_setting('fd.telegram_id', true), '')::bigint
    )
  )
  with check (
    campaign_id in (
      select c.id from fd.campaigns c
      where c.telegram_id = nullif(current_setting('fd.telegram_id', true), '')::bigint
    )
  );

grant select, insert, update, delete on fd.players to fd_runtime;
grant select, insert, update, delete on fd.contracts to fd_runtime;
grant usage on sequence fd.players_id_seq to fd_runtime;
grant usage on sequence fd.contracts_id_seq to fd_runtime;
