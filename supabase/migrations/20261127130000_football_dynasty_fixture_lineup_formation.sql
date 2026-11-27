ALTER TABLE fd.match_lineups
  ADD COLUMN formation text NOT NULL DEFAULT '4-3-3'
  CHECK (formation IN ('4-3-3','4-4-2','3-5-2','4-2-3-1','3-4-3'));
