use async_trait::async_trait;
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use serde_json::{Value, json};

use crate::{errors::ApiError, state::AppState};

#[derive(Clone, Copy, Debug)]
pub struct Identity {
    pub telegram_id: i64,
}

#[derive(Debug)]
pub enum VerifyError {
    Invalid,
    Unavailable,
}

#[async_trait]
pub trait IdentityVerifier: Send + Sync {
    async fn verify(&self, init_data: &str) -> Result<i64, VerifyError>;
}

#[derive(Clone)]
pub struct SupabaseIdentityVerifier {
    client: reqwest::Client,
    endpoint: String,
    anon_key: String,
}

impl SupabaseIdentityVerifier {
    pub fn new(project_url: String, anon_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            endpoint: format!(
                "{}/rest/v1/rpc/get_user_status",
                project_url.trim_end_matches('/')
            ),
            anon_key,
        }
    }
}

#[async_trait]
impl IdentityVerifier for SupabaseIdentityVerifier {
    async fn verify(&self, init_data: &str) -> Result<i64, VerifyError> {
        let response = self
            .client
            .post(&self.endpoint)
            .header("apikey", &self.anon_key)
            .bearer_auth(&self.anon_key)
            .json(&json!({ "p_init_data": init_data }))
            .send()
            .await
            .map_err(|_| VerifyError::Unavailable)?;

        if response.status().is_client_error() {
            return Err(VerifyError::Invalid);
        }
        if !response.status().is_success() {
            return Err(VerifyError::Unavailable);
        }

        let value: Value = response
            .json()
            .await
            .map_err(|_| VerifyError::Unavailable)?;
        value
            .get("telegram_id")
            .and_then(|id| id.as_i64().or_else(|| id.as_str()?.parse::<i64>().ok()))
            .filter(|id| *id > 0)
            .ok_or(VerifyError::Invalid)
    }
}

pub async fn authenticate(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let init_data = request
        .headers()
        .get("x-tg-init-data")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 8192)
        .ok_or_else(ApiError::unauthorized)?;

    let telegram_id = match state.verifier.verify(init_data).await {
        Ok(id) => id,
        Err(VerifyError::Invalid) => return Err(ApiError::unauthorized()),
        Err(VerifyError::Unavailable) => return Err(ApiError::unavailable()),
    };

    request.extensions_mut().insert(Identity { telegram_id });
    Ok(next.run(request).await)
}
