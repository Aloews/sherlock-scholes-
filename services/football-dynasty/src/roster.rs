use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::auth::Identity;
use crate::errors::ApiError;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct PlayerResponse {
    pub id: Uuid,
    pub full_name: String,
    pub position: String,
    pub age: i32,
    pub skill: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContractResponse {
    pub id: Uuid,
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub start_year: i32,
    pub end_year: i32,
    pub wage_per_year: i64,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SquadResponse {
    pub players: Vec<PlayerWithContract>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlayerWithContract {
    pub player: PlayerResponse,
    pub contract: ContractResponse,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub wage_per_year: i64,
    pub years: i32,
}

#[derive(Debug, Serialize)]
pub struct SignContractResponse {
    pub contract: ContractResponse,
}

const POSITION_COUNTS: &[(&str, usize)] = &[("GK", 2), ("DEF", 8), ("MID", 8), ("FWD", 5)];

fn deterministic_uuid(campaign_id: Uuid, seed: i64, domain: &str, index: usize) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.to_le_bytes());
    hasher.update(domain.as_bytes());
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    Uuid::from_bytes(bytes)
}

fn deterministic_name(campaign_id: Uuid, seed: i64, index: usize) -> String {
    let first_names = [
        "James", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas",
        "Charles", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul",
        "Andrew", "Joshua", "Kenneth", "Kevin", "Brian", "George", "Timothy", "Ronald",
    ];
    let last_names = [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
        "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
    ];

    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.to_le_bytes());
    hasher.update(b"name");
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();

    let first_idx = (hash[0] as usize) % first_names.len();
    let last_idx = (hash[1] as usize) % last_names.len();

    format!("{} {}", first_names[first_idx], last_names[last_idx])
}

fn deterministic_age(campaign_id: Uuid, seed: i64, index: usize) -> i32 {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.to_le_bytes());
    hasher.update(b"age");
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();
    18 + ((hash[0] as i32) % 17)
}

fn deterministic_skill(campaign_id: Uuid, seed: i64, index: usize) -> i32 {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.to_le_bytes());
    hasher.update(b"skill");
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();
    50 + ((hash[0] as i32) % 31)
}

async fn seed_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    club_id: Uuid,
    seed: i64,
    current_year: i32,
) -> Result<(), ApiError> {
    let mut player_index = 0;

    for (position, count) in POSITION_COUNTS {
        for _ in 0..*count {
            let player_id = deterministic_uuid(campaign_id, seed, "player", player_index);
            let full_name = deterministic_name(campaign_id, seed, player_index);
            let age = deterministic_age(campaign_id, seed, player_index);
            let skill = deterministic_skill(campaign_id, seed, player_index);

            sqlx::query!(
                r#"
                INSERT INTO fd.players (campaign_id, id, full_name, position, age, skill, seed_index)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (campaign_id, seed_index) DO NOTHING
                "#,
                campaign_id,
                player_id,
                full_name,
                *position,
                age,
                skill,
                player_index as i32
            )
            .execute(&mut **tx)
            .await
            .map_err(|e| ApiError::internal().with_source(e))?;

            let contract_id = deterministic_uuid(campaign_id, seed, "contract", player_index);
            let start_year = current_year;
            let end_year = current_year + 3;
            let wage_per_year: i64 = 50_000;

            sqlx::query!(
                r#"
                INSERT INTO fd.contracts (campaign_id, id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL)
                ON CONFLICT (campaign_id, player_id) WHERE status = 'active' DO NOTHING
                "#,
                campaign_id,
                contract_id,
                player_id,
                club_id,
                start_year,
                end_year,
                wage_per_year
            )
            .execute(&mut **tx)
            .await
            .map_err(|e| ApiError::internal().with_source(e))?;

            player_index += 1;
        }
    }

    Ok(())
}

