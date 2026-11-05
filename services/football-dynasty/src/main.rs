#![forbid(unsafe_code)]

use axum::http::HeaderValue;
use sqlx::postgres::PgPoolOptions;
use std::{error::Error, sync::Arc};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use football_dynasty::{auth::SupabaseIdentityVerifier, config::Config, http, state::AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    init_tracing();
    let config = Config::from_env()?;

    if config.run_migrations {
        let migration_url = config.migration_database_url.as_deref()
            .expect("validated migration database URL");
        let migration_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(migration_url)
            .await?;
        sqlx::migrate!("./migrations").run(&migration_pool).await?;
        migration_pool.close().await;
    }

    let database = PgPoolOptions::new()
        .max_connections(config.max_connections as u32)
        .after_connect(|connection, _metadata| {
            Box::pin(async move {
                sqlx::query("SET ROLE fd_runtime")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&config.database_url)
        .await?;

    let verifier = Arc::new(SupabaseIdentityVerifier::new(
        config.supabase_url,
        config.supabase_anon_key,
    ));
    let state = AppState {
        db: database,
        verifier,
    };
    let allowed_origin: HeaderValue = config.allowed_origin.parse()?;
    let listener = TcpListener::bind(config.bind_addr).await?;
    tracing::info!(address = %config.bind_addr, "Football Dynasty API listening");

    axum::serve(listener, http::router(state, allowed_origin))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("football_dynasty=info,tower_http=info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(%error, "failed to listen for Ctrl+C");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => tracing::error!(%error, "failed to listen for SIGTERM"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
