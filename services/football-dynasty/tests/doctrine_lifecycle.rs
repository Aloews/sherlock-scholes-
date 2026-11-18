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
async fn doctrine_progress_is_sequential_persistent_idempotent_and_owner_scoped() {
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

    let owner_id = 910_000_000_000_i64 + (uuid::Uuid::new_v4().as_u128() as i64 & 0x0fff_ffff);
    let state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id)),
    };
    let app = http::router(state, "http://localhost:5173".parse().expect("origin"));

    let create_body = json!({
        "name":"The Strategist",
        "mode":"sandbox",
        "origin":"entrepreneur",
        "founder_name":"Niccolo Vale",
        "dynasty_name":"Vale House",
        "club_name":"Florence Athletic"
    });
    let (create_status, created) = call(
        app.clone(),
        "POST",
        "/api/v1/campaigns",
        Some("doctrine-campaign-0001"),
        Some(create_body),
    )
    .await;
    assert_eq!(create_status, StatusCode::CREATED);
    let campaign_id = created["id"].as_str().expect("campaign id");

    let doctrine_path = format!("/api/v1/campaigns/{campaign_id}/doctrine");
    let (initial_status, initial) = call(app.clone(), "GET", &doctrine_path, None, None).await;
    assert_eq!(initial_status, StatusCode::OK);
    assert_eq!(initial["completed_count"], 0);
    assert_eq!(initial["total_principles"], 18);
    assert_eq!(initial["unlocked_principle_id"], 1);

    let (locked_status, _) = call(
        app.clone(),
        "POST",
        &format!("{doctrine_path}/2/answer"),
        Some("doctrine-locked-0001"),
        Some(json!({"choice_id":"a"})),
    )
    .await;
    assert_eq!(locked_status, StatusCode::CONFLICT);

    let answer_path = format!("{doctrine_path}/1/answer");
    let answer_body = json!({"choice_id":"a"});
    let (answer_status, answer) = call(
        app.clone(),
        "POST",
        &answer_path,
        Some("doctrine-answer-0001"),
        Some(answer_body.clone()),
    )
    .await;
    assert_eq!(answer_status, StatusCode::CREATED);
    assert_eq!(answer["principle_id"], 1);
    assert_eq!(answer["choice_id"], "a");
    assert_eq!(answer["score"], 2);
    assert_eq!(answer["completed_count"], 1);
    assert_eq!(answer["unlocked_principle_id"], 2);
    assert!(answer["completed_at"].as_str().is_some());

    let (replay_status, replayed) = call(
        app.clone(),
        "POST",
        &answer_path,
        Some("doctrine-answer-0001"),
        Some(answer_body),
    )
    .await;
    assert_eq!(replay_status, StatusCode::OK);
    assert_eq!(replayed, answer);

    let (progress_status, progress) = call(app.clone(), "GET", &doctrine_path, None, None).await;
    assert_eq!(progress_status, StatusCode::OK);
    assert_eq!(progress["completed_count"], 1);
    assert_eq!(progress["total_score"], 2);
    assert_eq!(progress["unlocked_principle_id"], 2);
    assert_eq!(progress["completed"][0]["principle_id"], 1);

    let (duplicate_status, _) = call(
        app.clone(),
        "POST",
        &answer_path,
        Some("doctrine-answer-duplicate"),
        Some(json!({"choice_id":"b"})),
    )
    .await;
    assert_eq!(duplicate_status, StatusCode::CONFLICT);

    let (invalid_choice_status, _) = call(
        app.clone(),
        "POST",
        &format!("{doctrine_path}/2/answer"),
        Some("doctrine-invalid-0001"),
        Some(json!({"choice_id":"d"})),
    )
    .await;
    assert_eq!(invalid_choice_status, StatusCode::BAD_REQUEST);

    let other_state = AppState {
        db: pool.clone(),
        verifier: Arc::new(FixedVerifier(owner_id + 1)),
    };
    let other_app = http::router(
        other_state,
        "http://localhost:5173".parse().expect("origin"),
    );
    let (other_owner_status, _) = call(other_app, "GET", &doctrine_path, None, None).await;
    assert_eq!(other_owner_status, StatusCode::NOT_FOUND);

    pool.close().await;
}
