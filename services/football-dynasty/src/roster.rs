use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{auth::Identity, errors::ApiError, state::AppState};

const POSITION_COUNTS: &[(&str, usize)] = &[("GK", 2), ("DEF", 8), ("MID", 8), ("FWD", 5)];
const SEEDED_WAGE_PER_YEAR: i64 = 50_000;
const SEEDED_CONTRACT_YEARS: i32 = 3;
const MAX_WAGE_PER_YEAR: i64 = 100_000_000;

type ApiResult<T> = Result<T, ApiError>;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/squad",
            get(get_squad),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/contracts",
            post(sign_contract),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/contracts/{player_id}/release",
            post(release_contract),
        )
}

#[derive(Debug, Serialize)]
pub struct PlayerResponse {
    pub id: Uuid,
    pub full_name: String,
    pub position: String,
    pub age: i32,
    pub skill: i32,
    pub seed_index: i32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ContractResponse {
    pub id: Uuid,
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub start_year: i32,
    pub end_year: i32,
    pub wage_per_year: i64,
    pub status: String,
    pub released_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct SquadResponse {
    pub players: Vec<PlayerResponse>,
    pub contracts: Vec<ContractResponse>,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub wage_per_year: i64,
    pub years: i32,
}

#[derive(Debug, Serialize)]
pub struct ContractActionResponse {
    pub contract: ContractResponse,
}

#[derive(Debug, FromRow)]
struct CampaignRow {
    seed: i64,
    current_year: i32,
}

#[derive(Debug, FromRow)]
struct SquadRow {
    player_id: Uuid,
    full_name: String,
    position: String,
    age: i32,
    skill: i32,
    seed_index: i32,
    contract_id: Option<Uuid>,
    contract_player_id: Option<Uuid>,
    club_id: Option<Uuid>,
    start_year: Option<i32>,
    end_year: Option<i32>,
    wage_per_year: Option<i64>,
    status: Option<String>,
    released_at: Option<DateTime<Utc>>,
}

fn deterministic_digest(campaign_id: Uuid, seed: i64, domain: &str, index: usize) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.to_be_bytes());
    hasher.update(domain.as_bytes());
    hasher.update((index as u64).to_be_bytes());
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 32];
    bytes.copy_from_slice(&digest);
    bytes
}

