import { describe, it, expect, vi, beforeEach } from 'vitest';

// Уровень состава — НЕОБЯЗАТЕЛЬНЫЙ раздел под матчем. Отсюда единственная
// вещь, которую здесь важно закрепить тестом: его поломка не должна ронять
// список матчей. Всё остальное (сама формула, глубина, порог) считает
// Postgres, и проверять это здесь значило бы проверять свой же стенд.

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { fetchSquadStrength } = await import('./squadStrengthApi');

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
