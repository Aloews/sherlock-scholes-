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
}: {
  onJoin: (code: string) => void;
  loading: boolean;
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

    const valid = (rows ?? []).filter((row) => typeof row.code === 'string' && row.code.trim().length > 0);
    const hostIds = [...new Set(valid.map((row) => row.host_id))];
    const { data: hosts, error: hostError } = hostIds.length
      ? await supabase.from('players').select('id, first_name, last_name').in('id', hostIds)
      : { data: [], error: null };

    if (hostError) {
      setState('error');
      return;
    }

    const names = new Map((hosts ?? []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]));
    setRooms(valid.map((row) => ({
      id: row.id,
      code: row.code.trim(),
      host_id: row.host_id,
      mode: row.mode as 'team' | '1v1',
      created_at: row.created_at,
      hostName: names.get(row.host_id) || 'Игрок',
    })));
    setState('ready');
  }, []);

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
