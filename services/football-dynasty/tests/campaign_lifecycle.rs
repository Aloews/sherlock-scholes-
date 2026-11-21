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
    assert_eq!(tick["generated_events"], 3);

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
    assert_eq!(events.as_array().expect("event inbox").len(), 6);
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
    assert_eq!(sponsor_tick["generated_events"], 3);
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
    assert_eq!(month["generated_events"], 11);
    assert_eq!(month["expired_events"], 5);

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