fn deterministic_uuid(campaign_id: Uuid, seed: i64, domain: &str, index: usize) -> Uuid {
    let digest = deterministic_digest(campaign_id, seed, domain, index);
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn deterministic_name(campaign_id: Uuid, seed: i64, index: usize) -> String {
    const FIRST_NAMES: &[&str] = &[
        "James", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas",
        "Charles", "Daniel", "Matthew", "Anthony", "Mark", "Steven", "Paul", "Andrew",
        "Joshua", "Kevin", "Brian", "George", "Timothy", "Ronald", "Edward", "Peter",
    ];
    const LAST_NAMES: &[&str] = &[
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
        "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
    ];
    let digest = deterministic_digest(campaign_id, seed, "name", index);
    let first = FIRST_NAMES[digest[0] as usize % FIRST_NAMES.len()];
    let last = LAST_NAMES[digest[1] as usize % LAST_NAMES.len()];
    format!("{first} {last}")
}

fn deterministic_age(campaign_id: Uuid, seed: i64, index: usize) -> i32 {
    let digest = deterministic_digest(campaign_id, seed, "age", index);
    18 + i32::from(digest[0] % 18)
}

fn deterministic_skill(campaign_id: Uuid, seed: i64, index: usize) -> i32 {
    let digest = deterministic_digest(campaign_id, seed, "skill", index);
    45 + i32::from(digest[0] % 51)
}

async fn set_owner_scope(
    tx: &mut Transaction<'_, Postgres>,
    telegram_id: i64,
) -> ApiResult<()> {
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;

    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(telegram_id.to_string())
        .execute(&mut **tx)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

async fn lock_campaign(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
) -> ApiResult<CampaignRow> {
    sqlx::query_as::<_, CampaignRow>(
        "SELECT seed, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE",
    )
    .bind(campaign_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(ApiError::not_found)
}

async fn expire_contracts(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    current_year: i32,
) -> ApiResult<()> {
    sqlx::query(
        "UPDATE fd.contracts
         SET status = 'expired'
         WHERE campaign_id = $1
           AND status = 'active'
           AND end_year < $2",
    )
    .bind(campaign_id)
    .bind(current_year)
    .execute(&mut **tx)
    .await
    .map_err(ApiError::from)?;

    Ok(())
}

async fn seed_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    club_id: Uuid,
    seed: i64,
    current_year: i32,
) -> ApiResult<()> {
    let mut index = 0_usize;

    for (position, count) in POSITION_COUNTS {
        for _ in 0..*count {
            let player_id = deterministic_uuid(campaign_id, seed, "player", index);
            let contract_id = deterministic_uuid(campaign_id, seed, "contract", index);
            let full_name = deterministic_name(campaign_id, seed, index);
            let age = deterministic_age(campaign_id, seed, index);
            let skill = deterministic_skill(campaign_id, seed, index);
            let seed_index = index as i32;
            let end_year = current_year
                .checked_add(SEEDED_CONTRACT_YEARS)
                .ok_or_else(ApiError::internal)?;
            let wage_per_year = SEEDED_WAGE_PER_YEAR + i64::from(skill) * 100;

            sqlx::query(
                "INSERT INTO fd.players
                    (campaign_id, id, full_name, position, age, skill, seed_index)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (campaign_id, seed_index) DO NOTHING",
            )
            .bind(campaign_id)
            .bind(player_id)
            .bind(full_name)
            .bind(*position)
            .bind(age)
            .bind(skill)
            .bind(seed_index)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;

            sqlx::query(
                "INSERT INTO fd.contracts
                    (campaign_id, id, player_id, club_id, start_year, end_year,
                     wage_per_year, status, released_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL)
                 ON CONFLICT (campaign_id, player_id)
                     WHERE status = 'active' DO NOTHING",
            )
            .bind(campaign_id)
            .bind(contract_id)
            .bind(player_id)
            .bind(club_id)
            .bind(current_year)
            .bind(end_year)
            .bind(wage_per_year)
            .execute(&mut **tx)
            .await
            .map_err(ApiError::from)?;

            index += 1;
        }
    }

    Ok(())
}

pub async fn get_squad(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    Extension(identity): Extension<Identity>,
) -> ApiResult<Json<SquadResponse>> {
    let mut tx = state.db.begin().await.map_err(ApiError::from)?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;

    let campaign = lock_campaign(&mut tx, campaign_id).await?;
    let player_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(ApiError::from)?;

    if player_count == 0 {
        let club_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM fd.clubs WHERE campaign_id = $1 ORDER BY id LIMIT 1",
        )
        .bind(campaign_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(ApiError::not_found)?;

        seed_squad(
            &mut tx,
            campaign_id,
            club_id,
            campaign.seed,
            campaign.current_year,
        )
        .await?;
    } else if player_count != 23 {
        return Err(ApiError::internal());
    }

    expire_contracts(&mut tx, campaign_id, campaign.current_year).await?;

    let rows = sqlx::query_as::<_, SquadRow>(
        "SELECT
            p.id AS player_id,
            p.full_name,
            p.position,
            p.age,
            p.skill,
            p.seed_index,
            c.id AS contract_id,
            c.player_id AS contract_player_id,
            c.club_id,
            c.start_year,
            c.end_year,
            c.wage_per_year,
            c.status,
            c.released_at
         FROM fd.players p
         LEFT JOIN fd.contracts c
           ON c.campaign_id = p.campaign_id
          AND c.player_id = p.id
          AND c.status = 'active'
         WHERE p.campaign_id = $1
         ORDER BY
            CASE p.position
                WHEN 'GK' THEN 1
                WHEN 'DEF' THEN 2
                WHEN 'MID' THEN 3
                WHEN 'FWD' THEN 4
                ELSE 5
            END,
            p.seed_index",
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(ApiError::from)?;

    tx.commit().await.map_err(ApiError::from)?;

    let mut players = Vec::with_capacity(rows.len());
    let mut contracts = Vec::with_capacity(rows.len());

    for row in rows {
        players.push(PlayerResponse {
            id: row.player_id,
            full_name: row.full_name,
            position: row.position,
            age: row.age,
            skill: row.skill,
            seed_index: row.seed_index,
        });

        if let Some(contract_id) = row.contract_id {
            let contract = ContractResponse {
                id: contract_id,
                player_id: row.contract_player_id.ok_or_else(ApiError::internal)?,
                club_id: row.club_id.ok_or_else(ApiError::internal)?,
                start_year: row.start_year.ok_or_else(ApiError::internal)?,
                end_year: row.end_year.ok_or_else(ApiError::internal)?,
                wage_per_year: row.wage_per_year.ok_or_else(ApiError::internal)?,
                status: row.status.ok_or_else(ApiError::internal)?,
                released_at: row.released_at,
            };
            contracts.push(contract);
        }
    }

    Ok(Json(SquadResponse {
        players,
        contracts,
    }))
}

pub async fn sign_contract(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    Extension(identity): Extension<Identity>,
    Json(payload): Json<SignContractRequest>,
) -> ApiResult<(StatusCode, Json<ContractActionResponse>)> {
    if !(1..=MAX_WAGE_PER_YEAR).contains(&payload.wage_per_year) {
        return Err(ApiError::bad_request("wage_per_year_out_of_range"));
    }
    if !(1..=5).contains(&payload.years) {
        return Err(ApiError::bad_request("contract_years_out_of_range"));
    }

    let mut tx = state.db.begin().await.map_err(ApiError::from)?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let campaign = lock_campaign(&mut tx, campaign_id).await?;
    expire_contracts(&mut tx, campaign_id, campaign.current_year).await?;

    let player_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM fd.players WHERE campaign_id = $1 AND id = $2
         )",
    )
    .bind(campaign_id)
    .bind(payload.player_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(ApiError::from)?;

    if !player_exists {
        return Err(ApiError::not_found());
    }

    let club_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.clubs WHERE campaign_id = $1 ORDER BY id LIMIT 1",
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(ApiError::not_found)?;

    let existing = sqlx::query_as::<_, ContractResponse>(
        "SELECT id, player_id, club_id, start_year, end_year, wage_per_year,
                status, released_at
         FROM fd.contracts
         WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'
         FOR UPDATE",
    )
    .bind(campaign_id)
    .bind(payload.player_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::from)?;

    let (contract, status_code) = if let Some(existing) = existing {
        let end_year = existing
            .end_year
            .max(campaign.current_year)
            .checked_add(payload.years)
            .ok_or_else(ApiError::internal)?;

        sqlx::query(
            "UPDATE fd.contracts
             SET end_year = $1, wage_per_year = $2
             WHERE campaign_id = $3 AND id = $4",
        )
        .bind(end_year)
        .bind(payload.wage_per_year)
        .bind(campaign_id)
        .bind(existing.id)
        .execute(&mut *tx)
        .await
        .map_err(ApiError::from)?;

        (
            ContractResponse {
                end_year,
                wage_per_year: payload.wage_per_year,
                status: "active".to_string(),
                released_at: None,
                ..existing
            },
            StatusCode::OK,
        )
    } else {
        let end_year = campaign
            .current_year
            .checked_add(payload.years)
            .ok_or_else(ApiError::internal)?;
        let contract = ContractResponse {
            id: Uuid::new_v4(),
            player_id: payload.player_id,
            club_id,
            start_year: campaign.current_year,
            end_year,
            wage_per_year: payload.wage_per_year,
            status: "active".to_string(),
            released_at: None,
        };

        sqlx::query(
            "INSERT INTO fd.contracts
                (campaign_id, id, player_id, club_id, start_year, end_year,
                 wage_per_year, status, released_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NULL)",
        )
        .bind(campaign_id)
        .bind(contract.id)
        .bind(contract.player_id)
        .bind(contract.club_id)
        .bind(contract.start_year)
        .bind(contract.end_year)
        .bind(contract.wage_per_year)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if let sqlx::Error::Database(database_error) = &error {
                if database_error.constraint() == Some("idx_contracts_active_player") {
                    return ApiError::conflict("player_already_has_active_contract");
                }
            }
            ApiError::from(error)
        })?;

        (contract, StatusCode::CREATED)
    };

    tx.commit().await.map_err(ApiError::from)?;

    Ok((
        status_code,
        Json(ContractActionResponse { contract }),
    ))
}

