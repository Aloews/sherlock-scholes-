UPDATE fd.season_fixtures AS fixture
SET
  season_year = campaign.current_year,
  match_date = campaign.game_date
    + ((6 - EXTRACT(ISODOW FROM campaign.game_date)::integer + 7) % 7)
    + ((fixture.matchday::integer - 1) * 7)
FROM fd.campaigns AS campaign
WHERE campaign.id = fixture.campaign_id
  AND (
    fixture.season_year <> campaign.current_year
    OR fixture.match_date <> campaign.game_date
      + ((6 - EXTRACT(ISODOW FROM campaign.game_date)::integer + 7) % 7)
      + ((fixture.matchday::integer - 1) * 7)
  );
