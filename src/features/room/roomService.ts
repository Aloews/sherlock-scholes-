// Pure Supabase service — no hooks, no store mutations.

import { supabase } from '@/shared/lib/supabase';
import type {
  Room, RoomSettings, GameMode, Team, RoomPlayer, Round, RoundCard,
} from '@/shared/types/database';
import { pickRandomCards } from '@/features/game/cardRandomizer';

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
      cards_per_round: 100, // always 100 for 1v1 — override any user setting
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await supabase.rpc('create_1v1_room' as any, {
      p_host_id:  hostId,
      p_settings: s,
    });
    if (error || !data) throw new Error(error?.message ?? 'Failed to create room');
    return data as Room;
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
  return room as Room;
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
  const { data: room, error } = await supabase
    .from('rooms')
    .select()
    .eq('code', code.toUpperCase())
    .eq('status', 'waiting')
    .single();

  if (error || !room) throw new Error('Room not found or game already started');

  if ((room as Room).mode === '1v1') {
    // Atomic path (PENDING_SQL 2026-07-18): status + capacity + team +
    // membership in one transaction under a row lock. Two concurrent joins
    // can both pass the client-side count check below, so the RPC is the
    // real fix; the legacy path stays as a fallback until the SQL reaches
    // prod, then this call always succeeds or raises.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: joined, error: rpcError } = await supabase.rpc('join_1v1_room' as any, {
      p_room_id:   room.id,
      p_player_id: playerId,
    });
    if (!rpcError && joined) return joined as Room;
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

    if (existing) return room as Room;

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
    return room as Room;
  }

  // Team mode. Insert (not upsert) so we know whether the membership is new:
  // backing out an already-existing membership would kick a player out of a
  // live game. 23505 = unique violation → already a member, nothing to undo.
  const { error: insertErr } = await supabase
    .from('room_players')
    .insert({ room_id: room.id, player_id: playerId });

  if (insertErr && insertErr.code !== '23505') throw new Error('Failed to join room');
  if (!insertErr) await backOutIfStarted(room.id, playerId);

  return room as Room;
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
  const totalTurns = teams.length * total_rounds;

  if (room.mode === '1v1') {
    // Resolve which player belongs to which team (for explainer_id)
    const { data: roomPlayers } = await supabase
      .from('room_players')
      .select('player_id, team_id')
      .eq('room_id', room.id);

    const playerByTeam: Record<string, number> = {};
    for (const rp of (roomPlayers ?? []) as { player_id: number; team_id: string | null }[]) {
      if (rp.team_id) playerByTeam[rp.team_id] = rp.player_id;
    }

    // Host's team always goes first so the host explains in round 1
    const hostTeamId = Object.entries(playerByTeam).find(([, pid]) => pid === room.host_id)?.[0];
    const sortedTeams = hostTeamId
      ? [...teams.filter((t) => t.id === hostTeamId), ...teams.filter((t) => t.id !== hostTeamId)]
      : teams;

    const roundsToInsert = Array.from({ length: totalTurns }, (_, i) => ({
      room_id:      room.id,
      team_id:      sortedTeams[i % sortedTeams.length].id,
      explainer_id: playerByTeam[sortedTeams[i % sortedTeams.length].id] ?? null,
      round_number: i + 1,
      status:       'pending' as const,
      time_seconds: round_seconds,
    }));

    const { data: rounds, error } = await supabase
      .from('rounds')
      .insert(roundsToInsert)
      .select();

    if (error || !rounds?.length) throw new Error('Failed to create rounds');
    await activateRound(rounds[0] as Round, room);
    return;
  }

  // Team mode: rotate the explainer through each team's roster so every player
  // explains in turn (round N of a team -> Nth player of that team, wrapping).
  // Deterministic order: joined_at, then player_id as tiebreaker — never the
  // DB's unspecified return order.
  const { data: teamRoomPlayers } = await supabase
    .from('room_players')
    .select('player_id, team_id, joined_at')
    .eq('room_id', room.id);

  const rosterByTeam: Record<string, number[]> = {};
  const sortedPlayers = ((teamRoomPlayers ?? []) as {
    player_id: number; team_id: string | null; joined_at: string;
  }[])
    .filter((rp) => rp.team_id !== null)
    .sort((a, b) => (
      a.joined_at !== b.joined_at
        ? (a.joined_at < b.joined_at ? -1 : 1)
        : a.player_id - b.player_id
    ));
  for (const rp of sortedPlayers) {
    const teamId = rp.team_id as string;
    if (!rosterByTeam[teamId]) rosterByTeam[teamId] = [];
    rosterByTeam[teamId].push(rp.player_id);
  }

  const roundsToInsert = Array.from({ length: totalTurns }, (_, i) => {
    const team   = teams[i % teams.length];
    const roster = rosterByTeam[team.id] ?? [];
    const turn   = Math.floor(i / teams.length); // this team's Nth turn
    return {
      room_id:      room.id,
      team_id:      team.id,
      explainer_id: roster.length ? roster[turn % roster.length] : null,
      round_number: i + 1,
      status:       'pending' as const,
      time_seconds: round_seconds,
    };
  });

  const { data: rounds, error: roundError } = await supabase
    .from('rounds')
    .insert(roundsToInsert)
    .select();

  if (roundError || !rounds?.length) throw new Error('Failed to create rounds');
  await activateRound(rounds[0] as Round, room);
}

