import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';

interface OpenRoom {
  id: string;
  code: string;
  host_id: number;
  mode: 'team' | '1v1';
  created_at: string;
  hostName: string;
}

type State = 'loading' | 'ready' | 'error';

/**
 * Room discovery replaces the impossible "join on the first character" rule:
 * show waiting rooms immediately, keep their secret join code internal, and
 * let the player explicitly choose one. The full code is still validated by
 * the same joinRoom path on the server.
 */
export function OpenRoomsPanel({
  onJoin,
  loading,
  playerId,
}: {
  onJoin: (code: string) => void;
  loading: boolean;
  playerId: number | null;
}) {
  const [rooms, setRooms] = useState<OpenRoom[]>([]);
  const [state, setState] = useState<State>('loading');

  const refresh = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('rooms')
      .select('id, code, host_id, mode, created_at')
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      setState('error');
      return;
    }

    const candidates = (rows ?? []).filter((row) => typeof row.code === 'string' && row.code.trim().length > 0 && row.host_id !== playerId);
    const candidateIds = candidates.map((row) => row.id);
    const [hostResult, memberResult] = await Promise.all([
      candidates.length
        ? supabase.from('players').select('id, first_name, last_name').in('id', [...new Set(candidates.map((row) => row.host_id))])
        : Promise.resolve({ data: [], error: null }),
      playerId !== null && candidateIds.length
        ? supabase.from('room_players').select('room_id').eq('player_id', playerId).in('room_id', candidateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const hosts = hostResult.data;
    const hostError = hostResult.error;
    const memberError = memberResult.error;
    if (hostError || memberError) {
      setState('error');
      return;
    }
    const alreadyJoined = new Set((memberResult.data ?? []).map((row) => row.room_id));
    const valid = candidates.filter((row) => !alreadyJoined.has(row.id));
    const roomIds = valid.map((row) => row.id);
    const { data: memberships, error: membershipError } = roomIds.length
      ? await supabase.from('room_players').select('room_id').in('room_id', roomIds)
      : { data: [], error: null };
    if (membershipError) {
      setState('error');
      return;
    }
    const counts = new Map<string, number>();
    for (const member of memberships ?? []) counts.set(member.room_id, (counts.get(member.room_id) ?? 0) + 1);
    const available = valid.filter((row) => row.mode !== '1v1' || (counts.get(row.id) ?? 0) < 2);
    const hostIds = [...new Set(available.map((row) => row.host_id))];
    const names = new Map((hosts ?? []).filter((p) => hostIds.includes(p.id)).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]));
    setRooms(available.map((row) => ({
      id: row.id,
      code: row.code.trim(),
      host_id: row.host_id,
      mode: row.mode as 'team' | '1v1',
      created_at: row.created_at,
      hostName: names.get(row.host_id) || 'Игрок',
    })));
    setState('ready');
  }, [playerId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section className="w-full rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-white text-sm font-semibold">Открытые комнаты</h2>
        <button type="button" onClick={() => { void refresh(); }} className="text-brand-muted text-xs hover:text-white">
          Обновить
        </button>
      </div>
      {state === 'loading' && <p className="text-brand-muted text-sm">Ищем комнаты…</p>}
      {state === 'error' && <p className="text-red-400/80 text-sm">Не удалось загрузить комнаты. Можно войти по коду ниже.</p>}
      {state === 'ready' && rooms.length === 0 && <p className="text-brand-muted text-sm">Свободных комнат пока нет. Создайте свою или введите код приглашения.</p>}
      {rooms.length > 0 && (
        <ul className="space-y-2">
          {rooms.map((room) => (
            <li key={room.id} className="flex items-center gap-3 rounded-xl border border-brand-border bg-brand-bg p-3">
              <div className="w-9 h-9 rounded-xl bg-brand-surface flex items-center justify-center" aria-hidden="true">
                {room.mode === '1v1' ? '⚔️' : '👥'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{room.hostName}</p>
                <p className="text-brand-muted text-xs">{room.mode === '1v1' ? 'Дуэль 1 на 1' : 'Командная игра'}</p>
              </div>
              <button type="button" disabled={loading} onClick={() => onJoin(room.code)}
                className="rounded-xl bg-brand-accent px-3 py-2 text-xs font-semibold text-brand-bg disabled:opacity-50">
                Войти
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
