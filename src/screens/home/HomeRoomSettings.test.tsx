// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn() }));
vi.mock('@/shared/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) =>
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>,
}));

import { HomeTeamSettings } from './HomeTeamSettings';
import { HomeDuelSettings } from './HomeDuelSettings';

const common = () => ({
  loading: false,
  categoriesLabel: 'Все категории',
  onConfigureCategories: vi.fn(),
  onBack: vi.fn(),
  deckPrompt: '',
  buildingDeck: false,
  deckMessage: '',
  onDeckPromptChange: vi.fn(),
  onBuildDeck: vi.fn(),
});

afterEach(() => cleanup());

describe('AI room deck intent', () => {
  it('is available before creating a team room', () => {
    const props = common();
    const onCreate = vi.fn();
    render(<HomeTeamSettings {...props} onCreate={onCreate} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос ИИ для колоды комнаты' }), {
      target: { value: 'Легенды Барселоны' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' }));
    expect(props.onBuildDeck).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'home.create_room' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('is available before creating a 1v1 room', () => {
    const props = common();
    const onCreate = vi.fn();
    render(<HomeDuelSettings {...props} rounds={3} onRounds={vi.fn()} onCreate={onCreate} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос ИИ для колоды комнаты' }), {
      target: { value: 'Вратари Серии А' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' }));
    expect(props.onBuildDeck).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'home.create_room' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('does not submit an empty or short request', () => {
    const props = common();
    render(<HomeTeamSettings {...props} onCreate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Запрос ИИ для колоды комнаты' }), {
      target: { value: 'x' },
    });
    expect(screen.getByRole('button', { name: 'Определить запрос и собрать колоду' })).toHaveProperty('disabled', true);
    expect(props.onBuildDeck).not.toHaveBeenCalled();
  });
});
