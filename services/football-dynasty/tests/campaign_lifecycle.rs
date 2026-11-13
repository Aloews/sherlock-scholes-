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
async fn squad_seeding_is_deterministic_idempotent_and_owner_isolated() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is set in CI");
    let migration_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("migration pool");
    sqlx::query("CREATE OR REPLACE FUNCTION public.tg_validate_init_data(p_init_data text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=public AS $fn$ SELECT NULL::bigint $fn$")
        .execute(&migration_pool)
        .await
        .expect("test Telegram verifier stub");
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
    let owner_id = 900_000_000_000_i64
        + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));
    let create_body = json!({
        "name": "Squad Test",
        "mode": "sandbox",
        "origin": "entrepreneur",
        "founder_name": "Test Founder",
        "dynasty_name": "Test House",
        "club_name": "Test United FC"
    });
    let (create_status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("squad-seed-campaign"),
        Some(create_body),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let squad_path = format!("/api/v1/campaigns/{campaign_id}/squad");
    let (first_result, second_result) = tokio::join!(
        call(app.clone(), "GET", &squad_path, None, None),
        call(app.clone(), "GET", &squad_path, None, None),
    );
    let (first_status, first_squad) = first_result;
    let (second_status, second_squad) = second_result;
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);
    assert_eq!(first_squad, second_squad);

    let players = first_squad["players"].as_array().expect("players array");
    assert_eq!(players.len(), 23);
    let position_count = |position: &str| {
        players
            .iter()
            .filter(|player| player["position"] == position)
            .count()
    };
    assert_eq!(position_count("GK"), 2);
    assert_eq!(position_count("DEF"), 8);
    assert_eq!(position_count("MID"), 8);
    assert_eq!(position_count("FWD"), 5);
    for player in players {
        assert!(player["id"].is_string());
        assert!(player["name"].is_string());
        assert!(player["age"].as_i64().is_some_and(|age| (18..=32).contains(&age)));
        assert!(player["contract"]["wage_per_week"].as_i64().unwrap_or(0) > 0);
        assert_eq!(player["contract"]["status"], "active");
    }

    let campaign_uuid = uuid::Uuid::parse_str(campaign_id).expect("campaign UUID");
    let player_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fd.players WHERE campaign_id = $1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("player count");
    let contract_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fd.contracts WHERE campaign_id = $1")
            .bind(campaign_uuid)
            .fetch_one(&pool)
            .await
            .expect("contract count");
    let active_contract_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fd.contracts WHERE campaign_id = $1 AND status = 'active'",
    )
    .bind(campaign_uuid)
    .fetch_one(&pool)
    .await
    .expect("active contract count");
    assert_eq!(player_count, 23);
    assert_eq!(contract_count, 23);
    assert_eq!(active_contract_count, 23);

    let other_state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id + 1)),
    };
    let other_app = http::router(
        other_state,
        "http://localhost:5173".parse().expect("origin"),
    );
    let (other_status, _) = call(other_app, "GET", &squad_path, None, None).await;
    assert_eq!(other_status, StatusCode::NOT_FOUND);

    pool.close().await;
}

