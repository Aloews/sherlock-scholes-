CREATE OR REPLACE FUNCTION public.upsert_cityfootball_team_card(
  p_source_key text,
  p_name text,
  p_logo_url text DEFAULT NULL,
  p_source_url text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_stats jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_team_id text;
BEGIN
  IF p_source_key IS NULL OR p_source_key !~ '^cityfootball:team:[0-9]{1,12}$' THEN
    RAISE EXCEPTION 'invalid_cityfootball_team_source_key';
  END IF;
  v_team_id := substring(p_source_key from '([0-9]+)$');
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(p_name) > 160 THEN
    RAISE EXCEPTION 'invalid_cityfootball_team_name';
  END IF;
  IF p_source_url IS NULL OR p_source_url !~ ('^https://league\.cityfootball\.ru/team/' || v_team_id || '/profile/info/?$') THEN
    RAISE EXCEPTION 'invalid_cityfootball_team_source_url';
  END IF;
  IF p_logo_url IS NOT NULL AND p_logo_url !~ '^https://hb\.bizmrg\.com/st\.cityfootball\.ru/team/[0-9]+/logo/[A-Za-z0-9_.-]+' THEN
    RAISE EXCEPTION 'invalid_cityfootball_team_logo_url';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_key, 0));
  SELECT id INTO v_id FROM public.cards WHERE external_source_key = p_source_key LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE public.cards
       SET name = btrim(p_name),
           photo_url = coalesce(nullif(p_logo_url, ''), photo_url),
           photo_source = CASE WHEN nullif(p_logo_url, '') IS NOT NULL AND photo_url IS NULL THEN 'cityfootball' ELSE photo_source END,
           tags = ARRAY(SELECT DISTINCT tag FROM unnest(coalesce(tags, '{}'::text[]) || ARRAY['football-club','amateur-football','cityfootball']::text[]) AS tag),
           facts = coalesce(facts, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'external_source','cityfootball','external_source_key',p_source_key,
             'source_url',p_source_url,'source_description',nullif(btrim(p_description),''),
             'source_stats',coalesce(p_stats,'{}'::jsonb),'source_verified_at',now()
           ))
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.cards(name,name_en,category,active,difficulty,photo_url,photo_source,tags,langs,fame,facts,external_source_key)
  VALUES(btrim(p_name),btrim(p_name),'club',true,'medium',nullif(p_logo_url,''),
    CASE WHEN nullif(p_logo_url,'') IS NOT NULL THEN 'cityfootball' ELSE NULL END,
    ARRAY['football-club','amateur-football','cityfootball']::text[],ARRAY['ru','en']::text[],20,
    jsonb_strip_nulls(jsonb_build_object('external_source','cityfootball','external_source_key',p_source_key,
      'source_url',p_source_url,'source_description',nullif(btrim(p_description),''),
      'source_stats',coalesce(p_stats,'{}'::jsonb),'source_verified_at',now())),p_source_key)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_cityfootball_team_card(text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_cityfootball_team_card(text,text,text,text,text,jsonb) TO service_role;
