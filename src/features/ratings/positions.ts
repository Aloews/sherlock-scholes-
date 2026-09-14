/**
 * Четыре категории, на которые делятся все игроки.
 *
 * ⚠️ ОТДЕЛЬНЫМ ФАЙЛОМ, А НЕ В `ratingsApi.ts`, И ЭТО РАДИ ПРОВЕРЯЕМОСТИ.
 * `ratingsApi` импортирует клиент Supabase, а тот падает на загрузке без
 * VITE_-переменных:
 *
 *   Error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY
 *
 * То есть тест на четыре строковых значения требовал бы поднятого окружения.
 * Ровно по этой причине в проекте уже разделены `digestFormat.ts` и
 * `digestApi.ts` — разделение здесь не ради красоты слоёв, а ради того, чтобы
 * этот список вообще был покрыт.
 *
 * ⚠️ ЗНАЧЕНИЯ СОВПАДАЮТ С CHECK НА `card_position.position` В SQL, и это
 * сверяется тестом `test/player_positions.test.ts`. Разъехавшийся список —
 * это кнопка, которая молча отбирает ноль: база такую строку не примет, но
 * `player_index` на незнакомое значение отвечает не ошибкой, а ПУСТЫМ
 * списком, и «нападающих нет» неотличимо от «конвейер не проставил амплуа».
 */
export const POSITIONS = ['goalkeeper', 'defender', 'midfield', 'attack'] as const;
export type PlayerPosition = (typeof POSITIONS)[number];
