DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$roles$;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text,
  schedule text NOT NULL,
  command text NOT NULL
);

CREATE OR REPLACE FUNCTION cron.schedule(jobname text, schedule text, command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_jobid bigint;
BEGIN
  INSERT INTO cron.job(jobname, schedule, command)
  VALUES (jobname, schedule, command)
  RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

INSERT INTO cron.job(jobname, schedule, command) VALUES
  ('build-model-accumulators', '10 7 * * *', 'SELECT public.build_model_accumulators()'),
  ('settle-model-accumulators', '0 7 * * *', 'SELECT public.settle_accumulators()');

CREATE TABLE public.forecast_pick (
  fixture_id text NOT NULL,
  commence_at timestamptz NOT NULL,
  model text NOT NULL,
  pick text NOT NULL,
  confidence numeric NOT NULL
);

CREATE TABLE public.accumulator_ticket (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model text,
  settled_at timestamptz,
  match_day date
);

CREATE TABLE public.accumulator_leg (
  ticket_id bigint,
  fixture_id text
);

CREATE TABLE public.llm_budget (id integer);
CREATE TABLE public.llm_auto_switch (id integer);
CREATE TABLE public.espn_league_slug (id integer);
CREATE TABLE public.fan_club (id integer);
CREATE TABLE public.fan_club_member (id integer);
CREATE TABLE public.profile_backfill_jobs (id bigint);

CREATE TABLE public._bak_accumulator_ticket (id bigint);

CREATE OR REPLACE FUNCTION public.calibrated_confidence(p_confidence numeric, p_model text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT p_confidence
$$;

CREATE OR REPLACE FUNCTION public.build_model_accumulators(
  p_days integer DEFAULT 14,
  p_legs integer[] DEFAULT ARRAY[3,4],
  p_floor numeric DEFAULT 0.47
)
RETURNS text LANGUAGE sql AS $$
  SELECT 'экспрессов собрано: 0, уже были: 1, не хватило плеч: 2'
$$;

CREATE OR REPLACE FUNCTION public.settle_accumulators()
RETURNS text LANGUAGE sql AS $$
  SELECT 'ног сведено: 0, экспрессов закрыто: 0'
$$;

DO $fixtures$
DECLARE i integer;
        v_fixture text;
        v_start timestamptz;
        v_model text;
BEGIN
  FOR i IN 1..4 LOOP
    v_fixture := 'fixture-' || i;
    v_start := now() + interval '2 days' + make_interval(hours => i);
    FOREACH v_model IN ARRAY ARRAY['llm','own','fly'] LOOP
      INSERT INTO public.forecast_pick(fixture_id, commence_at, model, pick, confidence)
      VALUES (v_fixture, v_start, v_model, 'H', 0.80);
    END LOOP;
  END LOOP;
END;
$fixtures$;
