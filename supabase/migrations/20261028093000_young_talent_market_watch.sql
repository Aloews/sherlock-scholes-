-- Daily youth scouting snapshot. Values are only eligible when the source valuation
-- has its own date and is no more than 180 days old. The scheduled market refresh
-- writes one row per active player per day; the view compares consecutive snapshots.
create table if not exists public.young_talent_market_snapshot (
  snapshot_date date not null,
  card_id uuid not null references public.cards(id) on delete cascade,
  player_name text not null,
  age smallint not null check (age between 16 and 23),
  market_value_eur bigint not null check (market_value_eur > 0),
  market_value_at date not null,
  verified_honours_count smallint not null default 0 check (verified_honours_count >= 0),
  verified_award_wins integer not null default 0 check (verified_award_wins >= 0),
  base_score numeric(6,3) not null check (base_score between 0 and 80),
  score_components jsonb not null default '{}'::jsonb,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  model_version text not null,
  source_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (snapshot_date, card_id)
);

create index if not exists young_talent_snapshot_card_date_idx
  on public.young_talent_market_snapshot (card_id, snapshot_date desc);
create index if not exists young_talent_snapshot_date_score_idx
  on public.young_talent_market_snapshot (snapshot_date desc, base_score desc);

create or replace view public.young_talent_market_watch as
with movement as (
  select s.*,
         lag(s.market_value_eur) over (
           partition by s.card_id order by s.snapshot_date
         ) as previous_market_value_eur,
         lag(s.snapshot_date) over (
           partition by s.card_id order by s.snapshot_date
         ) as previous_snapshot_date,
         count(*) over (
           partition by s.card_id order by s.snapshot_date
           rows between unbounded preceding and current row
         ) as snapshots_seen
    from public.young_talent_market_snapshot s
), scored as (
  select m.*,
         case
           when previous_market_value_eur is null or previous_market_value_eur <= 0 then null
           else round(100.0 * (market_value_eur - previous_market_value_eur)
                      / previous_market_value_eur, 2)
         end as price_change_pct
    from movement m
)
select snapshot_date, card_id, player_name, age, market_value_eur, market_value_at,
       verified_honours_count, verified_award_wins,
       previous_market_value_eur, previous_snapshot_date, price_change_pct,
       base_score,
       greatest(0::numeric, least(100::numeric,
         base_score + greatest(-10::numeric, least(20::numeric,
           coalesce(price_change_pct, 0) * 0.5
         ))
       ))::numeric(6,3) as score,
       case
         when snapshots_seen >= 3 and verified_honours_count > 0 then 'high'
         when snapshots_seen >= 2 then 'medium'
         else 'low'
       end as confidence,
       score_components || jsonb_build_object(
         'price_change_pct', price_change_pct,
         'momentum_score', greatest(-10::numeric, least(20::numeric,
           coalesce(price_change_pct, 0) * 0.5
         )),
         'previous_market_value_eur', previous_market_value_eur,
         'snapshots_seen', snapshots_seen
       ) as score_components,
       source_url, model_version, source_fetched_at
  from scored;

alter table public.young_talent_market_snapshot enable row level security;
revoke all on public.young_talent_market_snapshot from anon, authenticated;
revoke all on public.young_talent_market_watch from anon, authenticated;
grant all on public.young_talent_market_snapshot to service_role;
grant select on public.young_talent_market_watch to service_role;

comment on table public.young_talent_market_snapshot
  is 'Daily source-dated snapshots for active 16–23 year-old players with recent market values and structured award counts.';
comment on view public.young_talent_market_watch
  is 'Young player watch ranked by age, current market value, verified award wins and change versus the previous daily snapshot.';
