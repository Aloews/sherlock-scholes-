import { useEffect, useRef } from 'react';
import { getRawInitData } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import { loadAnonGames } from '@/features/game/onboarding';
import { getUserStatus } from './proApi';
import { readProCache, writeProCache, clearProCache } from './proCache';

/**
 * Подписка: сперва памятка, следом сервер.
 *
 * ⚠️ ПОРЯДОК ЗДЕСЬ И ЕСТЬ УСКОРЕНИЕ. Раньше `ProOnly` держал экран весь поход
 * за `get_user_status` (262…879 мс на бою), и только потом экран начинал
 * грузить расписание и новости — то есть два похода ПО ОЧЕРЕДИ. Теперь
 * памятка открывает ворота в том же кадре, экран уходит за своими данными
 * сразу, а проверка идёт РЯДОМ и поправляет ответ, когда вернётся.
 *
 * ⚠️ ПРОВЕРКА НЕ ОТМЕНЯЕТСЯ ПАМЯТКОЙ. Сторож теперь `ranRef`, а не `loaded`:
 * иначе `seedStatus` поставил бы `loaded`, и поход за настоящим ответом не
 * состоялся бы вовсе — отменённая подписка жила бы неделю.
 *
 * Вне Telegram initData нет, подтвердить подписку нечем: считаем бесплатным.
 */
export function useProStatus(): void {
  const setStatus = useProStore((s) => s.setStatus);
  const seedStatus = useProStore((s) => s.seedStatus);
  const setLoading = useProStore((s) => s.setLoading);
  const markLoaded = useProStore((s) => s.markLoaded);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const initData = getRawInitData();
    if (!initData) { void loadAnonGames(); markLoaded(); return; }

    const cached = readProCache(initData);
    if (cached) seedStatus(cached);

    let cancelled = false;
    setLoading(true);
    getUserStatus(initData)
      .then((s) => {
        if (cancelled) return;
        if (s) {
          setStatus({
            telegramId: s.telegram_id, isPro: s.is_pro,
            proSince: s.pro_since, gamesPlayed: s.games_played,
          });
          writeProCache(initData, { isPro: s.is_pro, gamesPlayed: s.games_played });
        } else {
          // Сервер не подтвердил — памятку долой, иначе она переживёт отказ.
          clearProCache(initData);
          void loadAnonGames();
          markLoaded();
        }
      })
      // ⚠️ Сеть отвалилась — памятка ОСТАЁТСЯ. Подписчик в метро не должен
      // терять оплаченные экраны из-за пропавшего интернета; срок годности
      // (неделя) всё равно закроет их, если сеть не вернётся.
      .catch(() => { if (!cancelled) markLoaded(); });

    return () => { cancelled = true; };
  }, [setStatus, seedStatus, setLoading, markLoaded]);
}
