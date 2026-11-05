use async_trait::async_trait;
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};
use sqlx::PgPool;

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
pub struct PostgresIdentityVerifier {
    db: PgPool,
}

impl PostgresIdentityVerifier {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

#[async_trait]
impl IdentityVerifier for PostgresIdentityVerifier {
    async fn verify(&self, init_data: &str) -> Result<i64, VerifyError> {
        let result =
            sqlx::query_scalar::<_, Option<i64>>("SELECT public.tg_validate_init_data($1)")
                .bind(init_data)
                .fetch_one(&self.db)
                .await;

        match result {
            Ok(Some(telegram_id)) if telegram_id > 0 => Ok(telegram_id),
            Ok(_) => Err(VerifyError::Invalid),
            Err(error) => {
                tracing::error!(error = %error, "Telegram initData verification query failed");
                Err(VerifyError::Unavailable)
            }
        }
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
