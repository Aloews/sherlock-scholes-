BEGIN;
SET CONSTRAINTS ALL DEFERRED;
DO $$
DECLARE
  campaign uuid := '10000000-0000-4000-8000-000000000001';
  dynasty uuid := '10000000-0000-4000-8000-000000000002';
  founder uuid := '10000000-0000-4000-8000-000000000003';
  incident uuid := '10000000-0000-4000-8000-000000000004';
  followup uuid := '10000000-0000-4000-8000-000000000005';
BEGIN
  INSERT INTO fd.campaigns(id,owner_telegram_id,name,mode,seed,current_year,status,dynasty_id,founder_character_id,player_character_id)
  VALUES(campaign,900001,'LW integration test','sandbox',42,2026,'active',dynasty,founder,founder);
  INSERT INTO fd.characters(id,campaign_id,full_name,age,life_status,is_heir,origin)
  VALUES(founder,campaign,'LW Test Founder',30,'alive',true,'integration-test');
  INSERT INTO fd.dynasties(id,campaign_id,name,head_character_id)
  VALUES(dynasty,campaign,'LW Test Dynasty',founder);
  INSERT INTO fd.world_events(id,campaign_id,event_key,event_type,game_day,location_key,state,payload)
  VALUES(incident,campaign,'test-incident','theft_near_club',100,'club_district','known',
    '{"witnesses":["supporter_01"],"awareness_channel":"local_news"}');
  INSERT INTO fd.world_actor_knowledge(campaign_id,actor_key,source_event_id)
  VALUES(campaign,'supporter_01',incident) ON CONFLICT DO NOTHING;
  INSERT INTO fd.world_facts(campaign_id,fact_key,fact_value,source_event_id)
  VALUES(campaign,'player_helped_victim','{"trust":2}',incident) ON CONFLICT DO NOTHING;
  INSERT INTO fd.world_reactions(campaign_id,source_event_id,reaction_key,reaction_type,due_game_day,state,payload)
  VALUES(campaign,incident,'test-incident:news','local_news_follow_up',102,'queued','{"location":"club_district"}')
  ON CONFLICT(campaign_id,reaction_key) DO NOTHING;
  INSERT INTO fd.world_events(id,campaign_id,event_key,event_type,game_day,location_key,state,payload,parent_event_id)
  VALUES(followup,campaign,'test-followup','news_follow_up',102,'club_district','known','{}',incident);
  UPDATE fd.world_reactions SET state='processed',processed_at=now()
  WHERE campaign_id=campaign AND reaction_key='test-incident:news';
  IF (SELECT count(*) FROM fd.world_actor_knowledge WHERE campaign_id=campaign AND actor_key='supporter_01') <> 1 THEN
    RAISE EXCEPTION 'actor knowledge persistence failed';
  END IF;
  IF (SELECT parent_event_id FROM fd.world_events WHERE id=followup) <> incident THEN
    RAISE EXCEPTION 'causal parent link failed';
  END IF;
  IF (SELECT state FROM fd.world_reactions WHERE campaign_id=campaign AND reaction_key='test-incident:news') <> 'processed' THEN
    RAISE EXCEPTION 'reaction processing failed';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='fd.world_events'::regclass) THEN
    RAISE EXCEPTION 'world event RLS is disabled';
  END IF;
END $$;
ROLLBACK;
