use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use futures::future::join_all;
use http_body_util::BodyExt;
use serde_json::{json, Value};
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
async fn concurrent_first_squad_read_seeds_deterministic_players_once() {
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
        "name":"Seeded Squad Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Taylor Swift",
        "dynasty_name":"Swift Estate",
        "club_name":"Stadium City FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("campaign-seed-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let mut handles = Vec::new();
    for index in 0..5 {
        let app_clone = app.clone();
        let uri = format!("/api/v1/campaigns/{campaign_id}/squad");
        handles.push(tokio::spawn(async move {
            call(
                app_clone,
                "GET",
                &uri,
                Some(&format!("squad-read-{index:04}")),
                None,
            )
            .await
        }));
    }

    let results = join_all(handles).await;
    let mut all_player_ids = Vec::new();
    for result in results {
        let (status, data) = result.expect("tokio join");
        assert_eq!(status, StatusCode::OK);
        let players = data["players"].as_array().expect("players array");
        assert_eq!(players.len(), 23);
        for player in players {
            all_player_ids.push(player["id"].as_str().expect("player id").to_string());
        }
    }

    all_player_ids.sort();
    let unique_count = all_player_ids.iter().collect::<std::collections::HashSet<_>>().len();
    assert_eq!(unique_count, 23, "all concurrent reads must return the same 23 player IDs");

    let (detail_status, detail) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("squad-detail-0001"),
        None,
    )
    .await;
    assert_eq!(detail_status, StatusCode::OK);
    let positions = detail["players"]
        .as_array()
        .expect("players")
        .iter()
        .map(|p| p["position"].as_str().expect("position"))
        .collect::<Vec<_>>();
    let gk_count = positions.iter().filter(|&&p| p == "GK").count();
    let def_count = positions.iter().filter(|&&p| p == "DEF").count();
    let mid_count = positions.iter().filter(|&&p| p == "MID").count();
    let fwd_count = positions.iter().filter(|&&p| p == "FWD").count();
    assert_eq!(gk_count, 2);
    assert_eq!(def_count, 8);
    assert_eq!(mid_count, 8);
    assert_eq!(fwd_count, 5);

    pool.close().await;
}

#[tokio::test]
async fn owner_isolation_prevents_cross_campaign_operations() {
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

    let create_body_a = json!({
        "name":"Owner A Campaign",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Alice",
        "dynasty_name":"Alice Family",
        "club_name":"Alice FC"
    });
    let (status, created_a) = call(
        app_a.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("owner-a-campaign-0001"),
        Some(create_body_a),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_a_id = created_a["id"].as_str().expect("campaign id");

    let (squad_a_status, squad_a) = call(
        app_a.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_a_id}/squad"),
        Some("owner-a-squad-0001"),
        None,
    )
    .await;
    assert_eq!(squad_a_status, StatusCode::OK);
    let player_a_id = squad_a["players"][0]["id"].as_str().expect("player id");

    let (isolation_status, _) = call(
        app_b.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_a_id}/squad"),
        Some("owner-b-attempt-0001"),
        None,
    )
    .await;
    assert_eq!(isolation_status, StatusCode::NOT_FOUND);

    let (sign_isolation_status, _) = call(
        app_b.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_a_id}/contracts"),
        Some("owner-b-sign-0001"),
        Some(json!({"player_id":player_a_id,"wage":50000,"years":3})),
    )
    .await;
    assert_eq!(sign_isolation_status, StatusCode::NOT_FOUND);

    pool.close().await;
}

