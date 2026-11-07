-- Ensure the award evaluation view obeys the querying role's RLS.
-- Only the internal service-role calibration pipeline needs access.
ALTER VIEW public.award_candidate_evaluation SET (security_invoker = true);
REVOKE ALL ON public.award_candidate_evaluation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.award_candidate_evaluation TO service_role;
