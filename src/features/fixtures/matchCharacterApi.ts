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
  /**
   * Обычная результативность — медиана по ВСЕМ измеренным клубам.
   *
   * ⚠️ БЕЗ НЕЁ ЧИСЛО ВЫШЕ НЕ ЧИТАЕТСЯ. «Ожидается 2.9» само по себе не
   * говорит, много это или мало, и прежде экран пытался сказать это словами —
   * «голов ожидаем столько же, сколько в обычном матче». Владелец назвал
   * такую фразу издевательской, и был прав: она пересказывала середину шкалы
   * и не добавляла ни одного факта. Два числа рядом добавляют.
   */
  goals_median: number | null;
  openness: number | null;
  /** Последние пять матчей буквами, старые слева: `WWDLW`. */
  home_form: string | null;
  away_form: string | null;
  /**
   * Заголовок про ИГРУ — отобранный, а не последний.
   *
   * ⚠️ ПРЕЖДЕ ЗДЕСЬ БЫЛ ПРОСТО САМЫЙ СВЕЖИЙ, и владелец описал результат
   * точно: «в „пишут“ везде новости об анонсе матча и где его посмотреть».
   * Так и было — анонсы и трансляции публикуются чаще и позже всего.
   * Отбирает `news_about_play` в SQL: анонс отбрасывается совсем, слова
   * тренера поднимаются наверх.
   *
   * null — ничего про игру не нашлось, и тогда строки на экране НЕТ. Не
   * «новостей нет»: сообщать об отсутствии — это то же, что делала снятая
   * строка про травмы.
   */
  home_headline: string | null;
  away_headline: string | null;
  /** Оценка отобранного заголовка: по ней видно снаружи, что отбор работает. */
  home_headline_score: number | null;
  away_headline_score: number | null;
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
