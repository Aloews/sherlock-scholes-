alter view public.player_match_days set (security_invoker = true);

grant select on public.player_match_days to anon, authenticated, service_role;
