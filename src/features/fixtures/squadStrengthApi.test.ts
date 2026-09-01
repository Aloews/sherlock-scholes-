import { describe, it, expect, vi, beforeEach } from 'vitest';

// Уровень состава — НЕОБЯЗАТЕЛЬНЫЙ раздел под матчем. Отсюда единственная
// вещь, которую здесь важно закрепить тестом: его поломка не должна ронять
// список матчей. Всё остальное (сама формула, глубина, порог) считает
// Postgres, и проверять это здесь значило бы проверять свой же стенд.

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { fetchSquadStrength, fetchTeamRating } = await import('./squadStrengthApi');

const row = (id: string, home = 90, away = 70) => ({
  fixture_id: id, home_fame: home, away_fame: away,
  depth: 11, home_squad: 20, away_squad: 14,
});

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('fetchSquadStrength', () => {
  it('раскладывает строки в карту по id матча', async () => {
    rpc.mockResolvedValue({ data: [row('a'), row('b')], error: null });
    const map = await fetchSquadStrength();
    expect(map.size).toBe(2);
    expect(map.get('a')?.home_fame).toBe(90);
    expect(map.get('b')?.away_fame).toBe(70);
  });

  it('на отказе возвращает ПУСТУЮ карту, а не бросает', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(fetchSquadStrength()).resolves.toBeInstanceOf(Map);
    expect((await fetchSquadStrength()).size).toBe(0);
  });

  // `data: null` без ошибки PostgREST отдаёт на пустом ответе. Без запасного
  // массива здесь был бы TypeError уже в цикле, то есть падение экрана матчей
  // из-за раздела, которого у большинства матчей и так нет.
  it('пустой ответ без ошибки не роняет', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await fetchSquadStrength()).size).toBe(0);
  });

  it('просит порог глубины, а не берёт умолчание сервера', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchSquadStrength();
    expect(rpc).toHaveBeenCalledWith('fixture_squad_strength', { p_min_depth: 5 });
  });
});

// ---------------------------------------------------------------------------
// Рейтинг команд из уровней игроков — то же требование, что и выше: раздел
// НЕОБЯЗАТЕЛЬНЫЙ, и его поломка не должна ронять список матчей. Сама формула
// (состав + форма поровну, равная глубина, порог) считается в Postgres, и
// проверять её здесь значило бы проверять свой же стенд.
// ---------------------------------------------------------------------------
const ratingRow = (id: string, home = 88.7, away = 69.1) => ({
  fixture_id: id,
  home_squad_level: 82.3, away_squad_level: 50.2,
  home_form_level: 95, away_form_level: 88,
  home_rating: home, away_rating: away,
  basis: 'squad+form', depth: 11, home_squad: 20, away_squad: 14,
  min_league_weight: 1,
});

describe('fetchTeamRating', () => {
  it('раскладывает строки в карту по id матча', async () => {
    rpc.mockResolvedValue({ data: [ratingRow('a'), ratingRow('b')], error: null });
    const map = await fetchTeamRating();
    expect(map.size).toBe(2);
    expect(map.get('a')?.home_rating).toBe(88.7);
    expect(map.get('b')?.away_rating).toBe(69.1);
  });

  it('на отказе возвращает ПУСТУЮ карту, а не бросает', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(fetchTeamRating()).resolves.toBeInstanceOf(Map);
    expect((await fetchTeamRating()).size).toBe(0);
  });

  it('пустой ответ без ошибки не роняет', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await fetchTeamRating()).size).toBe(0);
  });

  it('зовёт НОВУЮ функцию, а не старую', async () => {
    // Разница не косметическая: старая ищет клуб ключом, который не проходит
    // через словарь псевдонимов, и «Зенит» с ним не находит своего состава.
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchTeamRating();
    expect(rpc).toHaveBeenCalledWith('fixture_team_rating', { p_min_depth: 5 });
  });
});
