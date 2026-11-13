use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::{
    auth::Identity,
    error::{ApiError, Result},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/campaigns/:campaign_id/squad", get(get_squad))
        .route("/campaigns/:campaign_id/contracts", post(contract_action))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "fd.position", rename_all = "SCREAMING_SNAKE_CASE")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum Position {
    Gk,
    Def,
    Mid,
    Fwd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "fd.contract_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
enum ContractStatus {
    Active,
    Expired,
    Released,
}

#[derive(Debug, Serialize)]
struct Player {
    id: Uuid,
    campaign_id: Uuid,
    name: String,
    position: Position,
    skill: i32,
}

#[derive(Debug, Serialize)]
struct Contract {
    id: Uuid,
    campaign_id: Uuid,
    player_id: Uuid,
    club_id: Uuid,
    start_year: i32,
    end_year: i32,
    wage_per_year: i32,
    status: ContractStatus,
    released_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
struct SquadMember {
    player: Player,
    contract: Option<Contract>,
}

#[derive(Debug, Serialize)]
struct Squad {
    members: Vec<SquadMember>,
}

async fn get_squad(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    identity: Identity,
) -> Result<Json<Squad>> {
    let mut tx = state.db.begin().await.map_err(|_| ApiError::internal())?;

    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal())?;

    sqlx::query("SELECT set_config('fd.telegram_id', $1::text, true)")
        .bind(identity.telegram_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal())?;

    let campaign: Option<(Uuid, Uuid, i32)> = sqlx::query_as(
        "SELECT id, seed, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE",
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let (campaign_id, seed, current_year) = campaign.ok_or_else(|| ApiError::not_found())?;

    let player_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| ApiError::internal())?;

    if player_count == 0 {
        seed_squad(&mut tx, campaign_id, seed, current_year).await?;
    }

    expire_contracts(&mut tx, campaign_id, current_year).await?;

    let players: Vec<Player> = sqlx::query_as(
        "SELECT id, campaign_id, name, position, skill FROM fd.players WHERE campaign_id = $1 ORDER BY position, name",
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let contracts: Vec<Contract> = sqlx::query_as(
        "SELECT id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at
         FROM fd.contracts
         WHERE campaign_id = $1 AND status = 'active'",
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|_| ApiError::internal())?;

    tx.commit().await.map_err(|_| ApiError::internal())?;

    let contract_map: std::collections::HashMap<Uuid, Contract> =
        contracts.into_iter().map(|c| (c.player_id, c)).collect();

    let members = players
        .into_iter()
        .map(|player| {
            let contract = contract_map.get(&player.id).cloned();
            SquadMember { player, contract }
        })
        .collect();

    Ok(Json(Squad { members }))
}

async fn seed_squad(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    seed: Uuid,
    current_year: i32,
) -> Result<()> {
    let club_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.clubs WHERE campaign_id = $1 AND is_player_club = true",
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let positions = vec![
        (Position::Gk, 2),
        (Position::Def, 8),
        (Position::Mid, 8),
        (Position::Fwd, 5),
    ];

    let first_names = vec![
        "James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas",
        "Charles", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew",
        "Joshua", "Kenneth", "Kevin", "Brian", "George", "Edward",
    ];

    let last_names = vec![
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
        "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Walker", "Hall",
    ];

    let mut index = 0u32;
    for (position, count) in positions {
        for _ in 0..count {
            let player_id = deterministic_uuid(&campaign_id, &seed, "player", index);
            let contract_id = deterministic_uuid(&campaign_id, &seed, "contract", index);

            let name_seed = deterministic_hash(&campaign_id, &seed, "name", index);
            let first_idx = (name_seed % first_names.len() as u64) as usize;
            let last_idx = ((name_seed / first_names.len() as u64) % last_names.len() as u64)
                as usize;
            let name = format!("{} {}", first_names[first_idx], last_names[last_idx]);

            let skill_seed = deterministic_hash(&campaign_id, &seed, "skill", index);
            let skill = 50 + (skill_seed.rem_euclid(31) as i32);

            sqlx::query(
                "INSERT INTO fd.players (id, campaign_id, name, position, skill)
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(player_id)
            .bind(campaign_id)
            .bind(&name)
            .bind(position)
            .bind(skill)
            .execute(&mut **tx)
            .await
            .map_err(|_| ApiError::internal())?;

            sqlx::query(
                "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')",
            )
            .bind(contract_id)
            .bind(campaign_id)
            .bind(player_id)
            .bind(club_id)
            .bind(current_year)
            .bind(current_year + 3)
            .bind(100_000)
            .execute(&mut **tx)
            .await
            .map_err(|_| ApiError::internal())?;

            index += 1;
        }
    }

    Ok(())
}

fn deterministic_uuid(campaign_id: &Uuid, seed: &Uuid, domain: &str, index: u32) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.as_bytes());
    hasher.update(domain.as_bytes());
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();

    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[0..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn deterministic_hash(campaign_id: &Uuid, seed: &Uuid, domain: &str, index: u32) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(campaign_id.as_bytes());
    hasher.update(seed.as_bytes());
    hasher.update(domain.as_bytes());
    hasher.update(index.to_le_bytes());
    let hash = hasher.finalize();
    u64::from_le_bytes([
        hash[0], hash[1], hash[2], hash[3], hash[4], hash[5], hash[6], hash[7],
    ])
}

async fn expire_contracts(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    current_year: i32,
) -> Result<()> {
    sqlx::query(
        "UPDATE fd.contracts
         SET status = 'expired'
         WHERE campaign_id = $1 AND status = 'active' AND end_year < $2",
    )
    .bind(campaign_id)
    .bind(current_year)
    .execute(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum ContractAction {
    Sign {
        player_id: Uuid,
        wage_per_year: i32,
        years: i32,
    },
    Renew {
        player_id: Uuid,
        wage_per_year: i32,
        years: i32,
    },
    Release {
        player_id: Uuid,
    },
}

#[derive(Debug, Serialize)]
struct ContractResponse {
    contract: Contract,
}

async fn contract_action(
    State(state): State<AppState>,
    Path(campaign_id): Path<Uuid>,
    identity: Identity,
    Json(action): Json<ContractAction>,
) -> Result<Json<ContractResponse>> {
    let mut tx = state.db.begin().await.map_err(|_| ApiError::internal())?;

    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal())?;

    sqlx::query("SELECT set_config('fd.telegram_id', $1::text, true)")
        .bind(identity.telegram_id.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::internal())?;

    let campaign: Option<(Uuid, i32)> =
        sqlx::query_as("SELECT id, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE")
            .bind(campaign_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| ApiError::internal())?;

    let (campaign_id, current_year) = campaign.ok_or_else(|| ApiError::not_found())?;

    expire_contracts(&mut tx, campaign_id, current_year).await?;

    let contract = match action {
        ContractAction::Sign {
            player_id,
            wage_per_year,
            years,
        } => sign_contract(&mut tx, campaign_id, current_year, player_id, wage_per_year, years)
            .await?,
        ContractAction::Renew {
            player_id,
            wage_per_year,
            years,
        } => renew_contract(&mut tx, campaign_id, current_year, player_id, wage_per_year, years)
            .await?,
        ContractAction::Release { player_id } => {
            release_contract(&mut tx, campaign_id, player_id).await?
        }
    };

    tx.commit().await.map_err(|_| ApiError::internal())?;

    Ok(Json(ContractResponse { contract }))
}

async fn sign_contract(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    current_year: i32,
    player_id: Uuid,
    wage_per_year: i32,
    years: i32,
) -> Result<Contract> {
    if wage_per_year <= 0 || wage_per_year > 10_000_000 {
        return Err(ApiError::bad_request("wage must be between 1 and 10,000,000"));
    }

    if years <= 0 || years > 5 {
        return Err(ApiError::bad_request("years must be between 1 and 5"));
    }

    let player_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fd.players WHERE campaign_id = $1 AND id = $2)")
            .bind(campaign_id)
            .bind(player_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|_| ApiError::internal())?;

    if !player_exists {
        return Err(ApiError::not_found());
    }

    let active_contract: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM fd.contracts WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'",
    )
    .bind(campaign_id)
    .bind(player_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    if active_contract.is_some() {
        return Err(ApiError::conflict("player already has an active contract"));
    }

    let club_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.clubs WHERE campaign_id = $1 AND is_player_club = true",
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let contract_id = Uuid::new_v4();
    let start_year = current_year;
    let end_year = current_year + years;

    let contract = sqlx::query_as(
        "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at",
    )
    .bind(contract_id)
    .bind(campaign_id)
    .bind(player_id)
    .bind(club_id)
    .bind(start_year)
    .bind(end_year)
    .bind(wage_per_year)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    Ok(contract)
}

async fn renew_contract(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    current_year: i32,
    player_id: Uuid,
    wage_per_year: i32,
    years: i32,
) -> Result<Contract> {
    if wage_per_year <= 0 || wage_per_year > 10_000_000 {
        return Err(ApiError::bad_request("wage must be between 1 and 10,000,000"));
    }

    if years <= 0 || years > 5 {
        return Err(ApiError::bad_request("years must be between 1 and 5"));
    }

    let existing: Option<(Uuid, i32, Uuid)> = sqlx::query_as(
        "SELECT id, end_year, club_id FROM fd.contracts
         WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'",
    )
    .bind(campaign_id)
    .bind(player_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let (old_contract_id, old_end_year, club_id) =
        existing.ok_or_else(|| ApiError::not_found())?;

    sqlx::query("UPDATE fd.contracts SET status = 'expired' WHERE id = $1")
        .bind(old_contract_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| ApiError::internal())?;

    let new_contract_id = Uuid::new_v4();
    let start_year = std::cmp::max(old_end_year, current_year);
    let end_year = start_year + years;

    let contract = sqlx::query_as(
        "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
         RETURNING id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at",
    )
    .bind(new_contract_id)
    .bind(campaign_id)
    .bind(player_id)
    .bind(club_id)
    .bind(start_year)
    .bind(end_year)
    .bind(wage_per_year)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    Ok(contract)
}

async fn release_contract(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    player_id: Uuid,
) -> Result<Contract> {
    let existing: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM fd.contracts
         WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'",
    )
    .bind(campaign_id)
    .bind(player_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    let contract_id = existing.ok_or_else(|| ApiError::not_found())?;

    let contract = sqlx::query_as(
        "UPDATE fd.contracts
         SET status = 'released', released_at = now()
         WHERE id = $1
         RETURNING id, campaign_id, player_id, club_id, start_year, end_year, wage_per_year, status, released_at",
    )
    .bind(contract_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| ApiError::internal())?;

    Ok(contract)
}

impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for Player {
    fn from_row(row: &sqlx::postgres::PgRow) -> sqlx::Result<Self> {
        use sqlx::Row;
        Ok(Player {
            id: row.try_get("id")?,
            campaign_id: row.try_get("campaign_id")?,
            name: row.try_get("name")?,
            position: row.try_get("position")?,
            skill: row.try_get("skill")?,
        })
    }
}

impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for Contract {
    fn from_row(row: &sqlx::postgres::PgRow) -> sqlx::Result<Self> {
        use sqlx::Row;
        Ok(Contract {
            id: row.try_get("id")?,
            campaign_id: row.try_get("campaign_id")?,
            player_id: row.try_get("player_id")?,
            club_id: row.try_get("club_id")?,
            start_year: row.try_get("start_year")?,
            end_year: row.try_get("end_year")?,
            wage_per_year: row.try_get("wage_per_year")?,
            status: row.try_get("status")?,
            released_at: row.try_get("released_at")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_uuid_stability() {
        let campaign_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let seed = Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap();

        let id1 = deterministic_uuid(&campaign_id, &seed, "player", 0);
        let id2 = deterministic_uuid(&campaign_id, &seed, "player", 0);
        assert_eq!(id1, id2);

        let id3 = deterministic_uuid(&campaign_id, &seed, "player", 1);
        assert_ne!(id1, id3);

        let id4 = deterministic_uuid(&campaign_id, &seed, "contract", 0);
        assert_ne!(id1, id4);
    }

    #[test]
    fn test_deterministic_hash_no_overflow() {
        let campaign_id = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap();
        let seed = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff").unwrap();

        let hash = deterministic_hash(&campaign_id, &seed, "skill", u32::MAX);
        let _skill = 50 + (hash.rem_euclid(31) as i32);
    }

    #[test]
    fn test_position_distribution() {
        let positions = vec![
            (Position::Gk, 2),
            (Position::Def, 8),
            (Position::Mid, 8),
            (Position::Fwd, 5),
        ];

        let total: usize = positions.iter().map(|(_, count)| count).sum();
        assert_eq!(total, 23);
    }
}
