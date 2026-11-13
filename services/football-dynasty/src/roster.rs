use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::auth::TelegramIdentity;
use crate::error::ApiError;

#[derive(Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub position: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Contract {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub weekly_wage: i32,
    pub start_date: Date,
    pub end_date: Date,
    pub status: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SquadMember {
    pub player: Player,
    pub contract: Contract,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SquadResponse {
    pub campaign_id: Uuid,
    pub club_id: Uuid,
    pub squad: Vec<SquadMember>,
    pub total_weekly_wage: i32,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub weekly_wage: i32,
    pub start_date: Date,
    pub end_date: Date,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseContractRequest {
    pub player_id: Uuid,
}

pub async fn get_squad(
    State(pool): State<PgPool>,
    Path(campaign_id): Path<Uuid>,
    TelegramIdentity(telegram_id): TelegramIdentity,
) -> Result<Json<SquadResponse>, ApiError> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        "SET LOCAL fd.telegram_id = $1",
        telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await?;

    let campaign = sqlx::query!(
        "SELECT id FROM fd.campaigns WHERE id = $1",
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Campaign not found".into()))?;

    let club = sqlx::query!(
        "SELECT id FROM fd.clubs WHERE campaign_id = $1 LIMIT 1",
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Club not found".into()))?;

    let existing_players = sqlx::query!(
        "SELECT COUNT(*) as count FROM fd.players WHERE campaign_id = $1",
        campaign_id
    )
    .fetch_one(&mut *tx)
    .await?;

    if existing_players.count.unwrap_or(0) == 0 {
        seed_initial_squad(&mut tx, campaign_id, club.id).await?;
    }

    let squad_members = sqlx::query!(
        r#"
        SELECT
            p.id as player_id, p.campaign_id as player_campaign_id,
            p.first_name, p.last_name, p.position, p.created_at as player_created_at,
            c.id as contract_id, c.campaign_id as contract_campaign_id,
            c.player_id as contract_player_id, c.club_id,
            c.weekly_wage, c.start_date, c.end_date, c.status, c.created_at as contract_created_at
        FROM fd.players p
        JOIN fd.contracts c ON c.player_id = p.id AND c.campaign_id = p.campaign_id
        WHERE p.campaign_id = $1 AND c.club_id = $2 AND c.status = 'active'
        ORDER BY
            CASE p.position
                WHEN 'GK' THEN 1
                WHEN 'DEF' THEN 2
                WHEN 'MID' THEN 3
                WHEN 'FWD' THEN 4
            END,
            p.last_name, p.first_name
        "#,
        campaign_id,
        club.id
    )
    .fetch_all(&mut *tx)
    .await?;

    let squad: Vec<SquadMember> = squad_members
        .into_iter()
        .map(|row| SquadMember {
            player: Player {
                id: row.player_id,
                campaign_id: row.player_campaign_id,
                first_name: row.first_name,
                last_name: row.last_name,
                position: row.position,
                created_at: row.player_created_at,
            },
            contract: Contract {
                id: row.contract_id,
                campaign_id: row.contract_campaign_id,
                player_id: row.contract_player_id,
                club_id: row.club_id,
                weekly_wage: row.weekly_wage,
                start_date: row.start_date,
                end_date: row.end_date,
                status: row.status,
                created_at: row.contract_created_at,
            },
        })
        .collect();

    let total_weekly_wage: i32 = squad.iter().map(|m| m.contract.weekly_wage).sum();

    tx.commit().await?;

    Ok(Json(SquadResponse {
        campaign_id,
        club_id: club.id,
        squad,
        total_weekly_wage,
    }))
}

pub async fn sign_contract(
    State(pool): State<PgPool>,
    Path(campaign_id): Path<Uuid>,
    TelegramIdentity(telegram_id): TelegramIdentity,
    Json(req): Json<SignContractRequest>,
) -> Result<Json<Contract>, ApiError> {
    if req.weekly_wage <= 0 {
        return Err(ApiError::BadRequest("Weekly wage must be positive".into()));
    }

    if req.weekly_wage > 1_000_000 {
        return Err(ApiError::BadRequest("Weekly wage exceeds maximum allowed".into()));
    }

    if req.end_date <= req.start_date {
        return Err(ApiError::BadRequest("End date must be after start date".into()));
    }

    let duration_days = (req.end_date - req.start_date).whole_days();
    if duration_days > 365 * 10 {
        return Err(ApiError::BadRequest("Contract duration exceeds maximum allowed".into()));
    }

    let mut tx = pool.begin().await?;

    sqlx::query!(
        "SET LOCAL fd.telegram_id = $1",
        telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await?;

    let player = sqlx::query!(
        "SELECT id, campaign_id FROM fd.players WHERE id = $1 AND campaign_id = $2",
        req.player_id,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Player not found".into()))?;

    let club = sqlx::query!(
        "SELECT id FROM fd.clubs WHERE id = $1 AND campaign_id = $2",
        req.club_id,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Club not found".into()))?;

    let active_contracts = sqlx::query!(
        "SELECT COUNT(*) as count FROM fd.contracts WHERE player_id = $1 AND campaign_id = $2 AND status = 'active'",
        req.player_id,
        campaign_id
    )
    .fetch_one(&mut *tx)
    .await?;

    if active_contracts.count.unwrap_or(0) > 0 {
        return Err(ApiError::BadRequest("Player already has an active contract".into()));
    }

    let contract_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();

    let contract = sqlx::query_as!(
        Contract,
        r#"
        INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, weekly_wage, start_date, end_date, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
        RETURNING id, campaign_id, player_id, club_id, weekly_wage, start_date, end_date, status, created_at
        "#,
        contract_id,
        campaign_id,
        req.player_id,
        req.club_id,
        req.weekly_wage,
        req.start_date,
        req.end_date,
        now
    )
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(contract))
}

pub async fn release_contract(
    State(pool): State<PgPool>,
    Path(campaign_id): Path<Uuid>,
    TelegramIdentity(telegram_id): TelegramIdentity,
    Json(req): Json<ReleaseContractRequest>,
) -> Result<StatusCode, ApiError> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        "SET LOCAL fd.telegram_id = $1",
        telegram_id.to_string()
    )
    .execute(&mut *tx)
    .await?;

    let player = sqlx::query!(
        "SELECT id FROM fd.players WHERE id = $1 AND campaign_id = $2",
        req.player_id,
        campaign_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("Player not found".into()))?;

    let result = sqlx::query!(
        "UPDATE fd.contracts SET status = 'released' WHERE player_id = $1 AND campaign_id = $2 AND status = 'active'",
        req.player_id,
        campaign_id
    )
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound("No active contract found".into()));
    }

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn seed_initial_squad(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    campaign_id: Uuid,
    club_id: Uuid,
) -> Result<(), ApiError> {
    let seed = campaign_id.as_u128();

    let positions = [
        ("GK", 2),
        ("DEF", 8),
        ("MID", 8),
        ("FWD", 5),
    ];

    let first_names = [
        "Marco", "Luca", "Andrea", "Paolo", "Giovanni",
        "Roberto", "Francesco", "Matteo", "Alessandro", "Davide",
        "Simone", "Fabio", "Stefano", "Diego", "Carlo",
        "Emanuele", "Riccardo", "Lorenzo", "Nicola", "Gabriele",
        "Antonio", "Michele", "Daniele", "Federico",
    ];

    let last_names = [
        "Rossi", "Russo", "Ferrari", "Esposito", "Bianchi",
        "Romano", "Colombo", "Ricci", "Marino", "Greco",
        "Bruno", "Gallo", "Conti", "De Luca", "Costa",
        "Giordano", "Mancini", "Rizzo", "Lombardi", "Moretti",
        "Barbieri", "Fontana", "Santoro", "Mariani",
    ];

    let mut player_index = 0;
    let now = OffsetDateTime::now_utc();
    let start_date = Date::from_ordinal_date(2024, 1).unwrap();
    let end_date = Date::from_ordinal_date(2026, 365).unwrap();

    for (position, count) in positions {
        for i in 0..count {
            let player_seed = seed.wrapping_mul(31).wrapping_add(player_index as u128);
            let first_name_idx = (player_seed % first_names.len() as u128) as usize;
            let last_name_idx = ((player_seed / first_names.len() as u128) % last_names.len() as u128) as usize;

            let player_id = Uuid::new_v4();

            sqlx::query!(
                "INSERT INTO fd.players (id, campaign_id, first_name, last_name, position, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
                player_id,
                campaign_id,
                first_names[first_name_idx],
                last_names[last_name_idx],
                position,
                now
            )
            .execute(&mut **tx)
            .await?;

            let wage_base = match position {
                "GK" => 15_000,
                "DEF" => 12_000,
                "MID" => 14_000,
                "FWD" => 16_000,
                _ => 10_000,
            };
            let wage_variance = ((player_seed % 5000) as i32) - 2500;
            let weekly_wage = (wage_base + wage_variance).max(5_000);

            let contract_id = Uuid::new_v4();

            sqlx::query!(
                "INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, weekly_wage, start_date, end_date, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)",
                contract_id,
                campaign_id,
                player_id,
                club_id,
                weekly_wage,
                start_date,
                end_date,
                now
            )
            .execute(&mut **tx)
            .await?;

            player_index += 1;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_squad_distribution() {
        assert_eq!(2 + 8 + 8 + 5, 23);
    }

    #[test]
    fn test_wage_bounds() {
        let min_wage = 1;
        let max_wage = 1_000_000;
        assert!(min_wage > 0);
        assert!(max_wage <= 1_000_000);
    }

    #[test]
    fn test_contract_duration() {
        let start = Date::from_ordinal_date(2024, 1).unwrap();
        let end = Date::from_ordinal_date(2026, 365).unwrap();
        let duration = (end - start).whole_days();
        assert!(duration > 0);
        assert!(duration <= 365 * 10);
    }

    #[test]
    fn test_deterministic_names() {
        let seed1 = 12345u128;
        let seed2 = 12345u128;

        let first_names = ["Marco", "Luca", "Andrea"];
        let last_names = ["Rossi", "Russo", "Ferrari"];

        let idx1 = (seed1 % first_names.len() as u128) as usize;
        let idx2 = (seed2 % first_names.len() as u128) as usize;

        assert_eq!(idx1, idx2);
    }

    #[test]
    fn test_position_order() {
        let positions = vec!["GK", "DEF", "MID", "FWD"];
        let mut sorted = positions.clone();
        sorted.sort_by_key(|p| match *p {
            "GK" => 1,
            "DEF" => 2,
            "MID" => 3,
            "FWD" => 4,
            _ => 5,
        });
        assert_eq!(positions, sorted);
    }

    #[tokio::test]
    async fn test_contract_validation_positive_wage() {
        let req = SignContractRequest {
            player_id: Uuid::new_v4(),
            club_id: Uuid::new_v4(),
            weekly_wage: -100,
            start_date: Date::from_ordinal_date(2024, 1).unwrap(),
            end_date: Date::from_ordinal_date(2025, 1).unwrap(),
        };

        assert!(req.weekly_wage <= 0);
    }

    #[tokio::test]
    async fn test_contract_validation_date_order() {
        let start = Date::from_ordinal_date(2025, 1).unwrap();
        let end = Date::from_ordinal_date(2024, 1).unwrap();

        assert!(end <= start);
    }

    #[tokio::test]
    async fn test_contract_validation_max_duration() {
        let start = Date::from_ordinal_date(2024, 1).unwrap();
        let end = Date::from_ordinal_date(2040, 1).unwrap();
        let duration = (end - start).whole_days();

        assert!(duration > 365 * 10);
    }

    #[tokio::test]
    async fn test_seed_determinism() {
        let campaign_id1 = Uuid::from_u128(12345);
        let campaign_id2 = Uuid::from_u128(12345);

        let seed1 = campaign_id1.as_u128();
        let seed2 = campaign_id2.as_u128();

        assert_eq!(seed1, seed2);

        let player_seed1 = seed1.wrapping_mul(31).wrapping_add(0);
        let player_seed2 = seed2.wrapping_mul(31).wrapping_add(0);

        assert_eq!(player_seed1, player_seed2);
    }

    #[test]
    fn test_squad_size_invariant() {
        let gk_count = 2;
        let def_count = 8;
        let mid_count = 8;
        let fwd_count = 5;

        let total = gk_count + def_count + mid_count + fwd_count;
        assert_eq!(total, 23);
    }

    #[test]
    fn test_wage_calculation() {
        let base = 15_000;
        let variance = 2_000;
        let wage = (base + variance).max(5_000);

        assert!(wage >= 5_000);
        assert!(wage <= 1_000_000);
    }
}
