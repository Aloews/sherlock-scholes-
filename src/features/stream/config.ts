/**
 * Fast-response lever for a rights-holder takedown (see docs/ADR/0004): set
 * VITE_STREAM_HIDDEN=true and redeploy to pull the home-screen entry without
 * a code change. The /stream route itself stays reachable directly — same
 * "not linked from the game menu" treatment AdminScreen already gets.
 */
export function isStreamHidden(): boolean {
  return import.meta.env.VITE_STREAM_HIDDEN === 'true';
}
