// Схема в фэнтези — ЧИСТАЯ часть: ни сети, ни Supabase, ни окружения.
//
// ⚠️ ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ПАРА ЭКСПОРТОВ В fantasyApi.ts. Там это уже
// стояло, и тест на него УПАЛ В CI, не выполнив ни одной проверки:
//
//   FAIL src/features/fantasy/fantasyApi.test.ts
//   Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY
//     ❯ src/shared/lib/supabase.ts:7:9
//     ❯ src/features/fantasy/fantasyApi.ts:1:1
//
// `shared/lib/supabase.ts` бросает НА ЗАГРУЗКЕ МОДУЛЯ, если переменных нет, а
// `fantasyApi.ts` импортирует его первой строкой. Локально `.env` есть, и всё
// проходило; в CI его нет — и тест чистой функции падал на клиенте базы,
// который ему не нужен вовсе. Хуже того, падал он МОЛЧА для автора: «49 из 50
// файлов прошли, 712 тестов зелёные» выглядит как успех, если не читать, какой
// именно файл не загрузился.
//
// Поэтому правило живёт здесь, без единого импорта из приложения, — тем же
// приёмом, что `features/arena/ranked.ts` и `features/chess/rules.ts`.
// `fantasyApi.ts` его реэкспортирует, чтобы у экрана остался один вход.

/**
 * Линия игрока — 'gk' | 'def' | 'mid' | 'fwd', или null.
 *
 * NULL — это «мы не знаем», а не «универсал»: позиция приходит из обогащения, и
 * её отсутствие говорит о наших данных, а не об игроке. Такая карточка считается
 * по старому, позиционно-слепому правилу и не идёт в зачёт требований схемы —
 * см. шапку supabase/migrations/fantasy_tactics.sql.
 */
export type PositionKey = 'gk' | 'def' | 'mid' | 'fwd';

export type TacticKey = 'defensive' | 'balanced' | 'attacking';

/**
 * Схема и её цена. Правило приходит С СЕРВЕРА, а не лежит второй копией здесь:
 * веса и требования хранятся в таблице `fantasy_tactic`, потому что их
 * показывают игроку, а показанное и применённое обязаны быть одним числом.
 */
export interface Tactic {
  key: TacticKey;
  /** Множитель на сухарь. 0 — «Атака» за сухари не платит вовсе. */
  clean_sheet_x: number;
  /** Множитель на голы клуба. 0 — «Оборона» за голы не платит вовсе. */
  goal_x: number;
  /** Сколько вратарей+защитников обязано быть в пятёрке. null — без требования. */
  min_defence: number | null;
  min_forwards: number | null;
}

/** Схема по умолчанию: единственная без требований к составу. */
export const DEFAULT_TACTIC: TacticKey = 'balanced';

/**
 * Подходит ли пятёрка под схему — ТА ЖЕ проверка, что на сервере.
 *
 * Копия правила здесь не потому, что серверу не доверяют, а потому, что кнопка
 * обязана отказывать ДО отправки и объяснять, чего не хватает. Сервер всё равно
 * проверяет заново (`fantasy_tactic_fits` в set_fantasy_squad) — эта функция
 * ничего не разрешает, только предсказывает отказ.
 *
 * Карточка без позиции не закрывает ни одно требование: см. PositionKey.
 */
export function tacticFits(positions: (PositionKey | null)[], tactic: Tactic): boolean {
  const defence = positions.filter((p) => p === 'gk' || p === 'def').length;
  const forwards = positions.filter((p) => p === 'fwd').length;
  return defence >= (tactic.min_defence ?? 0) && forwards >= (tactic.min_forwards ?? 0);
}
