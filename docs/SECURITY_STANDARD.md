# Security Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). Scoped
> to this project's real architecture: a client-only Mini App on Supabase. The
> perimeter is **RLS + the `tg-pay` edge function + `initData` verification** —
> not a custom REST API.

## 1. Threat model (what actually matters here)

- The **anon Supabase key is public** (it ships in the client). It is not a
  secret; RLS is the access control.
- **Clients are hostile.** A user can call any RPC with any parameters and forge
  any client-side value. Never trust client-provided identity or entitlements.
- Trust-sensitive actions: **payments** (`tg-pay`) and **pro entitlement**. These
  MUST be enforced server-side.

## 2. Authentication & authorization (MUST)

- Identity comes only from **`initData` verified server-side** (HMAC with the bot
  token) — in the edge function / RPC via `p_init_data`. See
  [`TELEGRAM_STANDARD.md`](./TELEGRAM_STANDARD.md).
- Reject tampered, expired (stale `auth_date`), or absent signatures.
- **UI locks are UX, not security.** Pro-gating in the client is convenience; the
  authoritative check is in the RPC/edge function (the codebase already sends
  `p_init_data` only for pro-only requests and lets the server enforce `is_pro`).
- Roles/entitlements (pro, admin) are derived from server-verified identity, never
  from a client flag or a writable column an anon can set.

## 3. Data access (RLS)

- RLS ON for every user-reachable table; least-privilege policies; anon reads only
  active game data and cannot write trust-sensitive tables. `rls_lockdown.sql` is
  the baseline — never regress it. Details in [`SUPABASE_STANDARD.md`](./SUPABASE_STANDARD.md).

## 4. Input handling

- Treat every external input (RPC args, `initData`, edge-function bodies,
  scraped source data) as **untrusted `unknown`**; validate/narrow before use.
- Parameterised queries only (PostgREST/RPC handle this) — no string-built SQL in
  edge functions. Classic SQLi doesn't apply to the PostgREST client path, but
  edge-function SQL MUST still be parameterised.
- Sanitize/escape any user-provided string rendered as HTML; React escapes by
  default — MUST NOT use `dangerouslySetInnerHTML` with untrusted content.

## 5. OWASP Top 10 — as it maps here

| Risk | Our control |
| --- | --- |
| Broken access control | RLS + server-verified `initData`; UI locks are not trusted |
| Cryptographic failures | HTTPS only; verify `initData` HMAC; no home-rolled crypto |
| Injection | PostgREST params; parameterised edge SQL; React output escaping |
| Insecure design | Server-side enforcement of payments/pro; least privilege |
| Security misconfiguration | RLS never off; CSP set; no debug endpoints in prod |
| Vulnerable components | `npm audit` / `pip-audit` in CI; patch CVEs |
| Auth failures | Single trusted identity source; reject stale/forged `initData` |
| Data integrity failures | Signed `initData`; migrations reviewed; deck integrity gated |
| Logging failures | Structured logs, **no secrets/PII**; alert on auth failures |
| SSRF | N/A (no server fetch of user URLs); scraper fetches fixed sources only |

## 6. Secrets

- Secrets live in `.env` / platform env / Supabase function config **only**.
  Never in code, tests, logs, commits, or the client bundle.
- `.env` is git-ignored; `.env.example` documents keys with **no values**.
- CI runs secret scanning; a committed secret is a P0 — rotate immediately.
- The bot token, service-role key, and payment secrets are server-side only and
  never reach the client.

## 7. Content Security Policy & headers

- Set a CSP that allows only required origins (Supabase, Telegram, analytics);
  no `unsafe-inline`/`unsafe-eval` where avoidable.
- Standard hardening headers on the deployed app (Vercel config).

## 8. Static security analysis

- **Semgrep** (general + React/TS rules) and optionally **CodeQL** in CI.
- Dependency audit (`npm audit`, `pip-audit`) gating on high/critical.

## 9. Prohibitions (MUST NOT)

- MUST NOT trust client-provided identity/entitlement.
- MUST NOT disable RLS or weaken a policy for convenience.
- MUST NOT commit secrets or log secrets/`initData`/PII.
- MUST NOT render untrusted content as raw HTML.
- MUST NOT ship known high/critical CVEs.

## 10. Incident response

A leaked secret or auth bypass is a P0: rotate the secret, revoke sessions/keys,
patch, add a regression test, and file an ADR/post-mortem. See
[`CHECKLISTS/security-checklist.md`](./CHECKLISTS/security-checklist.md).
