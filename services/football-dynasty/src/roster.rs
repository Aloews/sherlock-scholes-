use axum::{
    extract::{Path, State},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{errors::ApiError, identity::Identity, AppState};

// ============================================================================
// Domain Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub club_id: Uuid,
    pub name: String,
    pub position: String,
    pub age: i32,
    pub ability: i32,
    pub seed_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contract {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub wage_per_week: i32,
    pub start_year: i32,
    pub end_year: i32,
    pub status: String,
    pub released_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct SquadResponse {
    pub players: Vec<Player>,
    pub contracts: Vec<Contract>,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub wage_per_week: i32,
    pub years: i32,
}

// ============================================================================
// GET /api/v1/campaigns/{campaign_id}/squad
// ============================================================================

pub async fn get_squad(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<SquadResponse>, ApiError> {
    let mut tx = state.pool.begin().await?;

    set_transaction_scope(&mut tx, identity.telegram_id).await?;

    let campaign: CampaignRow = sqlx::query_as(
        "SELECT id, owner_telegram_id, seed, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE"
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    if campaign.owner_telegram_id != identity.telegram_id {
        return Err(ApiError::Forbidden);
    }

    let existing_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1"
    )
    .bind(campaign_id)
    .fetch_one(&mut *tx)
    .await?;

    if existing_count == 0 {
        seed_squad(&mut tx, campaign_id, campaign.seed).await?;
    }

    expire_contracts(&mut tx, campaign_id, campaign.current_year).await?;

    let players: Vec<Player> = sqlx::query_as(
        "SELECT id, campaign_id, club_id, name, position, age, ability, seed_index
         FROM fd.players
         WHERE campaign_id = $1
         ORDER BY seed_index"
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await?;

    let contracts: Vec<Contract> = sqlx::query_as(
        "SELECT id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status, released_at
         FROM fd.contracts
         WHERE campaign_id = $1 AND status = 'active'
         ORDER BY player_id"
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(SquadResponse { players, contracts }))
}

// ============================================================================
// POST /api/v1/campaigns/{campaign_id}/contracts
// ============================================================================

pub async fn sign_contract(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    Json(req): Json<SignContractRequest>,
) -> Result<Json<Contract>, ApiError> {
    if req.years < 1 || req.years > 5 {
        return Err(ApiError::BadRequest("years must be between 1 and 5".into()));
    }

    if req.wage_per_week <= 0 || req.wage_per_week > 1_000_000 {
        return Err(ApiError::BadRequest("wage_per_week must be positive and bounded".into()));
    }

    let mut tx = state.pool.begin().await?;

    set_transaction_scope(&mut tx, identity.telegram_id).await?;

    let campaign: CampaignRow = sqlx::query_as(
        "SELECT id, owner_telegram_id, seed, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE"
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    if campaign.owner_telegram_id != identity.telegram_id {
        return Err(ApiError::Forbidden);
    }

    let player: PlayerRow = sqlx::query_as(
        "SELECT id, campaign_id, club_id FROM fd.players WHERE id = $1 FOR UPDATE"
    )
    .bind(req.player_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    if player.campaign_id != campaign_id {
        return Err(ApiError::BadRequest("player does not belong to this campaign".into()));
    }

    let existing: Option<ExistingContractRow> = sqlx::query_as(
        "SELECT id, status, end_year FROM fd.contracts WHERE player_id = $1 AND status = 'active' FOR UPDATE"
    )
    .bind(req.player_id)
    .fetch_optional(&mut *tx)
    .await?;

    let start_year = campaign.current_year;
    let end_year = start_year + req.years;

    let contract_id = if let Some(existing_contract) = existing {
        if existing_contract.end_year >= end_year {
            return Err(ApiError::BadRequest("existing contract already covers this period".into()));
        }

        sqlx::query(
            "UPDATE fd.contracts SET end_year = $1, wage_per_week = $2 WHERE id = $3"
        )
        .bind(end_year)
        .bind(req.wage_per_week)
        .bind(existing_contract.id)
        .execute(&mut *tx)
        .await?;

        existing_contract.id
    } else {
        let new_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')"
        )
        .bind(new_id)
        .bind(campaign_id)
        .bind(req.player_id)
        .bind(player.club_id)
        .bind(req.wage_per_week)
        .bind(start_year)
        .bind(end_year)
        .execute(&mut *tx)
        .await?;

        new_id
    };

    let contract: Contract = sqlx::query_as(
        "SELECT id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status, released_at
         FROM fd.contracts WHERE id = $1"
    )
    .bind(contract_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(contract))
}

// ============================================================================
// POST /api/v1/campaigns/{campaign_id}/contracts/{player_id}/release
// ============================================================================

pub async fn release_contract(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, player_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Contract>, ApiError> {
    let mut tx = state.pool.begin().await?;

    set_transaction_scope(&mut tx, identity.telegram_id).await?;

    let campaign: CampaignRow = sqlx::query_as(
        "SELECT id, owner_telegram_id, seed, current_year FROM fd.campaigns WHERE id = $1 FOR UPDATE"
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    if campaign.owner_telegram_id != identity.telegram_id {
        return Err(ApiError::Forbidden);
    }

    let player: PlayerRow = sqlx::query_as(
        "SELECT id, campaign_id, club_id FROM fd.players WHERE id = $1 FOR UPDATE"
    )
    .bind(player_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    if player.campaign_id != campaign_id {
        return Err(ApiError::BadRequest("player does not belong to this campaign".into()));
    }

    let contract_id: Uuid = sqlx::query_scalar(
        "UPDATE fd.contracts SET status = 'released', released_at = NOW()
         WHERE player_id = $1 AND status = 'active'
         RETURNING id"
    )
    .bind(player_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::NotFound)?;

    let contract: Contract = sqlx::query_as(
        "SELECT id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status, released_at
         FROM fd.contracts WHERE id = $1"
    )
    .bind(contract_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(contract))
}

// ============================================================================
// Internal Helpers
// ============================================================================

#[derive(sqlx::FromRow)]
struct CampaignRow {
    id: Uuid,
    owner_telegram_id: i64,
    seed: i64,
    current_year: i32,
}

#[derive(sqlx::FromRow)]
struct PlayerRow {
    id: Uuid,
    campaign_id: Uuid,
    club_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct ExistingContractRow {
    id: Uuid,
    status: String,
    end_year: i32,
}

async fn set_transaction_scope(
    tx: &mut Transaction<'_, Postgres>,
    telegram_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut **tx)
        .await?;

    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(telegram_id.to_string())
        .execute(&mut **tx)
        .await?;

    Ok(())
}

async fn expire_contracts(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    current_year: i32,
) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE fd.contracts SET status = 'expired'
         WHERE campaign_id = $1 AND status = 'active' AND end_year < $2"
    )
    .bind(campaign_id)
    .bind(current_year)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn seed_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    seed: i64,
) -> Result<(), ApiError> {
    let club_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1"
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await?;

    let start_year: i32 = sqlx::query_scalar(
        "SELECT current_year FROM fd.campaigns WHERE id = $1"
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await?;

    let players = generate_players(campaign_id, club_id, seed);

    for player in &players {
        sqlx::query(
            "INSERT INTO fd.players (id, campaign_id, club_id, name, position, age, ability, seed_index)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
        )
        .bind(player.id)
        .bind(player.campaign_id)
        .bind(player.club_id)
        .bind(&player.name)
        .bind(&player.position)
        .bind(player.age)
        .bind(player.ability)
        .bind(player.seed_index)
        .execute(&mut **tx)
        .await?;

        let contract_id = Uuid::new_v4();
        let base_wage = 1000 + (player.ability * 50);
        let end_year = start_year + 3;

        sqlx::query(
            "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')"
        )
        .bind(contract_id)
        .bind(campaign_id)
        .bind(player.id)
        .bind(club_id)
        .bind(base_wage)
        .bind(start_year)
        .bind(end_year)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

fn generate_players(campaign_id: Uuid, club_id: Uuid, seed: i64) -> Vec<Player> {
    let mut players = Vec::new();
    let mut index = 0;

    let positions = [
        ("GK", 2),
        ("DEF", 8),
        ("MID", 8),
        ("FWD", 5),
    ];

    for (position, count) in positions {
        for i in 0..count {
            let player_seed = seed.wrapping_add((index as i64).wrapping_mul(97));
            let id = deterministic_uuid(campaign_id, index);
            let name = generate_name(player_seed, index);
            let age = 18 + ((player_seed.abs() % 15) as i32);
            let ability = 40 + ((player_seed.wrapping_mul(13).abs() % 40) as i32);

            players.push(Player {
                id,
                campaign_id,
                club_id,
                name,
                position: position.to_string(),
                age,
                ability,
                seed_index: index,
            });

            index += 1;
        }
    }

    players
}

fn deterministic_uuid(campaign_id: Uuid, index: i32) -> Uuid {
    let campaign_bytes = campaign_id.as_bytes();
    let mut bytes = [0u8; 16];

    for i in 0..16 {
        bytes[i] = campaign_bytes[i]
            .wrapping_add((index as u8).wrapping_mul(i as u8 + 1));
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    Uuid::from_bytes(bytes)
}

fn generate_name(seed: i64, index: i32) -> String {
    let first_names = [
        "Oliver", "Jack", "Harry", "Jacob", "Charlie", "Thomas", "George", "Oscar",
        "James", "William", "Noah", "Alfie", "Joshua", "Muhammad", "Henry", "Leo",
        "Archie", "Ethan", "Joseph", "Freddie", "Samuel", "Alexander", "Logan", "Max",
        "Lucas", "Mason", "Isaac", "Benjamin", "Harrison", "Edward", "Sebastian", "Daniel",
    ];

    let last_names = [
        "Smith", "Jones", "Williams", "Brown", "Taylor", "Davies", "Wilson", "Evans",
        "Thomas", "Roberts", "Johnson", "Lewis", "Walker", "Robinson", "Wood", "Thompson",
        "White", "Watson", "Jackson", "Wright", "Green", "Harris", "Cooper", "King",
        "Lee", "Martin", "Clarke", "James", "Morgan", "Hughes", "Edwards", "Hill",
    ];

    let first_idx = (seed.wrapping_add(index as i64).abs() as usize) % first_names.len();
    let last_idx = (seed.wrapping_mul(31).wrapping_add(index as i64).abs() as usize) % last_names.len();

    format!("{} {}", first_names[first_idx], last_names[last_idx])
}

// ============================================================================
// SQLx FromRow implementations
// ============================================================================

impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for Player {
    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Player {
            id: row.try_get("id")?,
            campaign_id: row.try_get("campaign_id")?,
            club_id: row.try_get("club_id")?,
            name: row.try_get("name")?,
            position: row.try_get("position")?,
            age: row.try_get("age")?,
            ability: row.try_get("ability")?,
            seed_index: row.try_get("seed_index")?,
        })
    }
}

impl sqlx::FromRow<'_, sqlx::postgres::PgRow> for Contract {
    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Contract {
            id: row.try_get("id")?,
            campaign_id: row.try_get("campaign_id")?,
            player_id: row.try_get("player_id")?,
            club_id: row.try_get("club_id")?,
            wage_per_week: row.try_get("wage_per_week")?,
            start_year: row.try_get("start_year")?,
            end_year: row.try_get("end_year")?,
            status: row.try_get("status")?,
            released_at: row.try_get("released_at")?,
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_uuid_stable() {
        let campaign_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let id1 = deterministic_uuid(campaign_id, 0);
        let id2 = deterministic_uuid(campaign_id, 0);
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_deterministic_uuid_unique() {
        let campaign_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let id1 = deterministic_uuid(campaign_id, 0);
        let id2 = deterministic_uuid(campaign_id, 1);
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_generate_players_count() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);
        assert_eq!(players.len(), 23);
    }

    #[test]
    fn test_generate_players_distribution() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);

        let gk_count = players.iter().filter(|p| p.position == "GK").count();
        let def_count = players.iter().filter(|p| p.position == "DEF").count();
        let mid_count = players.iter().filter(|p| p.position == "MID").count();
        let fwd_count = players.iter().filter(|p| p.position == "FWD").count();

        assert_eq!(gk_count, 2);
        assert_eq!(def_count, 8);
        assert_eq!(mid_count, 8);
        assert_eq!(fwd_count, 5);
    }

    #[test]
    fn test_generate_players_deterministic() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let seed = 12345i64;

        let players1 = generate_players(campaign_id, club_id, seed);
        let players2 = generate_players(campaign_id, club_id, seed);

        assert_eq!(players1.len(), players2.len());
        for (p1, p2) in players1.iter().zip(players2.iter()) {
            assert_eq!(p1.id, p2.id);
            assert_eq!(p1.name, p2.name);
            assert_eq!(p1.position, p2.position);
            assert_eq!(p1.age, p2.age);
            assert_eq!(p1.ability, p2.ability);
            assert_eq!(p1.seed_index, p2.seed_index);
        }
    }

    #[test]
    fn test_generate_players_unique_ids() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);

        let mut ids = std::collections::HashSet::new();
        for player in &players {
            assert!(ids.insert(player.id), "duplicate player ID found");
        }
    }

    #[test]
    fn test_generate_players_age_range() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);

        for player in &players {
            assert!(player.age >= 18 && player.age <= 32);
        }
    }

    #[test]
    fn test_generate_players_ability_range() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);

        for player in &players {
            assert!(player.ability >= 40 && player.ability < 80);
        }
    }

    #[test]
    fn test_generate_players_seed_index() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let players = generate_players(campaign_id, club_id, 12345);

        for (i, player) in players.iter().enumerate() {
            assert_eq!(player.seed_index, i as i32);
        }
    }

    #[test]
    fn test_generate_name_deterministic() {
        let name1 = generate_name(12345, 0);
        let name2 = generate_name(12345, 0);
        assert_eq!(name1, name2);
    }

    #[test]
    fn test_generate_name_format() {
        let name = generate_name(12345, 0);
        let parts: Vec<&str> = name.split_whitespace().collect();
        assert_eq!(parts.len(), 2);
    }

    #[test]
    fn test_generate_name_variation() {
        let name1 = generate_name(12345, 0);
        let name2 = generate_name(12345, 1);
        assert_ne!(name1, name2);
    }
}