#[tokio::test]
async fn contract_sign_renew_release_and_expiry_are_transactional() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is set in CI");
    let migration_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("migration pool");
    sqlx::query("CREATE OR REPLACE FUNCTION public.tg_validate_init_data(p_init_data text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=public AS $fn$ SELECT NULL::bigint $fn$")
        .execute(&migration_pool)
        .await
        .expect("test Telegram verifier stub");
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
    let owner_id = 900_000_000_000_i64
        + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));
    let create_body = json!({
        "name": "Contract Test",
        "mode": "sandbox",
        "origin": "entrepreneur",
        "founder_name": "Contract Founder",
        "dynasty_name": "Contract Dynasty",
        "club_name": "Contract FC"
    });
    let (create_status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("contract-test-campaign"),
        Some(create_body),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");
    let campaign_uuid = uuid::Uuid::parse_str(campaign_id).expect("campaign UUID");

    let (squad_status, squad) = call(
        app.clone(),
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(squad_status, StatusCode::OK);
    let players = squad["players"].as_array().expect("players");
    let player_id = players[0]["id"].as_str().expect("player id");
    let player_uuid = uuid::Uuid::parse_str(player_id).expect("player UUID");

    let invalid_wage = json!({
        "player_id": player_id,
        "wage_per_week": -1000,
        "years": 3
    });
    let (invalid_wage_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("invalid-wage"),
        Some(invalid_wage),
    )
    .await;
    assert_eq!(invalid_wage_status, StatusCode::BAD_REQUEST);

    let invalid_years = json!({
        "player_id": player_id,
        "wage_per_week": 5000,
        "years": 6
    });
    let (invalid_years_status, _) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("invalid-years"),
        Some(invalid_years),
    )
    .await;
    assert_eq!(invalid_years_status, StatusCode::BAD_REQUEST);

    let other_state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id + 1)),
    };
    let other_app = http::router(
        other_state,
        "http://localhost:5173".parse().expect("origin"),
    );
    let (other_release_status, _) = call(
        other_app,
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts/{player_id}/release"),
        Some("other-owner-release"),
        None,
    )
    .await;
    assert_eq!(other_release_status, StatusCode::NOT_FOUND);

    let sign_body = json!({
        "player_id": player_id,
        "wage_per_week": 8000,
        "years": 4
    });
    let (sign_status, signed) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("sign-contract-001"),
        Some(sign_body),
    )
    .await;
    assert_eq!(sign_status, StatusCode::OK);
    assert_eq!(signed["wage_per_week"], 8000);
    assert_eq!(signed["status"], "active");

    let renew_body = json!({
        "player_id": player_id,
        "wage_per_week": 12000,
        "years": 5
    });
    let (renew_status, renewed) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("renew-contract-001"),
        Some(renew_body),
    )
    .await;
    assert_eq!(renew_status, StatusCode::OK);
    assert_eq!(renewed["wage_per_week"], 12000);
    assert_eq!(renewed["status"], "active");

    let active_before_release: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fd.contracts WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'",
    )
    .bind(campaign_uuid)
    .bind(player_uuid)
    .fetch_one(&pool)
    .await
    .expect("active contract count");
    assert_eq!(active_before_release, 1);

    let (release_status, released) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts/{player_id}/release"),
        Some("release-contract-001"),
        None,
    )
    .await;
    assert_eq!(release_status, StatusCode::OK);
    assert_eq!(released["status"], "released");

    let released_contract_id = uuid::Uuid::parse_str(
        released["id"].as_str().expect("released contract id"),
    )
    .expect("released contract UUID");
    let released_at: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
        "SELECT released_at FROM fd.contracts WHERE id = $1",
    )
    .bind(released_contract_id)
    .fetch_one(&pool)
    .await
    .expect("released timestamp");
    assert!(released_at.is_some());

    let re_sign_body = json!({
        "player_id": player_id,
        "wage_per_week": 9000,
        "years": 2
    });
    let (re_sign_status, re_signed) = call(
        app.clone(),
        "POST",
        &format!("/api/v1/campaigns/{campaign_id}/contracts"),
        Some("resign-contract-001"),
        Some(re_sign_body),
    )
    .await;
    assert_eq!(re_sign_status, StatusCode::OK);
    assert_eq!(re_signed["status"], "active");

    let mut tx = pool.begin().await.expect("year advance transaction");
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .expect("set runtime role");
    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut *tx)
        .await
        .expect("set owner scope");
    sqlx::query("UPDATE fd.campaigns SET current_year = 2040 WHERE id = $1")
        .bind(campaign_uuid)
        .execute(&mut *tx)
        .await
        .expect("advance campaign year");
    tx.commit().await.expect("commit year advance");

    let (expired_squad_status, expired_squad) = call(
        app,
        "GET",
        &format!("/api/v1/campaigns/{campaign_id}/squad"),
        None,
        None,
    )
    .await;
    assert_eq!(expired_squad_status, StatusCode::OK);
    let expired_player = expired_squad["players"]
        .as_array()
        .expect("players")
        .iter()
        .find(|player| player["id"] == player_id)
        .expect("player in squad");
    assert!(expired_player["contract"].is_null());

    let expired_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM fd.contracts WHERE campaign_id = $1 AND status = 'expired'",
    )
    .bind(campaign_uuid)
    .fetch_one(&pool)
    .await
    .expect("expired contract count");
    assert_eq!(expired_count, 23);

    pool.close().await;
}
