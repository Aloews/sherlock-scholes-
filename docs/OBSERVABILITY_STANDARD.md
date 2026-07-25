# Observability Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). You
> cannot fix what you cannot see. A live multiplayer round that breaks silently is
> the worst outcome.

## 1. Logging

- Structured, leveled logging (`debug`/`info`/`warn`/`error`). The state machine
  already logs invalid transitions in DEV — extend that discipline.
- **No secrets, no `initData`, no PII** in logs (see [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md)).
- `debug` logs are DEV-only (gate on `import.meta.env.DEV`); production ships
  `warn`/`error` and key `info` events.
- Log **decisions and failures**, not noise: graceful-degrade fallbacks
  (`PGRST202`), retries exhausted, realtime reconnects, auth rejections.

## 2. Error tracking

- Client errors (including Error Boundary catches) MUST be reported to an error
  tracker (**Sentry** recommended). Every unhandled rejection and render crash is
  captured with enough context (screen, phase, room id — not PII) to reproduce.
- Edge-function errors (`tg-pay`) MUST be captured and alerted; a payment failure
  is high severity.
- Group and alert on error-rate spikes, not individual noise.

## 3. Tracing

- For multi-step flows (join room → team setup → round → score), attach a
  correlation id so a failed session can be traced end to end.
- **OpenTelemetry** is the target standard if/when tracing is added; keep spans
  around the network + realtime boundaries.

## 4. Metrics & analytics

- Product analytics already exists (`shared/lib/analytics.ts`, `trackEvent`,
  slow-load reporting in `cardRandomizer.ts`). Keep instrumenting: deck-load
  latency, round completion, error rates, RPC fallback frequency (a spike means a
  migration didn't land).
- Analytics events MUST NOT carry secrets/PII and MUST respect user settings.

## 5. Health & SLOs (lightweight, scale-appropriate)

- Define what "healthy" means: deck RPC success rate, median deck-load time,
  round-completion rate, edge-function success rate.
- Alert when the free-tier DB is failing beyond the built-in warm/retry tolerance.

## 6. What to add when

This is a small project; don't over-instrument. Priority order:
1. Sentry (client + edge) — highest value, add first.
2. Structured logging conventions (this doc) — already partly in place.
3. Analytics on the critical funnels — partly in place.
4. OpenTelemetry tracing — when multiplayer complexity warrants it (ADR).

## 7. Prohibitions (MUST NOT)

- MUST NOT log secrets/`initData`/PII.
- MUST NOT swallow errors silently (`catch {}` with no report) on a critical path.
- MUST NOT ship noisy `debug` logging to production.
