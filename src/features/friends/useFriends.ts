import { useCallback, useEffect, useState } from 'react';
import { getRawInitData } from '@/shared/lib/telegram';
import { dataOr } from '@/shared/lib/loadState';
import {
  fetchFriends, fetchSuggestions, addFriend, removeFriend,
  type FriendRow, type SuggestionRow,
} from './friendsApi';

/**
 * The friends screen's data.
 *
 * Both lists move together on every change: adding somebody takes them out of
 * the suggestions and into the list, and the two must never disagree about
 * where a person is. Refetching both is one round trip more and one class of
 * bug fewer.
 */
export function useFriends(playerId: number | null) {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** The player whose row is mid-flight, so its button can say so. */
  const [pending, setPending] = useState<number | null>(null);
  // Отдельный признак, а не LoadState наружу: экран рисует друзей и подсказки
  // одним списком, и переводить его целиком ради одной строки значило бы
  // трогать всю разметку. Массив остаётся массивом, а «не загрузилось»
  // перестаёт притворяться «никого нет».
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    if (playerId === null) { setLoading(false); return; }
    const [list, suggested] = await Promise.all([
      fetchFriends(playerId),
      fetchSuggestions(playerId),
    ]);
    setFailed(list.status === 'error');
    setFriends(dataOr(list, []));
    setSuggestions(suggested);
    setLoading(false);
  }, [playerId]);

  useEffect(() => { void reload(); }, [reload]);

  const add = useCallback(async (friendId: number): Promise<boolean> => {
    setPending(friendId);
    const ok = await addFriend(getRawInitData(), friendId);
    // Only refetch on success. A refused write that reordered the screen
    // anyway would read as "it worked" — the one lie this must not tell.
    if (ok) await reload();
    setPending(null);
    return ok;
  }, [reload]);

  const remove = useCallback(async (friendId: number): Promise<boolean> => {
    setPending(friendId);
    const ok = await removeFriend(getRawInitData(), friendId);
    if (ok) await reload();
    setPending(null);
    return ok;
  }, [reload]);

  return { friends, suggestions, loading, failed, pending, add, remove, reload };
}
