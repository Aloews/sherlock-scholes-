-- The smart-deck Edge Function validates Telegram initData, then checks
-- that the validated Telegram ID exists in public.players. RLS bypass alone
-- does not grant table privileges; service_role needs SELECT explicitly.
-- Keep this grant server-only: do not grant players access to anon/authenticated.
GRANT SELECT ON TABLE public.players TO service_role;
