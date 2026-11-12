use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use football_dynasty::{
    auth::{IdentityVerifier, VerifyError},
    http,
    state::AppState,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower::ServiceExt;
use uuid::Uuid;

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

async fn call_at(
    app: axum::Router,
    uri: &str,
    body: Value,
    init_data: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(value) = init_data {
        request = request.header("x-tg-init-data", value);
    }
    let response = app
        .oneshot(request.body(Body::from(body.to_string())).expect("request"))
        .await
        .expect("response");
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

async fn call(app: axum::Router, body: Value, init_data: Option<&str>) -> (StatusCode, Value) {
    call_at(app, "/api/v1/alias/round-plan", body, init_data).await
}

fn app(identity: i64) -> axum::Router {
    let db = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:5432/unused")
        .expect("lazy database pool");
    let state = AppState {
        db,
        verifier: Arc::new(FixedVerifier(identity)),
    };
    http::router(state, "http://localhost:5173".parse().expect("origin"))
}

fn database_app(identity: i64) -> (axum::Router, PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL for ignored PostgreSQL tests");
    let db = PgPoolOptions::new()
        .max_connections(2)
        .connect_lazy(&url)
        .expect("database URL");
    let state = AppState {
        db: db.clone(),
        verifier: Arc::new(FixedVerifier(identity)),
    };
    (
        http::router(state, "http://localhost:5173".parse().expect("origin")),
        db,
    )
}

fn team_mode_request() -> Value {
    json!({
        "mode": "team",
        "teams": ["blue", "red"],
        "total_rounds": 2,
        "members": [
            {"player_id": 2, "team_id": "blue", "joined_at": "2026-01-02T10:00:00Z"},
            {"player_id": 4, "team_id": "red", "joined_at": "2026-01-02T10:00:00Z"},
            {"player_id": 1, "team_id": "blue", "joined_at": "2026-01-01T10:00:00Z"},
            {"player_id": 3, "team_id": "red", "joined_at": "2026-01-01T10:00:00Z"}
        ]
    })
}

#[tokio::test]
#[ignore = "requires the isolated alias lifecycle PostgreSQL fixture"]
async fn end_round_requires_room_membership_and_is_idempotent() {
    let room_id = Uuid::new_v4();
    let round_id = Uuid::new_v4();
    let next_round_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let (app, db) = database_app(7);

    sqlx::query("INSERT INTO public.rooms (id, status) VALUES ($1, 'playing')")
        .bind(room_id)
        .execute(&db)
        .await
        .expect("room");
    sqlx::query(
        "INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
         VALUES ($1, $2, $3, 1, 'active', 7), ($4, $2, $3, 2, 'pending', 8)",
    )
    .bind(round_id)
    .bind(room_id)
    .bind(team_id)
    .bind(next_round_id)
    .execute(&db)
    .await
    .expect("rounds");
    sqlx::query("INSERT INTO public.room_players (room_id, player_id) VALUES ($1, 7)")
        .bind(room_id)
        .execute(&db)
        .await
        .expect("room player");
    sqlx::query("INSERT INTO public.round_cards (id, round_id, status) VALUES ($1, $2, 'correct')")
        .bind(Uuid::new_v4())
        .bind(round_id)
        .execute(&db)
        .await
        .expect("card");

    let uri = format!("/api/v1/alias/rounds/{round_id}/end");
    let (denied, _) = call_at(
        database_app(8).0,
        &uri,
        json!({}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(denied, StatusCode::FORBIDDEN);

    let (status, body) = call_at(app.clone(), &uri, json!({}), Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["outcome"], "next_round");
    assert_eq!(body["next_round_id"], next_round_id.to_string());

    let (again_status, again) = call_at(app, &uri, json!({}), Some("valid-test-init-data")).await;
    assert_eq!(again_status, StatusCode::OK);
    assert_eq!(again["outcome"], "already_ended");

    let points: i32 = sqlx::query_scalar("SELECT points FROM public.scores WHERE round_id = $1")
        .bind(round_id)
        .fetch_one(&db)
        .await
        .expect("score");
    assert_eq!(points, 1);
}

#[tokio::test]
#[ignore = "requires the isolated alias lifecycle PostgreSQL fixture"]
async fn voice_pause_and_resume_are_explainer_scoped_and_idempotent() {
    let room_id = Uuid::new_v4();
    let round_id = Uuid::new_v4();
    let team_id = Uuid::new_v4();
    let (app, db) = database_app(7);
    sqlx::query("INSERT INTO public.rooms (id, status) VALUES ($1, 'playing')")
        .bind(room_id)
        .execute(&db)
        .await
        .expect("room");
    sqlx::query(
        "INSERT INTO public.rounds (id, room_id, team_id, round_number, status, explainer_id)
         VALUES ($1, $2, $3, 1, 'active', 7)",
    )
    .bind(round_id)
    .bind(room_id)
    .bind(team_id)
    .execute(&db)
    .await
    .expect("round");

    let pause_uri = format!("/api/v1/alias/rounds/{round_id}/pause");
    let resume_uri = format!("/api/v1/alias/rounds/{round_id}/resume");
    let (denied, _) = call_at(
        database_app(8).0,
        &pause_uri,
        json!({}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(denied, StatusCode::FORBIDDEN);

    let (status, first) = call_at(
        app.clone(),
        &pause_uri,
        json!({}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(first["paused_at"].is_string());

    let (again_status, again) = call_at(
        app.clone(),
        &pause_uri,
        json!({}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(again_status, StatusCode::OK);
    assert_eq!(again["paused_at"], first["paused_at"]);

    let (resume_status, resumed) =
        call_at(app, &resume_uri, json!({}), Some("valid-test-init-data")).await;
    assert_eq!(resume_status, StatusCode::OK);
    assert!(resumed["paused_at"].is_null());
    assert!(resumed["paused_ms"].as_i64().unwrap_or(-1) >= 0);
}

#[tokio::test]
async fn authenticated_request_returns_the_rust_round_plan() {
    let (status, body) = call(app(42), team_mode_request(), Some("valid-test-init-data")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().map(Vec::len), Some(4));
    assert_eq!(body[0]["round_number"], 1);
    assert_eq!(body[0]["team_id"], "blue");
    assert_eq!(body[0]["explainer_id"], 1);
    assert_eq!(body[1]["team_id"], "red");
    assert_eq!(body[1]["explainer_id"], 3);
    assert_eq!(body[2]["explainer_id"], 2);
    assert_eq!(body[3]["explainer_id"], 4);
}

#[tokio::test]
async fn one_vs_one_uses_the_verified_telegram_identity_for_host_order() {
    let body = json!({
        "mode": "1v1",
        "teams": ["home", "away"],
        "total_rounds": 1,
        "members": [
            {"player_id": 20, "team_id": "away", "joined_at": "2026-01-02T10:00:00Z"},
            {"player_id": 42, "team_id": "home", "joined_at": "2026-01-01T10:00:00Z"}
        ]
    });
    let (status, plan) = call(app(42), body, Some("valid-test-init-data")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan[0]["team_id"], "home");
    assert_eq!(plan[0]["explainer_id"], 42);
    assert_eq!(plan[1]["team_id"], "away");
    assert_eq!(plan[1]["explainer_id"], 20);
}

#[tokio::test]
async fn malformed_join_timestamps_are_rejected() {
    let mut body = team_mode_request();
    body["members"][0]["joined_at"] = json!("2026-02-30T10:00:00Z");
    let (status, _) = call(app(42), body, Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn missing_telegram_identity_is_rejected() {
    let (status, _) = call(app(42), team_mode_request(), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invalid_mode_and_duplicate_teams_are_rejected() {
    let mut invalid_mode = team_mode_request();
    invalid_mode["mode"] = json!("unknown");
    let (status, _) = call(app(42), invalid_mode, Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let mut duplicate_teams = team_mode_request();
    duplicate_teams["teams"] = json!(["blue", "blue"]);
    let (status, _) = call(app(42), duplicate_teams, Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn empty_and_oversized_plans_are_rejected() {
    let mut empty = team_mode_request();
    empty["teams"] = json!([]);
    let (status, _) = call(app(42), empty, Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let mut oversized = team_mode_request();
    oversized["total_rounds"] = json!(200);
    let (status, _) = call(app(42), oversized, Some("valid-test-init-data")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
