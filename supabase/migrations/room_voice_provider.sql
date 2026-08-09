-- ============================================================================
-- The voice service belongs to the ROOM, not to the device.
--
-- THE FAILURE THIS PREVENTS. A channel exists only inside one vendor. Once the
-- client could fall back — player A stays on LiveKit, player B's LiveKit
-- flickers and B lands on Daily — the two are in different channels on
-- different services. Both screens read "Связь есть". Neither hears anything.
--
-- That is the worst shape a bug can take here, because it looks like success.
-- "Connected and silent" has already been the symptom of two unrelated causes
-- in this project (docs/LOBBY_AND_VOICE_FIXES.md §3), and each cost days. A
-- third one that is invisible from both players' screens would cost more.
--
-- So the room decides once and everyone follows. The first caller to ask for a
-- token fixes the service; every later caller is signed for that same one no
-- matter what it asked for.
--
-- WHY A FUNCTION AND NOT AN UPDATE FROM THE EDGE FUNCTION. Two players tapping
-- at the same instant is the normal case, not the exception — a game starts
-- with everybody arriving at once. `update … where voice_provider is null`
-- takes a row lock, so the second writer finds the column already set and
-- reads the winner's value instead of overwriting it. Doing this as a read
-- then a write from Deno would leave exactly the window this exists to close.
-- ============================================================================

alter table public.rooms
  add column if not exists voice_provider text;

-- Only services this app has an adapter for. A typo here would pin a room to
-- something nobody can join, and the room would be silent for everyone until
-- it ended.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rooms_voice_provider_known'
  ) then
    alter table public.rooms
      add constraint rooms_voice_provider_known
      check (voice_provider is null or voice_provider in ('livekit', 'daily', 'agora'));
  end if;
end $$;

comment on column public.rooms.voice_provider is
  'Voice service every player in this room must use. Null until the first '
  'token is issued. Set only by claim_room_voice_provider() — a client that '
  'could set it could move the whole room onto a service it alone can reach.';

-- ---------------------------------------------------------------------------
-- claim_room_voice_provider — first caller wins, everybody else is told who.
--
-- Returns the service the room is on: the caller's own choice if it got there
-- first, otherwise whatever was already agreed. Never returns null for a room
-- that exists, so the Edge Function always has something to sign for.
-- ---------------------------------------------------------------------------
create or replace function public.claim_room_voice_provider(
  p_room_id uuid,
  p_wanted  text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
begin
  if p_wanted is null or p_wanted not in ('livekit', 'daily', 'agora') then
    raise exception 'unknown voice provider: %', p_wanted
      using errcode = '22023';
  end if;

  -- The lock is the point. A second caller arriving mid-transaction waits here
  -- and then matches zero rows, because the column is no longer null.
  update rooms
     set voice_provider = p_wanted
   where id = p_room_id
     and voice_provider is null
  returning voice_provider into v_provider;

  if v_provider is not null then
    return v_provider;
  end if;

  select voice_provider into v_provider from rooms where id = p_room_id;
  return v_provider;
end;
$$;

-- Nobody but the server. The Edge Function calls this with the service role
-- AFTER it has checked membership; a client that could call it directly could
-- pin any room — including one it is not in — to a service that deployment
-- holds no keys for, and leave everyone in it silent. Same reasoning as the
-- channel name never coming from the client.
revoke all on function public.claim_room_voice_provider(uuid, text) from public;
revoke all on function public.claim_room_voice_provider(uuid, text) from anon;
revoke all on function public.claim_room_voice_provider(uuid, text) from authenticated;
-- And then hand it back to the one caller that must have it. EXECUTE is
-- granted to PUBLIC by default, so revoking from PUBLIC takes it away from
-- service_role too — the Edge Function would get "permission denied", report
-- lookup_failed, and voice would be dead for everyone the moment this shipped.
-- Same explicit re-grant get_user_status needs, for the same reason
-- (pro_users.sql).
grant execute on function public.claim_room_voice_provider(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- move_room_voice_provider — take the whole room somewhere else, once.
--
-- Compare-and-swap, deliberately: the caller says which service it believes
-- the room is on, and the move only lands if that is still true. Two players
-- whose service died at the same second therefore produce ONE move, not a
-- pair of them dragging the room back and forth while everybody reconnects.
-- The loser is simply told where the room went.
--
-- Returns the room's service after the call — the mover's target if it won,
-- the winner's if it did not.
-- ---------------------------------------------------------------------------
create or replace function public.move_room_voice_provider(
  p_room_id uuid,
  p_from    text,
  p_to      text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text;
begin
  if p_to is null or p_to not in ('livekit', 'daily', 'agora') then
    raise exception 'unknown voice provider: %', p_to
      using errcode = '22023';
  end if;

  update rooms
     set voice_provider = p_to
   where id = p_room_id
     and voice_provider is not distinct from p_from
  returning voice_provider into v_provider;

  if v_provider is not null then
    return v_provider;
  end if;

  select voice_provider into v_provider from rooms where id = p_room_id;
  return v_provider;
end;
$$;

revoke all on function public.move_room_voice_provider(uuid, text, text) from public;
revoke all on function public.move_room_voice_provider(uuid, text, text) from anon;
revoke all on function public.move_room_voice_provider(uuid, text, text) from authenticated;
grant execute on function public.move_room_voice_provider(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Old frontends keep working.
--
-- The column is additive and nullable, and nothing already deployed selects
-- it. A build that predates this migration asks for a token exactly as before
-- and is served the room's agreed provider — which, for a room full of old
-- builds, is simply whatever the first of them asked for. That is the same
-- answer they would have got yesterday.
-- ---------------------------------------------------------------------------
