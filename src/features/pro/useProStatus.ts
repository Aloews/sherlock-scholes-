import { useEffect } from 'react';
import { getRawInitData } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import { getUserStatus } from './proApi';

// Fetch the server-validated Pro status once per session. Runs after Telegram
// is ready (mounted under AuthGate). Outside Telegram there is no initData, so
// we mark loaded and stay free — Pro can only be confirmed by the server.
export function useProStatus(): void {
  const loaded = useProStore((s) => s.loaded);
  const setStatus = useProStore((s) => s.setStatus);
  const setLoading = useProStore((s) => s.setLoading);
  const markLoaded = useProStore((s) => s.markLoaded);

  useEffect(() => {
    if (loaded) return;
    const initData = getRawInitData();
    if (!initData) { markLoaded(); return; }

    let cancelled = false;
    setLoading(true);
    getUserStatus(initData)
      .then((s) => {
        if (cancelled) return;
        if (s) setStatus({ telegramId: s.telegram_id, isPro: s.is_pro, proSince: s.pro_since });
        else markLoaded();
      })
      .catch(() => { if (!cancelled) markLoaded(); });

    return () => { cancelled = true; };
  }, [loaded, setStatus, setLoading, markLoaded]);
}
