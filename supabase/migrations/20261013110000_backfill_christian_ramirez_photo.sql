-- Backfill a verified Commons portrait for Christian Ramirez (TM 236590).
-- The Wikidata entity Q30090030 identifies the US forward born 1991-04-04.
-- Only fill the missing portrait; never replace an existing curated image.
UPDATE public.cards
   SET photo_url = 'https://commons.wikimedia.org/wiki/Special:FilePath/Christian_Ramirez_-_MNUFC_-_MLS_-_Soccer_2017-03-12_%2836508093885%29_%28cropped%29.jpg?width=400',
       photo_source = 'wikimedia_commons'
 WHERE transfermarkt_id = '236590'
   AND wikidata_qid = 'Q30090030'
   AND born_on = DATE '1991-04-04'
   AND category = 'player'
   AND photo_url IS NULL;
