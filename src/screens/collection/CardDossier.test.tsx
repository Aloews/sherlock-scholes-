// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ⚠️ ПЕРЕХОД ПРОВЕРЯЕТСЯ ВЫЗОВОМ, А НЕ ИСЧЕЗНОВЕНИЕМ РАЗМЕТКИ. В боевом
// экране досье снимает маршрутизатор, а здесь компонент отрисован напрямую и
// после перехода остаётся на месте: проверка «на экране больше нет имени»
// была бы зелёной ровно тогда, когда перехода нет вовсе.
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useNavigate: () => navigateSpy,
}));

/**
 * ДОСЬЕ КАРТОЧКИ ОБЯЗАНО ОТКРЫВАТЬСЯ, А НЕ ГАСНУТЬ.
 *
 * Владелец: «сейчас в „коллекциях“ при нажатии на карточку экран потухает и
 * нет данных».
 *
 * ⚠️ ПУСТОЙ ЭКРАН — ЭТО ИСКЛЮЧЕНИЕ ПРИ ОТРИСОВКЕ, А НЕ ПУСТЫЕ ДАННЫЕ. React
 * снимает всё поддерево, когда компонент бросает, и снаружи это выглядит как
 * «ничего не загрузилось». Ни tsc, ни сборка такого не видят: типы сходятся,
 * бандл собирается, падает оно только в браузере.
 *
 * Поэтому проверка РИСУЕТ досье по-настоящему — и в самом тяжёлом случае:
 * когда все запросы вернули пусто. Именно так выглядит карточка, у которой
 * ещё нет ни клуба, ни истории стоимости, и именно на таком наборе легче
 * всего обратиться к полю, которого нет.
 */

// Клиент базы заводится на уровне модуля и без ключей БРОСАЕТ. Досье тянет
// его транзитивно через соседние модули, поэтому заглушка обязательна — иначе
// проверка падает на импорте и не проверяет ничего.
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
              rpc: async () => ({ data: null, error: null }) },
}));

vi.mock('@/features/clubs/clubsApi', () => ({
  fetchClubOfCard: vi.fn(async () => ({ status: 'ok', data: null })),
  fetchCardValueTrend: vi.fn(async () => null),
  fetchClubsByNames: vi.fn(async () => []),
  fetchClubKeyOfCard: vi.fn(async (id: string) =>
    (id === 'club-without-key' ? null : 'real madrid')),
}));
vi.mock('@/features/collection/playerMediaApi', () => ({
  fetchPlayerNews: vi.fn(async () => ({ status: 'ok', data: [] })),
  fetchPlayerClips: vi.fn(async () => ({ status: 'ok', data: [] })),
}));
vi.mock('@/features/soccerwiki/SoccerWikiPanel', () => ({
  SoccerWikiPanel: () => <div>sw</div>,
}));
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn(), openLink: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'ru', exists: () => false },
  }),
}));

const { CardDossier } = await import('./CardDossier');

afterEach(() => cleanup());

const bare: Record<string, unknown> = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Тест',
  name_en: 'Test Player',
  category: 'player',
  category_ru: 'игроки',
  active: true,
};

async function mount(card: unknown) {
  await act(async () => {
    render(
      <MemoryRouter>
        <CardDossier card={card as never} onClose={() => {}} />
      </MemoryRouter>,
    );
  });
}

describe('CardDossier', () => {
  it('открывается на карточке без единого поля сверх обязательных', async () => {
    await mount(bare);
    // Имя на месте — значит дерево отрисовалось, а не свернулось в пустоту.
    expect(screen.getByText('Test Player')).toBeTruthy();
  });

  // ⚠️ КАРТОЧКА-КЛУБ НЕ ДОЛЖНА ОТКРЫВАТЬСЯ ДОСЬЕ ИГРОКА. Их в колоде 1262, и
  // до правки все они показывали пустую карьеру и пустую статистику. Верни
  // кто-нибудь общий путь — типы сойдутся, сборка пройдёт, и увидеть это можно
  // будет только открыв клуб руками.
  it('карточку клуба уводит на экран команды', async () => {
    navigateSpy.mockClear();
    await mount({ ...bare, id: 'club-card', category: 'club',
                  name: 'Real Madrid', name_en: 'Real Madrid' });
    expect(navigateSpy).toHaveBeenCalledWith('/club/real%20madrid', { replace: true });
  });

  // 28 карточек из 1262 клуба в справочнике не имеют. Для них досье остаётся
  // прежним — пустоватым, но существующим: пустой экран был бы хуже.
  it('карточку клуба без ключа никуда не уводит и показывает прежним досье', async () => {
    navigateSpy.mockClear();
    await mount({ ...bare, id: 'club-without-key', category: 'club',
                  name: 'Unknown Club', name_en: 'Unknown Club' });
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Unknown Club')).toBeTruthy();
  });

  it('открывается со стоимостью и без истории её изменений', async () => {
    // ⚠️ ИМЕННО ЭТОТ СЛУЧАЙ СЕЙЧАС У ВСЕХ 25 509 КАРТОЧЕК: стоимость есть,
    // а второй точки в истории нет ни у одной, и роста не посчитать.
    await mount({ ...bare, market_value_eur: 220000000, market_value_at: '2026-09-06' });
    expect(screen.getByText('Test Player')).toBeTruthy();
    expect(screen.getAllByText('collection.value').length).toBeGreaterThan(0);
  });
});
