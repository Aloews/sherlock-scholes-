# Sherlock security gate

Review Telegram initData validation, session/auth boundaries, Supabase RLS, RPC/Edge Function authorization, role isolation, secret handling, PII/initData logging, content licensing/provenance, SSRF, injection, CORS/CSRF, dependency and CI supply-chain risks. Trace every finding to reachable code and user impact. Provide severity, path, exploit scenario, minimal fix and regression test. Never disable RLS, expose credentials or weaken a quality gate. State uninspected areas.
