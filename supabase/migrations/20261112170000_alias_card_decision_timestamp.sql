-- Persist the server timestamp for each Alias card decision.
-- The Rust API owns decision authorization and writes this field atomically.
ALTER TABLE public.round_cards
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

COMMENT ON COLUMN public.round_cards.decided_at IS
  'Server timestamp at which the explainer marked the card correct or skipped.';

NOTIFY pgrst, 'reload schema';
