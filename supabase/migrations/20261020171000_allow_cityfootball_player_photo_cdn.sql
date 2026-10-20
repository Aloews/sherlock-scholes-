-- Source-keyed canonical cards for verified amateur-league player profiles.
ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS external_source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS cards_external_source_key_uidx
  ON public.cards (external_source_key)
  WHERE external_source_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.upsert_cityfootball_player_card(
  p_source_key text,
  p_name text,
  p_name_en text DEFAULT NULL,
  p_born_on date DEFAULT NULL,
  p_position_ru text DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_team_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_stats jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_player_id text;
BEGIN
  IF p_source_key IS NULL OR p_source_key !~ '^cityfootball:player:[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'invalid_cityfootball_source_key';
  END IF;
  v_player_id := substring(p_source_key from '([0-9]+)$');
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(p_name) > 160 THEN
    RAISE EXCEPTION 'invalid_cityfootball_player_name';
  END IF;
  IF p_source_url IS NULL OR p_source_url !~ ('^https://league\.cityfootball\.ru/player/' || v_player_id || '/?$') THEN
    RAISE EXCEPTION 'invalid_cityfootball_source_url';
  END IF;
  IF p_photo_url IS NOT NULL AND p_photo_url !~ '^https://([A-Za-z0-9-]+\.)*cityfootball\.ru/' AND p_photo_url !~ '^https://hb\\.bizmrg\\.com/st\\.cityfootball\\.ru/player/' THEN
    RAISE EXCEPTION 'invalid_cityfootball_photo_url';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_key, 0));
  SELECT id INTO v_id FROM public.cards
   WHERE external_source_key = p_source_key
   LIMIT 1 FOR UPDATE;

  IF v_id IS NOT NULL THEN
    UPDATE public.cards
       SET name = btrim(p_name),
           name_en = coalesce(nullif(btrim(p_name_en), ''), name_en),
           born_on = coalesce(p_born_on, born_on),
           position_ru = coalesce(nullif(btrim(p_position_ru), ''), position_ru),
           photo_url = coalesce(nullif(p_photo_url, ''), photo_url),
           photo_source = CASE WHEN nullif(p_photo_url, '') IS NOT NULL AND photo_url IS NULL
                               THEN 'cityfootball' ELSE photo_source END,
           tags = ARRAY(SELECT DISTINCT tag FROM unnest(coalesce(tags, '{}'::text[]) ||
                    ARRAY['footballer','amateur-football','cityfootball']::text[]) AS tag),
           facts = coalesce(facts, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'external_source', 'cityfootball',
             'external_source_key', p_source_key,
             'source_url', p_source_url,
             'team_name', nullif(btrim(p_team_name), ''),
             'source_description', nullif(btrim(p_description), ''),
             'source_stats', coalesce(p_stats, '{}'::jsonb),
             'source_verified_at', now()
           ))
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.cards (
    name, name_en, category, active, difficulty, born_on, position_ru,
    photo_url, photo_source, tags, langs, fame, facts, external_source_key
  ) VALUES (
    btrim(p_name), nullif(btrim(p_name_en), ''), 'player', true, 'medium',
    p_born_on, nullif(btrim(p_position_ru), ''), nullif(p_photo_url, ''),
    CASE WHEN nullif(p_photo_url, '') IS NOT NULL THEN 'cityfootball' ELSE NULL END,
    ARRAY['footballer','amateur-football','cityfootball']::text[],
    ARRAY['ru','en']::text[], 20,
    jsonb_strip_nulls(jsonb_build_object(
      'external_source', 'cityfootball',
      'external_source_key', p_source_key,
      'source_url', p_source_url,
      'team_name', nullif(btrim(p_team_name), ''),
      'source_description', nullif(btrim(p_description), ''),
      'source_stats', coalesce(p_stats, '{}'::jsonb),
      'source_verified_at', now()
    )),
    p_source_key
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_cityfootball_player_card(text,text,text,date,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_cityfootball_player_card(text,text,text,date,text,text,text,text,text,jsonb)
  TO service_role;

COMMENT ON COLUMN public.cards.external_source_key IS
  'Stable ID from a verified external football source; prevents duplicate source imports.';
