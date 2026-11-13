use std::sync::Arc;
use std::collections::HashSet;

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

    for index in 0..4 {
        let (advance_status, _) = call(
            app.clone(),
            "POST",
            &format!("/api/v1/campaigns/{campaign_id}/advance"),
            Some(&format!("advance-{index:04}")),
            Some(json!({"years":10})),
        )
        .await;
        assert_eq!(advance_status, StatusCode::OK);
    }

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
        "UPDATE fd.characters SET age=85 WHERE id=(SELECT founder_character_id FROM fd.campaigns WHERE id=$1)",
    )
    .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
    .execute(&mut *boundary_tx)
    .await
    .expect("prepare boundary case");
    boundary_tx.commit().await.expect("commit boundary fixture");
    let (last_advance_status, last_advance) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/advance"),
        Some("advance-boundary-0001"),
        Some(json!({"years":10})),
    )
    .await;
    assert_eq!(last_advance_status, StatusCode::OK);
    assert_eq!(last_advance["player_age"], 90);
    assert_eq!(last_advance["current_year"], 2071);
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
        Some(json!({"name":"Casey Morgan","age":16})),
    )
    .await;
    assert_eq!(grandchild_status, StatusCode::CREATED);
    let grandchild_id = grandchild["id"].as_str().expect("grandchild id");

    for (index, years) in [10, 10, 9].into_iter().enumerate() {
        let (advance_status, result) = call(
            app.clone(),
            "POST",
            &format!("/api/v1/campaigns/{campaign_id}/advance"),
            Some(&format!("second-life-{index:04}")),
            Some(json!({"years":years})),
        )
        .await;
        assert_eq!(advance_status, StatusCode::OK);
        if index == 2 {
            assert_eq!(result["status"], "succession_pending");
            assert_eq!(result["player_age"], 90);
        }
    }

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

