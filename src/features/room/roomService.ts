// Pure Supabase service — no hooks, no store mutations.

import { supabase } from '@/shared/lib/supabase';
import type {
  Room, RoomSettings, GameMode, Team, RoomPlayer, Round, RoundCard,
} from '@/shared/types/database';
import { pickCardIds } from '@/features/game/cardRandomizer';
import { isCardTranslationLang } from '@/shared/lib/cardName';
import { getRawInitData } from '@/shared/lib/telegram';
import { pinnableFilter, roomDeckFilter } from '@/features/room/roomDeck';
import type { DeckFilter } from '@/shared/types/deck';
import { CODE_LENGTH, normalizeCode } from '@/features/lobby/invite';
import { requestAliasRoundPlan } from '@/features/room/roundPlan';
import { endAliasRound } from '@/features/game/roundLifecycle';

function requireRoomCode(room: Room, expectedCode?: string): Room {
  const code = normalizeCode(room.code);
  if (!code || (expectedCode !== undefined && code !== expectedCode)) {
    throw new Error('INVALID_ROOM_CODE_RETURNED');
  }
  return { ...room, code };
}

function requireGeneratedRoomCode(room: Room): Room {
  const validated = requireRoomCode(room);
  if (validated.code.length !== CODE_LENGTH) {
    throw new Error('INVALID_ROOM_CODE_RETURNED');
  }
  return validated;
}

// ─── Room ───────────────────────────────────────────────────

export async function createRoom(
  hostId: number,
  settings: Partial<RoomSettings> = {},
  mode: GameMode = 'team',
): Promise<Room> {
  if (mode === '1v1') {
    const s = {
      round_seconds:   60,
      total_rounds:    3,
      categories:      null,
      ...settings,
      cards_per_round: settings.deck?.card_ids?.length
        ? Math.min(100, settings.deck.card_ids.length)
        : 100,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('create_1v1_room' as any, {
      p_host_id:  hostId,
      p_settings: s,
    });
    if (error || !data) throw new Error(error?.message ?? 'Failed to create room');
    return requireGeneratedRoomCode(data as Room);
  }

  const finalSettings: RoomSettings = {
    round_seconds:   60,
    cards_per_round: 5,
    total_rounds:    3,
    categories:      null,
    ...settings,
  };

  // Atomic bootstrap: room + Team A/Team B + host room_player in one txn (one round-trip).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: room, error } = await supabase.rpc('create_team_room' as any, {
    p_host_id:  hostId,
    p_settings: finalSettings,
  });
  if (error || !room) throw new Error(error?.message ?? 'Failed to create room');
  return requireGeneratedRoomCode(room as Room);
}

// Join-vs-start race guard: joinRoom saw status='waiting' before inserting,
// but the host may have started the game in between — the rounds/rosters are
// already built and the late joiner would be a permanent spectator. Re-check
// after the insert and back the membership out.
async function backOutIfStarted(
  roomId: string,
  playerId: number,
  teamIdToDrop?: string,
): Promise<void> {
  const { data } = await supabase.from('rooms').select('status').eq('id', roomId).single();
  if ((data as { status: string } | null)?.status === 'waiting') return;
  await supabase.from('room_players').delete().eq('room_id', roomId).eq('player_id', playerId);
  if (teamIdToDrop) await supabase.from('teams').delete().eq('id', teamIdToDrop);
  throw new Error('Room not found or game already started');
}

