use axum::{Json, Router, routing::get};
use serde_status::HealthResponse;

pub fn router() -> Router {
    Router::new().route("/health/live", get(liveness))
}

async fn liveness() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "football-dynasty",
    })
}

mod serde_status {
    #[derive(serde::Serialize)]
    pub struct HealthResponse {
        pub status: &'static str,
        pub service: &'static str,
    }
}
