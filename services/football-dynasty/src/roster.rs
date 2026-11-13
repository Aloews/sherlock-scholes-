use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{auth::Identity, errors::ApiError, state::AppState};

const STARTING_POSITIONS: [(&str, usize); 4] = [("GK", 2), ("DEF", 8), ("MID", 8), ("FWD", 5)];

#[derive(Debug, Serialize)]
pub struct SquadResponse {
    pub campaign_id: Uuid,
    pub current_year: i32,
    pub players: Vec<SquadPlayer>,
}

#[derive(Debug, Serialize)]
pub struct SquadPlayer {
    pub id: Uuid,
    pub name: String,
    pub position: String,
    pub age: i32,
    pub ability: i32,
    pub contract: Option<ContractView>,
}

#[derive(Debug, Serialize)]
pub struct ContractView {
    pub id: Uuid,
    pub wage_per_week: i64,
    pub start_year: i32,
    pub end_year: i32,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub wage_per_week: i64,
    pub years: i32,
}

#[derive(Debug, Serialize)]
pub struct ContractMutationResponse {
    pub id: Uuid,
    pub player_id: Uuid,
    pub wage_per_week: i64,
    pub start_year: i32,
    pub end_year: i32,
    pub status: String,
}

struct CampaignContext {
    seed: i64,
    current_year: i32,
    dynasty_id: Uuid,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/campaigns/{campaign_id}/squad", get(get_squad))
        .route(
            "/api/v1/campaigns/{campaign_id}/contracts",
            post(sign_or_renew_contract),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/contracts/{player_id}/release",
            post(release_contract),
        )
}

