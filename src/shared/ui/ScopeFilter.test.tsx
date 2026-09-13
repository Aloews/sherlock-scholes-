// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

/**
 * ОТБОР ПО КЛУБУ НЕ ДОЛЖЕН ГАСИТЬ ЭКРАН, ПЕРЕКЛЮЧАЯСЬ МЕЖДУ КАТЕГОРИЯМИ.
 *
 * ⚠️ ЭТО ПРОВЕРКА НА НАСТОЯЩУЮ ПОЛОМКУ, А НЕ НА ГИПОТЕЗУ. `useMemo` стоял
 * НИЖЕ `if (facets.length === 0) return null`: у категории без фасетов
 * компонент отдавал четыре хука, у категории с фасетами — пять. React роняет
 * на этом ВСЁ ПОДДЕРЕВО:
 *
 *   Minified React error #310 — Rendered more hooks than during the
 *   previous render
 *
 * Снаружи это выглядит как «коллекции зависают»: экран гаснет и перестаёт
 * отвечать. Владелец сообщал трижды и назвал категории поимённо — «термины,
 * клубы, эпохи»; ровно у них фасетов ноль. Таких категорий девять из
 * тринадцати, то есть падало на каждом втором нажатии, в обе стороны.
 *
 * ⚠️ ПРОВЕРЯЮТСЯ ОБА НАПРАВЛЕНИЯ. «Пусто → есть» и «есть → пусто» ломаются
 * разными ошибками React (#310 и #300), и проверка одного направления
 * зеленела бы на половине поломки.
 */
vi.mock('@/features/collection/collectionApi', () => ({
  fetchCollectionFacets: vi.fn(async () => []),
}));
vi.mock('@/shared/lib/facetCache', () => ({
  readFacets: vi.fn(() => null),
  writeFacets: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'ru' } }),
}));

const { fetchCollectionFacets } = await import('@/features/collection/collectionApi');
const { ScopeFilter } = await import('./ScopeFilter');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const CLUBS = [
  { kind: 'club' as const, value: 'real madrid', label: 'Real Madrid', n: 25 },
  { kind: 'league' as const, value: 'Испания. Ла Лига', label: 'Испания. Ла Лига', n: 120 },
];

/** Отрисовать с одной категорией, затем переключить на другую. */
async function switchCategory(
  first: 'player' | 'term', firstFacets: typeof CLUBS,
  second: 'player' | 'term', secondFacets: typeof CLUBS,
) {
  const mocked = vi.mocked(fetchCollectionFacets);
  mocked.mockResolvedValue(firstFacets);
  const { rerender } = render(
    <ScopeFilter value={{}} onChange={() => {}} category={first} />,
  );
  await act(async () => {});

  mocked.mockResolvedValue(secondFacets);
  rerender(<ScopeFilter value={{}} onChange={() => {}} category={second} />);
  await act(async () => {});
}

describe('ScopeFilter: смена категории', () => {
  it('из категории БЕЗ фасетов в категорию С фасетами — экран жив', async () => {
    await switchCategory('term', [], 'player', CLUBS);
    // Дерево уцелело — значит списки на месте, а не белый экран.
    expect(screen.getByText('collection.any_club')).toBeTruthy();
  });

  it('из категории С фасетами в категорию БЕЗ — экран жив', async () => {
    await switchCategory('player', CLUBS, 'term', []);
    // Пусто — это ответ: у «терминов» нет ни клуба, ни лиги, ни страны.
    expect(screen.queryByText('collection.any_club')).toBeNull();
    // Но приложение живо: следующая отрисовка проходит без исключения.
    expect(document.body).toBeTruthy();
  });

  it('туда и обратно подряд — тоже', async () => {
    const mocked = vi.mocked(fetchCollectionFacets);
    mocked.mockResolvedValue([]);
    const { rerender } = render(<ScopeFilter value={{}} onChange={() => {}} category="term" />);
    await act(async () => {});
    for (const [cat, facets] of [['player', CLUBS], ['term', []], ['player', CLUBS]] as const) {
      mocked.mockResolvedValue(facets as typeof CLUBS);
      rerender(<ScopeFilter value={{}} onChange={() => {}} category={cat} />);
      await act(async () => {});
    }
    expect(screen.getByText('collection.any_club')).toBeTruthy();
  });
});