#[tokio::test]
async fn squad_is_seeded_deterministically_with_correct_distribution() {
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

    let owner_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"Seed Test Campaign",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Test Founder",
        "dynasty_name":"Test Dynasty",
        "club_name":"Test United"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("seed-campaign-create"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);

    let players = squad["players"].as_array().expect("players array");
    assert_eq!(players.len(), 23, "Must seed exactly 23 players");

    let mut position_counts = std::collections::HashMap::new();
    let mut player_ids = HashSet::new();
    let mut seed_indices = HashSet::new();

    for player in players {
        let position = player["position"].as_str().expect("position");
        *position_counts.entry(position).or_insert(0) += 1;

        let player_id = player["id"].as_str().expect("player id");
        assert!(player_ids.insert(player_id), "Duplicate player ID: {}", player_id);

        let seed_index = player["seed_index"].as_i64().expect("seed_index");
        assert!(seed_indices.insert(seed_index), "Duplicate seed_index: {}", seed_index);

        assert!(player["full_name"].as_str().expect("full_name").len() > 0);
        assert!(player["age"].as_i64().expect("age") >= 16);
        assert!(player["skill"].as_i64().expect("skill") > 0);
    }

    assert_eq!(position_counts.get("GK"), Some(&2), "Must have 2 GK");
    assert_eq!(position_counts.get("DEF"), Some(&8), "Must have 8 DEF");
    assert_eq!(position_counts.get("MID"), Some(&8), "Must have 8 MID");
    assert_eq!(position_counts.get("FWD"), Some(&5), "Must have 5 FWD");

    let contracts = squad["contracts"].as_array().expect("contracts array");
    assert_eq!(contracts.len(), 23, "Must have 23 active contracts");

    for contract in contracts {
        assert_eq!(contract["status"].as_str().expect("status"), "active");
        let start_year = contract["start_year"].as_i64().expect("start_year");
        let end_year = contract["end_year"].as_i64().expect("end_year");
        assert_eq!(end_year - start_year, 3, "Initial contracts should be 3 years");
        assert!(contract["wage_per_year"].as_i64().expect("wage") > 0);
    }

    let (replay_status, replay_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(
        replay_squad["players"].as_array().expect("players").len(),
        23,
        "Repeated read must return same 23 players"
    );

    let first_player_id = players[0]["id"].as_str().expect("first player id");
    let replay_first_id = replay_squad["players"].as_array().expect("players")[0]["id"]
        .as_str()
        .expect("replay first player id");
    assert_eq!(
        first_player_id, replay_first_id,
        "Player IDs must be deterministic"
    );

    pool.close().await;
}

#[tokio::test]
async fn concurrent_first_squad_reads_produce_identical_deterministic_results() {
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
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("runtime pool");

    let owner_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"Concurrent Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Concurrent Founder",
        "dynasty_name":"Concurrent Dynasty",
        "club_name":"Concurrent FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("concurrent-campaign-create"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let mut handles = vec![];
    for i in 0..5 {
        let app_clone = app.clone();
        let campaign_id_clone = campaign_id.to_string();
        let handle = tokio::spawn(async move {
            call(
                app_clone,
                "GET",
                &format!("/api/v1/campaigns/{}/squad", campaign_id_clone),
                None,
                None,
            )
            .await
        });
        handles.push(handle);
    }

    let mut results = vec![];
    for handle in handles {
        let (status, squad) = handle.await.expect("concurrent request");
        assert_eq!(status, StatusCode::OK);
        results.push(squad);
    }

    let first_players = results[0]["players"].as_array().expect("first players");
    assert_eq!(first_players.len(), 23);

    for result in &results[1..] {
        let players = result["players"].as_array().expect("players");
        assert_eq!(players.len(), 23, "All concurrent reads must return 23 players");

        for (i, player) in players.iter().enumerate() {
            let expected_id = first_players[i]["id"].as_str().expect("expected id");
            let actual_id = player["id"].as_str().expect("actual id");
            assert_eq!(
                expected_id, actual_id,
                "Player {} ID must be deterministic across concurrent reads",
                i
            );
        }
    }

    pool.close().await;
}

#[tokio::test]
async fn owner_isolation_prevents_cross_campaign_access() {
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

    let owner_a_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let owner_b_id = owner_a_id + 1;

    let state_a = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_a_id)),
    };
    let app_a = http::router(state_a, "http://localhost:5173".parse().expect("origin"));

    let state_b = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_b_id)),
    };
    let app_b = http::router(state_b, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"Owner A Campaign",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Owner A",
        "dynasty_name":"Dynasty A",
        "club_name":"Club A"
    });
    let (status, created) = call(
        app_a.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("owner-a-create"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_a_id = created["id"].as_str().expect("campaign id");

    let (squad_status, _) = call(
        app_a.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_a_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);

    let (cross_status, _) = call(
        app_b.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_a_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(
        cross_status,
        StatusCode::NOT_FOUND,
        "Owner B must not access Owner A's squad"
    );

    pool.close().await;
}

#[tokio::test]
async fn contract_signing_enforces_wage_and_term_bounds() {
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

    let owner_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"Contract Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Contract Founder",
        "dynasty_name":"Contract Dynasty",
        "club_name":"Contract FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("contract-campaign-create"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);
    let player_id = squad["players"].as_array().expect("players")[0]["id"]
        .as_str()
        .expect("player id");

    let (under_wage_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-under-wage"),
        Some(json!({"player_id": player_id, "wage_per_year": 0, "years": 3})),
    )
    .await;
    assert_eq!(
        under_wage_status,
        StatusCode::BAD_REQUEST,
        "Wage must be at least 1"
    );

    let (over_wage_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-over-wage"),
        Some(json!({"player_id": player_id, "wage_per_year": 100_000_001, "years": 3})),
    )
    .await;
    assert_eq!(
        over_wage_status,
        StatusCode::BAD_REQUEST,
        "Wage must be at most 100,000,000"
    );

    let (under_years_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-under-years"),
        Some(json!({"player_id": player_id, "wage_per_year": 50_000, "years": 0})),
    )
    .await;
    assert_eq!(
        under_years_status,
        StatusCode::BAD_REQUEST,
        "Years must be at least 1"
    );

    let (over_years_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-over-years"),
        Some(json!({"player_id": player_id, "wage_per_year": 50_000, "years": 6})),
    )
    .await;
    assert_eq!(
        over_years_status,
        StatusCode::BAD_REQUEST,
        "Years must be at most 5"
    );

    pool.close().await;
}

#[tokio::test]
async fn contract_renewal_extends_existing_contract_and_updates_wage() {
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

    let owner_id = 900_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"Renewal Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Renewal Founder",
        "dynasty_name":"Renewal Dynasty",
        "club_name":"Renewal FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("renewal-campaign-create"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);
    let player_id = squad["players"].as_array().expect("players")[0]["id"]
        .as_str()
        .expect("player id");

    let (renew_status, renewed) = call(
        app.clone(),