export async function joinRoom(code: string, playerId: number): Promise<Room> {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) throw new Error('INVALID_ROOM_CODE');
  const { data: room, error } = await supabase
    .from('rooms')
    .select()
    .eq('code', normalizedCode)
    .eq('status', 'waiting')
    .single();

  if (error || !room) throw new Error('Room not found or game already started');
  const validRoom = requireRoomCode(room as Room, normalizedCode);

  if (validRoom.mode === '1v1') {
    // Atomic path (PENDING_SQL 2026-07-18): status + capacity + team +
    // membership in one transaction under a row lock. Two concurrent joins
    // can both pass the client-side count check below, so the RPC is the
    // real fix; the legacy path stays as a fallback until the SQL reaches
    // prod, then this call always succeeds or raises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: joined, error: rpcError } = await supabase.rpc('join_1v1_room' as any, {
      p_room_id:   validRoom.id,
      p_player_id: playerId,
    });
    if (!rpcError && joined) return requireRoomCode(joined as Room, normalizedCode);
    if (rpcError?.message.includes('ROOM_FULL_1V1'))    throw new Error('ROOM_FULL_1V1');
    if (rpcError?.message.includes('ROOM_NOT_WAITING')) throw new Error('Room not found or game already started');
    // Any other error means the function isn't on prod yet → legacy path.

    // Check if player is already in room
    const { data: existing } = await supabase
      .from('room_players')
      .select('id')
      .eq('room_id', room.id)
      .eq('player_id', playerId)
      .maybeSingle();

    if (existing) return validRoom;

    // Capacity check
    const { count } = await supabase
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id);

    if ((count ?? 0) >= 2) throw new Error('ROOM_FULL_1V1');

    // Create team for joining player
    const { data: joiner } = await supabase
      .from('players')
      .select('first_name')
      .eq('id', playerId)
      .maybeSingle();

    const { data: team2, error: teamErr } = await supabase
      .from('teams')
      .insert({
        room_id: room.id,
        name:    (joiner as { first_name: string } | null)?.first_name ?? 'Player 2',
        color:   '#3b82f6',
      })
      .select()
      .single();

    if (teamErr || !team2) throw new Error('Failed to join room');

    await supabase
      .from('room_players')
      .insert({ room_id: room.id, player_id: playerId, team_id: (team2 as Team).id });

    await backOutIfStarted(room.id, playerId, (team2 as Team).id);
    return validRoom;
  }

  // Team mode. Insert (not upsert) so we know whether the membership is new:
  // backing out an already-existing membership would kick a player out of a
  // live game. 23505 = unique violation → already a member, nothing to undo.
  const { error: insertErr } = await supabase
    .from('room_players')
    .insert({ room_id: room.id, player_id: playerId });

  if (insertErr && insertErr.code !== '23505') throw new Error('Failed to join room');
  if (!insertErr) await backOutIfStarted(room.id, playerId);

  return validRoom;
}

export async function leaveRoom(roomId: string, playerId: number): Promise<void> {
  const { data: roomData } = await supabase
    .from('rooms')
    .select('mode')
    .eq('id', roomId)
    .maybeSingle();

  if ((roomData as { mode: string } | null)?.mode === '1v1') {
    // Find player's team before deleting
    const { data: rp } = await supabase
      .from('room_players')
      .select('team_id')
      .eq('room_id', roomId)
      .eq('player_id', playerId)
      .maybeSingle();

    await supabase
      .from('room_players')
      .delete()
      .eq('room_id', roomId)
      .eq('player_id', playerId);

    if ((rp as { team_id: string | null } | null)?.team_id) {
      await supabase
        .from('teams')
        .delete()
        .eq('id', (rp as { team_id: string }).team_id);
    }

    // If room is empty → mark finished
    const { count } = await supabase
      .from('room_players')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', roomId);

    if ((count ?? 0) === 0) {
      await supabase
        .from('rooms')
        .update({ status: 'finished', ended_at: new Date().toISOString() })
        .eq('id', roomId);
    }
    return;
  }

  await supabase
    .from('room_players')
    .delete()
    .eq('room_id', roomId)
    .eq('player_id', playerId);
}

export async function fetchRoom(roomId: string): Promise<Room> {
  const { data, error } = await supabase.from('rooms').select().eq('id', roomId).single();
  if (error || !data) throw new Error('Room not found');
  return data as Room;
}

/**
 * Store the host's deck choice on the room.
 *
 * Through an RPC rather than `rooms.update`, because the row is not protected:
 * `rooms_public_update` is `USING (true)`, so any client can write any room —
 * a guest could redeal the host's game, and someone with a room code could
 * rewrite a lobby they never joined. `set_room_deck_filter` derives the caller
 * from the signed initData and refuses anyone but the host, the same shape as
 * pause_round() and claim_room_voice_provider().
 *
 * Returns the settings the server actually stored, so the caller renders what
 * is on the row and not what it hoped to put there. Everyone else in the lobby
 * learns about it through the realtime UPDATE on `rooms` they already have.
 */
