-- Defense in depth for presence: this table is intentionally accessed only
-- through initData-validating SECURITY DEFINER RPCs (touch_presence and
-- online_players). The original migration revoked direct table privileges,
-- but RLS was not enabled, leaving a schema-level security warning and no
-- row-policy boundary if privileges are ever reintroduced.
ALTER TABLE public.player_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.player_presence FROM PUBLIC, anon, authenticated;

-- This counter function is an internal implementation detail used by the
-- SECURITY DEFINER award_room_stats() function. Exposing it directly lets a
-- caller forge games, wins, cards guessed, score and XP for any player.
REVOKE ALL ON FUNCTION public.increment_player_stats(bigint, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_player_stats(bigint, integer, integer, integer, integer)
  TO service_role;


-- award_room_stats is callable as an RPC for retry compatibility. It must
-- not claim a room while the game is still waiting/playing: otherwise a
-- client can force an early one-time award based on incomplete scores.
CREATE OR REPLACE FUNCTION public.award_room_stats(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_max_points INT;
  v_claimed    INT;
BEGIN
  UPDATE rooms SET stats_awarded_at = now()
  WHERE id = p_room_id
    AND stats_awarded_at IS NULL
    AND status = 'finished';
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  IF v_claimed = 0 THEN
    RETURN FALSE;
  END IF;

  SELECT coalesce(max(pts), 0) INTO v_max_points
  FROM (
    SELECT sum(s.points) AS pts
    FROM scores s WHERE s.room_id = p_room_id GROUP BY s.team_id
  ) t;

  PERFORM increment_player_stats(
            rp.player_id,
            1,
            CASE WHEN tp.pts = v_max_points AND v_max_points > 0 THEN 1 ELSE 0 END,
            coalesce(g.cards, 0)::int,
            coalesce(tp.pts, 0)::int)
  FROM room_players rp
  LEFT JOIN (
    SELECT s.team_id, sum(s.points) AS pts
    FROM scores s WHERE s.room_id = p_room_id GROUP BY s.team_id
  ) tp ON tp.team_id = rp.team_id
  LEFT JOIN (
    SELECT r.explainer_id, count(*) AS cards
    FROM rounds r
    JOIN round_cards rc ON rc.round_id = r.id
    WHERE r.room_id = p_room_id AND rc.status = 'correct' AND r.explainer_id IS NOT NULL
    GROUP BY r.explainer_id
  ) g ON g.explainer_id = rp.player_id
  WHERE rp.room_id = p_room_id;

  RETURN TRUE;
END;
$function$;

-- Verification queries:
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.player_presence'::regclass;
-- SELECT grantee, privilege_type FROM information_schema.role_routine_grants
--  WHERE routine_schema = 'public' AND routine_name = 'increment_player_stats';
