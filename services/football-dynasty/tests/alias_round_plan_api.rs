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
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({"body": String::from_utf8_lossy(&bytes).to_string()}));
    (status, value)
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
#[ignore = "requires the isolated alias lifecycle PostgreSQL fixture"]
async fn round_plan_uses_the_authenticated_host_and_database_roster() {
    let room_id = Uuid::new_v4();
    let team_a = Uuid::from_u128(1);
    let team_b = Uuid::from_u128(2);
    let (app, db) = database_app(7);

    sqlx::query(
        "INSERT INTO public.rooms (id, host_id, status, mode, settings)
         VALUES ($1, 7, 'waiting', 'team', $2)",
    )
    .bind(room_id)
    .bind(json!({"total_rounds": 2}))
    .execute(&db)
    .await
    .expect("room");
    sqlx::query(
        "INSERT INTO public.teams (id, room_id)
         VALUES ($1, $3), ($2, $3)",
    )
    .bind(team_a)
    .bind(team_b)
    .bind(room_id)
    .execute(&db)
    .await
    .expect("teams");
    sqlx::query(
        "INSERT INTO public.room_players (room_id, player_id, team_id, joined_at)
         VALUES ($1, 7, $2, '2026-01-01T10:00:00Z'),
                ($1, 8, $3, '2026-01-02T10:00:00Z')",
    )
    .bind(room_id)
    .bind(team_a)
    .bind(team_b)
    .execute(&db)
    .await
    .expect("room roster");

    let uri = "/api/v1/alias/round-plan";
    let (status, plan) = call_at(
        app,
        uri,
        json!({"room_id": room_id}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan.as_array().map(Vec::len), Some(4));
    assert_eq!(plan[0]["team_id"], team_a.to_string());
    assert_eq!(plan[0]["explainer_id"], 7);
    assert_eq!(plan[1]["team_id"], team_b.to_string());
    assert_eq!(plan[1]["explainer_id"], 8);
    assert_eq!(plan[2]["round_number"], 3);

    let (forbidden, _) = call_at(
        database_app(8).0,
        uri,
        json!({"room_id": room_id}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(forbidden, StatusCode::NOT_FOUND);

    let (forged, _) = call_at(
        database_app(7).0,
        uri,
        json!({
            "room_id": room_id,
            "teams": ["attacker-controlled"],
            "members": [{"player_id": 7, "team_id": "attacker-controlled"}]
        }),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(forged, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
#[ignore = "requires the isolated alias lifecycle PostgreSQL fixture"]
async fn one_vs_one_round_plan_places_the_authenticated_host_team_first() {
    let room_id = Uuid::new_v4();
    let team_a = Uuid::from_u128(3);
    let team_b = Uuid::from_u128(4);
    let (app, db) = database_app(7);

    sqlx::query(
        "INSERT INTO public.rooms (id, host_id, status, mode, settings)
         VALUES ($1, 7, 'waiting', '1v1', $2)",
    )
    .bind(room_id)
    .bind(json!({"total_rounds": 1}))
    .execute(&db)
    .await
    .expect("room");
    sqlx::query(
        "INSERT INTO public.teams (id, room_id)
         VALUES ($1, $3), ($2, $3)",
    )
    .bind(team_a)
    .bind(team_b)
    .bind(room_id)
    .execute(&db)
    .await
    .expect("teams");
    sqlx::query(
        "INSERT INTO public.room_players (room_id, player_id, team_id, joined_at)
         VALUES ($1, 7, $3, '2026-01-02T10:00:00Z'),
                ($1, 8, $2, '2026-01-01T10:00:00Z')",
    )
    .bind(room_id)
    .bind(team_a)
    .bind(team_b)
    .execute(&db)
    .await
    .expect("room roster");

    let (status, plan) = call_at(
        app,
        "/api/v1/alias/round-plan",
        json!({"room_id": room_id}),
        Some("valid-test-init-data"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan[0]["team_id"], team_b.to_string());
    assert_eq!(plan[0]["explainer_id"], 7);
    assert_eq!(plan[1]["team_id"], team_a.to_string());
    assert_eq!(plan[1]["explainer_id"], 8);
}
