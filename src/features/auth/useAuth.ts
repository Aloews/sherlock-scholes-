import { useEffect } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { getTelegramUser, initTelegram } from '@/shared/lib/telegram';
import { useAuthStore } from '@/shared/store/authStore';
import type { Player } from '@/shared/types/database';

export function useAuth() {
  const { player, initialized, setPlayer, setInitialized } = useAuthStore();

  useEffect(() => {
    async function authenticate() {
      initTelegram();

      const tgUser = getTelegramUser();
      if (!tgUser) {
        setInitialized(true);
        return;
      }

      const { data, error } = await supabase
        .from('players')
        .upsert(
          {
            id: tgUser.id,
            username: tgUser.username ?? null,
            first_name: tgUser.first_name,
            last_name: tgUser.last_name ?? null,
            avatar_url: tgUser.photo_url ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
        .select()
        .single();

      if (data) {
        setPlayer(data);
      } else if (error) {
        console.error('[useAuth] players upsert failed:', error.code, error.message);
        // Dev fallback: keep app usable even when DB is unreachable
        if (import.meta.env.DEV) {
          setPlayer({
            id: tgUser.id,
            username: tgUser.username ?? null,
            first_name: tgUser.first_name,
            last_name: tgUser.last_name ?? null,
            avatar_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Player);
        }
      }

      setInitialized(true);
    }

    if (!initialized) {
      authenticate();
    }
  }, [initialized, setPlayer, setInitialized]);

  return { player, initialized };
}
