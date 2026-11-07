-- Disposable fixture for award_candidate_evaluation privilege regression.
CREATE VIEW public.award_candidate_evaluation AS SELECT 1::integer AS fixture_value;
GRANT SELECT ON public.award_candidate_evaluation TO anon, authenticated, service_role;
