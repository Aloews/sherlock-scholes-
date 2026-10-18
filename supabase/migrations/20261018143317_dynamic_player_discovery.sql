-- Dynamic, source-verified player discovery for Smart Decks.
CREATE OR REPLACE FUNCTION public.upsert_discovered_player_card(
  p_wikidata_qid text, p_name text, p_name_en text DEFAULT NULL,
  p_born_on date DEFAULT NULL, p_country text DEFAULT NULL,
  p_position_ru text DEFAULT NULL, p_photo_url text DEFAULT NULL,
  p_tags text[] DEFAULT '{}'::text[], p_facts jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_tags text[];
BEGIN
  IF p_wikidata_qid IS NULL OR p_wikidata_qid !~ '^Q[1-9][0-9]*$' THEN RAISE EXCEPTION 'invalid_wikidata_qid'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(p_name) > 160 THEN RAISE EXCEPTION 'invalid_player_name'; END IF;
  IF p_photo_url IS NOT NULL AND p_photo_url !~ '^https://commons\.wikimedia\.org/wiki/Special:FilePath/' THEN RAISE EXCEPTION 'invalid_player_photo_source'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wikidata:' || p_wikidata_qid, 0));
  SELECT id INTO v_id FROM public.cards WHERE wikidata_qid = p_wikidata_qid
    ORDER BY active DESC NULLS LAST, created_at ASC LIMIT 1 FOR UPDATE;
  IF v_id IS NULL AND p_born_on IS NOT NULL AND p_country IS NOT NULL THEN
    SELECT id INTO v_id FROM public.cards
     WHERE category IN ('player', 'woman') AND wikidata_qid IS NULL AND born_on = p_born_on AND lower(country) = lower(p_country)
       AND (lower(name) = lower(p_name)
         OR (p_name_en IS NOT NULL AND lower(name) = lower(p_name_en))
         OR (name_en IS NOT NULL AND lower(name_en) = lower(p_name))
         OR (p_name_en IS NOT NULL AND name_en IS NOT NULL AND lower(name_en) = lower(p_name_en)))
     ORDER BY active DESC NULLS LAST, created_at ASC LIMIT 1 FOR UPDATE;
    IF v_id IS NOT NULL THEN UPDATE public.cards SET wikidata_qid = p_wikidata_qid WHERE id = v_id AND wikidata_qid IS NULL; END IF;
  END IF;
  v_tags := ARRAY(SELECT DISTINCT tag FROM unnest(coalesce(p_tags, '{}'::text[])) AS tag WHERE tag IS NOT NULL AND btrim(tag) <> '');
  IF v_id IS NOT NULL THEN
    UPDATE public.cards SET
      name_en = coalesce(name_en, nullif(p_name_en, '')), born_on = coalesce(born_on, p_born_on),
      country = coalesce(country, nullif(p_country, '')), position_ru = coalesce(position_ru, nullif(p_position_ru, '')),
      photo_url = coalesce(photo_url, p_photo_url),
      photo_source = CASE WHEN photo_url IS NULL AND p_photo_url IS NOT NULL THEN 'wikidata' ELSE photo_source END,
      tags = ARRAY(SELECT DISTINCT tag FROM unnest(coalesce(tags, '{}'::text[]) || v_tags) AS tag WHERE tag IS NOT NULL AND btrim(tag) <> ''),
      facts = coalesce(facts, '{}'::jsonb) || coalesce(p_facts, '{}'::jsonb)
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.cards (name, name_en, category, active, difficulty, country, position_ru, born_on, photo_url, photo_source, wikidata_qid, tags, langs, fame, facts)
  VALUES (btrim(p_name), nullif(btrim(p_name_en), ''), 'player', true, 'medium', nullif(btrim(p_country), ''),
    nullif(btrim(p_position_ru), ''), p_born_on, p_photo_url,
    CASE WHEN p_photo_url IS NOT NULL THEN 'wikidata' ELSE NULL END, p_wikidata_qid, v_tags,
    ARRAY['ru','en']::text[], 20, coalesce(p_facts, '{}'::jsonb) || jsonb_build_object('discovery_source','wikidata','wikidata_qid',p_wikidata_qid))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.upsert_discovered_player_card(text,text,text,date,text,text,text,text[],jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_discovered_player_card(text,text,text,date,text,text,text,text[],jsonb) TO service_role;
