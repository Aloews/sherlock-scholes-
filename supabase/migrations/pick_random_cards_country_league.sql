-- Deck filter by exact player country (ISO) and league (cards.top_league).
-- Adds p_countries + p_leagues to pick_random_cards, player-only (mirrors the
-- p_continents filter). Applied to prod 2026-07-26.
--
-- The two prior overloads (7-arg and 9-arg) are collapsed into ONE canonical
-- function so PostgREST has no overload ambiguity: every param except p_count
-- defaults to NULL, so the already-deployed 9-arg frontend calls still resolve
-- to this single function (the two new params just default to NULL).
--
-- top_league is filled by docs/cards_fill_top_club_preview.py (best-minutes
-- season league from the API-Football cache); until a player has it, a league
-- filter excludes them. See also: ALTER below (idempotent).

ALTER TABLE cards ADD COLUMN IF NOT EXISTS top_league TEXT;

DROP FUNCTION IF EXISTS public.pick_random_cards(integer,text[],bigint,text[],text[],text,integer);
DROP FUNCTION IF EXISTS public.pick_random_cards(integer,text[],bigint,text[],text[],text,integer,text[],text);

CREATE OR REPLACE FUNCTION public.pick_random_cards(
  p_count integer,
  p_categories text[] DEFAULT NULL,
  p_min_pageviews bigint DEFAULT NULL,
  p_continents text[] DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_init_data text DEFAULT NULL,
  p_difficulty integer DEFAULT NULL,
  p_boost_countries text[] DEFAULT NULL,
  p_lang text DEFAULT NULL,
  p_countries text[] DEFAULT NULL,
  p_leagues text[] DEFAULT NULL
) RETURNS SETOF cards
  LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select *
  from cards
  where active = true
    and (p_categories is null or cardinality(p_categories) = 0 or category = any(p_categories))
    and (p_min_pageviews is null or pageviews is null or pageviews > p_min_pageviews)
    and (
      p_continents is null or cardinality(p_continents) = 0
      or category <> 'player'
      or continent = any(p_continents)
      or (continent is null and 'other' = any(p_continents))
    )
    and (
      p_countries is null or cardinality(p_countries) = 0
      or category <> 'player'
      or country = any(p_countries)
    )
    and (
      p_leagues is null or cardinality(p_leagues) = 0
      or category <> 'player'
      or top_league = any(p_leagues)
    )
    and (p_tags is null or cardinality(p_tags) = 0 or tags && p_tags)
    and (langs is null or p_lang is null or p_lang = any(langs))
    and (
      p_difficulty is null or p_difficulty <= 0
      or tier in ('legendary', 'epic')
      or (p_lang is not null and (pageviews_i18n ->> p_lang) is not null
          and (pageviews_i18n ->> p_lang)::bigint >= p_difficulty)
      or pageviews >= p_difficulty
      or (p_boost_countries is not null and category = 'player'
          and country = any(p_boost_countries)
          and coalesce(pageviews, 0) >= greatest(p_difficulty / 4, 1))
    )
  order by random()
  limit p_count;
$function$;

GRANT EXECUTE ON FUNCTION public.pick_random_cards(integer,text[],bigint,text[],text[],text,integer,text[],text,text[],text[])
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
