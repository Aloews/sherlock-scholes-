#[macro_export]
macro_rules! fd_query {
    ($sql:expr) => {
        sqlx::query($sql).persistent(false)
    };
}

#[macro_export]
macro_rules! fd_query_as {
    ($row:ty, $sql:expr) => {
        sqlx::query_as::<_, $row>($sql).persistent(false)
    };
}

#[macro_export]
macro_rules! fd_query_scalar {
    ($sql:expr) => {
        sqlx::query_scalar($sql).persistent(false)
    };
    ($row:ty, $sql:expr) => {
        sqlx::query_scalar::<_, $row>($sql).persistent(false)
    };
}

pub mod api;
pub mod auth;
pub mod config;
pub mod errors;
pub mod http;
pub mod simulation;
pub mod state;
