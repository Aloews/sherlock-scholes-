// @vitest-environment jsdom
import { afterEach, vi, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetchCareerTotals: vi.fn(),
  fetchClubCareer: vi.fn(),
}));

vi.mock('@/features/ratings/ratingsApi', () => ({
  fetchCareerTotals: mocks.fetchCareerTotals,
  fetchClubCareer: mocks.fetchClubCareer,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import { CareerStats } from './CareerStats';

afterEach(() => cleanup());

describe('CareerStats', () => {
  it('does not display unverified season years while retaining verified club totals', async () => {
    mocks.fetchCareerTotals.mockResolvedValue({
      status: 'ok',
      data: [{
        club_apps: 118, club_goals: 49, club_assists: 23, club_minutes: 8536,
        club_count: 1, season_from: null, season_to: null,
        national_apps: 0, national_goals: 0, national_team: null, leagues: 1, countries: 1,
      }],
    });
    mocks.fetchClubCareer.mockResolvedValue({
      status: 'ok',
      data: [{
        club_id: 'club-a', club_name: 'Chelsea', season_from: null, season_to: null,
        apps: 24, goals: 4, assists: 3, minutes: 1980,
      }],
    });

    render(<CareerStats cardId="palmer-card" />);

    expect(await screen.findByText('Chelsea')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
    expect(screen.queryByText('null–null')).toBeNull();
  });
});