async fn expire_contracts(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    current_year: i32,
) -> Result<(), ApiError> {
    sqlx::query!(
        r#"
        UPDATE fd.contracts
        SET status = 'expired'
        WHERE campaign_id = $1
          AND status = 'active'
          AND end_year < $2
        "#,
        campaign_id,
        current_year
    )
    .execute(&mut **tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    Ok(())
}

pub async fn get_squad(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    Extension(identity): Extension<Identity>,
) -> Result<Json<SquadResponse>, ApiError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!(
        "SELECT set_config('fd.telegram_id', $1, true)",
        identity.telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    let campaign = sqlx::query!(
        r#"
        SELECT seed, current_year
        FROM fd.campaigns
        WHERE id = $1
        FOR UPDATE
        "#,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let seed = campaign.seed;
    let current_year = campaign.current_year;

    expire_contracts(&mut tx, campaign_id, current_year).await?;

    let player_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*)
        FROM fd.players
        WHERE campaign_id = $1
        "#,
        campaign_id
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .unwrap_or(0);

    if player_count == 0 {
        let club = sqlx::query!(
            r#"
            SELECT id
            FROM fd.clubs
            WHERE campaign_id = $1
            ORDER BY id
            LIMIT 1
            "#,
            campaign_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| ApiError::internal().with_source(e))?
        .ok_or_else(|| ApiError::not_found())?;

        seed_squad(&mut tx, campaign_id, club.id, seed, current_year).await?;
    }

    let rows = sqlx::query!(
        r#"
        SELECT
            p.id as player_id,
            p.full_name,
            p.position,
            p.age,
            p.skill,
            c.id as contract_id,
            c.club_id,
            c.start_year,
            c.end_year,
            c.wage_per_year,
            c.status
        FROM fd.players p
        INNER JOIN fd.contracts c ON c.campaign_id = p.campaign_id AND c.player_id = p.id
        WHERE p.campaign_id = $1
          AND c.status = 'active'
        ORDER BY
            CASE p.position
                WHEN 'GK' THEN 1
                WHEN 'DEF' THEN 2
                WHEN 'MID' THEN 3
                WHEN 'FWD' THEN 4
                ELSE 5
            END,
            p.skill DESC,
            p.full_name
        "#,
        campaign_id
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    let players = rows
        .into_iter()
        .map(|row| PlayerWithContract {
            player: PlayerResponse {
                id: row.player_id,
                full_name: row.full_name,
                position: row.position,
                age: row.age,
                skill: row.skill,
            },
            contract: ContractResponse {
                id: row.contract_id,
                player_id: row.player_id,
                club_id: row.club_id,
                start_year: row.start_year,
                end_year: row.end_year,
                wage_per_year: row.wage_per_year,
                status: row.status,
            },
        })
        .collect();

    Ok(Json(SquadResponse { players }))
}

pub async fn sign_contract(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    Extension(identity): Extension<Identity>,
    Json(payload): Json<SignContractRequest>,
) -> Result<(StatusCode, Json<SignContractResponse>), ApiError> {
    if payload.wage_per_year < 1 || payload.wage_per_year > 100_000_000 {
        return Err(ApiError::bad_request("wage must be between 1 and 100000000"));
    }

    if payload.years < 1 || payload.years > 5 {
        return Err(ApiError::bad_request("contract years must be between 1 and 5"));
    }

    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!(
        "SELECT set_config('fd.telegram_id', $1, true)",
        identity.telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    let campaign = sqlx::query!(
        r#"
        SELECT current_year
        FROM fd.campaigns
        WHERE id = $1
        FOR UPDATE
        "#,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let current_year = campaign.current_year;

    expire_contracts(&mut tx, campaign_id, current_year).await?;

    let player = sqlx::query!(
        r#"
        SELECT id
        FROM fd.players
        WHERE campaign_id = $1 AND id = $2
        "#,
        campaign_id,
        payload.player_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let club = sqlx::query!(
        r#"
        SELECT id
        FROM fd.clubs
        WHERE campaign_id = $1
        ORDER BY id
        LIMIT 1
        "#,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let existing = sqlx::query!(
        r#"
        SELECT id, end_year, wage_per_year
        FROM fd.contracts
        WHERE campaign_id = $1
          AND player_id = $2
          AND status = 'active'
        "#,
        campaign_id,
        payload.player_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    let (contract_id, start_year, end_year, status_code) = if let Some(existing) = existing {
        let new_end_year = existing.end_year.max(current_year) + payload.years;

        sqlx::query!(
            r#"
            UPDATE fd.contracts
            SET end_year = $1, wage_per_year = $2
            WHERE campaign_id = $3 AND id = $4
            "#,
            new_end_year,
            payload.wage_per_year,
            campaign_id,
            existing.id
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

        (existing.id, current_year, new_end_year, StatusCode::OK)
    } else {
        let contract_id = Uuid::new_v4();
        let start_year = current_year;
        let end_year = current_year + payload.years;

        sqlx::query!(
            r#"
            INSERT INTO fd.contracts (campaign_id, id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL)
            "#,
            campaign_id,
            contract_id,
            payload.player_id,
            club.id,
            start_year,
            end_year,
            payload.wage_per_year
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            if let Some(db_err) = e.as_database_error() {
                if db_err.constraint() == Some("contracts_campaign_id_player_id_key") {
                    return ApiError::conflict("player already has an active contract");
                }
            }
            ApiError::internal().with_source(e)
        })?;

        (contract_id, start_year, end_year, StatusCode::CREATED)
    };

    tx.commit()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    Ok((
        status_code,
        Json(SignContractResponse {
            contract: ContractResponse {
                id: contract_id,
                player_id: payload.player_id,
                club_id: club.id,
                start_year,
                end_year,
                wage_per_year: payload.wage_per_year,
                status: "active".to_string(),
            },
        }),
    ))
}

pub async fn release_contract(
    State(state): State<AppState>,
    Path((campaign_id, player_id)): Path<(Uuid, Uuid)>,
    Extension(identity): Extension<Identity>,
) -> Result<StatusCode, ApiError> {
    let mut tx = state
        .db
        .begin()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    sqlx::query!(
        "SELECT set_config('fd.telegram_id', $1, true)",
        identity.telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    let campaign = sqlx::query!(
        r#"
        SELECT current_year
        FROM fd.campaigns
        WHERE id = $1
        FOR UPDATE
        "#,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let current_year = campaign.current_year;

    expire_contracts(&mut tx, campaign_id, current_year).await?;

    let contract = sqlx::query!(
        r#"
        SELECT id
        FROM fd.contracts
        WHERE campaign_id = $1
          AND player_id = $2
          AND status = 'active'
        "#,
        campaign_id,
        player_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?
    .ok_or_else(|| ApiError::not_found())?;

    let now = Utc::now();

    sqlx::query!(
        r#"
        UPDATE fd.contracts
        SET status = 'released', released_at = $1
        WHERE campaign_id = $2 AND id = $3
        "#,
        now,
        campaign_id,
        contract.id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::internal().with_source(e))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::internal().with_source(e))?;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;

    async fn setup_test_db() -> PgPool {
        let database_url =
            std::env::var("TEST_DATABASE_URL").expect("TEST_DATABASE_URL must be set");
        PgPool::connect(&database_url).await.unwrap()
    }

    async fn create_test_campaign(pool: &PgPool, telegram_id: i64) -> Uuid {
        let campaign_id = Uuid::new_v4();
        let seed: i64 = 12345;

        sqlx::query!(
            r#"
            SET LOCAL ROLE fd_runtime;
            SELECT set_config('fd.telegram_id', $1, true);
            "#,
            telegram_id.to_string()
        )
        .execute(pool)
        .await
        .unwrap();

        sqlx::query!(
            r#"
            INSERT INTO fd.campaigns (id, telegram_id, seed, current_year)
            VALUES ($1, $2, $3, 2024)
            "#,
            campaign_id,
            telegram_id,
            seed
        )
        .execute(pool)
        .await
        .unwrap();

        let club_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO fd.clubs (campaign_id, id, name, city, reputation)
            VALUES ($1, $2, 'Test FC', 'Test City', 50)
            "#,
            campaign_id,
            club_id
        )
        .execute(pool)
        .await
        .unwrap();

        campaign_id
    }

    #[tokio::test]
    async fn test_seed_squad_count() {
        let pool = setup_test_db().await;
        let telegram_id = 999001;
        let campaign_id = create_test_campaign(&pool, telegram_id).await;

        let mut tx = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL ROLE fd_runtime")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query!(
            "SELECT set_config('fd.telegram_id', $1, true)",
            telegram_id.to_string()
        )
        .execute(&mut *tx)
        .await
        .unwrap();

        let club_id = sqlx::query_scalar!(
            "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
            campaign_id
        )
        .fetch_one(&mut *tx)
        .await
        .unwrap();

        seed_squad(&mut tx, campaign_id, club_id, 12345, 2024)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();

        assert_eq!(count, 23);

        let gk_count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1 AND position = 'GK'",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(gk_count, 2);

        let def_count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1 AND position = 'DEF'",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(def_count, 8);

        let mid_count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1 AND position = 'MID'",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(mid_count, 8);

        let fwd_count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1 AND position = 'FWD'",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(fwd_count, 5);
    }

    #[tokio::test]
    async fn test_seed_deterministic() {
        let pool = setup_test_db().await;
        let telegram_id = 999002;
        let campaign_id_1 = create_test_campaign(&pool, telegram_id).await;
        let campaign_id_2 = create_test_campaign(&pool, telegram_id + 1).await;

        let mut tx1 = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL ROLE fd_runtime")
            .execute(&mut *tx1)
            .await
            .unwrap();
        sqlx::query!(
            "SELECT set_config('fd.telegram_id', $1, true)",
            telegram_id.to_string()
        )
        .execute(&mut *tx1)
        .await
        .unwrap();

        let club_id_1 = sqlx::query_scalar!(
            "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
            campaign_id_1
        )
        .fetch_one(&mut *tx1)
        .await
        .unwrap();

        seed_squad(&mut tx1, campaign_id_1, club_id_1, 12345, 2024)
            .await
            .unwrap();
        tx1.commit().await.unwrap();

        let mut tx2 = pool.begin().await.unwrap();
        sqlx::query!("SET LOCAL ROLE fd_runtime")
            .execute(&mut *tx2)
            .await
            .unwrap();
        sqlx::query!(
            "SELECT set_config('fd.telegram_id', $1, true)",
            (telegram_id + 1).to_string()
        )
        .execute(&mut *tx2)
        .await
        .unwrap();

        let club_id_2 = sqlx::query_scalar!(
            "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
            campaign_id_2
        )
        .fetch_one(&mut *tx2)
        .await
        .unwrap();

        seed_squad(&mut tx2, campaign_id_2, club_id_2, 12345, 2024)
            .await
            .unwrap();
        tx2.commit().await.unwrap();

        let players_1 = sqlx::query!(
            r#"
            SELECT full_name, position, age, skill
            FROM fd.players
            WHERE campaign_id = $1
            ORDER BY seed_index
            "#,
            campaign_id_1
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        let players_2 = sqlx::query!(
            r#"
            SELECT full_name, position, age, skill
            FROM fd.players
            WHERE campaign_id = $1
            ORDER BY seed_index
            "#,
            campaign_id_2
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(players_1.len(), players_2.len());
        for (p1, p2) in players_1.iter().zip(players_2.iter()) {
            assert_eq!(p1.full_name, p2.full_name);
            assert_eq!(p1.position, p2.position);
            assert_eq!(p1.age, p2.age);
            assert_eq!(p1.skill, p2.skill);
        }
    }

    #[tokio::test]
    async fn test_concurrent_seed_idempotent() {
        let pool = setup_test_db().await;
        let telegram_id = 999003;
        let campaign_id = create_test_campaign(&pool, telegram_id).await;

        let pool_clone = pool.clone();
        let campaign_id_clone = campaign_id;
        let handle1 = tokio::spawn(async move {
            let mut tx = pool_clone.begin().await.unwrap();
            sqlx::query!("SET LOCAL ROLE fd_runtime")
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query!(
                "SELECT set_config('fd.telegram_id', $1, true)",
                telegram_id.to_string()
            )
            .execute(&mut *tx)
            .await
            .unwrap();

            let club_id = sqlx::query_scalar!(
                "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
                campaign_id_clone
            )
            .fetch_one(&mut *tx)
            .await
            .unwrap();

            seed_squad(&mut tx, campaign_id_clone, club_id, 12345, 2024)
                .await
                .unwrap();
            tx.commit().await.unwrap();
        });

        let pool_clone = pool.clone();
        let handle2 = tokio::spawn(async move {
            let mut tx = pool_clone.begin().await.unwrap();
            sqlx::query!("SET LOCAL ROLE fd_runtime")
                .execute(&mut *tx)
                .await
                .unwrap();
            sqlx::query!(
                "SELECT set_config('fd.telegram_id', $1, true)",
                telegram_id.to_string()
            )
            .execute(&mut *tx)
            .await
            .unwrap();

            let club_id = sqlx::query_scalar!(
                "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
                campaign_id
            )
            .fetch_one(&mut *tx)
            .await
            .unwrap();

            seed_squad(&mut tx, campaign_id, club_id, 12345, 2024)
                .await
                .unwrap();
            tx.commit().await.unwrap();
        });

        handle1.await.unwrap();
        handle2.await.unwrap();

        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1",
            campaign_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap();

        assert_eq!(count, 23);
    }
}
