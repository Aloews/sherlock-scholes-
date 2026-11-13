import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { HomeScreen } from '../src/screens/HomeScreen';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'home.alias_link': 'Football Alias',
        'home.dynasty_link': 'Football Dynasty',
        'home.subtitle': 'Guess football players',
        'home.tutorial_button_aria': 'Tutorial',
        'home.sound_toggle_aria': 'Sound',
        'tabs.profile': 'Profile',
        'home.footer': 'Sherlock Scholes',
      };
      return map[key] || key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/shared/store/authStore', () => ({
  useAuthStore: () => ({ player: { id: '123', alias: 'Test' } }),
}));

vi.mock('@/shared/store/gameStore', () => ({
  useGameStore: () => ({ loading: false }),
}));

vi.mock('@/shared/store/settingsStore', () => ({
  useSettingsStore: () => ({ soundEnabled: true, setSoundEnabled: vi.fn() }),
}));

vi.mock('@/shared/store/proStore', () => ({
  useProStore: () => ({ gamesPlayed: 0 }),
}));

vi.mock('@/shared/design/useDesign', () => ({
  useDesign: () => 'classic',
}));

vi.mock('@/features/room/useRoom', () => ({
  useRoom: () => ({ createRoom: vi.fn() }),
}));

vi.mock('@/features/game/usePlayerStats', () => ({
  usePlayerStats: () => ({ stats: null, loading: false }),
}));

vi.mock('@/features/lobby/useRoomJoin', () => ({
  useRoomJoin: () => ({
    code: '',
    setCode: vi.fn(),
    typedCode: '',
    inputRef: { current: null },
    error: null,
    enter: vi.fn(),
    submit: vi.fn(),
  }),
}));

describe('HomeScreen', () => {
  beforeEach(() => {
    delete (import.meta.env as { VITE_FD_API_URL?: string }).VITE_FD_API_URL;
  });

  it('renders Football Dynasty navigation link without VITE_FD_API_URL set', () => {
    expect(import.meta.env.VITE_FD_API_URL).toBeUndefined();

    render(
      <BrowserRouter>
        <HomeScreen />
      </BrowserRouter>
    );

    expect(screen.getByText('Football Dynasty')).toBeInTheDocument();
  });
});
