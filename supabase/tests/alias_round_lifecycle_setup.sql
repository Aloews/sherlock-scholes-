-- Isolated schema fixture for the Alias round lifecycle SQL integration tests.
-- Run only in the dedicated sherlock_alias_test database created by CI.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$roles$;

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY,
  host_id BIGINT,
  status TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{"total_rounds": 3}'::jsonb,
  mode TEXT NOT NULL DEFAULT 'team',
  current_round_id UUID,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE TABLE public.teams (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sweep_stale_rooms(p_grace_seconds INT DEFAULT 120)
RETURNS TABLE (rounds_ended INT, rooms_finished INT)
LANGUAGE SQL SECURITY DEFINER SET search_path = public AS $$
  SELECT 0::INT, 0::INT
$$;

CREATE TABLE public.room_players (
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  player_id BIGINT NOT NULL,
  team_id UUID,
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, player_id)
);

CREATE TABLE public.rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  team_id UUID NOT NULL,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  ended_at TIMESTAMPTZ,
  explainer_id BIGINT,
  paused_at TIMESTAMPTZ,
  paused_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  time_seconds INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE public.cards (
  id UUID PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  test_scope TEXT NOT NULL DEFAULT 'default'
);

CREATE OR REPLACE FUNCTION public.pick_random_cards(
  p_filter JSONB,
  p_count INTEGER DEFAULT 50,
  p_init_data TEXT DEFAULT NULL
) RETURNS SETOF public.cards
LANGUAGE SQL STABLE
AS $$
  SELECT *
    FROM public.cards
   WHERE active
     AND (p_filter ->> 'test_scope' IS NULL OR test_scope = p_filter ->> 'test_scope')
   ORDER BY id
   LIMIT greatest(coalesce(p_count, 50), 1);
$$;

CREATE TABLE public.round_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.rounds(id),
  card_id UUID NOT NULL DEFAULT gen_random_uuid(),
  card_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  decided_at TIMESTAMPTZ
);

CREATE TABLE public.scores (
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  team_id UUID NOT NULL,
  round_id UUID NOT NULL REFERENCES public.rounds(id),
  points INTEGER NOT NULL,
  UNIQUE (team_id, round_id)
);

-- Deterministic stand-in for Supabase's Telegram initData validator.
-- It is deliberately limited to fixture identities and is created only in
-- this disposable CI database; production migrations and auth are untouched.
CREATE OR REPLACE FUNCTION public.tg_validate_init_data(p_init_data TEXT)
RETURNS BIGINT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE p_init_data
    WHEN 'valid-explainer' THEN 7::BIGINT
    WHEN 'valid-other' THEN 8::BIGINT
    ELSE NULL
  END;
$$;
