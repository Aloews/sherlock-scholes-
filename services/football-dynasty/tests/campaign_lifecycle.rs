use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use football_dynasty::{
    auth::{IdentityVerifier, PostgresIdentityVerifier, VerifyError},
    http,
    state::AppState,
};

struct FixedVerifier(i64);

#[async_trait]
impl IdentityVerifier for FixedVerifier {
    async fn verify(&self, init_data: &str) -> Result<i64, VerifyError> {
        if init_data == "valid-test-init-data" {
            Ok(self.0)
        } else {
            Err(VerifyError::Invalid)
        }
    }
}

async fn response_json(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let value = serde_json::from_slice(&bytes).expect("JSON response");
    (status, value)
}

async fn call(
    app: axum::Router,
    method: &str,
    uri: &str,
    key: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("x-tg-init-data", "valid-test-init-data");
    if let Some(key) = key {
        builder = builder.header("idempotency-key", key);
    }
    let request = builder
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            body.map(|value| Body::from(value.to_string()))
                .unwrap_or_else(Body::empty),
        )
        .expect("request");
    response_json(app.oneshot(request).await.expect("response")).await
}

#[tokio::test]
async fn founder_heir_death_and_succession_are_persistent_and_idempotent() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is set in CI");
    let migration_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("migration pool");
    sqlx::query("CREATE OR REPLACE FUNCTION public.tg_validate_init_data(p_init_data text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=public AS $fn$ SELECT NULL::bigint $fn$")
        .execute(&migration_pool).await.expect("test Telegram verifier stub");
    sqlx::migrate!("./migrations")
        .run(&migration_pool)
        .await
        .expect("migrations");
    migration_pool.close().await;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("runtime pool");

    let verifier = PostgresIdentityVerifier::new(pool.clone());
    assert!(matches!(
        verifier.verify("").await,
        Err(VerifyError::Invalid)
    ));

    let owner_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let missing = Request::builder()
        .uri("/api/v1/campaigns")
        .body(Body::empty())
        .expect("request");
    let response = app.clone().oneshot(missing).await.expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let forged = Request::builder()
        .uri("/api/v1/campaigns")
        .header("x-tg-init-data", "forged")
        .body(Body::empty())
        .expect("request");
    let response = app.clone().oneshot(forged).await.expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let create_body = json!({
        "name":"North Star",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Alex Morgan",
        "dynasty_name":"Morgan House",
        "club_name":"Northbridge United"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("campaign-create-0001"),
        Some(create_body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");
    let (replay_status, replayed) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("campaign-create-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replayed["id"], created["id"]);

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    ).await;
    assert_eq!(squad_status, StatusCode::OK);
    assert_eq!(squad["formation"], "4-3-3");
    assert_eq!(squad["players"].as_array().expect("squad players").len(), 19);
    assert_eq!(squad["players"][0]["shirt_number"], 1);
    assert!(squad["players"].as_array().expect("players").iter().any(|player| player["position"] == "goalkeeper"));
    assert!(squad["players"][0]["potential"].as_i64().is_some());
    assert!(squad["team_name"].as_str().is_some_and(|name| !name.is_empty()));

    let campaign_uuid = uuid::Uuid::parse_str(campaign_id).expect("campaign UUID");
    let (fixture_id, team_id) = sqlx::query_as::<_, (uuid::Uuid, uuid::Uuid)>(
        "SELECT f.id,t.id FROM fd.season_fixtures f JOIN fd.teams t ON t.campaign_id=f.campaign_id AND t.id IN (f.home_team_id,f.away_team_id) WHERE f.campaign_id=$1 AND t.is_player_controlled=true AND f.status='scheduled' ORDER BY f.matchday LIMIT 1")
        .bind(campaign_uuid).fetch_one(&pool).await.expect("upcoming controlled fixture");
    let fixture_date: chrono::NaiveDate = sqlx::query_scalar("SELECT match_date FROM fd.season_fixtures WHERE id=$1 AND campaign_id=$2")
        .bind(fixture_id).bind(campaign_uuid).fetch_one(&pool).await.expect("fixture date");
    assert_eq!(fixture_date, chrono::NaiveDate::from_ymd_opt(2026, 1, 3).expect("first matchday"));
    let roster = sqlx::query_as::<_, (uuid::Uuid, String, i16)>(
        "SELECT id,position,shirt_number FROM fd.players WHERE campaign_id=$1 AND team_id=$2 ORDER BY shirt_number")
        .bind(campaign_uuid).bind(team_id).fetch_all(&pool).await.expect("controlled roster");
    let mut starters = Vec::new(); let mut substitutes = Vec::new();
    for (id, position, shirt) in roster {
        let starter = (position == "goalkeeper" && shirt == 1) || (position == "defender" && (2..=5).contains(&shirt))
            || (position == "midfielder" && (8..=11).contains(&shirt)) || (position == "forward" && (14..=15).contains(&shirt));
        if starter { starters.push(id); } else if substitutes.len() < 7 { substitutes.push(id); }
    }
    assert_eq!(starters.len(), 11, "test roster has a valid 4-4-2");
    let expected_starters = starters.clone();
    let expected_substitutes = substitutes.clone();
    let (save_status, saved) = call(app.clone(), "POST", &format!("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}/lineup"), None,
        Some(json!({"formation":"4-4-2","starter_ids":starters,"substitute_ids":substitutes}))).await;
    assert_eq!(save_status, StatusCode::OK, "save lineup: {saved}");
    assert_eq!(saved["starters_saved"], 11); assert_eq!(saved["substitutes_saved"], 7);
    let persisted = sqlx::query_as::<_, (String, String, i64)>(
        "SELECT tt.formation,min(ml.formation),count(ml.player_id) FROM fd.team_tactics tt JOIN fd.match_lineups ml ON ml.campaign_id=tt.campaign_id AND ml.team_id=tt.team_id WHERE tt.campaign_id=$1 AND tt.team_id=$2 AND ml.fixture_id=$3 GROUP BY tt.formation")
        .bind(campaign_uuid).bind(team_id).bind(fixture_id).fetch_one(&pool).await.expect("persisted lineup");
    assert_eq!(persisted, ("4-4-2".to_owned(), "4-4-2".to_owned(), 18));
    let (reload_status, reloaded) = call(app.clone(), "GET", &format!("/api/v1/campaigns/{campaign_id}/squad"), None, None).await;
    assert_eq!(reload_status, StatusCode::OK);
    assert_eq!(reloaded["next_fixture_id"], fixture_id.to_string());
    let reloaded_starters: Vec<uuid::Uuid> = serde_json::from_value(reloaded["starter_ids"].clone()).expect("restored starters");
    let reloaded_substitutes: Vec<uuid::Uuid> = serde_json::from_value(reloaded["substitute_ids"].clone()).expect("restored substitutes");
    assert_eq!(reloaded_starters, expected_starters);
    assert_eq!(reloaded_substitutes, expected_substitutes);
    // A later team-level tactic change must not override this fixture's saved formation.
    sqlx::query("UPDATE fd.team_tactics SET formation='4-3-3' WHERE campaign_id=$1 AND team_id=$2")
        .bind(campaign_uuid).bind(team_id).execute(&pool).await.expect("set a different global formation");
    let (invalid_status, _) = call(app.clone(), "POST", &format!("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}/lineup"), None,
        Some(json!({"formation":"5-5-0","starter_ids":[],"substitute_ids":[]}))).await;
    assert_eq!(invalid_status, StatusCode::BAD_REQUEST);

    // Simulate a late injury after the manager saved the lineup. The engine
    // must promote a same-position substitute rather than abort the fixture.
    let injured_starter = expected_starters[1];
    let promoted_substitute: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.players WHERE campaign_id=$1 AND team_id=$2 AND id=ANY($3) AND position='defender' ORDER BY shirt_number LIMIT 1")
        .bind(campaign_uuid).bind(team_id).bind(&expected_substitutes).fetch_one(&pool).await
        .expect("eligible defender on the bench");
    sqlx::query("UPDATE fd.players SET injured_until=$1 WHERE campaign_id=$2 AND id=$3")
        .bind(fixture_date).bind(campaign_uuid).bind(injured_starter).execute(&pool).await
        .expect("mark saved starter unavailable before kickoff");

    let other_owner_app = http::router(
        AppState {
            db: pool.clone(),
            verifier: Arc::new(FixedVerifier(owner_id + 1)),
        },
        "http://localhost:5173".parse().expect("origin"),
    );
    let (foreign_save_status, _) = call(
        other_owner_app.clone(), "POST",
        &format!("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}/lineup"), None,
        Some(json!({"formation":"4-3-3",
            "starter_ids":(0..11).map(|_| uuid::Uuid::new_v4()).collect::<Vec<_>>(),
            "substitute_ids":(0..7).map(|_| uuid::Uuid::new_v4()).collect::<Vec<_>>()})),
    ).await;
    assert_eq!(foreign_save_status, StatusCode::NOT_FOUND);

    let (foreign_status, _) = call(
        other_owner_app,
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    ).await;
    assert_eq!(foreign_status, StatusCode::NOT_FOUND);

    let (heir_status, heir) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/heirs"),
        Some("heir-create-0001"),
        Some(json!({"name":"Jordan Morgan","age":16})),
    )
    .await;
    assert_eq!(heir_status, StatusCode::CREATED);
    let heir_id = heir["id"].as_str().expect("heir id");

    // Assign a real individual development plan, replay the command, then
    // advance the persisted game clock and verify PostgreSQL attributes/logs.
    let (training_player, training_before, training_potential, fatigue_before): (uuid::Uuid, i16, i16, i16) = sqlx::query_as(
        "SELECT id,LEAST(pace,shooting,passing,defending,physical,goalkeeping,stamina),potential,fatigue FROM fd.players WHERE campaign_id=$1 AND team_id=$2 AND LEAST(pace,shooting,passing,defending,physical,goalkeeping,stamina)<potential AND injured_until IS NULL AND suspended_until IS NULL ORDER BY shirt_number LIMIT 1")
        .bind(campaign_uuid).bind(team_id).fetch_one(&pool).await.expect("player eligible for development");
    let training_payload=json!({"player_ids":[training_player],"focus":"balanced","intensity":80});
    let (training_status, training_result)=call(app.clone(),"POST",&format!("/api/v1/campaigns/{campaign_id}/training"),Some("training-plan-0001"),Some(training_payload.clone())).await;
    assert_eq!(training_status,StatusCode::OK,"training assignment: {training_result}");
    assert_eq!(training_result["assigned_players"],1);
    let (training_replay_status,training_replay)=call(app.clone(),"POST",&format!("/api/v1/campaigns/{campaign_id}/training"),Some("training-plan-0001"),Some(training_payload)).await;
    assert_eq!(training_replay_status,StatusCode::OK);
    assert_eq!(training_replay,training_result,"training assignment replay must not duplicate state");

    let (one_day_status, one_day) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("calendar-one-day-01"),
        Some(json!({"days":1})),
    )
    .await;
    assert_eq!(one_day_status, StatusCode::OK);
    assert_eq!(one_day["current_date"], "2026-01-02");
    assert_eq!(one_day["generated_events"], 0);
    let (training_after, fatigue_after): (i16,i16)=sqlx::query_as(
        "SELECT LEAST(pace,shooting,passing,defending,physical,goalkeeping,stamina),fatigue FROM fd.players WHERE campaign_id=$1 AND id=$2")
        .bind(campaign_uuid).bind(training_player).fetch_one(&pool).await.expect("persisted trained player");
    assert!(training_after>training_before,"daily training must improve a real PostgreSQL attribute without exceeding potential {training_potential}");
    assert!(training_after<=training_potential);
    assert!(fatigue_after>=0 && fatigue_after<=100);
    let training_log_count:i64=sqlx::query_scalar("SELECT COUNT(*) FROM fd.player_training_log WHERE campaign_id=$1 AND player_id=$2 AND game_date=DATE '2026-01-02'")
        .bind(campaign_uuid).bind(training_player).fetch_one(&pool).await.expect("training audit log");
    assert_eq!(training_log_count,1,"one daily training outcome must be persisted exactly once");
    let (training_focus,training_intensity):(Option<String>,Option<i16>)=sqlx::query_as("SELECT focus,intensity FROM fd.player_training_plans WHERE campaign_id=$1 AND player_id=$2")
        .bind(campaign_uuid).bind(training_player).fetch_one(&pool).await.expect("persisted training plan");
    assert_eq!((training_focus,training_intensity),(Some("balanced".to_owned()),Some(80)));
    let _ = fatigue_before;

    // A world incident is separate from the legacy calendar inbox. Exercise
    // the authenticated API, persist the player's choice, then verify that
    // the delayed NPC/news reaction is materialized by a later time tick.
    let (world_status, world_events) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/world/events"),
        None,
        None,
    )
    .await;
    assert_eq!(world_status, StatusCode::OK);
    let incident = world_events
        .as_array()
        .expect("world event feed")
        .iter()
        .find(|event| event["event_type"] == "theft_near_club")
        .expect("scheduled world incident");
    let world_event_id = incident["id"].as_str().expect("world event id");
    let (response_status, response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/world/events/{world_event_id}/respond"),
        Some("world-response-0001"),
        Some(json!({"response":"help"})),
    )
    .await;
    assert_eq!(response_status, StatusCode::OK);
    assert_eq!(response["status"], "resolved");
    assert_eq!(response["scheduled_reaction"], "local_news_follow_up");
    assert_eq!(response["witness_count"], 2);
    assert_eq!(
        response["immediate_reactions"],
        json!(["VictimTrustsPlayer", "WitnessSharesIntervention"])
    );
    assert_eq!(
        response["scheduled_reactions"],
        json!(["local_news_follow_up"])
    );
    let (replay_status, replayed_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/world/events/{world_event_id}/respond"),
        Some("world-response-0001"),
        Some(json!({"response":"help"})),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replayed_response, response);

    let (tick_status, tick) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("calendar-tick-0001"),
        Some(json!({"days":6})),
    )
    .await;
    assert_eq!(tick_status, StatusCode::OK);
    assert_eq!(tick["from_date"], "2026-01-02");
    assert_eq!(tick["current_date"], "2026-01-08");
    assert_eq!(tick["generated_events"], 4);
    let played_status: String = sqlx::query_scalar("SELECT status FROM fd.season_fixtures WHERE id=$1 AND campaign_id=$2")
        .bind(fixture_id).bind(campaign_uuid).fetch_one(&pool).await.expect("played fixture status");
    assert_eq!(played_status, "played", "the match engine must consume the fixture-specific 4-4-2");
    let selected_starters_used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fd.player_match_stats WHERE campaign_id=$1 AND fixture_id=$2 AND player_id=ANY($3) AND started=true")
        .bind(campaign_uuid).bind(fixture_id).bind(&expected_starters).fetch_one(&pool).await.expect("persisted selected starter stats");
    assert_eq!(selected_starters_used, 10, "the unavailable saved starter must not start");
    let total_starters: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fd.player_match_stats WHERE campaign_id=$1 AND fixture_id=$2 AND started=true")
        .bind(campaign_uuid).bind(fixture_id).fetch_one(&pool).await.expect("persisted matchday starting XI");
    assert_eq!(total_starters, 11, "the engine must promote an eligible substitute to preserve an XI");
    let promoted_started: bool = sqlx::query_scalar("SELECT started FROM fd.player_match_stats WHERE campaign_id=$1 AND fixture_id=$2 AND player_id=$3")
        .bind(campaign_uuid).bind(fixture_id).bind(promoted_substitute).fetch_one(&pool).await.expect("promoted substitute match stats");
    assert!(promoted_started, "same-position substitute must be promoted before kickoff");

    let (follow_up_status, follow_up_events) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/world/events"),
        None,
        None,
    )
    .await;
    assert_eq!(follow_up_status, StatusCode::OK);
    let follow_up = follow_up_events
        .as_array()
        .expect("world event feed")
        .iter()
        .find(|event| event["event_type"] == "news_follow_up")
        .expect("delayed NPC reaction");
    assert_eq!(follow_up["parent_event_id"], world_event_id);

    let (events_status, events) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/events"),
        None,
        None,
    )
    .await;
    assert_eq!(events_status, StatusCode::OK);
    assert_eq!(events.as_array().expect("event inbox").len(), 7);

    let match_review = events
        .as_array()
        .expect("event inbox")
        .iter()
        .find(|event| event["event_type"] == "match_board_review")
        .expect("player match must create a contextual board decision");
    assert!(
        match_review["body"]
            .as_str()
            .unwrap_or_default()
            .contains("Northbridge United")
    );
    assert_eq!(
        match_review["choices"]
            .as_array()
            .expect("match review choices")
            .len(),
        2
    );
    assert!(
        match_review["title"]
            .as_str()
            .unwrap_or_default()
            .contains("Решение после матча")
    );
    let match_review_id = match_review["id"].as_str().expect("match review id");
    let match_review_choice = match_review["choices"][0]["id"]
        .as_str()
        .expect("match review choice");
    let match_review_effect = match_review["choices"][0]["effect"]
        .as_str()
        .expect("match review effect");

    let campaign_uuid = uuid::Uuid::parse_str(campaign_id).expect("campaign UUID");
    let club_reputation_before: i32 =
        sqlx::query_scalar("SELECT reputation FROM fd.clubs WHERE campaign_id=$1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("club reputation before match decision");
    let dynasty_prestige_before: i32 =
        sqlx::query_scalar("SELECT prestige FROM fd.dynasties WHERE campaign_id=$1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("dynasty prestige before match decision");
    let (match_review_status, match_review_result) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{match_review_id}/resolve"),
        Some("match-review-choice-01"),
        Some(json!({"choice_id": match_review_choice})),
    )
    .await;
    assert_eq!(match_review_status, StatusCode::OK);
    assert_eq!(match_review_result["status"], "resolved");
    let (match_review_replay_status, match_review_replay) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{match_review_id}/resolve"),
        Some("match-review-choice-01"),
        Some(json!({"choice_id": match_review_choice})),
    )
    .await;
    assert_eq!(match_review_replay_status, StatusCode::OK);
    assert_eq!(match_review_replay, match_review_result);
    let club_reputation_after: i32 =
        sqlx::query_scalar("SELECT reputation FROM fd.clubs WHERE campaign_id=$1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("club reputation after match decision");
    let dynasty_prestige_after: i32 =
        sqlx::query_scalar("SELECT prestige FROM fd.dynasties WHERE campaign_id=$1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("dynasty prestige after match decision");
    match match_review_effect {
        "club_reputation" => {
            assert_eq!(club_reputation_after, (club_reputation_before + 1).min(100));
            assert_eq!(dynasty_prestige_after, dynasty_prestige_before);
        }
        "club_reputation_2" => {
            assert_eq!(club_reputation_after, (club_reputation_before + 2).min(100));
            assert_eq!(dynasty_prestige_after, dynasty_prestige_before);
        }
        "club_reputation_minus_1" => {
            assert_eq!(club_reputation_after, (club_reputation_before - 1).max(0));
            assert_eq!(dynasty_prestige_after, dynasty_prestige_before);
        }
        "dynasty_prestige" => {
            assert_eq!(dynasty_prestige_after, dynasty_prestige_before + 1);
            assert_eq!(club_reputation_after, club_reputation_before);
        }
        "dynasty_prestige_2" => {
            assert_eq!(dynasty_prestige_after, dynasty_prestige_before + 2);
            assert_eq!(club_reputation_after, club_reputation_before);
        }
        other => panic!("unexpected match decision effect: {other}"),
    }

    sqlx::query("UPDATE fd.clubs SET reputation=0 WHERE campaign_id=$1")
        .bind(campaign_uuid)
        .execute(&pool)
        .await
        .expect("set reputation floor fixture");
    sqlx::query(
        "INSERT INTO fd.game_events(campaign_id,event_key,event_type,title,body,game_date,expires_on,priority,choices)
         VALUES($1,'test-match-board-minus-one','match_board_review','Test board decision','Test floor behavior','2026-01-08','2026-01-15',80,$2)",
    )
    .bind(campaign_uuid)
    .bind(json!([
        {
            "id": "decrease",
            "label": "Decrease reputation",
            "effect": "club_reputation_minus_1"
        }
    ]))
    .execute(&pool)
    .await
    .expect("insert minus-one effect fixture");
    let minus_one_event_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.game_events WHERE campaign_id=$1 AND event_key='test-match-board-minus-one'",
    )
    .bind(campaign_uuid)
    .fetch_one(&pool)
    .await
    .expect("minus-one event id");
    let (minus_one_status, minus_one_result) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{minus_one_event_id}/resolve"),
        Some("match-review-minus-1-01"),
        Some(json!({"choice_id": "decrease"})),
    )
    .await;
    assert_eq!(minus_one_status, StatusCode::OK);
    assert_eq!(
        minus_one_result["resolution"]["outcome"],
        "club_reputation_decreased_by_one"
    );
    let (minus_one_replay_status, minus_one_replay) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{minus_one_event_id}/resolve"),
        Some("match-review-minus-1-01"),
        Some(json!({"choice_id": "decrease"})),
    )
    .await;
    assert_eq!(minus_one_replay_status, StatusCode::OK);
    assert_eq!(minus_one_replay, minus_one_result);
    let reputation_floor: i32 =
        sqlx::query_scalar("SELECT reputation FROM fd.clubs WHERE campaign_id=$1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("reputation floor");
    assert_eq!(reputation_floor, 0);

    let event_id = events
        .as_array()
        .expect("event inbox")
        .iter()
        .find(|event| event["event_type"] == "club_weekly_review")
        .expect("weekly review event")["id"]
        .as_str()
        .expect("event id");

    let (resolve_status, resolved) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{event_id}/resolve"),
        Some("event-choice-0001"),
        Some(json!({"choice_id":"reputation"})),
    )
    .await;
    assert_eq!(resolve_status, StatusCode::OK);
    assert_eq!(resolved["status"], "resolved");

    let (resolved_events_status, resolved_events) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/events"),
        None,
        None,
    )
    .await;
    assert_eq!(resolved_events_status, StatusCode::OK);
    assert_eq!(
        resolved_events
            .as_array()
            .expect("event inbox")
            .iter()
            .find(|event| event["id"] == event_id)
            .expect("resolved event")["status"],
        "resolved"
    );

    let (season_status, season) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/season"),
        None,
        None,
    )
    .await;
    assert_eq!(season_status, StatusCode::OK);
    assert_eq!(season["fixtures"].as_array().expect("fixtures").len(), 12);
    assert_eq!(season["fixtures"][0]["match_date"], "2026-01-03");
    assert_eq!(
        season["fixtures"]
            .as_array()
            .expect("fixtures")
            .iter()
            .filter(|fixture| fixture["status"] == "played")
            .count(),
        2
    );

    let played_fixture = season["fixtures"].as_array().expect("fixtures").iter()
        .find(|fixture| fixture["status"] == "played").expect("played fixture");
    let fixture_id = played_fixture["id"].as_str().expect("fixture id");
    let (report_status, report) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}"),
        None,
        None,
    ).await;
    assert_eq!(report_status, StatusCode::OK);
    let match_events = report["events"].as_array().expect("persisted match events");
    let goal_events: Vec<_> = match_events.iter().filter(|event| event["event_type"] == "goal").collect();
    let expected_goals = played_fixture["home_goals"].as_i64().unwrap()
        + played_fixture["away_goals"].as_i64().unwrap();
    assert_eq!(goal_events.len() as i64, expected_goals);
    assert!(goal_events.iter().all(|event| event["player_name"].is_string()));
    assert_eq!(match_events.iter().filter(|event| event["event_type"] == "substitution").count(), 6);
    assert!(match_events.iter().filter(|event| event["event_type"] == "substitution")
        .all(|event| event["player_name"].is_string() && event["related_player_name"].is_string()));
    let fixture_uuid=uuid::Uuid::parse_str(fixture_id).expect("fixture UUID");
    let persisted_goals:i64=sqlx::query_scalar(
        "SELECT COALESCE(SUM(goals),0)::bigint FROM fd.player_match_stats WHERE campaign_id=$1 AND fixture_id=$2"
    ).bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID")).bind(fixture_uuid)
        .fetch_one(&pool).await.expect("player match goal stats");
    assert_eq!(persisted_goals,expected_goals);
    let appearance_count:i64=sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM fd.player_match_stats WHERE campaign_id=$1 AND fixture_id=$2 AND minutes_played>0"
    ).bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID")).bind(fixture_uuid)
        .fetch_one(&pool).await.expect("player match appearances");
    assert!(appearance_count>=11);

    let (sponsor_tick_status, sponsor_tick) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("calendar-sponsor-tick"),
        Some(json!({"days":4})),
    )
    .await;
    assert_eq!(sponsor_tick_status, StatusCode::OK);
    assert_eq!(sponsor_tick["current_date"], "2026-01-12");
    assert_eq!(sponsor_tick["generated_events"], 4);
    // The only event whose deadline could have elapsed was explicitly resolved above.
    assert_eq!(sponsor_tick["expired_events"], 0);

    let (sponsor_events_status, sponsor_events) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/events"),
        None,
        None,
    )
    .await;
    assert_eq!(sponsor_events_status, StatusCode::OK);
    let sponsor_event_id = sponsor_events
        .as_array()
        .expect("event inbox")
        .iter()
        .find(|event| event["event_type"] == "sponsor_approach")
        .expect("sponsor event")["id"]
        .as_str()
        .expect("sponsor event id");
    let (sponsor_choice_status, sponsor_choice) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{sponsor_event_id}/resolve"),
        Some("sponsor-cash-choice-01"),
        Some(json!({"choice_id":"sponsor_cash"})),
    )
    .await;
    assert_eq!(sponsor_choice_status, StatusCode::OK);
    assert_eq!(sponsor_choice["status"], "resolved");

    let (cash_status, cash_view) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(cash_status, StatusCode::OK);
    let cash_total: i64 = cash_view["cash_accounts"]
        .as_array()
        .expect("cash accounts")
        .iter()
        .map(|account| account["balance_minor"].as_i64().expect("cash balance"))
        .sum();
    assert_eq!(cash_total, 3_525_000_000);

    let (month_status, month) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("calendar-month-0001"),
        Some(json!({"days":26})),
    )
    .await;
    assert_eq!(month_status, StatusCode::OK);
    assert_eq!(month["current_date"], "2026-02-07");
    assert_eq!(month["generated_events"], 15);
    assert_eq!(month["expired_events"], 8);

    let (final_season_status, final_season) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/season"),
        None,
        None,
    )
    .await;
    assert_eq!(final_season_status, StatusCode::OK);
    assert_eq!(
        final_season["fixtures"]
            .as_array()
            .expect("final fixtures")
            .iter()
            .filter(|fixture| fixture["status"] == "played")
            .count(),
        12
    );

    let (expired_list_status, expired_list) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/events"),
        None,
        None,
    )
    .await;
    assert_eq!(expired_list_status, StatusCode::OK);
    let expired_event_id = expired_list
        .as_array()
        .expect("event inbox")
        .iter()
        .find(|event| event["status"] == "expired")
        .expect("expired weekly event")["id"]
        .as_str()
        .expect("expired event id");
    let (expired_resolve_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/events/{expired_event_id}/resolve"),
        Some("expired-event-choice-01"),
        Some(json!({"choice_id":"reputation"})),
    )
    .await;
    assert_eq!(expired_resolve_status, StatusCode::CONFLICT);

    let (legacy_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/advance"),
        Some("legacy-disabled-0001"),
        Some(json!({"years":1})),
    )
    .await;
    assert_eq!(legacy_status, StatusCode::CONFLICT);

    // Put the founder five years below the deterministic death boundary, then
    // request ten years: the simulation must stop exactly at age 90.
    let mut boundary_tx = pool.begin().await.expect("boundary transaction");
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *boundary_tx)
        .await
        .expect("set runtime role for boundary fixture");
    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut *boundary_tx)
        .await
        .expect("set owner scope for boundary fixture");
    sqlx::query(
        "UPDATE fd.characters SET age=89 WHERE id=(SELECT founder_character_id FROM fd.campaigns WHERE id=$1)",
    )
    .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
    .execute(&mut *boundary_tx)
    .await
    .expect("prepare founder age boundary");
    sqlx::query("UPDATE fd.characters SET age=40 WHERE id=$2 AND campaign_id=$1")
        .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
        .bind(uuid::Uuid::parse_str(heir_id).expect("heir UUID"))
        .execute(&mut *boundary_tx)
        .await
        .expect("prepare eligible heir");
    sqlx::query(
        "UPDATE fd.campaigns SET game_date=DATE '2026-12-31',current_year=2026 WHERE id=$1",
    )
    .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
    .execute(&mut *boundary_tx)
    .await
    .expect("set calendar before birthday");
    boundary_tx.commit().await.expect("commit boundary fixture");
    let (last_advance_status, last_advance) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("calendar-boundary-0001"),
        Some(json!({"days":1})),
    )
    .await;
    assert_eq!(last_advance_status, StatusCode::OK);
    assert_eq!(last_advance["current_date"], "2027-01-01");
    assert_eq!(last_advance["player_age"], 90);
    assert_eq!(last_advance["current_year"], 2027);
    assert_eq!(last_advance["status"], "succession_pending");

    let (preview_status, candidates) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/succession/preview"),
        None,
        None,
    )
    .await;
    assert_eq!(preview_status, StatusCode::OK);
    assert_eq!(candidates[0]["id"], heir_id);

    let (succession_status, succession) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/succession"),
        Some("succession-0001"),
        Some(json!({"heir_id":heir_id})),
    )
    .await;
    assert_eq!(succession_status, StatusCode::OK);
    assert_eq!(succession["heir_id"], heir_id);

    let (replay_succession_status, replay_succession) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/succession"),
        Some("succession-0001"),
        Some(json!({"heir_id":heir_id})),
    )
    .await;
    assert_eq!(replay_succession_status, StatusCode::OK);
    assert_eq!(replay_succession, succession);

    let other_state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id + 1)),
    };
    let other_app = http::router(
        other_state,
        "http://localhost:5173".parse().expect("origin"),
    );
    let (other_owner_status, _) = call(
        other_app,
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(other_owner_status, StatusCode::NOT_FOUND);

    let (detail_status, detail) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(detail_status, StatusCode::OK);
    assert_eq!(detail["campaign"]["status"], "active");
    assert_eq!(detail["player_character_id"], heir_id);
    assert_eq!(detail["dynasty"]["head_character_id"], heir_id);
    assert_eq!(
        detail["characters"]
            .as_array()
            .expect("characters")
            .iter()
            .find(|person| person["id"] == heir_id)
            .expect("new dynasty head")["is_heir"],
        false
    );
    assert_eq!(
        detail["characters"].as_array().expect("characters").len(),
        2
    );
    assert_eq!(
        detail["cash_accounts"]
            .as_array()
            .expect("cash accounts")
            .len(),
        2
    );

    let (grandchild_status, grandchild) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/heirs"),
        Some("grandchild-create-0001"),
        Some(json!({"name":"Casey Morgan","age":18})),
    )
    .await;
    assert_eq!(grandchild_status, StatusCode::CREATED);
    let grandchild_id = grandchild["id"].as_str().expect("grandchild id");

    let mut second_boundary_tx = pool.begin().await.expect("second boundary transaction");
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *second_boundary_tx)
        .await
        .expect("set runtime role for second boundary fixture");
    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut *second_boundary_tx)
        .await
        .expect("set owner scope for second boundary fixture");
    sqlx::query("UPDATE fd.characters SET age=89 WHERE id=(SELECT player_character_id FROM fd.campaigns WHERE id=$1)")
        .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
        .execute(&mut *second_boundary_tx)
        .await
        .expect("prepare second founder age boundary");
    sqlx::query(
        "UPDATE fd.campaigns SET game_date=DATE '2027-12-31',current_year=2027 WHERE id=$1",
    )
    .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
    .execute(&mut *second_boundary_tx)
    .await
    .expect("set second calendar boundary");
    second_boundary_tx
        .commit()
        .await
        .expect("commit second boundary fixture");
    let (second_advance_status, second_advance) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/time/advance"),
        Some("second-calendar-boundary-01"),
        Some(json!({"days":1})),
    )
    .await;
    assert_eq!(second_advance_status, StatusCode::OK);
    assert_eq!(second_advance["current_date"], "2028-01-01");
    assert_eq!(second_advance["status"], "succession_pending");
    assert_eq!(second_advance["player_age"], 90);

    let (second_preview_status, second_candidates) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/succession/preview"),
        None,
        None,
    )
    .await;
    assert_eq!(second_preview_status, StatusCode::OK);
    assert_eq!(second_candidates[0]["id"], grandchild_id);

    let (second_succession_status, second_succession) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/succession"),
        Some("second-succession-0001"),
        Some(json!({"heir_id":grandchild_id})),
    )
    .await;
    assert_eq!(second_succession_status, StatusCode::OK);
    assert_eq!(second_succession["heir_id"], grandchild_id);

    let (second_detail_status, second_detail) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}"),
        None,
        None,
    )
    .await;
    assert_eq!(second_detail_status, StatusCode::OK);
    assert_eq!(second_detail["player_character_id"], grandchild_id);
    assert_eq!(second_detail["dynasty"]["head_character_id"], grandchild_id);
    assert_eq!(
        second_detail["characters"]
            .as_array()
            .expect("three generations")
            .iter()
            .find(|person| person["id"] == grandchild_id)
            .expect("current dynasty head")["is_heir"],
        false
    );
    assert_eq!(
        second_detail["characters"]
            .as_array()
            .expect("three generations")
            .len(),
        3
    );

    pool.close().await;
}
