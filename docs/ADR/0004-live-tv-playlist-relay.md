# 0004. Add a Live TV (m3u/HLS) screen, unrelated to the Alias gameplay

- **Status:** Proposed
- **Date:** 2026-08-24
- **Deciders:** repository owner (via chat request)
- **Related:** [`ENGINEERING_CONSTITUTION.md`](../ENGINEERING_CONSTITUTION.md) § 3 ("no scope creep"), `src/features/stream/`, `src/screens/StreamScreen.tsx`

## Context

The repository owner asked for a live-TV playlist player to be added inside
the Sherlock Scholes Telegram Mini App, backed by an external m3u/HLS relay
service (`stream-service`, a separate small Node service, not part of this
repo) that itself proxies a third-party IPTV aggregator playlist. This has no
connection to football Alias gameplay, the game's card content, or its
real-time room mechanics — it is explicitly outside "what Sherlock Scholes
is" (§ 1 of the Constitution) and outside the Definition of Done's default
("no scope creep"). The owner was told this in advance and confirmed they
want it anyway, placed as its own screen with its own entry in the home
game-link list (not the bottom tab bar, which is reserved for the four core
tabs: home, collection, profile, pro).

## Decision

We will add a `/stream` route (`StreamScreen`) and a `features/stream` module
containing a small `useHlsPlayer` hook (native HLS on Safari/iOS, `hls.js`
elsewhere) and a `StreamPlayer` component. The playlist URL is read from
`VITE_STREAM_URL` (public by nature, like `VITE_LIVEKIT_URL` — the browser
must know where to fetch it) with no built-in default; unset, the screen
renders a "not configured" empty state rather than hiding the entry, so a
misconfiguration is visible instead of silently absent.

## Alternatives considered

- **A native app / separate Mini App just for this.** Rejected: the ask was
  specifically to surface it inside the existing game, and a second Mini App
  is more infra for an unrelated side feature the owner wants iterated on
  quickly.
- **Hide it behind `/admin`.** Rejected by the owner explicitly — the ask was
  a home-screen entry, not an admin-only tool.
- **Hardcode the relay URL in code instead of an env var.** Rejected: ties a
  shipped build to one specific ephemeral Railway domain forever; an env var
  lets it move without a redeploy of this app.

## Consequences

- **Positive:** the owner gets the feature where they asked for it; the
  module is fully isolated (`features/stream/`, one route, one nav entry) so
  it can be deleted in one PR if it doesn't pan out.
- **Negative / trade-offs:**
  - This is content the game has no editorial control over — whatever the
    upstream m3u playlist serves, plays. The playlist observed at
    integration time is an unofficial IPTV aggregation list; **its legal
    right to redistribute those channels was not verified by this change**,
    and is the owner's responsibility to confirm before shipping to real
    users.
  - It is explicitly *not* part of "core" for the coverage/mutation gates
    (§ 4 of the Constitution scopes those to `features/game`, `shared/lib`,
    `shared/store`, `scraper/`), so it ships with unit tests on the hook's
    branching logic and a screen smoke test, not the 90 %/85 % bar.
  - One more third-party script (`hls.js`) in the bundle; it is only pulled
    into the `/stream` route's lazy chunk, so it doesn't affect the game's
    initial load.
- **Follow-ups:** if this becomes a real, kept feature, revisit whether it
  belongs in `docs/ROADMAP.md` and whether the playlist source needs a
  licensing review.

## Compliance

Enforced by file layout only (isolated module + single route + single nav
entry) and this ADR as the record of the "no scope creep" exception. No
automated gate — a future PR removing it needs no more than deleting
`src/features/stream/`, `src/screens/StreamScreen.tsx`, the `/stream` route,
the home-screen link, and the `stream`/`home.stream_link` i18n keys.
