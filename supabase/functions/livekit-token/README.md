# livekit-token — setup

Issues a short-lived access token for the in-game voice channel.

**The name is historical.** This function issues tokens for whichever voice
service is configured — LiveKit, Daily or Agora — not only LiveKit. It keeps
the name because deployed frontends call it by that name, and renaming a live
entry point is the mistake `pick_random_cards` already taught this project
once (CLAUDE.md). Rename it when there is a deploy window for both halves.

Which service, and every variable each one needs, is in
**[`docs/VOICE_PROVIDERS.md`](../../../docs/VOICE_PROVIDERS.md)**. The fastest
way to see what is missing:

```bash
node scripts/check-voice.mjs --vars
```

Nothing here works until the values below are set; until then the voice UI
hides itself and the game plays exactly as before.

## Choosing the service

`VOICE_PROVIDER` (a Supabase secret) selects the issuer: `livekit` (default),
`daily` or `agora`. The client sends its own `provider` as a **hint only** —
it is echoed back in a `provider_mismatch`, never acted on. Letting a caller
pick the issuer would let it pick which set of secrets to exercise.

## Where each value goes — LiveKit

Three values, and **only one of them is public**. Putting the wrong one in the
wrong place is the one mistake that matters here. Daily's and Agora's tables
are in [`docs/VOICE_PROVIDERS.md`](../../../docs/VOICE_PROVIDERS.md) §2 and
follow the same rule: the address is public, the signing material never is.

| Value | Where | Why there |
|---|---|---|
| `VITE_LIVEKIT_URL` | Vercel → project → Settings → Environment Variables | Public. It is an address; the browser must know it to connect. Anything `VITE_`-prefixed is compiled into the bundle and readable by every player. |
| `LIVEKIT_API_KEY` | Supabase secret | Server-side only. |
| `LIVEKIT_API_SECRET` | Supabase secret | **Server-side only.** Signs tokens. Whoever holds it can mint a token for any channel — including the opposing team's. It must never reach the browser, a `VITE_` variable, or this repository. |

## Getting the credentials

1. Create a project at <https://cloud.livekit.io>.
2. Settings → Keys → the key and secret are shown once. Copy both.
3. The project page also shows the server URL, `wss://<name>.livekit.cloud` —
   that is the public one.

## Setting them

```bash
# Server-side, never in the repo:
supabase secrets set LIVEKIT_API_KEY=APIxxxxxxxx
supabase secrets set LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxx

supabase functions deploy livekit-token
```

Then add `VITE_LIVEKIT_URL=wss://<name>.livekit.cloud` in Vercel and redeploy
the frontend — Vite reads env vars at build time, so an existing deployment
will not pick it up on its own.

## Checking it worked

Open a room in two browsers and tap "Turn on voice" in the lobby. The status
line goes `Connecting…` → a level. If it says `Unavailable`, the function
logs (`supabase functions logs livekit-token`) name the reason:

| Response | Meaning |
|---|---|
| `voice_not_configured` | The configured provider's secrets are not set. The body carries `provider` and a `missing` list naming exactly which. |
| `unauthorized` | `initData` failed HMAC validation — the caller is not a real Mini App session. |
| `not_in_room` | The authenticated player is not a member of that room. |
| `no_team_yet` | Team mode, and the player has not picked a side. There is no channel they belong to yet. |
| `room_finished` | The game is over. |
| `provider_mismatch` | The frontend is built for one service and this deployment signs for another. The token would be valid and unusable. |
| `issue_failed` | The voice service itself refused to mint a credential — a server fault, not a verdict on the player. |

## What the token allows

Scoped to exactly one channel, for four hours, microphone only. No
`roomCreate`, no `roomAdmin`, no `roomList`, no data channel, and
`canPublishSources: ["microphone"]` so a modified client cannot publish video
even if it asks.

The channel is chosen **by the server** from the database — one channel per
team in team mode, one per room in 1v1. The client never names it; if it
could, a player could join the opposing team's channel and hear the explainer.

## What an unconfigured build costs: nothing

`VITE_LIVEKIT_URL` is read at build time, so `voiceEnabled()` folds to a
constant and Rollup removes everything behind it — including the dynamic
`import('livekit-client')`. Measured both ways:

| Build | `index.js` | LiveKit SDK chunk |
|---|---|---|
| without `VITE_LIVEKIT_URL` | 729.73 kB | **not emitted at all** |
| with `VITE_LIVEKIT_URL` | 729.88 kB | 553.47 kB (144 kB gzip), separate |

So a deployment that has not set the variable does not ship the SDK, and one
that has still does not load it until a player taps "Turn on voice". Setting
the variable is what turns the feature on; there is no separate flag to
forget.

## Cost

LiveKit Cloud bills participant-minutes. Four players in a 15-minute game is
60 participant-minutes. Check the current free allowance before opening this
to everyone — the token TTL (4h) bounds a leaked token, not your bill.
