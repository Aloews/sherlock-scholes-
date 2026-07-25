# Telegram Mini App Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). Rules
> for running Sherlock Scholes inside Telegram. Related: `src/shared/lib/telegram.ts`,
> `src/shared/lib/device.ts`, `src/shared/store/authStore.ts`.

## 1. `initData` — authentication (MUST)

Telegram passes a signed `initData` string to the WebApp. It is the **only**
trusted identity source.

- The client reads raw `initData` (`getRawInitData()`), never fabricates it.
- **Any privileged / write operation MUST be authorised server-side by verifying
  the `initData` HMAC signature** (Telegram bot token as key) — in the Supabase
  edge function / RPC (`p_init_data`), never by trusting a client-sent user id.
- The client-side UI lock (e.g. pro gating) is **UX only, not security.** The
  real check is server-side. This is already the documented model in
  `cardRandomizer.ts` (`p_init_data` sent only when a pro-only tag is requested);
  keep it.
- `initData` has an `auth_date`; server verification MUST reject stale payloads
  (replay window, e.g. > 24h) and malformed/absent signatures.
- MUST NOT log `initData`, the bot token, or the derived user id in plaintext.

See [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md) for the full auth chain.

## 2. Lifecycle

- Call `WebApp.ready()` once the app is mounted and interactive; `WebApp.expand()`
  when full height is needed.
- Handle the **lifecycle events**: `viewportChanged`, `themeChanged`,
  `back_button`, and app pause/resume (user leaves and returns). Returning to the
  app MUST restore session state — the game already has `useSessionRestore`;
  in-flight rounds/rooms MUST survive a backgrounding.
- Use Telegram's **BackButton / MainButton** for native navigation instead of
  custom chrome where it applies; wire and unwire their handlers on mount/unmount.
- Every Telegram event listener MUST be removed on unmount (no leaks).

## 3. Theming & adaptation

- The UI MUST follow Telegram theme params (`themeParams`, dark/light) and update
  live on `themeChanged`. No hardcoded colours that fight the client theme.
- Support the safe-area / viewport insets Telegram provides; content MUST NOT sit
  under the header or home indicator.
- Support both **iOS and Android** Telegram clients and Telegram Desktop/Web.
  Detect capabilities via `device.ts`; degrade features that a client lacks
  rather than breaking.

## 4. Offline & flaky network

Telegram Mini Apps run on phones on bad mobile networks. Assume the network fails.

- Free-tier Supabase sleeps and cold-starts (5–30s). The app already warms it
  (`wakeSupabase`) and retries the deck RPC with backoff — keep this pattern for
  every critical read.
- Show explicit loading/offline states; never a blank screen. Retries are
  bounded and surfaced only after they fail.
- Cache what is safe to cache (static deck/photos); revalidate. Preload player
  photos (`preloadPhotos.ts`) so a round doesn't stall on images.
- A dropped Realtime connection MUST auto-resubscribe; a room MUST recover.

## 5. UX rules

- The game is played in short, timed rounds on a phone: primary actions are
  thumb-reachable, tap targets ≥ 44px, and the round loop stays at 60fps.
- No blocking modals during a live round. Errors during a round degrade
  gracefully (skip card, keep timer honest) rather than aborting the round.
- Haptics/sounds (`sounds.ts`) respect user settings and the client's mute state.

## 6. Testing Telegram code (MUST)

Telegram behaviour is testable without the real client by mocking the `WebApp`
global. Cover:

- `initData` parsing and **signature verification** (valid, tampered, expired,
  absent) — the tampered/expired cases MUST be rejected.
- Theme application on `themeChanged`.
- Lifecycle: ready/expand called once; pause→resume restores state; listeners
  cleaned up.
- Client variance: iOS vs Android vs Desktop capability flags via `device.ts`.
- Behaviour **outside** Telegram (dev fallback) doesn't crash.

Details and structure in [`TESTING_STANDARD.md`](./TESTING_STANDARD.md) § Telegram.

## 7. Prohibitions (MUST NOT)

- MUST NOT trust any client-provided identity except a server-verified `initData`.
- MUST NOT log secrets or `initData`.
- MUST NOT hardcode theme colours or assume a single client/platform.
- MUST NOT leave the user on a blank/broken screen when the network fails.
- MUST NOT leak Telegram event listeners or Realtime channels.
