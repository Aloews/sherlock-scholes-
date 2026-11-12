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
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

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

async fn call(app: axum::Router, body: Value, init_data: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri("/api/v1/alias/round-plan")
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