#[tokio::test]
async fn contract_sign_renew_release_and_expiry_lifecycle() {
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
        "name":"Contract Lifecycle Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Contract Manager",
        "dynasty_name":"Contract Estate",
        "club_name":"Contract FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("contract-campaign-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("contract-squad-0001"),
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);
    let players = squad["players"].as_array().expect("players");
    assert_eq!(players.len(), 23);

    let active_contracts = players
        .iter()
        .filter(|p| p["current_contract"].is_object())
        .count();
    assert_eq!(active_contracts, 23, "all seeded players have active contracts");

    let player_id = players[0]["id"].as_str().expect("player id");
    let initial_contract = &players[0]["current_contract"];
    let initial_wage = initial_contract["wage"].as_i64().expect("initial wage");
    let initial_end_year = initial_contract["end_year"].as_i64().expect("initial end year");

    let (renew_status, renewed) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-renew-0001"),
        Some(json!({"player_id":player_id,"wage":initial_wage + 10000,"years":2})),
    )
    .await;
    assert_eq!(renew_status, StatusCode::OK);
    let renewed_end_year = renewed["end_year"].as_i64().expect("renewed end year");
    assert!(
        renewed_end_year >= initial_end_year + 2,
        "renewal extends from max(existing.end_year, current_year) by requested years"
    );

    let (renewed_squad_status, renewed_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("renewed-squad-0001"),
        None,
    )
    .await;
    assert_eq!(renewed_squad_status, StatusCode::OK);
    let renewed_players = renewed_squad["players"].as_array().expect("renewed players");
    let renewed_player = renewed_players
        .iter()
        .find(|p| p["id"] == player_id)
        .expect("renewed player");
    assert_eq!(
        renewed_player["current_contract"]["wage"],
        initial_wage + 10000
    );

    let (release_status, released) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts/{}/release", renewed["id"].as_str().expect("contract id")),
        Some("contract-release-0001"),
        None,
    )
    .await;
    assert_eq!(release_status, StatusCode::OK);
    assert!(released["released_at"].is_string(), "released contract has released_at timestamp");

    let (released_squad_status, released_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("released-squad-0001"),
        None,
    )
    .await;
    assert_eq!(released_squad_status, StatusCode::OK);
    let released_players = released_squad["players"].as_array().expect("released players");
    let released_player = released_players
        .iter()
        .find(|p| p["id"] == player_id)
        .expect("released player");
    assert!(released_player["current_contract"].is_null(), "released player has no active contract");

    let (resign_status, resigned) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("contract-resign-0001"),
        Some(json!({"player_id":player_id,"wage":60000,"years":3})),
    )
    .await;
    assert_eq!(resign_status, StatusCode::OK);
    let resigned_end_year = resigned["end_year"].as_i64().expect("resigned end year");
    assert!(resigned_end_year > renewed_end_year, "new contract after release");

    let mut expiry_tx = pool.begin().await.expect("expiry transaction");
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *expiry_tx)
        .await
        .expect("set runtime role for expiry");
    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut *expiry_tx)
        .await
        .expect("set owner scope for expiry");
    sqlx::query(
        "UPDATE fd.campaigns SET current_year = $1 WHERE id = $2",
    )
    .bind((resigned_end_year + 1) as i32)
    .bind(uuid::Uuid::parse_str(campaign_id).expect("campaign UUID"))
    .execute(&mut *expiry_tx)
    .await
    .expect("advance current_year beyond contract end");
    expiry_tx.commit().await.expect("commit expiry fixture");

    let (expired_squad_status, expired_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("expired-squad-0001"),
        None,
    )
    .await;
    assert_eq!(expired_squad_status, StatusCode::OK);
    let expired_players = expired_squad["players"].as_array().expect("expired players");
    let expired_player = expired_players
        .iter()
        .find(|p| p["id"] == player_id)
        .expect("expired player");
    assert!(expired_player["current_contract"].is_null(), "expired contract is no longer active");

    pool.close().await;
}

