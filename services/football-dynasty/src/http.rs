use axum::{
    Json, Router,
    http::{HeaderName, HeaderValue, Method},
    middleware,
    routing::get,
};
use serde_json::json;
use tower_http::cors::CorsLayer;

use crate::{api, auth, roster, state::AppState};

pub fn router(state: AppState, allowed_origin: HeaderValue) -> Router {
    let protected =
        api::routes()
            .merge(roster::routes())
            .route_layer(middleware::from_fn_with_state(
                state.clone(),
                auth::authenticate,
            ));

    let cors = CorsLayer::new()
        .allow_origin(allowed_origin)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("x-tg-init-data"),
            HeaderName::from_static("idempotency-key"),
        ]);

    Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .merge(protected)
        .with_state(state)
        .layer(cors)
}

async fn liveness() -> Json<serde_json::Value> {
    Json(json!({"status":"ok","service":"football-dynasty"}))
}

async fn readiness(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .map(|_| Json(json!({"status":"ready","database":"ok"})))
        .map_err(|_| axum::http::StatusCode::SERVICE_UNAVAILABLE)
}
