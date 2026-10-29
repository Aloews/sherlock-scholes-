-- Existing player_stats_refresh_checkpoint_existing_schema_setup.sql must run first.
-- Simulate one verified historical lineup record and one recent false-zero record
-- written by the match-level parser that cannot observe starter/substitution flags.
delete from public.player_season_stat
 where tm_player_id = '101' and season_id = 2026
   and competition_id = 'UNLA' and club_id = '3440';

insert into public.player_season_stat (
  tm_player_id, season_id, competition_id, club_id, card_id,
  apps, starts, sub_in, sub_out, minutes, goals, assists, fetched_at
) values (
  '101', 2026, 'UNLA', '3440',
  '00000000-0000-0000-0000-000000000101',
  4, 3, 1, 1, 360, 0, 4, '2026-10-25T12:00:00Z'
);

delete from public.player_season_stat
 where tm_player_id = '102' and season_id = 2026
   and competition_id = 'GB1' and club_id = '11';

insert into public.player_season_stat (
  tm_player_id, season_id, competition_id, club_id, card_id,
  apps, starts, sub_in, sub_out, minutes, goals, assists, fetched_at
) values (
  '102', 2026, 'GB1', '11',
  '00000000-0000-0000-0000-000000000102',
  8, 0, 0, 0, 652, 2, 0, '2026-10-28T12:00:00Z'
);