export async function activateRound(round: Round, room: Room): Promise<void> {
  // 1v1 always uses 100 cards (big buffer — player shouldn't run out in 60s)
  const cardsCount = room.mode === '1v1' ? 100 : room.settings.cards_per_round;
  const { categories } = room.settings;

  // null min_pageviews — no difficulty filter, the whole deck.
  const cards = await pickRandomCards(cardsCount, categories, null);

  await supabase.from('round_cards').insert(
    cards.map((card, i) => ({
      round_id:   round.id,
      card_id:    card.id,
      card_order: i + 1,
      status:     'pending',
    })),
  );

  const startedAt = new Date().toISOString();

  await Promise.all([
    supabase
      .from('rounds')
      .update({ status: 'active', started_at: startedAt })
      .eq('id', round.id),
    supabase
      .from('rooms')
      .update({ status: 'playing', current_round_id: round.id, started_at: startedAt })
      .eq('id', room.id),
  ]);
}

// ─── Cards ───────────────────────────────────────────────────

// card_translations exists only after docs/card_translations.sql ran; until
// then PostgREST rejects the embedded relation, so after the first such
// rejection the plain select is used for the rest of the session.
let cardsEmbedTranslations = true;

export async function fetchRoundCards(roundId: string): Promise<RoundCard[]> {
  if (cardsEmbedTranslations) {
    const { data, error } = await supabase
      .from('round_cards')
      .select('*, card:cards(*, card_translations(*))')
      .eq('round_id', roundId)
      .order('card_order');
    if (!error) return (data ?? []) as RoundCard[];
    cardsEmbedTranslations = false; // pre-migration DB — retry without
  }
  const { data } = await supabase
    .from('round_cards')
    .select('*, card:cards(*)')
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

export async function endRound(
  round: Round,
  room: Room,
  allRounds: Round[],
): Promise<'next_round' | 'game_end' | 'already_ended'> {
  // Atomic claim: whoever flips active→completed first carries on; everyone
  // else (a double call, or the non-explainer fallback in useGame) stops here.
  // Without the status guard two concurrent calls would double-write scores
  // and activate the next round twice (duplicate round_cards).
  const { data: claimed } = await supabase
    .from('rounds')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', round.id)
    .eq('status', 'active')
    .select('id');

  if (!claimed?.length) return 'already_ended';

  const { data: cards } = await supabase
    .from('round_cards')
    .select('status')
    .eq('round_id', round.id);

  const points = (cards ?? []).filter((c) => c.status === 'correct').length;

  await supabase.from('scores').upsert({
    room_id:  room.id,
    team_id:  round.team_id,
    round_id: round.id,
    points,
  });

  const nextRound = allRounds.find(
    (r) => r.round_number === round.round_number + 1 && r.status === 'pending',
  );

  if (!nextRound) {
    await supabase
      .from('rooms')
      .update({ status: 'finished', ended_at: new Date().toISOString() })
      .eq('id', room.id);
    updatePlayerStats(room.id).catch(() => undefined);
    return 'game_end';
  }

  await activateRound(nextRound, room);
  return 'next_round';
}

// ─── Player Stats ─────────────────────────────────────────────

async function updatePlayerStats(roomId: string): Promise<void> {
  const [
    { data: roomPlayers },
    { data: scores },
    { data: rounds },
  ] = await Promise.all([
    supabase.from('room_players').select('player_id, team_id').eq('room_id', roomId),
    supabase.from('scores').select('team_id, points').eq('room_id', roomId),
    supabase.from('rounds').select('id, explainer_id').eq('room_id', roomId),
  ]);

  if (!roomPlayers?.length) return;

  const roundExplainer: Record<string, number | null> = {};
  for (const r of rounds ?? []) {
    roundExplainer[r.id] = r.explainer_id;
  }

  const cardsPerExplainer: Record<number, number> = {};
  const roundIds = Object.keys(roundExplainer);
  if (roundIds.length > 0) {
    const { data: correctCards } = await supabase
      .from('round_cards')
      .select('round_id')
      .in('round_id', roundIds)
      .eq('status', 'correct');
    for (const rc of correctCards ?? []) {
      const explainerId = roundExplainer[rc.round_id];
      if (explainerId != null) {
        cardsPerExplainer[explainerId] = (cardsPerExplainer[explainerId] ?? 0) + 1;
      }
    }
  }

  const teamPoints: Record<string, number> = {};
  for (const s of scores ?? []) {
    teamPoints[s.team_id] = (teamPoints[s.team_id] ?? 0) + s.points;
  }

  const maxPoints = Math.max(0, ...Object.values(teamPoints));
  const winnerTeamIds = maxPoints > 0
    ? Object.entries(teamPoints).filter(([, pts]) => pts === maxPoints).map(([id]) => id)
    : [];

  await Promise.all(
    (roomPlayers as { player_id: number; team_id: string | null }[]).map((rp) => {
      const teamScore    = rp.team_id ? (teamPoints[rp.team_id] ?? 0) : 0;
      const won          = rp.team_id ? winnerTeamIds.includes(rp.team_id) : false;
      const cardsGuessed = cardsPerExplainer[rp.player_id] ?? 0;
      return supabase.rpc('increment_player_stats', {
        p_player_id:     rp.player_id,
        p_games_played:  1,
        p_games_won:     won ? 1 : 0,
        p_cards_guessed: cardsGuessed,
        p_total_score:   teamScore,
      });
    }),
  );
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