export async function setRoomDeckFilter(
  roomId: string,
  filter: DeckFilter,
): Promise<RoomSettings> {
  const { data, error } = await supabase.rpc('set_room_deck_filter', {
    p_room_id:   roomId,
    p_filter:    pinnableFilter(filter),
    p_init_data: getRawInitData() || null,
  });
  if (error) throw new Error(error.message);
  return data as RoomSettings;
}

// ─── Teams ──────────────────────────────────────────────────

export async function fetchTeams(roomId: string): Promise<Team[]> {
  const { data } = await supabase.from('teams').select().eq('room_id', roomId).order('name');
  return (data ?? []) as Team[];
}

export async function assignTeam(roomPlayerId: string, teamId: string): Promise<void> {
  await supabase.from('room_players').update({ team_id: teamId }).eq('id', roomPlayerId);
}

export async function fetchRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data } = await supabase
    .from('room_players')
    .select('*, player:players(*)')
    .eq('room_id', roomId)
    .order('joined_at');
  return (data ?? []) as RoomPlayer[];
}

// ─── Game Start ──────────────────────────────────────────────

export async function startGame(room: Room, teams: Team[]): Promise<void> {
  const { round_seconds, total_rounds } = room.settings;
  let members: Pick<RoomPlayer, 'player_id' | 'team_id' | 'joined_at'>[] = [];
  if (import.meta.env.DEV) {
    const { data: roomPlayers, error: playersError } = await supabase
      .from('room_players')
      .select('player_id, team_id, joined_at')
      .eq('room_id', room.id);
    if (playersError) throw new Error('Failed to load room players');
    members = (roomPlayers ?? []) as Pick<RoomPlayer, 'player_id' | 'team_id' | 'joined_at'>[];
  }

  const plan = await requestAliasRoundPlan({
    roomId: room.id,
    mode: room.mode,
    teams: teams.map((team) => team.id),
    members,
    hostId: room.host_id,
    totalRounds: total_rounds,
    initData: getRawInitData(),
  });

  const roundsToInsert = plan.map((round) => ({
    room_id: room.id,
    team_id: round.team_id,
    explainer_id: round.explainer_id,
    round_number: round.round_number,
    status: 'pending' as const,
    time_seconds: round_seconds,
  }));

  const { data: rounds, error } = await supabase
    .from('rounds')
    .insert(roundsToInsert)
    .select();

  if (error || !rounds?.length) throw new Error('Failed to create rounds');
  await activateRound((rounds[0] as Round).id, room);
}

// How long the round-summary overlay stays up between rounds. The runner
// sleeps this long before activating the next round; the watchdog in useGame
// uses it to know when a stalled activation is overdue.
export const SUMMARY_PAUSE_MS = 4000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Claim-then-activate: rooms.current_round_id flips to this round exactly once
// (the .or matches only while it still points elsewhere), so the round runner
// and the useGame watchdog can never deal two hands or start the timer twice.
// Cards are inserted BEFORE the round goes 'active' — clients fetch the hand
// the moment they see the active event.
export async function activateRound(roundId: string, room: Room): Promise<boolean> {
  const { data: claimed } = await supabase
    .from('rooms')
    .update({ status: 'playing', current_round_id: roundId, started_at: new Date().toISOString() })
    .eq('id', room.id)
    .or(`current_round_id.is.null,current_round_id.neq.${roundId}`)
    .select('id');

  if (!claimed?.length) return false;

  // 1v1 always uses 100 cards (big buffer — player shouldn't run out in 60s)
  const cardsCount = room.mode === '1v1' ? 100 : room.settings.cards_per_round;

  // One filter for the room, so both teams face the same spread — whatever the
  // host narrowed it to in the lobby, and the whole deck when they narrowed
  // nothing. roomDeckFilter is also what the lobby counts, so the number under
  // the Start button and this hand can never describe different decks.
  // Ids only: this inserts round_cards and never reads another column. Asking
  // for whole rows shipped 141 kB to the host to extract 100 UUIDs (4.9 kB),
  // on the critical path between "start" and the first card appearing.
  const cardIds = await pickCardIds(roomDeckFilter(room.settings), cardsCount);

  await supabase.from('round_cards').insert(
    cardIds.map((cardId, i) => ({
      round_id:   roundId,
      card_id:    cardId,
      card_order: i + 1,
      status:     'pending',
    })),
  );

  await supabase
    .from('rounds')
    .update({ status: 'active', started_at: new Date().toISOString() })
    .eq('id', roundId);
  return true;
}

