# Release QA Checklist

Manual pass before a notable release (Vercel deploys `main` automatically; this
is the human smoke test on top of green CI). Run inside the real Telegram client.

## Gates (must already be green)
- [ ] CI green: build, tests, coverage, mutation, python, security.
- [ ] No open P0/P1 issues; open defect locks acknowledged.

## Auth & entry
- [ ] Opens inside Telegram (iOS **and** Android); `initData` accepted.
- [ ] Theme matches the client (dark/light); safe-area insets correct.
- [ ] Works from a cold free-tier DB (warm/retry, no "no cards" flash).

## Core game loop
- [ ] Create room → join → team setup → countdown → round → summary → winner.
- [ ] Timer accurate; scoring correct (correct/skipped); no negative scores.
- [ ] Cards render (photo, name, forbidden words); no junk/placeholder cards.
- [ ] Realtime: a second device sees room updates; reconnect recovers a round.

## Resilience
- [ ] Airplane mode mid-round degrades gracefully (no white screen).
- [ ] Backgrounding and returning restores the session.
- [ ] Broken image / slow load handled.

## Content & i18n
- [ ] Language switch works; no missing keys; RTL correct for `ar`.
- [ ] Spot-check card data for obvious inaccuracies.

## Pro / payments (if touched)
- [ ] Pro gating enforced server-side; `tg-pay` flow works end to end in a
      sandbox; no secret leakage.

## Sign-off
- [ ] Tester, date, build/commit recorded.
- [ ] Any issue found → an issue filed (+ a regression test before the fix).
