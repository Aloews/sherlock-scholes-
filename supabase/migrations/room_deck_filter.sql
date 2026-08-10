-- ============================================================================
-- The host picks the room's deck — and only the host.
--
-- WHY THIS IS AN RPC AND NOT AN UPDATE. `rooms` is writable by everyone:
--
--   rooms_public_update  UPDATE  {anon,authenticated}  qual: true, check: true
--
-- That policy is what lets any client claim a round or flip a room to
-- 'playing', and it means a plain `update rooms set settings = …` from the
-- lobby would let a GUEST redeal the host's game — or let anyone holding a
-- six-character room code rewrite the deck of a lobby they never joined.
-- Identity has to come from the signed initData, which is the same reason
-- pause_round() and claim_room_voice_provider() are functions.
--
-- WHY IT MERGES RATHER THAN REPLACES. `settings` also carries round_seconds,
-- cards_per_round and total_rounds. A client that sent the whole object would
-- overwrite whatever it had not heard about yet — including any key a later
-- version adds. This writes two keys and leaves the rest of the jsonb alone.
--
-- WHY `categories` IS WRITTEN TOO. Any client in the room may be the one that
-- activates a round, and a build that predates `deck` reads `categories`. Kept
-- in step here, on the server, so the mirror cannot drift with whichever
-- frontend happened to make the call. See src/features/room/roomDeck.ts.
--
-- WHY ONLY WHILE WAITING. The deck is dealt when a round activates. Changing
-- the filter mid-game would give round 3 a different deck from round 1, with
-- nothing on screen to say so — and the round already in play would keep the
-- cards it had, so the scoreboard would be comparing two different games.
-- ============================================================================

create or replace function public.set_room_deck_filter(
  p_room_id   uuid,
  p_filter    jsonb,
  p_init_data text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     bigint;
  v_room       rooms%rowtype;
  v_filter     jsonb;
  v_categories jsonb;
  v_settings   jsonb;
begin
  -- tg_validate_init_data, not get_user_status: the latter returns `json`, so
  -- `(get_user_status(x)).telegram_id` is composite notation on a scalar and
  -- raises 42809 before any guard runs — which is exactly how pause_round
  -- shipped broken. This one returns the caller's id, or null when the
  -- signature does not check out.
  v_caller := tg_validate_init_data(p_init_data);
  if v_caller is null then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select * into v_room from rooms where id = p_room_id;
  if not found then
    raise exception 'no such room' using errcode = '22023';
  end if;
  if v_room.host_id is distinct from v_caller then
    raise exception 'only the host may choose the deck' using errcode = '42501';
  end if;
  if v_room.status <> 'waiting' then
    raise exception 'the game has already started' using errcode = '42501';
  end if;

  -- An object or nothing. A filter that arrived as an array, a string or null
  -- becomes "the whole deck" rather than a settings row nobody can read back.
  v_filter := case when jsonb_typeof(p_filter) = 'object' then p_filter else '{}'::jsonb end;

  -- The mirror. `categories` absent from the filter means every category,
  -- which is what a null `categories` has always meant on this row.
  v_categories := case
    when jsonb_typeof(v_filter -> 'categories') = 'array' then v_filter -> 'categories'
    else 'null'::jsonb
  end;

  v_settings := coalesce(v_room.settings, '{}'::jsonb)
              || jsonb_build_object('deck', v_filter, 'categories', v_categories);

  update rooms set settings = v_settings
   where id = p_room_id and status = 'waiting';

  -- Read back rather than return what we built: if the row moved to 'playing'
  -- between the check and the update, the caller must see the settings that
  -- are actually on it, not the ones it asked for.
  return (select r.settings from rooms r where r.id = p_room_id);
end;
$$;

-- The caller is derived inside from a signature only the server can check, so
-- the app roles may call it — same shape as the other initData-authenticated
-- RPCs. `revoke ... from public` also strips EXECUTE from service_role, hence
-- the explicit re-grant.
revoke all on function public.set_room_deck_filter(uuid, jsonb, text) from public;
grant execute on function public.set_room_deck_filter(uuid, jsonb, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nothing to migrate.
--
-- `deck` is an added jsonb key, so every room that exists keeps dealing from
-- `categories` exactly as it did — roomDeckFilter() falls back to it when
-- `deck` is absent, and this function is the only thing that ever writes it.
-- ---------------------------------------------------------------------------
