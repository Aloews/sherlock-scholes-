// Pure Supabase service — no hooks, no store mutations.
// All table references updated: football_players → cards, football_player_id → card_id.

import { supabase } from '@/shared/lib/supabase';
import type { Room, RoomSettings, Team, RoomPlayer, Round, RoundCard } from '@/shared/types/database';
import { pickRandomCards } from '@/features/game/cardRandomizer';

// ─── Room ───────────────────────────────────────────────────

export async function createRoom(
  hostId: number,
  settings: Partial<RoomSettings> = {},
): Promise<Room> {
  const finalSettings: RoomSettings = {
    round_seconds:  60,
    cards_per_round: 5,
    total_rounds:   3,
    categories:     null, // all categories by default
    ...settings,
  };

  const { data: room, error } = await supabase
    .from('rooms')
    .insert({ host_id: hostId, settings: finalSettings, code: '' })
    .select()
    .single();

  if (error || !room) throw new Error(error?.message ?? 'Failed to create room');

  await supabase.from('teams').insert([
    { room_id: room.id, name: 'Team A', color: '#22c55e' },
    { room_id: room.id, name: 'Team B', color: '#3b82f6' },
  ]);

  await supabase.from('room_players').insert({ room_id: room.id, player_id: hostId });

  return room as Room;
}

export async function joinRoom(code: string, playerId: number): Promise<Room> {
  const { data: room, error } = await supabase
    .from('rooms')
    .select()
    .eq('code', code.toUpperCase())
    .eq('status', 'waiting')
    .single();

  if (error || !room) throw new Error('Room not found or game already started');

  await supabase
    .from('room_players')
    .upsert({ room_id: room.id, player_id: playerId }, { onConflict: 'room_id,player_id' });

  return room as Room;
}

export async function leaveRoom(roomId: string, playerId: number): Promise<void> {
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

  const roundsToInsert = Array.from({ length: totalTurns }, (_, i) => ({
    room_id:      room.id,
    team_id:      teams[i % teams.length].id,
    round_number: i + 1,
    status:       'pending' as const,
    time_seconds: round_seconds,
  }));

  const { data: rounds, error: roundError } = await supabase
    .from('rounds')
    .insert(roundsToInsert)
    .select();

  if (roundError || !rounds?.length) throw new Error('Failed to create rounds');

  await activateRound(rounds[0] as Round, room);
}

export async function activateRound(round: Round, room: Room): Promise<void> {
  const { cards_per_round, categories } = room.settings;

  const cards = await pickRandomCards(cards_per_round, categories);

  await supabase.from('round_cards').insert(
    cards.map((card, i) => ({
      round_id:  round.id,
      card_id:   card.id,       // ← was football_player_id
      card_order: i + 1,
      status:    'pending',
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

export async function fetchRoundCards(roundId: string): Promise<RoundCard[]> {
  const { data } = await supabase
    .from('round_cards')
    .select('*, card:cards(*)')   // ← was football_player:football_players(*)
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
): Promise<'next_round' | 'game_end'> {
  const { data: cards } = await supabase
    .from('round_cards')
    .select('status')
    .eq('round_id', round.id);

  const points = (cards ?? []).filter((c) => c.status === 'correct').length;

  await Promise.all([
    supabase
      .from('rounds')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', round.id),
    supabase.from('scores').upsert({
      room_id:  room.id,
      team_id:  round.team_id,
      round_id: round.id,
      points,
    }),
  ]);

  const nextRound = allRounds.find(
    (r) => r.round_number === round.round_number + 1 && r.status === 'pending',
  );

  if (!nextRound) {
    await supabase
      .from('rooms')
      .update({ status: 'finished', ended_at: new Date().toISOString() })
      .eq('id', room.id);
    // Non-blocking — stats failure must not break game_end flow
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

  // round_id → explainer_id for fast lookup
  const roundExplainer: Record<string, number | null> = {};
  for (const r of rounds ?? []) {
    roundExplainer[r.id] = r.explainer_id;
  }

  // Count correct cards individually: only rounds where THIS player was the explainer
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

  // Sum points per team
  const teamPoints: Record<string, number> = {};
  for (const s of scores ?? []) {
    teamPoints[s.team_id] = (teamPoints[s.team_id] ?? 0) + s.points;
  }

  const maxPoints = Math.max(0, ...Object.values(teamPoints));
  // All teams sharing the max are "winners" (draw = both win)
  const winnerTeamIds = maxPoints > 0
    ? Object.entries(teamPoints).filter(([, pts]) => pts === maxPoints).map(([id]) => id)
    : [];

  await Promise.all(
    roomPlayers.map((rp) => {
      const teamScore    = rp.team_id ? (teamPoints[rp.team_id] ?? 0) : 0;
      const won          = rp.team_id ? winnerTeamIds.includes(rp.team_id) : false;
      const cardsGuessed = cardsPerExplainer[rp.player_id] ?? 0;
      return supabase.rpc('increment_player_stats', {
        p_player_id:     rp.player_id,
        p_games_played:  1,
        p_games_won:     won ? 1 : 0,
        p_cards_guessed: cardsGuessed,   // personal: rounds explained × correct cards
        p_total_score:   teamScore,      // team score credited to the player
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
