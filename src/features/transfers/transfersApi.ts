// Трансферы: клиентская половина supabase/migrations/recent_transfers.sql.
//
// ⚠️ ЗДЕСЬ НЕ ФИЛЬТРУЕТСЯ ПО ИСТОЧНИКУ, И ЭТО НАРОЧНО. Отбор
// `source = 'wikidata'` живёт в SQL, потому что он не косметика, а условие
// правильности: у остальных источников `joined_at` — дата матча, а не
// перехода (замер: 29 игроков из 14 несвязанных клубов «пришли» в один день,
// когда сыграно 70 матчей). Продублировать это правило здесь значило бы
// завести второе место, где оно может разойтись с первым.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

export interface Transfer {
  card_id: string;
  name: string;
  /** Уровень игрока — то же число, что в рейтинге и на карточке. */
  level: number | null;
  to_key: string;
  to_club: string | null;
  to_crest: string | null;
  /** Прежний клуб известен НЕ ВСЕГДА: первое появление в составах — не переход. */
  from_key: string | null;
  from_club: string | null;
  moved_at: string;
}

export async function fetchRecentTransfers(
  lang: string,
  days = 45,
  limit = 20,
): Promise<LoadState<Transfer[]>> {
  const res = await supabase.rpc('recent_transfers', {
    p_days: days,
    p_lang: lang,
    p_limit: limit,
  });
  return fromPostgrest<Transfer[]>(res, 'recent_transfers');
}
