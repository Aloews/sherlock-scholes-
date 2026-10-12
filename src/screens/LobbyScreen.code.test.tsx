// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  leaveRoom: vi.fn(),
  assignTeam: vi.fn(),
  startGame: vi.fn(),
  setDeck: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/lobby/useLobby', () => ({
  useLobby: () => ({
    room: { id: 'room-1', code: 'AB12CD', host_id: 100, mode: 'team', settings: { categories: null } },
    teams: [],
    roomPlayers: [],
    isHost: false,
    isTeamMode: true,
    myTeamId: null,
    canStart: false,
    assignTeam: mocks.assignTeam,
    startGame: mocks.startGame,
    deckFilter: {},
    deckCount: 100,
    deckError: false,
    setDeck: mocks.setDeck,
  }),
}));
vi.mock('@/features/room/useRoom', () => ({ useRoom: () => ({ leaveRoom: mocks.leaveRoom }) }));
vi.mock('@/shared/store/gameStore', () => ({ useGameStore: () => ({ loading: false, error: null }) }));
vi.mock('@/shared/store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ player: { id: 100, first_name: 'Host' } }),
}));
vi.mock('@/shared/design/useDesign', () => ({ useDesign: () => 'master' }));
vi.mock('@/shared/lib/telegram', () => ({
  hapticImpact: vi.fn(),
  hapticError: vi.fn(),
  openTelegramLink: vi.fn(() => false),
}));
vi.mock('@/features/lobby/invite', () => ({
  copyText: vi.fn(async () => true),
  deepLink: (code: string) => `https://example.test/${code}`,
  shareLink: (code: string) => `https://example.test/share/${code}`,
}));
vi.mock('@/shared/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@/shared/ui/Avatar', () => ({ Avatar: () => <div /> }));
vi.mock('@/shared/ui/LanguageToggle', () => ({ LanguageToggle: () => <div /> }));
vi.mock('@/shared/ui/QuoteRotator', () => ({ QuoteRotator: () => <div /> }));
vi.mock('@/features/lobby/RoomDeckPanel', () => ({ RoomDeckPanel: () => <div /> }));
vi.mock('@/features/lobby/InviteFriendsPanel', () => ({ InviteFriendsPanel: () => <div /> }));
vi.mock('@/features/lobby/InviteFansPanel', () => ({ InviteFansPanel: () => <div /> }));
vi.mock('@/features/social/OnlinePanel', () => ({ OnlinePanel: () => <div /> }));
vi.mock('@/features/voice/VoiceControl', () => ({ VoiceControl: () => <div /> }));
vi.mock('@/features/voice/VideoStage', () => ({ VideoStage: () => <div /> }));
vi.mock('@/shared/ui/QrCode', () => ({ QrCode: () => <div /> }));

import { LobbyScreen } from './LobbyScreen';

afterEach(() => cleanup());

describe('Lobby room code display', () => {
  it('renders the exact six-character room code without wrapping', () => {
    render(<LobbyScreen />);
    const code = screen.getByTestId('room-code-display');
    expect(code.textContent).toBe('AB12CD');
    expect(code.className).toContain('whitespace-nowrap');
  });
});
