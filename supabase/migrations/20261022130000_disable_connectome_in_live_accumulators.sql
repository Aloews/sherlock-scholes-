-- Stop generating new express tickets from the connectome model.
-- Historical forecast_pick rows and already-settled fly tickets are retained.
-- Active picks are now llm + own; all live selection and diagnostics must use
-- the same two-model consensus, otherwise generation would silently return 0.
create or replace function public.build_model_accumulators(
  p_days  integer default 14,
  p_legs  integer[] default array[3, 4],
  p_floor numeric default 0.47
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_model text;
  v_k     int;
  v_day   date;
  v_rule  text;
  v_id    bigint;
  v_prob  numeric;
  v_made  int := 0;
  v_skip  int := 0;
  v_thin  int := 0;
begin
  create temp table if not exists _legs_tmp (
    fixture_id text, pick text, prob numeric,
    home_team text, away_team text, commence_at timestamptz
  ) on commit drop;

  for v_day in
    select distinct (p.commence_at at time zone 'utc')::date
      from forecast_pick p
     where p.commence_at > now()
       and p.commence_at < now() + make_interval(days => greatest(1, p_days))
     order by 1
  loop
    foreach v_k in array p_legs loop
      foreach v_model in array array['llm', 'own'] loop
        v_rule := 'model:' || v_model || ':' || v_k;

        if exists (select 1 from accumulator_ticket t
                    where t.rule = v_rule and t.match_day = v_day) then
          v_skip := v_skip + 1;
          continue;
        end if;

        delete from _legs_tmp;

        -- Правило отбора требует согласия обеих активных моделей; порог 0.47
        -- относится к калиброванной уверенности конкретной модели.
        --
        -- Порог отсекает дни, когда недостаточно плеч с нужной калиброванной
        -- уверенностью; отсутствие билета предпочтительнее выдуманного.
        insert into _legs_tmp
        select p.fixture_id, p.pick,
               calibrated_confidence(p.confidence, p.model),
               p.home_team, p.away_team, p.commence_at
          from forecast_pick p
         where p.model = v_model
           and p.commence_at > now()
           and (p.commence_at at time zone 'utc')::date = v_day
           and (select count(distinct p2.pick) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 1
           and (select count(*) from forecast_pick p2
                 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 2
           and calibrated_confidence(p.confidence, p.model) >= coalesce(p_floor, 0.47)
         -- ⚠️ ДОБОР ПО commence_at И fixture_id ОБЯЗАТЕЛЕН, и это видно на
         -- живых данных: у `own` калибровка сжала почти всё к 0.5500, то есть
         -- равенства сплошные. Без полного добора два прогона собрали бы
         -- РАЗНЫЕ билеты из одних и тех же данных.
         order by calibrated_confidence(p.confidence, p.model) desc,
                  p.commence_at asc, p.fixture_id asc
         limit v_k;

        if (select count(*) from _legs_tmp) < v_k then
          v_thin := v_thin + 1;
          continue;
        end if;

        select exp(sum(ln(greatest(prob, 0.0001)))) into v_prob from _legs_tmp;

        insert into accumulator_ticket
              (rule, model, legs, pass_prob, payout, match_day)
        values (v_rule, v_model, v_k, round(v_prob, 4), null, v_day)
        returning id into v_id;

        insert into accumulator_leg
              (ticket_id, fixture_id, pick, price, fair_prob,
               home_team, away_team, commence_at)
        select v_id, fixture_id, pick, null, round(prob, 4),
               home_team, away_team, commence_at
          from _legs_tmp;

        v_made := v_made + 1;
      end loop;
    end loop;
  end loop;

  return format('экспрессов собрано: %s, уже были: %s, не хватило плеч: %s',
                v_made, v_skip, v_thin);
end;
$$;

REVOKE ALL ON FUNCTION public.build_model_accumulators(integer, integer[], numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_model_accumulators(integer, integer[], numeric) TO service_role;

-- Keep generation diagnostics aligned with the two-model eligibility rule.
CREATE OR REPLACE FUNCTION public.run_model_accumulator_generation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_run_id bigint;
  v_started timestamptz := clock_timestamp();
  v_before bigint;
  v_after bigint;
  v_result text;
  v_error text;
  v_metrics jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public.run_model_accumulator_generation', 0)) THEN
    INSERT INTO public.accumulator_generation_runs
      (started_at, finished_at, status, result_text, metrics)
    VALUES
      (v_started, clock_timestamp(), 'skipped', 'generation already running',
       jsonb_build_object('reason', 'advisory_lock_held'));
    RETURN 'generation skipped: another run holds the lock';
  END IF;

  SELECT count(*) INTO v_before FROM public.accumulator_ticket;

  SELECT jsonb_build_object(
    'checked_at', clock_timestamp(),
    'window_days', 14,
    'floor', 0.47,
    'future_forecast_rows', (
      SELECT count(*) FROM public.forecast_pick p
       WHERE p.commence_at > now()
         AND p.commence_at < now() + interval '14 days'
    ),
    'future_fixtures', (
      SELECT count(DISTINCT p.fixture_id) FROM public.forecast_pick p
       WHERE p.commence_at > now()
         AND p.commence_at < now() + interval '14 days'
    ),
    'unanimous_fixtures', (
      SELECT count(*) FROM (
        SELECT p.fixture_id
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
           AND p.model IN ('llm', 'own')
         GROUP BY p.fixture_id
        HAVING count(*) = 2 AND count(DISTINCT p.pick) = 1
      ) q
    ),
    'eligible_model_days_3_legs', (
      SELECT count(*) FROM (
        SELECT (p.commence_at AT TIME ZONE 'UTC')::date AS match_day, p.model
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
           AND p.model IN ('llm', 'own')
           AND (SELECT count(*) FROM public.forecast_pick p2 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 2
           AND (SELECT count(DISTINCT p2.pick) FROM public.forecast_pick p2 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 1
           AND public.calibrated_confidence(p.confidence, p.model) >= 0.47
         GROUP BY (p.commence_at AT TIME ZONE 'UTC')::date, p.model
        HAVING count(*) >= 3
      ) q
    ),
    'eligible_model_days_4_legs', (
      SELECT count(*) FROM (
        SELECT (p.commence_at AT TIME ZONE 'UTC')::date AS match_day, p.model
          FROM public.forecast_pick p
         WHERE p.commence_at > now()
           AND p.commence_at < now() + interval '14 days'
           AND p.model IN ('llm', 'own')
           AND (SELECT count(*) FROM public.forecast_pick p2 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 2
           AND (SELECT count(DISTINCT p2.pick) FROM public.forecast_pick p2 where p2.fixture_id = p.fixture_id and p2.model in ('llm', 'own')) = 1
           AND public.calibrated_confidence(p.confidence, p.model) >= 0.47
         GROUP BY (p.commence_at AT TIME ZONE 'UTC')::date, p.model
        HAVING count(*) >= 4
      ) q
    ),
    'existing_future_model_tickets', (
      SELECT count(*) FROM public.accumulator_ticket t
       WHERE t.model IS NOT NULL AND t.settled_at IS NULL
         AND t.match_day >= (now() AT TIME ZONE 'UTC')::date
    )
  ) INTO v_metrics;

  INSERT INTO public.accumulator_generation_runs (started_at, status, metrics)
  VALUES (v_started, 'running', v_metrics)
  RETURNING id INTO v_run_id;

  BEGIN
    v_result := public.build_model_accumulators();
    SELECT count(*) INTO v_after FROM public.accumulator_ticket;

    UPDATE public.accumulator_generation_runs
       SET finished_at = clock_timestamp(),
           status = CASE WHEN v_after > v_before THEN 'created' ELSE 'no_new_tickets' END,
           result_text = v_result,
           metrics = metrics || jsonb_build_object(
             'tickets_before', v_before,
             'tickets_after', v_after,
             'tickets_created', greatest(v_after - v_before, 0)
           )
     WHERE id = v_run_id;

    RETURN format('%s; run_id=%s; tickets_before=%s; tickets_after=%s; tickets_created=%s',
                  coalesce(v_result, 'builder returned NULL'), v_run_id, v_before, v_after,
                  greatest(v_after - v_before, 0));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    UPDATE public.accumulator_generation_runs
       SET finished_at = clock_timestamp(),
           status = 'failed',
           error_text = v_error,
           metrics = metrics || jsonb_build_object('tickets_before', v_before)
     WHERE id = v_run_id;
    RETURN format('generation failed; run_id=%s; error=%s', v_run_id, v_error);
  END;
END;
$function$;

-- Disable the old connectome predictor on the active winner board while
-- retaining the legacy RPC columns for older clients. No new fly picks are
-- written by the Python pipeline; the three legacy fields are always NULL.
CREATE OR REPLACE FUNCTION public.forecast_scoreboard(p_password text DEFAULT NULL)
RETURNS TABLE(
  model text, graded integer, hits integer, accuracy numeric,
  last30 numeric, streak integer, backfilled integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '4s'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND
     (p_password IS NULL OR NOT public.admin_check_password(p_password)) THEN
    PERFORM public.require_pro();
  END IF;

  RETURN QUERY
    WITH g AS (
      SELECT fp.model, fp.correct, fp.commence_at, fp.backfilled,
             row_number() OVER (PARTITION BY fp.model ORDER BY fp.commence_at DESC) AS rn
        FROM public.forecast_pick fp
       WHERE fp.correct IS NOT NULL
         AND fp.model IN ('llm', 'own')
    ), base AS (
      SELECT g.model, count(*)::int AS graded,
             count(*) FILTER (WHERE g.correct)::int AS hits,
             round(avg(CASE WHEN g.correct THEN 1.0 ELSE 0.0 END), 4) AS accuracy,
             round(avg(CASE WHEN g.correct THEN 1.0 ELSE 0.0 END)
                   FILTER (WHERE g.rn <= 30), 4) AS last30,
             count(*) FILTER (WHERE g.backfilled)::int AS backfilled
        FROM g GROUP BY g.model
    ), run AS (
      SELECT q.model, count(*)::int AS streak FROM (
        SELECT g.model, g.correct,
               sum(CASE WHEN g.correct THEN 0 ELSE 1 END)
                 OVER (PARTITION BY g.model ORDER BY g.commence_at DESC
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS broke
          FROM g
      ) q WHERE q.broke = 0 AND q.correct GROUP BY q.model
    )
    SELECT b.model, b.graded, b.hits, b.accuracy, b.last30,
           coalesce(r.streak, 0), b.backfilled
      FROM base b LEFT JOIN run r ON r.model = b.model
     ORDER BY b.accuracy DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public.forecast_upcoming_v2(
  p_limit integer DEFAULT 20,
  p_password text DEFAULT NULL
)
RETURNS TABLE(
  fixture_id text, commence_at timestamptz, home_team text, away_team text,
  llm_pick text, llm_conf numeric, own_pick text, own_conf numeric,
  exp_total numeric, agree integer, llm_cal numeric, own_cal numeric,
  fly_pick text, fly_conf numeric, fly_cal numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '4s'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND
     (p_password IS NULL OR NOT public.admin_check_password(p_password)) THEN
    PERFORM public.require_pro();
  END IF;

  RETURN QUERY
    WITH p AS (
      SELECT k.fixture_id, k.commence_at, k.home_team, k.away_team,
             max(CASE WHEN k.model = 'llm' THEN k.pick END) AS llm_pick,
             max(CASE WHEN k.model = 'llm' THEN k.confidence END) AS llm_conf,
             max(CASE WHEN k.model = 'own' THEN k.pick END) AS own_pick,
             max(CASE WHEN k.model = 'own' THEN k.confidence END) AS own_conf,
             max(k.exp_total) AS exp_total,
             count(*) FILTER (WHERE k.pick = (
               SELECT mode() WITHIN GROUP (ORDER BY k2.pick)
                 FROM public.forecast_pick k2
                WHERE k2.fixture_id = k.fixture_id
                  AND k2.model IN ('llm', 'own')
             ))::integer AS agree
        FROM public.forecast_pick k
       WHERE k.commence_at > now()
         AND k.model IN ('llm', 'own')
       GROUP BY k.fixture_id, k.commence_at, k.home_team, k.away_team
    )
    SELECT p.fixture_id, p.commence_at, p.home_team, p.away_team,
           p.llm_pick, p.llm_conf, p.own_pick, p.own_conf, p.exp_total, p.agree,
           public.calibrated_confidence(p.llm_conf, 'llm'),
           public.calibrated_confidence(p.own_conf, 'own'),
           NULL::text, NULL::numeric, NULL::numeric
      FROM p
     ORDER BY p.commence_at ASC
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.forecast_upcoming_v2(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forecast_upcoming_v2(integer, text) TO anon, authenticated, service_role;