// ─── Cards ───────────────────────────────────────────────────

// card_translations exists only after docs/card_translations.sql ran; until
// then PostgREST rejects the embedded relation, so after the first such
// rejection the plain select is used for the rest of the session.
let cardsEmbedTranslations = true;

// Only what PlayerCard draws (PlayableCard). A 1v1 round holds 100 cards, and
// `cards(*)` shipped every column of each — facts, career_stats, legend_career,
// clubs_minutes, attributes — to BOTH players, on every round. Measured against
// production: 111 kB of card columns where the screen reads 13 kB, 61 kB of it
// JSONB that neither the game screen nor the end screen ever opens.
//
// Widening this back to `*` is how the slow load comes back. If a screen needs
// a heavy column, fetch it for the handful of cards that screen shows.
const PLAY_COLUMNS = 'id, name, name_en, category, category_ru, photo_url, tier';

/**
 * The cards of a round, in play order, carrying only what the screen draws.
 *
 * `lang` decides whether translations travel at all. cardDisplayName() reads
 * card_translations ONLY for the seven languages that keep card names there —
 * ru falls back to `name` and en to `name_en`, so for those two the embed is
 * pure waste, and for the rest only that one language is of any use.
 */
export async function fetchRoundCards(roundId: string, lang: string): Promise<RoundCard[]> {
  const base = lang.slice(0, 2);
  const wantsTranslations = cardsEmbedTranslations && isCardTranslationLang(base);

  if (wantsTranslations) {
    const { data, error } = await supabase
      .from('round_cards')
      // card_translations(*) would also carry `source` — provenance for the
      // enrichment scripts, never shown to a player.
      .select(`*, card:cards(${PLAY_COLUMNS}, card_translations(card_id, lang, name))`)
      .eq('round_id', roundId)
      .eq('card.card_translations.lang', base)
      .order('card_order');
    if (!error) return (data ?? []) as RoundCard[];
    cardsEmbedTranslations = false; // pre-migration DB — retry without
  }

  const { data } = await supabase
    .from('round_cards')
    .select(`*, card:cards(${PLAY_COLUMNS})`)
    .eq('round_id', roundId)
    .order('card_order');
  return (data ?? []) as RoundCard[];
}

export async function markCard(cardId: string, status: 'correct' | 'skipped'): Promise<void> {
  await supabase
    .from('round_cards')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', cardId);
}

// ─── End Round ───────────────────────────────────────────────

export type EndRoundOutcome = 'next_round' | 'game_end' | 'already_ended';

/**
 * Close a round: claim it, write its score, and either point at the next round
 * or finish the game — all inside ONE server transaction.
 *
 * The transaction is the whole point. This used to be four client calls in a
 * row, and the FIRST of them (rounds → 'completed') is what wakes every other
 * client through realtime. Those clients then fetched the scores — arriving in
 * the window before the third call had written them. For round 1 the answer
 * was always 0:0, reproducibly, and a player reported exactly that after
 * scoring 63. Postgres emits the realtime event at COMMIT, so with the whole
 * sequence in end_round() the score row is already there when the event lands.
 *
 * Reordering the client calls was not an option: that first write is also the
 * atomic claim that stops the explainer and the useGame watchdog from scoring
 * the same round twice. See supabase/migrations/end_round_rpc.sql.
 */
export async function endRound(roundId: string, room: Room): Promise<EndRoundOutcome> {
  const { outcome, next_round_id: nextRoundId } = await endAliasRound(
    roundId,
    getRawInitData(),
  );

  // Statistics are credited by trg_award_room_stats inside the end_round
  // transaction, so game_end needs no follow-up request from the client.
  if (outcome !== 'next_round' || !nextRoundId) return outcome;

  await sleep(SUMMARY_PAUSE_MS);
  await activateRound(nextRoundId, room);
  return 'next_round';
}

export async function fetchRoundScores(
  roomId: string,
): Promise<{ teamId: string; teamName: string; total: number }[]> {
  const { data } = await supabase.rpc('get_room_scores', { p_room_id: roomId });
  return (data ?? []).map((row: { team_id: string; team_name: string; total_points: number }) => ({
    teamId:   row.team_id,
    teamName: row.team_name,
    total:    Number(row.total_points),
  }));
}
