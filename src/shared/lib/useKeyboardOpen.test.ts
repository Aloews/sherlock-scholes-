import { describe, it, expect } from 'vitest';
import { isKeyboardOpen, KEYBOARD_MIN_PX } from './useKeyboardOpen';

// The rule that decides whether the join screen jumps under the player's
// thumb. Telegram reports small viewport changes for its own chrome, so the
// threshold is the whole point: too low and every scroll reads as a keyboard.

describe('isKeyboardOpen', () => {
  it('is false when nothing is covering the app', () => {
    expect(isKeyboardOpen({ height: 844, stableHeight: 844 })).toBe(false);
  });

  it('is true when the viewport loses a keyboard-sized chunk', () => {
    expect(isKeyboardOpen({ height: 508, stableHeight: 844 })).toBe(true);
  });

  it('ignores the small shrink Telegram reports for its own chrome', () => {
    expect(isKeyboardOpen({ height: 844 - 60, stableHeight: 844 })).toBe(false);
  });

  it('treats exactly the threshold as open', () => {
    expect(isKeyboardOpen({ height: 844 - KEYBOARD_MIN_PX, stableHeight: 844 })).toBe(true);
    expect(isKeyboardOpen({ height: 844 - KEYBOARD_MIN_PX + 1, stableHeight: 844 })).toBe(false);
  });

  it('is false outside Telegram, where there is no viewport to ask', () => {
    expect(isKeyboardOpen(null)).toBe(false);
  });

  // A taller current height than the stable one happens while the app is being
  // expanded; it is not a keyboard, and a negative difference must not wrap
  // into "open" through a comparison mistake.
  it('is false when the viewport grew instead of shrinking', () => {
    expect(isKeyboardOpen({ height: 844, stableHeight: 600 })).toBe(false);
  });
});
