// Supavisor transaction pooling can reuse backend sessions across clients; keep runtime SQLx statements non-persistent.
#[macro_export]
macro_rules! fd_query {
    ($sql:expr $(,)?) => {
        sqlx::query($sql).persistent(false)
    };
}

#[macro_export]
macro_rules! fd_query_as {
    ($row:ty, $sql:expr $(,)?) => {
        sqlx::query_as::<_, $row>($sql).persistent(false)
    };
}

#[macro_export]
macro_rules! fd_query_scalar {
    ($row:ty, $sql:expr $(,)?) => {
        sqlx::query_scalar::<_, $row>($sql).persistent(false)
    };
    ($sql:expr $(,)?) => {
        sqlx::query_scalar($sql).persistent(false)
    };
}

pub mod api;
pub mod auth;
pub mod config;
pub mod errors;
pub mod engine;
pub mod squad;
pub mod match_engine;
pub mod match_intelligence;
pub mod spatial;
pub mod competition;
pub mod player_lifecycle;
pub mod http;
pub mod simulation;
pub mod living_world;
pub mod state;
