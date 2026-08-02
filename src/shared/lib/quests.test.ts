import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { questState, questPct, daysLeftInWeek, unclaimedXp } from './quests';
import type { WeeklyQuest } from '@/shared/types/database';

const quest = (over: Partial<WeeklyQuest> = {}): WeeklyQuest => ({
  code: 'guess_50',
  metric: 'cards_guessed',
  target: 50,
  reward_xp: 150,
  progress: 0,
  claimed_at: null,
  week_start: '2026-08-03',   // a Monday
  ...over,
});

describe('questState', () => {
  it('is claimed once claimed_at is set, whatever the progress', () => {
    expect(questState(quest({ progress: 0,  claimed_at: '2026-08-04T10:00:00Z' }))).toBe('claimed');
    expect(questState(quest({ progress: 99, claimed_at: '2026-08-04T10:00:00Z' }))).toBe('claimed');
  });

  it('is ready at the target and beyond', () => {
    expect(questState(quest({ progress: 50 }))).toBe('ready');
    expect(questState(quest({ progress: 51 }))).toBe('ready');
  });

  it('is in progress below the target', () => {
    expect(questState(quest({ progress: 49 }))).toBe('in_progress');
    expect(questState(quest({ progress: 0 }))).toBe('in_progress');
  });
});

describe('questPct', () => {
  it('maps progress onto 0–100', () => {
    expect(questPct(quest({ progress: 0 }))).toBe(0);
    expect(questPct(quest({ progress: 25 }))).toBe(50);
    expect(questPct(quest({ progress: 50 }))).toBe(100);
  });

  it('never exceeds 100, even if a target is lowered after progress was banked', () => {
    expect(questPct(quest({ progress: 80, target: 50 }))).toBe(100);
  });

  it('never goes negative, and treats a zero target as done', () => {
    expect(questPct(quest({ progress: -5 }))).toBe(0);
    expect(questPct(quest({ target: 0 }))).toBe(100);
  });

  it('stays inside 0–100 for any numbers at all', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (progress, target) => {
        const pct = questPct(quest({ progress, target }));
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }),
    );
  });
});

describe('daysLeftInWeek', () => {
  // The week runs Monday 00:00 UTC to the next Monday 00:00 UTC.
  it('is 7 on the Monday the week starts', () => {
    expect(daysLeftInWeek('2026-08-03', new Date('2026-08-03T00:00:00Z'))).toBe(7);
  });

  it('is 1 through the final Sunday, so the last day never reads as expired', () => {
    expect(daysLeftInWeek('2026-08-03', new Date('2026-08-09T00:00:01Z'))).toBe(1);
    expect(daysLeftInWeek('2026-08-03', new Date('2026-08-09T23:59:59Z'))).toBe(1);
  });

  it('is 0 once the next week has begun', () => {
    expect(daysLeftInWeek('2026-08-03', new Date('2026-08-10T00:00:00Z'))).toBe(0);
    expect(daysLeftInWeek('2026-08-03', new Date('2026-08-11T12:00:00Z'))).toBe(0);
  });

  it('counts down by one per day', () => {
    const days = ['03', '04', '05', '06', '07', '08', '09']
      .map((d) => daysLeftInWeek('2026-08-03', new Date(`2026-08-${d}T12:00:00Z`)));
    expect(days).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('returns 0 rather than NaN for an unparseable week', () => {
    expect(daysLeftInWeek('not-a-date')).toBe(0);
  });
});

describe('unclaimedXp', () => {
  it('sums the reward of every unclaimed quest, finished or not', () => {
    expect(unclaimedXp([
      quest({ code: 'a', reward_xp: 150, progress: 50 }),                                  // ready
      quest({ code: 'b', reward_xp: 100, progress: 1 }),                                   // in progress
      quest({ code: 'c', reward_xp: 200, progress: 50, claimed_at: '2026-08-04T00:00:00Z' }),
    ])).toBe(250);
  });

  it('is 0 for an empty week and for a fully claimed one', () => {
    expect(unclaimedXp([])).toBe(0);
    expect(unclaimedXp([quest({ claimed_at: '2026-08-04T00:00:00Z' })])).toBe(0);
  });
});
