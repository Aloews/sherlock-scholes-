# Security Checklist

Pairs with [`SECURITY_STANDARD.md`](../SECURITY_STANDARD.md). Run on any change
touching auth, data access, payments, or dependencies.

## Auth & identity
- [ ] Every privileged action authorised by **server-verified `initData`** (HMAC).
- [ ] Tampered / expired (`auth_date`) / absent signatures are rejected.
- [ ] No client-provided user id / entitlement trusted; UI locks are UX only.
- [ ] Roles (pro/admin) derived from verified identity, not a writable column.

## Data access (RLS)
- [ ] RLS ON for every user-reachable table; least-privilege policies.
- [ ] Anon cannot read/write beyond intent (verify against `rls_lockdown.sql`).
- [ ] Trust-sensitive writes (payments, pro) go through edge/service role only.
- [ ] New table ships its policies in the same migration.

## Input & output
- [ ] External inputs treated as `unknown` and validated.
- [ ] Edge-function SQL parameterised; no string-built queries.
- [ ] No `dangerouslySetInnerHTML` with untrusted content.

## Secrets
- [ ] No secret in code/tests/logs/commits/bundle; `.env` git-ignored.
- [ ] `.env.example` has keys, no values.
- [ ] Secret scan clean; bot token / service key / payment secrets server-side
      only.

## Dependencies & static analysis
- [ ] `npm audit` / `pip-audit`: no high/critical.
- [ ] Semgrep (and CodeQL if enabled): no high-severity findings.

## Config
- [ ] CSP restricts to required origins; hardening headers set.
- [ ] No debug/admin surface exposed in production.

## If something is wrong
- [ ] Leaked secret / auth bypass = **P0**: rotate, revoke, patch, regression
      test, ADR/post-mortem.