#[tokio::test]
async fn contract_validation_rejects_invalid_terms() {
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
        "name":"Validation Test Campaign",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Validator",
        "dynasty_name":"Validator House",
        "club_name":"Validator FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("validation-campaign-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("validation-squad-0001"),
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);
    let player_id = squad["players"][0]["id"].as_str().expect("player id");

    let (zero_wage_status, zero_wage_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("zero-wage-0001"),
        Some(json!({"player_id":player_id,"wage":0,"years":3})),
    )
    .await;
    assert_eq!(zero_wage_status, StatusCode::BAD_REQUEST);
    assert!(
        zero_wage_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("wage"),
        "zero wage is rejected"
    );

    let (negative_wage_status, negative_wage_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("negative-wage-0001"),
        Some(json!({"player_id":player_id,"wage":-50000,"years":3})),
    )
    .await;
    assert_eq!(negative_wage_status, StatusCode::BAD_REQUEST);
    assert!(
        negative_wage_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("wage"),
        "negative wage is rejected"
    );

    let (over_limit_wage_status, over_limit_wage_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("over-limit-wage-0001"),
        Some(json!({"player_id":player_id,"wage":10_000_001,"years":3})),
    )
    .await;
    assert_eq!(over_limit_wage_status, StatusCode::BAD_REQUEST);
    assert!(
        over_limit_wage_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("wage"),
        "over-limit wage is rejected"
    );

    let (zero_years_status, zero_years_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("zero-years-0001"),
        Some(json!({"player_id":player_id,"wage":50000,"years":0})),
    )
    .await;
    assert_eq!(zero_years_status, StatusCode::BAD_REQUEST);
    assert!(
        zero_years_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("years"),
        "zero years is rejected"
    );

    let (negative_years_status, negative_years_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("negative-years-0001"),
        Some(json!({"player_id":player_id,"wage":50000,"years":-1})),
    )
    .await;
    assert_eq!(negative_years_status, StatusCode::BAD_REQUEST);
    assert!(
        negative_years_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("years"),
        "negative years is rejected"
    );

    let (over_limit_years_status, over_limit_years_response) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("over-limit-years-0001"),
        Some(json!({"player_id":player_id,"wage":50000,"years":11})),
    )
    .await;
    assert_eq!(over_limit_years_status, StatusCode::BAD_REQUEST);
    assert!(
        over_limit_years_response["message"]
            .as_str()
            .unwrap_or("")
            .contains("years"),
        "over-limit years is rejected"
    );

    pool.close().await;
}

#[tokio::test]
async fn seeded_contracts_are_deterministic_and_unique() {
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
        "name":"Deterministic Contract Test",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Deterministic Manager",
        "dynasty_name":"Deterministic Estate",
        "club_name":"Deterministic FC"
    });
    let (status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("deterministic-campaign-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let (first_squad_status, first_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("deterministic-first-squad-0001"),
        None,
    )
    .await;
    assert_eq!(first_squad_status, StatusCode::OK);
    let first_players = first_squad["players"].as_array().expect("first players");
    let first_contract_ids: Vec<String> = first_players
        .iter()
        .filter_map(|p| {
            p["current_contract"]["id"]
                .as_str()
                .map(|s| s.to_string())
        })
        .collect();
    assert_eq!(first_contract_ids.len(), 23, "all seeded players have contracts");

    let (second_squad_status, second_squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        Some("deterministic-second-squad-0001"),
        None,
    )
    .await;
    assert_eq!(second_squad_status, StatusCode::OK);
    let second_players = second_squad["players"].as_array().expect("second players");
    let second_contract_ids: Vec<String> = second_players
        .iter()
        .filter_map(|p| {
            p["current_contract"]["id"]
                .as_str()
                .map(|s| s.to_string())
        })
        .collect();

    assert_eq!(
        first_contract_ids, second_contract_ids,
        "repeated reads return identical contract IDs"
    );

    let unique_contract_ids: std::collections::HashSet<_> = first_contract_ids.iter().collect();
    assert_eq!(
        unique_contract_ids.len(),
        23,
        "all 23 contract IDs are unique"
    );

    pool.close().await;
}
