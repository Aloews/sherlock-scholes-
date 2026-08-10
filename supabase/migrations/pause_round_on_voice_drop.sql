-- ============================================================================
-- Stop the clock when the explainer's voice dies.
--
-- WHY THIS CANNOT BE A CLIENT-SIDE PAUSE. The timer is not counted down
-- anywhere: every client DERIVES the remaining seconds from `rounds.started_at`
-- (src/features/game/useTimer.ts), which is what keeps two phones agreeing to
-- the second. And the round is ended by whoever reaches the deadline first —
-- the explainer normally, every other client a few seconds later as a fallback
-- (useGame.ts).
--
-- So a pause that lived on one device would do the opposite of its job: that
-- player's clock would stop while everyone else's ran out, the fallback would
-- end the round on time, and the paused player would be staring at "20 seconds
-- left" on a round that finished. The pause has to be a fact about the ROUND,
-- reaching every client through the realtime UPDATE they already subscribe to.
--
-- WHOSE CONNECTION COUNTS: the explainer's, and only theirs. They are the one
-- talking; if their audio is gone the round is unplayable for everybody. A
-- guesser dropping is not the same — the others can still play, and letting any
-- of four phones freeze the game means the flakiest one sets the pace.
--
-- THE CAP IS THE POINT. A connection that never comes back would otherwise
-- freeze a game forever, and "the timer stopped and nothing happened" is a
-- worse bug than the one this fixes. After MAX_PAUSE_MS the round runs on
-- regardless, and the players lose a round rather than an evening.
-- ============================================================================

alter table public.rounds
  add column if not exists paused_at timestamptz,
  add column if not exists paused_ms integer not null default 0;

comment on column public.rounds.paused_at is
  'When the current pause began, or null when running. Every client adds the '
  'elapsed pause to the deadline it derives from started_at.';
comment on column public.rounds.paused_ms is
  'Total milliseconds this round has spent paused, excluding a pause still in '
  'progress. Capped — see pause_round().';

-- Two minutes. Long enough to survive a lift, a tunnel or a network handover;
-- short enough that a phone that is never coming back costs one round.
create or replace function public.max_round_pause_ms() returns integer
language sql immutable as $$ select 120000 $$;

-- ---------------------------------------------------------------------------
-- pause_round — the explainer's link went down; hold the clock.
--
-- Idempotent: a client that reports the same drop twice (a re-render, a retry)
-- must not restart the pause, or the round would never resume.
-- ---------------------------------------------------------------------------
create or replace function public.pause_round(
  p_round_id  uuid,
  p_init_data text
) returns table (paused_at timestamptz, paused_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller bigint;
  v_round  rounds%rowtype;
begin
  -- Identity from the signed initData, never from an argument. A client that
  -- could name the explainer could freeze a round it is not even in.
  --
  -- tg_validate_init_data, NOT get_user_status: that one returns `json`, so
  -- `(get_user_status(x)).telegram_id` is composite notation on a scalar and
  -- raises 42809 on every call — this whole path was dead from the day it
  -- shipped until 10 August 2026. It also upserts into `users`, which asking
  -- who is calling has no business doing.
  v_caller := tg_validate_init_data(p_init_data);
  if v_caller is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select * into v_round from rounds where id = p_round_id;
  if not found then
    raise exception 'no such round' using errcode = '22023';
  end if;
  if v_round.explainer_id is distinct from v_caller then
    raise exception 'only the explainer may pause' using errcode = '42501';
  end if;

  -- Nothing to hold: the round is not running, is already held, or has spent
  -- its whole allowance. The last is not an error — it is the cap doing its
  -- job, and the caller gets the unchanged state back.
  if v_round.status <> 'active'
     or v_round.paused_at is not null
     or v_round.paused_ms >= max_round_pause_ms() then
    -- RETURN QUERY appends rows; it does not leave the function. Without the
    -- bare RETURN the early exit fell straight into the update below and
    -- answered with two rows.
    return query select v_round.paused_at, v_round.paused_ms;
    return;
  end if;

  update rounds set paused_at = now()
   where id = p_round_id and paused_at is null and status = 'active';

  return query select r.paused_at, r.paused_ms from rounds r where r.id = p_round_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- resume_round — the link came back, or the allowance ran out.
--
-- Folds the elapsed pause into paused_ms and clamps it: past the cap the
-- round simply carries on, and a further pause is refused above.
-- ---------------------------------------------------------------------------
create or replace function public.resume_round(
  p_round_id  uuid,
  p_init_data text
) returns table (paused_at timestamptz, paused_ms integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller bigint;
  v_round  rounds%rowtype;
  v_spent  integer;
begin
  v_caller := tg_validate_init_data(p_init_data);
  if v_caller is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select * into v_round from rounds where id = p_round_id;
  if not found then
    raise exception 'no such round' using errcode = '22023';
  end if;
  if v_round.explainer_id is distinct from v_caller then
    raise exception 'only the explainer may resume' using errcode = '42501';
  end if;

  if v_round.paused_at is null then
    return query select v_round.paused_at, v_round.paused_ms;
    return;
  end if;

  v_spent := least(
    max_round_pause_ms(),
    v_round.paused_ms + (extract(epoch from (now() - v_round.paused_at)) * 1000)::integer
  );

  update rounds
     set paused_ms = v_spent,
         paused_at = null
   where id = p_round_id and paused_at is not null;

  return query select r.paused_at, r.paused_ms from rounds r where r.id = p_round_id;
end;
$$;

-- The caller is derived inside, from a signature only the server can check, so
-- these are safe for the app roles to call — the same shape as the other
-- initData-authenticated RPCs.
revoke all on function public.pause_round(uuid, text)  from public;
revoke all on function public.resume_round(uuid, text) from public;
grant execute on function public.pause_round(uuid, text)  to anon, authenticated, service_role;
grant execute on function public.resume_round(uuid, text) to anon, authenticated, service_role;
grant execute on function public.max_round_pause_ms()     to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Old frontends keep working.
--
-- Both columns are additive, and a build that predates them derives its
-- deadline from started_at alone — exactly what it did yesterday. It will end
-- a paused round on the original schedule, which is the behaviour it has now;
-- nothing gets worse for it, and the moment it updates it starts honouring the
-- pause.
-- ---------------------------------------------------------------------------
