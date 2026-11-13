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
    let protected = api::routes().route_layer(middleware::from_fn_with_state(
        state.clone(),
        auth::authenticate,
    ));

    let roster_routes = Router::new()
        .route("/campaigns/:campaign_id/squads/:club_id", get(get_squad))
        .route("/campaigns/:campaign_id/contracts/sign", axum::routing::post(sign_contract))
        .route("/campaigns/:campaign_id/contracts/release", axum::routing::post(release_contract))
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
        .merge(roster_routes)
        .with_state(state)
        .layer(cors)
}

async fn get_squad(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(telegram_id): axum::Extension<i64>,
    axum::extract::Path((campaign_id, club_id)): axum::extract::Path<(String, i64)>,
) -> Result<Json<Vec<(roster::Player, Option<roster::Contract>)>>, axum::http::StatusCode> {
    let campaign_uuid = uuid::Uuid::parse_str(&campaign_id)
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?;

    let mut tx = state.db.begin().await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query("set local role fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("select set_config('fd.telegram_id', $1, true)")
        .bind(telegram_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    let owner_id: Option<i64> = sqlx::query_scalar(
        "select telegram_id from fd.campaigns where id = $1",
    )
    .bind(campaign_uuid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    if owner_id != Some(telegram_id) {
        return Err(axum::http::StatusCode::NOT_FOUND);
    }

    tx.commit().await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    roster::get_squad(&state.db, campaign_uuid.as_u128() as i64, club_id)
        .await
        .map(Json)
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)
}

async fn sign_contract(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(telegram_id): axum::Extension<i64>,
    axum::extract::Path(campaign_id): axum::extract::Path<String>,
    Json(req): Json<roster::SignContractRequest>,
) -> Result<Json<roster::Contract>, axum::http::StatusCode> {
    let campaign_uuid = uuid::Uuid::parse_str(&campaign_id)
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?;

    let club_id: i64 = sqlx::query_scalar(
        "select c.id from fd.clubs c join fd.campaigns camp on camp.id = c.campaign_id where camp.id = $1 and camp.telegram_id = $2 limit 1",
    )
    .bind(campaign_uuid)
    .bind(telegram_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(axum::http::StatusCode::NOT_FOUND)?;

    roster::sign_contract(&state.db, campaign_uuid.as_u128() as i64, club_id, req)
        .await
        .map(Json)
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)
}

async fn release_contract(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Extension(telegram_id): axum::Extension<i64>,
    axum::extract::Path(campaign_id): axum::extract::Path<String>,
    Json(req): Json<roster::ReleaseContractRequest>,
) -> Result<Json<()>, axum::http::StatusCode> {
    let campaign_uuid = uuid::Uuid::parse_str(&campaign_id)
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?;

    roster::release_contract(&state.db, campaign_uuid.as_u128() as i64, req)
        .await
        .map(|_| Json(()))
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)
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
