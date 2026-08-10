-- ============================================================================
-- SHERLOCK SCHOLES — invite a friend into a room, without a code
--
-- WHY. Getting a second person into a room meant reading six characters aloud
-- and having them typed back, on a phone, into a field the keyboard is sitting
-- on top of. Every step of that can fail, and the ones that fail quietly —
-- O against 0, I against 1 — fail as "the code doesn't work". The invite link
-- already removes the typing for anyone who can be sent a link; this removes
-- the link too for the people the game already knows you play with.
--
-- The shape is the one every game with a friends list uses: the host picks a
-- name, the other player sees "X is inviting you" the next time they look at
-- the app, and joining is one tap. No code is shown, spoken or typed.
--
-- WHY A TABLE AND NOT A PUSH. `friends_and_rating.sql` says a request/accept
-- flow "needs a notification channel to be worth anything". That is still
-- true, and this is not pretending otherwise: an invite is a row the invitee
-- finds when they open the app. What makes it worth having anyway is that the
-- app is a Mini App — the invitee is usually already in Telegram, and the host
-- can still send the link through the chat for the case where they are not.
--
-- EXPIRY IS DERIVED, NOT SCHEDULED. An invite is worth acting on while the
-- room is still waiting for players, so `pending_room_invites` joins the room
-- and filters on its status rather than trusting a timestamp. A room that has
-- started, finished, or been swept is not an invitation to anything, and no
-- cron has to run for that to be true. The age limit on top is only there to
-- stop a room somebody left open all day from resurfacing.
--
-- SECURITY. Reads and writes both derive the caller from Telegram's signed
-- initData via tg_validate_init_data() — an invite names two people, and
-- letting a client claim to be either of them would let anyone read who is
-- inviting whom, or put invites in a stranger's list. This is stricter than
-- friends_with_rating (which takes a player id), because that one exposes a
-- public leaderboard row and this one exposes a private one.
--
-- Run in the Supabase SQL Editor as one script. Idempotent.
-- ============================================================================

create table if not exists public.room_invites (
  room_id     uuid   not null references public.rooms(id)   on delete cascade,
  to_id       bigint not null references public.players(id) on delete cascade,
  from_id     bigint not null references public.players(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One invite per person per room. A host tapping a name twice is a host
  -- being unsure it worked, not a second invitation — and the newer one
  -- replaces the older so the list cannot fill up with duplicates.
  primary key (room_id, to_id),
  constraint room_invites_not_self check (to_id <> from_id)
);

create index if not exists room_invites_to_idx on public.room_invites (to_id, created_at desc);

comment on table public.room_invites is
  'Pending "come and play" invitations. Read through pending_room_invites, '
  'which drops any whose room is no longer waiting — see the header of '
  'room_invites.sql.';

-- RLS on, no policies: everything goes through the SECURITY DEFINER functions
-- below. The grant is written out too, in both directions, because a policy
-- without a grant and a grant without a policy are different bugs and neither
-- announces itself (see current_squads.sql).
alter table public.room_invites enable row level security;
revoke all on public.room_invites from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- How long an unanswered invite stays interesting.
--
-- The room's status is the real expiry; this only stops a room that somebody
-- left open in the background from showing up as an invitation hours later.
-- ---------------------------------------------------------------------------
create or replace function public.room_invite_ttl() returns interval
language sql immutable as $$ select interval '2 hours' $$;

-- ---------------------------------------------------------------------------
-- invite_to_room — "come and play"
--
-- The caller must be IN the room. Not host-only on purpose: anybody already in
-- the room can pull a friend in, which is how these games actually fill up,
-- and the room is visible to whoever holds its code anyway.
-- ---------------------------------------------------------------------------
create or replace function public.invite_to_room(
  p_init_data text,
  p_room_id   uuid,
  p_to_id     bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from bigint := tg_validate_init_data(p_init_data);
begin
  if v_from is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  if v_from = p_to_id then
    return false;
  end if;

  -- In the room, and the room still open. Both checked here rather than in the
  -- client: an invitation into a game that has already started is an invitation
  -- to a screen that will refuse the invitee.
  if not exists (
    select 1
      from room_players rp
      join rooms r on r.id = rp.room_id
     where rp.room_id = p_room_id
       and rp.player_id = v_from
       and r.status = 'waiting'
  ) then
    return false;
  end if;

  -- Already in the room: nothing to invite them to, and a row here would show
  -- them an invitation to where they are standing.
  if exists (select 1 from room_players where room_id = p_room_id and player_id = p_to_id) then
    return false;
  end if;

  insert into room_invites (room_id, to_id, from_id)
       values (p_room_id, p_to_id, v_from)
  on conflict (room_id, to_id) do update
    set from_id = excluded.from_id, created_at = now();

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- pending_room_invites — what is waiting for me
--
-- Returns the room CODE, because joining is the point: the client hands it
-- straight to the same join path a typed code uses, and no second mechanism
-- appears. The inviter's name comes along so the invitee is answering a person
-- rather than a room id.
-- ---------------------------------------------------------------------------
create or replace function public.pending_room_invites(p_init_data text)
returns table (
  room_id     uuid,
  code        text,
  from_id     bigint,
  first_name  text,
  last_name   text,
  avatar_url  text,
  players     integer,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;

  return query
    select r.id,
           -- `rooms.code` is char(6) and therefore blank-padded; btrim keeps a
           -- stray space out of the client's join call, where it would fail a
           -- six-character check that the code itself passes.
           btrim(r.code)::text,
           p.id,
           p.first_name,
           p.last_name,
           p.avatar_url,
           (select count(*)::int from room_players rp where rp.room_id = r.id),
           i.created_at
      from room_invites i
      join rooms   r on r.id = i.room_id
      join players p on p.id = i.from_id
     where i.to_id = v_me
       and r.status = 'waiting'
       and i.created_at > now() - room_invite_ttl()
       -- Joined in the meantime — through the link, or because somebody read
       -- the code out. The invitation has been answered; stop offering it.
       and not exists (
         select 1 from room_players rp
          where rp.room_id = r.id and rp.player_id = v_me
       )
     order by i.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- decline_room_invite — "no thanks"
--
-- Deleting rather than marking: a declined invitation has no later use, and a
-- status column would need every read above to remember to filter on it.
-- ---------------------------------------------------------------------------
create or replace function public.decline_room_invite(p_init_data text, p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me bigint := tg_validate_init_data(p_init_data);
begin
  if v_me is null then
    raise exception 'invalid init data' using errcode = '28000';
  end if;
  delete from room_invites where room_id = p_room_id and to_id = v_me;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. `revoke ... from public` above also strips service_role of what it
-- inherited through PUBLIC, so every role that needs EXECUTE is named here.
-- ---------------------------------------------------------------------------
revoke all on function public.invite_to_room(text, uuid, bigint) from public;
revoke all on function public.pending_room_invites(text)         from public;
revoke all on function public.decline_room_invite(text, uuid)    from public;
revoke all on function public.room_invite_ttl()                  from public;

grant execute on function public.invite_to_room(text, uuid, bigint) to anon, authenticated, service_role;
grant execute on function public.pending_room_invites(text)         to anon, authenticated, service_role;
grant execute on function public.decline_room_invite(text, uuid)    to anon, authenticated, service_role;
grant execute on function public.room_invite_ttl()                  to anon, authenticated, service_role;