async fn set_owner_scope(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
) -> Result<(), ApiError> {
    sqlx::query("SET LOCAL ROLE fd_runtime")
        .execute(&mut **tx)
        .await?;
    sqlx::query("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn campaign_context(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    owner_id: i64,
) -> Result<CampaignContext, ApiError> {
    let row = sqlx::query(
        "SELECT seed, current_year, dynasty_id FROM fd.campaigns WHERE id = $1 AND owner_telegram_id = $2 FOR UPDATE",
    )
    .bind(campaign_id)
    .bind(owner_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(ApiError::not_found)?;

    Ok(CampaignContext {
        seed: row.try_get("seed")?,
        current_year: row.try_get("current_year")?,
        dynasty_id: row.try_get("dynasty_id")?,
    })
}

async fn campaign_club_id(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    dynasty_id: Uuid,
) -> Result<Uuid, ApiError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT club_id FROM fd.club_ownership WHERE campaign_id = $1 AND owner_type = 'dynasty' AND owner_id = $2 ORDER BY created_at LIMIT 1",
    )
    .bind(campaign_id)
    .bind(dynasty_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(ApiError::not_found)
}

async fn seed_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    club_id: Uuid,
    seed: i64,
    current_year: i32,
) -> Result<(), ApiError> {
    let existing: i64 =
        sqlx::query_scalar("SELECT count(*) FROM fd.players WHERE campaign_id = $1")
            .bind(campaign_id)
            .fetch_one(&mut **tx)
            .await?;

    if existing == 23 {
        return Ok(());
    }
    if existing != 0 {
        return Err(ApiError::conflict("squad_seed_incomplete"));
    }

    let contract_end_year = current_year
        .checked_add(3)
        .ok_or_else(|| ApiError::bad_request("invalid_campaign_year"))?;
    let mut seed_index = 0_i32;
    for (position, count) in STARTING_POSITIONS {
        for _ in 0..count {
            let player_id = deterministic_uuid(campaign_id, seed, "player", seed_index);
            let contract_id = deterministic_uuid(campaign_id, seed, "contract", seed_index);
            let (name, age, ability) = generated_player(seed, seed_index);
            let wage_per_week = 1500_i64 + i64::from(ability) * 125;

            sqlx::query(
                "INSERT INTO fd.players (id, campaign_id, club_id, seed_index, name, position, age, ability) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(player_id)
            .bind(campaign_id)
            .bind(club_id)
            .bind(seed_index)
            .bind(name)
            .bind(position)
            .bind(age)
            .bind(ability)
            .execute(&mut **tx)
            .await?;

            sqlx::query(
                "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')",
            )
            .bind(contract_id)
            .bind(campaign_id)
            .bind(player_id)
            .bind(club_id)
            .bind(wage_per_week)
            .bind(current_year)
            .bind(contract_end_year)
            .execute(&mut **tx)
            .await?;

            seed_index += 1;
        }
    }

    Ok(())
}

fn deterministic_uuid(campaign_id: Uuid, seed: i64, kind: &str, index: i32) -> Uuid {
    let input = format!("{campaign_id}:{seed}:{kind}:{index}");
    let digest = Sha256::digest(input.as_bytes());
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

fn generated_player(seed: i64, index: i32) -> (String, i32, i32) {
    const FIRST_NAMES: &[&str] = &[
        "Alex", "Ben", "Chris", "David", "Ethan", "Frank", "George", "Harry", "Ivan", "Jack",
        "Kevin", "Leo", "Mark", "Nathan", "Oscar", "Paul", "Quinn", "Ryan", "Sam", "Tom", "Ulrich",
        "Victor", "Will", "Xavier", "Yuri", "Zack", "Adam", "Brian", "Carl", "Dan", "Eric",
        "Felix",
    ];
    const LAST_NAMES: &[&str] = &[
        "Smith",
        "Johnson",
        "Brown",
        "Taylor",
        "Anderson",
        "Thomas",
        "Jackson",
        "White",
        "Harris",
        "Martin",
        "Garcia",
        "Martinez",
        "Robinson",
        "Clark",
        "Rodriguez",
        "Lewis",
        "Lee",
        "Walker",
        "Hall",
        "Allen",
        "Young",
        "King",
        "Wright",
        "Lopez",
        "Hill",
        "Scott",
        "Green",
        "Adams",
        "Baker",
        "Nelson",
        "Carter",
        "Mitchell",
    ];

    let mixed = seed.wrapping_add(i64::from(index).wrapping_mul(7919));
    let first = mixed.rem_euclid(FIRST_NAMES.len() as i64) as usize;
    let last = mixed.wrapping_mul(7).rem_euclid(LAST_NAMES.len() as i64) as usize;
    let age = 18 + mixed.rem_euclid(15) as i32;
    let ability = 45 + mixed.wrapping_mul(17).rem_euclid(45) as i32;

    (
        format!("{} {}", FIRST_NAMES[first], LAST_NAMES[last]),
        age,
        ability,
    )
}

async fn update_expired_contracts(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    current_year: i32,
) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE fd.contracts SET status = 'expired' WHERE campaign_id = $1 AND status = 'active' AND end_year < $2",
    )
    .bind(campaign_id)
    .bind(current_year)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn get_squad(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<(StatusCode, Json<SquadResponse>), ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let context = campaign_context(&mut tx, campaign_id, identity.telegram_id).await?;
    let club_id = campaign_club_id(&mut tx, campaign_id, context.dynasty_id).await?;

    seed_squad(
        &mut tx,
        campaign_id,
        club_id,
        context.seed,
        context.current_year,
    )
    .await?;
    update_expired_contracts(&mut tx, campaign_id, context.current_year).await?;

    let rows = sqlx::query(
        "SELECT p.id, p.name, p.position, p.age, p.ability, c.id AS contract_id, c.wage_per_week, c.start_year, c.end_year, c.status FROM fd.players p LEFT JOIN fd.contracts c ON c.campaign_id = p.campaign_id AND c.player_id = p.id AND c.status = 'active' WHERE p.campaign_id = $1 AND p.club_id = $2 ORDER BY p.seed_index",
    )
    .bind(campaign_id)
    .bind(club_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut players = Vec::with_capacity(rows.len());
    for row in rows {
        let contract_id: Option<Uuid> = row.try_get("contract_id")?;
        let contract = match contract_id {
            Some(id) => Some(ContractView {
                id,
                wage_per_week: row.try_get("wage_per_week")?,
                start_year: row.try_get("start_year")?,
                end_year: row.try_get("end_year")?,
                status: row.try_get("status")?,
            }),
            None => None,
        };
        players.push(SquadPlayer {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            position: row.try_get("position")?,
            age: row.try_get("age")?,
            ability: row.try_get("ability")?,
            contract,
        });
    }

    tx.commit().await?;
    Ok((
        StatusCode::OK,
        Json(SquadResponse {
            campaign_id,
            current_year: context.current_year,
            players,
        }),
    ))
}

pub async fn sign_or_renew_contract(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    Json(request): Json<SignContractRequest>,
) -> Result<(StatusCode, Json<ContractMutationResponse>), ApiError> {
    if !(1..=1_000_000_000).contains(&request.wage_per_week) || !(1..=5).contains(&request.years) {
        return Err(ApiError::bad_request("invalid_contract_terms"));
    }

    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let context = campaign_context(&mut tx, campaign_id, identity.telegram_id).await?;
    let club_id = campaign_club_id(&mut tx, campaign_id, context.dynasty_id).await?;

    let player_exists = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM fd.players WHERE campaign_id = $1 AND id = $2 AND club_id = $3 FOR UPDATE",
    )
    .bind(campaign_id)
    .bind(request.player_id)
    .bind(club_id)
    .fetch_optional(&mut **tx)
    .await?;
    if player_exists.is_none() {
        return Err(ApiError::not_found());
    }

    update_expired_contracts(&mut tx, campaign_id, context.current_year).await?;
    let end_year = context
        .current_year
        .checked_add(request.years)
        .ok_or_else(|| ApiError::bad_request("invalid_contract_terms"))?;

    let updated = sqlx::query(
        "UPDATE fd.contracts SET wage_per_week = $3, start_year = $4, end_year = $5 WHERE campaign_id = $1 AND player_id = $2 AND status = 'active' RETURNING id",
    )
    .bind(campaign_id)
    .bind(request.player_id)
    .bind(request.wage_per_week)
    .bind(context.current_year)
    .bind(end_year)
    .fetch_optional(&mut **tx)
    .await?;

    let contract_id = match updated {
        Some(row) => row.try_get::<Uuid, _>("id")?,
        None => {
            let id = Uuid::new_v4();
            sqlx::query(
                "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, wage_per_week, start_year, end_year, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')",
            )
            .bind(id)
            .bind(campaign_id)
            .bind(request.player_id)
            .bind(club_id)
            .bind(request.wage_per_week)
            .bind(context.current_year)
            .bind(end_year)
            .execute(&mut **tx)
            .await?;
            id
        }
    };

    tx.commit().await?;
    Ok((
        StatusCode::OK,
        Json(ContractMutationResponse {
            id: contract_id,
            player_id: request.player_id,
            wage_per_week: request.wage_per_week,
            start_year: context.current_year,
            end_year,
            status: "active".to_owned(),
        }),
    ))
}

pub async fn release_contract(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, player_id)): Path<(Uuid, Uuid)>,
) -> Result<(StatusCode, Json<ContractMutationResponse>), ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let context = campaign_context(&mut tx, campaign_id, identity.telegram_id).await?;
    let club_id = campaign_club_id(&mut tx, campaign_id, context.dynasty_id).await?;
    update_expired_contracts(&mut tx, campaign_id, context.current_year).await?;

    let row = sqlx::query(
        "UPDATE fd.contracts SET status = 'released', released_at = now() WHERE campaign_id = $1 AND player_id = $2 AND club_id = $3 AND status = 'active' RETURNING id, wage_per_week, start_year, end_year",
    )
    .bind(campaign_id)
    .bind(player_id)
    .bind(club_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(ApiError::not_found)?;

    let response = ContractMutationResponse {
        id: row.try_get("id")?,
        player_id,
        wage_per_week: row.try_get("wage_per_week")?,
        start_year: row.try_get("start_year")?,
        end_year: row.try_get("end_year")?,
        status: "released".to_owned(),
    };

    tx.commit().await?;
    Ok((StatusCode::OK, Json(response)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn squad_positions_total_twenty_three() {
        let total: usize = STARTING_POSITIONS.iter().map(|(_, count)| count).sum();
        assert_eq!(total, 23);
        assert_eq!(STARTING_POSITIONS[0], ("GK", 2));
        assert_eq!(STARTING_POSITIONS[1], ("DEF", 8));
        assert_eq!(STARTING_POSITIONS[2], ("MID", 8));
        assert_eq!(STARTING_POSITIONS[3], ("FWD", 5));
    }

    #[test]
    fn deterministic_player_ids_and_profiles_are_stable() {
        let campaign_id = Uuid::from_u128(7);
        let first_id = deterministic_uuid(campaign_id, 1234, "player", 0);
        let second_id = deterministic_uuid(campaign_id, 1234, "player", 0);
        assert_eq!(first_id, second_id);
        assert_eq!(generated_player(1234, 0), generated_player(1234, 0));
        assert_ne!(
            deterministic_uuid(campaign_id, 1234, "player", 0),
            deterministic_uuid(campaign_id, 1234, "player", 1)
        );
    }
}
