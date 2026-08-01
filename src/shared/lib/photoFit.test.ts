import { describe, it, expect } from 'vitest';
import { isPortraitCategory, photoFitClass, photoFitCircleClass } from './photoFit';
import { ALL_CATEGORIES } from '@/shared/types/database';

// Regression: club crests and wide scene photos were rendered with
// `object-cover`, which cropped their edges away — the bug that motivated this
// helper. The rule these tests pin down is "only a person's card may be
// cropped", so a new category defaults to being shown whole rather than
// silently inheriting the crop.

describe('isPortraitCategory', () => {
  it('is true exactly for the categories whose photo is a face', () => {
    const portraits = ALL_CATEGORIES.filter(isPortraitCategory);
    expect(portraits.sort()).toEqual(
      ['coach', 'commentator', 'player', 'referee', 'woman'],
    );
  });

  it('is false for emblems and scenes', () => {
    for (const c of ['club', 'club_nickname', 'trophy', 'stadium', 'derby', 'era'] as const) {
      expect(isPortraitCategory(c)).toBe(false);
    }
  });
});

describe('photoFitClass', () => {
  it('never crops a non-portrait', () => {
    for (const c of ALL_CATEGORIES) {
      if (isPortraitCategory(c)) continue;
      expect(photoFitClass(c)).toContain('object-contain');
      expect(photoFitClass(c)).not.toContain('object-cover');
    }
  });

  it('fills from the top for a portrait, so the face is never cut off', () => {
    expect(photoFitClass('player')).toContain('object-cover');
    expect(photoFitClass('player')).toContain('object-top');
  });

  it('drops the circular mask for a crest, which would clip its corners', () => {
    expect(photoFitClass('club')).not.toContain('rounded-full');
    expect(photoFitClass('player')).toContain('rounded-full');
  });
});

describe('photoFitCircleClass', () => {
  it('keeps the circle intact — the rarity ring is drawn around it', () => {
    for (const c of ALL_CATEGORIES) {
      expect(photoFitCircleClass(c)).not.toContain('rounded');
    }
  });

  it('insets a crest so its corners survive the circular mask', () => {
    expect(photoFitCircleClass('club')).toContain('object-contain');
    expect(photoFitCircleClass('club')).toContain('p-1');
    expect(photoFitCircleClass('player')).not.toContain('p-1');
  });
});
