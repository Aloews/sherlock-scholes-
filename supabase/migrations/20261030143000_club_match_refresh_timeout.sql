-- PostgREST uses a short per-request statement timeout by default.
-- The daily 365-day club-match rebuild is a bounded batch job, not an interactive
-- request; give this SECURITY DEFINER maintenance function its own safe ceiling.
alter function public.rebuild_club_matches()
  set statement_timeout = '30s';

alter function public.rebuild_club_matches()
  set work_mem = '64MB';

notify pgrst, 'reload schema';
