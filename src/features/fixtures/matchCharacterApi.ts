// Характер матча — клиентская обёртка.
//
// Обоснование и границы — supabase/migrations/match_character.sql. Коротко:
// это НЕ прогноз счёта и не фаворит (шапка FixtureCard такое запрещает), а
// ответ на другой вопрос — каким будет матч.

import { supabase } from '@/shared/lib/supabase';

export interface MatchCharacter {
  fixture_id: string;
  home_key: string | null;
  home_name: string | null;
  away_key: string | null;
  away_name: string | null;
  /** Коды черт — те же, что на экране клуба: attacking, open, steady и прочие. */
  home_traits: string[];
  away_traits: string[];
  home_matches: number | null;
  away_matches: number | null;
  home_attack: number | null;
  home_defence: number | null;
  home_openness: number | null;
  away_attack: number | null;
  away_defence: number | null;
  away_openness: number | null;
  home_home_edge: number | null;
  away_home_edge: number | null;
  home_steadiness: number | null;
  away_steadiness: number | null;
  home_gf_pm: number | null;
  home_ga_pm: number | null;
  away_gf_pm: number | null;
  away_ga_pm: number | null;
  /** Тренер берётся ТОЛЬКО из club_manager — снимок в club_character убран. */
  home_manager: string | null;
  away_manager: string | null;
  /** Сумма ожидаемых голов ОБЕИХ сторон, а не чей-то счёт. */
  expected_goals: number | null;
  openness: number | null;
  home_news: number;
  away_news: number;
  home_headline: string | null;
  away_headline: string | null;
}

/**
 * ⚠️ ПО ТРЕБОВАНИЮ, А НЕ ПРИ ОТРИСОВКЕ СПИСКА. Замер 09.09.2026: один вызов —
 * 753 мс, из них 435 приходится на новости клубов (`club_news` стоит 217 мс на
 * клуб). Для нажатия это нормально, для списка из трёхсот матчей — нет.
 *
 * Пусто на ошибке, а не исключение: одна не открывшаяся справка не должна
 * ронять список матчей.
 */
export async function fetchMatchCharacter(
  fixtureId: string, lang: string,
): Promise<MatchCharacter | null> {
  const { data, error } = await supabase.rpc('match_character', {
    p_fixture_id: fixtureId,
    p_lang: lang,
  });
  if (error) {
    console.error('[match_character]', error.code ?? '', error.message);
    return null;
  }
  const rows = (data as MatchCharacter[]) ?? [];
  return rows[0] ?? null;
}
