/**
 * Одна строка о человеке под именем в досье — та, что есть.
 *
 * Владелец: «в карточках стоит писать матчей за сборную или количество лиг,
 * где играл игрок. Если этих данных нет, то дату рождения».
 *
 * ⚠️ ЭТО ЛЕСТНИЦА, А НЕ НАБОР. Показывается ПЕРВОЕ, что нашлось, и порядок
 * задан смыслом: матчи за сборную говорят о человеке больше всего, число лиг —
 * меньше, дата рождения не говорит о футболе ничего и стоит последней именно
 * поэтому. Показать всё сразу значит утопить главное.
 */
export interface CareerTotals {
  national_apps: number | null;
  national_goals: number | null;
  national_team: string | null;
  leagues: number | null;
  countries: number | null;
}

export type CareerHighlight =
  | { kind: 'national'; team: string; apps: number; goals: number }
  | { kind: 'leagues'; leagues: number; countries: number }
  | { kind: 'born'; date: string }
  | null;

export function careerHighlight(
  totals: CareerTotals | null | undefined,
  bornOn: string | null | undefined,
): CareerHighlight {
  // ⚠️ БЕЗ ИМЕНИ КОМАНДЫ СТРОКА НЕ СОБИРАЕТСЯ. «7 матчей за сборную» без
  // указания какой — это про Россию U17 у Классена ровно так же, как про
  // главную сборную Португалии у Роналду, а это разные утверждения.
  if (totals?.national_team && (totals.national_apps ?? 0) > 0) {
    return {
      kind: 'national',
      team: totals.national_team,
      apps: totals.national_apps ?? 0,
      goals: totals.national_goals ?? 0,
    };
  }
  // ⚠️ ОДНА ЛИГА — НЕ ФАКТ. «Играл в 1 лиге» верно почти про каждого и не
  // сообщает ничего; строка занимает место, которое лучше отдать дате
  // рождения. Две и больше — уже путь.
  if ((totals?.leagues ?? 0) > 1) {
    return {
      kind: 'leagues',
      leagues: totals?.leagues ?? 0,
      countries: totals?.countries ?? 0,
    };
  }
  if (bornOn) return { kind: 'born', date: bornOn };
  return null;
}
