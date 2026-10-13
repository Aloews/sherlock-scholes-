CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END;
$$;

CREATE TABLE public.players (
  id BIGINT PRIMARY KEY,
  first_name TEXT NOT NULL
);

CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code CHAR(6) UNIQUE NOT NULL,
  host_id BIGINT NOT NULL REFERENCES public.players(id),
  status TEXT NOT NULL DEFAULT 'waiting',
  settings JSONB NOT NULL DEFAULT '{"round_seconds":60,"cards_per_round":5,"total_rounds":3,"categories":null}',
  mode TEXT NOT NULL DEFAULT 'team',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);

CREATE TABLE public.room_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES public.players(id),
  team_id UUID REFERENCES public.teams(id),
  UNIQUE (room_id, player_id)
);

INSERT INTO public.players (id, first_name) VALUES (1001, 'Room Code Test');
