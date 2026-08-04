import { useEffect, useState } from 'react';
import { getViewport, onViewportChanged, type Viewport } from './telegram';

/**
 * How much the viewport has to shrink before we call it a keyboard.
 *
 * Telegram also reports small changes for its own chrome (the header
 * collapsing on scroll, a swipe part-way down), and treating those as a
 * keyboard would scroll the page out from under the player's thumb. No
 * software keyboard is under ~200px tall on a phone; 120 is comfortably below
 * that and comfortably above the chrome.
 */
export const KEYBOARD_MIN_PX = 120;

/**
 * Whether the on-screen keyboard is covering part of the Mini App.
 *
 * `viewportHeight` shrinks when the keyboard opens; `viewportStableHeight`
 * does not. Nothing else in the app reads the viewport, so this is the whole
 * rule, kept pure and next to its test.
 */
export function isKeyboardOpen(v: Viewport | null, threshold = KEYBOARD_MIN_PX): boolean {
  if (!v) return false;
  return v.stableHeight - v.height >= threshold;
}

/**
 * Live answer to "is the keyboard up?", for screens that have to move
 * something out of its way. Always false outside Telegram, where there is no
 * viewport to ask — those layouts have to survive on their own.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(() => isKeyboardOpen(getViewport()));

  useEffect(() => onViewportChanged(() => setOpen(isKeyboardOpen(getViewport()))), []);

  return open;
}
