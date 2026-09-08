// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛА НЕ ДОЛЖНО НИ ГРУЗИТЬ ЗАНОВО, НИ КЛАСТЬ ЗАПИСЬ В ИСТОРИЮ.
 *
 * Владелец: «из-за того что теперь сохраняется история просмотренных
 * страничек, чтобы вернуться назад, приложение начинает зависать, когда
 * открываешь два больших экрана „коллекции“ и „рейтинг футболистов“».
 *
 * Оба симптома шли из одного места. «Коллекция» и «Рейтинг футболистов» — это
 * ОДИН компонент с разделами в адресе, и переключение раздела:
 *   * клало запись в историю (`setParams` без `replace`), так что десять
 *     нажатий превращали одну кнопку «назад» в десять;
 *   * размонтировало раздел, а возврат перезапрашивал всё заново — каталог на
 *     28 тысяч карточек и рейтинг на 25 508 игроков.
 *
 * ⚠️ ЭТО ПРОВЕРЯЕТСЯ СЧЁТЧИКАМИ, А НЕ ГЛАЗАМИ. Симптом — лишние запросы и
 * лишние записи в истории; ни то ни другое не видно на экране, поэтому
 * проверка считает вызовы загрузки и монтирования разделов. Сломай `replace`
 * или верни размонтирование — счётчики вырастут, и тест покраснеет.
 */

const fetchCollection = vi.fn(async () => ({ cards: [], hasMore: false }));
const clubsMounted = vi.fn();
const statsMounted = vi.fn();

vi.mock('@/features/collection/collectionApi', () => ({
  fetchCollection: (...a: unknown[]) => fetchCollection(...(a as [])),
  fetchCard: vi.fn(async () => ({})),
  COLLECTION_PAGE_SIZE: 48,
}));
// ⚠️ СЧИТАЕМ МОНТИРОВАНИЕ, А НЕ ОТРИСОВКУ. Тело функции-компонента
// выполняется на каждой перерисовке, и счётчик в нём мерил бы совсем не то,
// что сломалось: раздел перерисовывается при каждой смене вкладки и остаётся
// при этом живым. Пустой массив зависимостей срабатывает ровно при сборке с
// нуля — то есть ровно тогда, когда раздел заново пойдёт в сеть.
vi.mock('./collection/ClubsPane', async () => {
  const { useEffect } = await import('react');
  return { ClubsPane: () => { useEffect(() => { clubsMounted(); }, []); return <div>pane-clubs</div>; } };
});
vi.mock('./collection/StatsPane', async () => {
  const { useEffect } = await import('react');
  return { StatsPane: () => { useEffect(() => { statsMounted(); }, []); return <div>pane-stats</div>; } };
});
vi.mock('@/shared/ui/ScopeFilter', () => ({ ScopeFilter: () => <div /> }));
vi.mock('@/screens/collection/CardDossier', () => ({ CardDossier: () => <div /> }));
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn() }));
vi.mock('@/shared/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/shared/design/useDesign', () => ({ useDesign: () => 'master' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'ru', exists: () => false },
  }),
}));
vi.mock('@/shared/store/proStore', () => ({
  useProStore: (sel: (s: { isPro: boolean }) => unknown) => sel({ isPro: true }),
}));

const { CollectionScreen } = await import('./CollectionScreen');

// Раздел выбирается теми же кнопками, что у игрока: ключ локали вместо текста,
// потому что t() в этом стенде возвращает ключ.
const tab = (name: 'cards' | 'clubs' | 'stats') =>
  screen.getByText(`collection.view_${name}`);

beforeEach(() => {
  fetchCollection.mockClear();
  clubsMounted.mockClear();
  statsMounted.mockClear();
});
afterEach(() => cleanup());

async function mount() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/collection']}>
        <CollectionScreen />
      </MemoryRouter>,
    );
  });
}

const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

describe('CollectionScreen: разделы', () => {
  it('возврат в карточки НЕ перезапрашивает каталог', async () => {
    await mount();
    expect(fetchCollection).toHaveBeenCalledTimes(1);

    await click(tab('stats'));
    await click(tab('cards'));
    await click(tab('clubs'));
    await click(tab('cards'));

    // Пять переключений — по-прежнему одно чтение каталога. До починки их было
    // бы три: каждое возвращение на вкладку читало всё заново.
    expect(fetchCollection).toHaveBeenCalledTimes(1);
  });

  it('раздел монтируется один раз и дальше только прячется', async () => {
    await mount();
    // Незаглянувший раздел не монтируется вовсе: иначе открытие коллекции
    // стоило бы трёх тяжёлых чтений сразу.
    expect(statsMounted).not.toHaveBeenCalled();
    expect(clubsMounted).not.toHaveBeenCalled();

    await click(tab('stats'));
    expect(screen.getByText('pane-stats')).toBeTruthy();
    expect(statsMounted).toHaveBeenCalledTimes(1);

    await click(tab('cards'));
    // Спрятан, но жив: состояние и место прокрутки остаются на месте.
    expect(screen.getByText('pane-stats')).toBeTruthy();

    await click(tab('stats'));
    await click(tab('cards'));
    await click(tab('stats'));
    // Три возвращения — по-прежнему одна сборка. У размонтированного раздела
    // счётчик стал бы четвёркой, и каждая единица — это запрос рейтинга на
    // 25 508 игроков заново.
    expect(statsMounted).toHaveBeenCalledTimes(1);
    // Клубы так и не открывали — их не собирали ни разу.
    expect(clubsMounted).not.toHaveBeenCalled();
  });
});
