import { useEffect, useRef } from 'react';
import { showMainButton } from './telegram';

interface MainButtonSpec {
  /** Whether this screen wants the button at all. */
  visible: boolean;
  text: string;
  /** false renders it greyed and unclickable — e.g. the code is incomplete. */
  active?: boolean;
  onClick: () => void;
}

/**
 * Binds Telegram's MainButton to a screen for as long as that screen is
 * mounted, and lets go on unmount.
 *
 * The handler is held in a ref so a fresh closure every render does not churn
 * onClick/offClick on the Telegram side; only text/active/visible re-register.
 * Outside Telegram this does nothing at all, which is why every screen using
 * it still needs its own in-page button.
 */
export function useMainButton({ visible, text, active = true, onClick }: MainButtonSpec): void {
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    if (!visible) return;
    return showMainButton({ text, active, onClick: () => handler.current() });
  }, [visible, text, active]);
}