pub async fn release_contract(
    State(state): State<AppState>,
    Path((campaign_id, player_id)): Path<(Uuid, Uuid)>,
    Extension(identity): Extension<Identity>,
) -> ApiResult<Json<ContractActionResponse>> {
    let mut tx = state.db.begin().await.map_err(ApiError::from)?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let campaign = lock_campaign(&mut tx, campaign_id).await?;
    expire_contracts(&mut tx, campaign_id, campaign.current_year).await?;

    let contract = sqlx::query_as::<_, ContractResponse>(
        "UPDATE fd.contracts
         SET status = 'released', released_at = $1
         WHERE campaign_id = $2 AND player_id = $3 AND status = 'active'
         RETURNING id, player_id, club_id, start_year, end_year, wage_per_year,
                   status, released_at",
    )
    .bind(Utc::now())
    .bind(campaign_id)
    .bind(player_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(ApiError::not_found)?;

    tx.commit().await.map_err(ApiError::from)?;

    Ok(Json(ContractActionResponse { contract }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_seed_data_is_stable_and_domain_separated() {
        let campaign_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let seed = 123_456_i64;
        let player_a = deterministic_uuid(campaign_id, seed, "player", 0);
        let player_b = deterministic_uuid(campaign_id, seed, "player", 0);
        let contract = deterministic_uuid(campaign_id, seed, "contract", 0);

        assert_eq!(player_a, player_b);
        assert_ne!(player_a, contract);
        assert_ne!(
            player_a,
            deterministic_uuid(campaign_id, seed + 1, "player", 0)
        );
    }

    #[test]
    fn generated_roster_has_exact_position_counts() {
        assert_eq!(POSITION_COUNTS.iter().map(|(_, count)| count).sum::<usize>(), 23);
        assert_eq!(POSITION_COUNTS[0], ("GK", 2));
        assert_eq!(POSITION_COUNTS[1], ("DEF", 8));
        assert_eq!(POSITION_COUNTS[2], ("MID", 8));
        assert_eq!(POSITION_COUNTS[3], ("FWD", 5));
    }
}
