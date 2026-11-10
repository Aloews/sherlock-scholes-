use std::sync::Arc;

use sqlx::PgPool;

use crate::auth::IdentityVerifier;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub verifier: Arc<dyn IdentityVerifier>,
}
