use crate::error::{AppError, AppResult};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

const STARTING_SQUAD_SIZE: usize = 23;
const STARTING_GK: usize = 2;
const STARTING_DEF: usize = 8;
const STARTING_MID: usize = 8;
const STARTING_FWD: usize = 5;

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Position {
    Gk,
    Def,
    Mid,
    Fwd,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContractStatus {
    Active,
    Expired,
    Released,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub club_id: Uuid,
    pub name: String,
    pub position: Position,
    pub age: i32,
    pub ability: i32,
    pub seed_index: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Contract {
    pub id: Uuid,
    pub campaign_id: Uuid,
    pub player_id: Uuid,
    pub club_id: Uuid,
    pub wage: i64,
    pub start_date: Date,
    pub end_date: Date,
    pub status: ContractStatus,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SquadPlayer {
    pub player: Player,
    pub contract: Option<Contract>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SquadResponse {
    pub players: Vec<SquadPlayer>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: Uuid,
    pub wage: i64,
    pub start_date: Date,
    pub end_date: Date,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseContractRequest {
    pub player_id: Uuid,
}

pub async fn get_squad(
    State(pool): State<Arc<PgPool>>,
    Path(campaign_id): Path<Uuid>,
) -> AppResult<impl IntoResponse> {
    let mut tx = pool.begin().await?;

    verify_campaign_owner(&mut tx, campaign_id).await?;

    let club_id = get_user_club(&mut tx, campaign_id).await?;

    ensure_squad_seeded(&mut tx, campaign_id, club_id).await?;

    update_expired_contracts(&mut tx, campaign_id).await?;

    let players = sqlx::query_as::<_, (Uuid, Uuid, Uuid, String, Position, i32, i32, i32)>(
        r#"
        SELECT id, campaign_id, club_id, name, position, age, ability, seed_index
        FROM fd.players
        WHERE campaign_id = $1 AND club_id = $2
        ORDER BY position, seed_index
        "#,
    )
    .bind(campaign_id)
    .bind(club_id)
    .fetch_all(&mut *tx)
    .await?;

    let mut squad_players = Vec::with_capacity(players.len());
    for (id, campaign_id, club_id, name, position, age, ability, seed_index) in players {
        let contract = sqlx::query_as::<_, (Uuid, Uuid, Uuid, Uuid, i64, Date, Date, ContractStatus)>(
            r#"
            SELECT id, campaign_id, player_id, club_id, wage, start_date, end_date, status
            FROM fd.contracts
            WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'
            "#,
        )
        .bind(campaign_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .map(|(id, campaign_id, player_id, club_id, wage, start_date, end_date, status)| Contract {
            id,
            campaign_id,
            player_id,
            club_id,
            wage,
            start_date,
            end_date,
            status,
        });

        squad_players.push(SquadPlayer {
            player: Player {
                id,
                campaign_id,
                club_id,
                name,
                position,
                age,
                ability,
                seed_index,
            },
            contract,
        });
    }

    tx.commit().await?;

    Ok((
        StatusCode::OK,
        Json(SquadResponse {
            total: squad_players.len(),
            players: squad_players,
        }),
    ))
}

pub async fn sign_contract(
    State(pool): State<Arc<PgPool>>,
    Path(campaign_id): Path<Uuid>,
    Json(req): Json<SignContractRequest>,
) -> AppResult<impl IntoResponse> {
    let mut tx = pool.begin().await?;

    verify_campaign_owner(&mut tx, campaign_id).await?;

    let club_id = get_user_club(&mut tx, campaign_id).await?;

    if req.wage <= 0 || req.wage > 1_000_000_000 {
        return Err(AppError::BadRequest("wage must be positive and bounded".into()));
    }

    if req.end_date <= req.start_date {
        return Err(AppError::BadRequest("end_date must be after start_date".into()));
    }

    let player = sqlx::query_as::<_, (Uuid, Uuid, Uuid)>(
        r#"
        SELECT id, campaign_id, club_id
        FROM fd.players
        WHERE id = $1 AND campaign_id = $2
        "#,
    )
    .bind(req.player_id)
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("player not found".into()))?;

    if player.2 != club_id {
        return Err(AppError::Forbidden("player does not belong to your club".into()));
    }

    let existing_active = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM fd.contracts
        WHERE campaign_id = $1 AND player_id = $2 AND status = 'active'
        "#,
    )
    .bind(campaign_id)
    .bind(req.player_id)
    .fetch_one(&mut *tx)
    .await?;

    if existing_active > 0 {
        return Err(AppError::BadRequest("player already has an active contract".into()));
    }

    let contract_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO fd.contracts (id, campaign_id, player_id, club_id, wage, start_date, end_date, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        "#,
    )
    .bind(contract_id)
    .bind(campaign_id)
    .bind(req.player_id)
    .bind(club_id)
    .bind(req.wage)
    .bind(req.start_date)
    .bind(req.end_date)
    .fetch_optional(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(Contract {
            id: contract_id,
            campaign_id,
            player_id: req.player_id,
            club_id,
            wage: req.wage,
            start_date: req.start_date,
            end_date: req.end_date,
            status: ContractStatus::Active,
        }),
    ))
}

pub async fn release_contract(
    State(pool): State<Arc<PgPool>>,
    Path(campaign_id): Path<Uuid>,
    Json(req): Json<ReleaseContractRequest>,
) -> AppResult<impl IntoResponse> {
    let mut tx = pool.begin().await?;

    verify_campaign_owner(&mut tx, campaign_id).await?;

    let club_id = get_user_club(&mut tx, campaign_id).await?;

    let player = sqlx::query_as::<_, (Uuid, Uuid, Uuid)>(
        r#"
        SELECT id, campaign_id, club_id
        FROM fd.players
        WHERE id = $1 AND campaign_id = $2
        "#,
    )
    .bind(req.player_id)
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| AppError::NotFound("player not found".into()))?;

    if player.2 != club_id {
        return Err(AppError::Forbidden("player does not belong to your club".into()));
    }

    let updated = sqlx::query(
        r#"
        UPDATE fd.contracts
        SET status = 'released'
        WHERE campaign_id = $1 AND player_id = $2 AND club_id = $3 AND status = 'active'
        "#,
    )
    .bind(campaign_id)
    .bind(req.player_id)
    .bind(club_id)
    .execute(&mut *tx)
    .await?;

    if updated.rows_affected() == 0 {
        return Err(AppError::NotFound("no active contract to release".into()));
    }

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn verify_campaign_owner(tx: &mut Transaction<'_, Postgres>, campaign_id: Uuid) -> AppResult<()> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(SELECT 1 FROM fd.campaigns WHERE id = $1)
        "#,
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await?;

    if !exists {
        return Err(AppError::NotFound("campaign not found".into()));
    }

    Ok(())
}

async fn get_user_club(tx: &mut Transaction<'_, Postgres>, campaign_id: Uuid) -> AppResult<Uuid> {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM fd.clubs WHERE campaign_id = $1 ORDER BY created_at LIMIT 1
        "#,
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| AppError::NotFound("user club not found".into()))
}

async fn ensure_squad_seeded(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    club_id: Uuid,
) -> AppResult<()> {
    let existing_count = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM fd.players WHERE campaign_id = $1 AND club_id = $2
        "#,
    )
    .bind(campaign_id)
    .bind(club_id)
    .fetch_one(&mut **tx)
    .await?;

    if existing_count > 0 {
        return Ok(());
    }

    let campaign_seed = sqlx::query_scalar::<_, i32>(
        r#"
        SELECT seed FROM fd.campaigns WHERE id = $1
        "#,
    )
    .bind(campaign_id)
    .fetch_one(&mut **tx)
    .await?;

    let mut players = Vec::with_capacity(STARTING_SQUAD_SIZE);
    let mut seed_index = 0;

    for _ in 0..STARTING_GK {
        players.push(generate_player(campaign_id, club_id, Position::Gk, campaign_seed, seed_index));
        seed_index += 1;
    }
    for _ in 0..STARTING_DEF {
        players.push(generate_player(campaign_id, club_id, Position::Def, campaign_seed, seed_index));
        seed_index += 1;
    }
    for _ in 0..STARTING_MID {
        players.push(generate_player(campaign_id, club_id, Position::Mid, campaign_seed, seed_index));
        seed_index += 1;
    }
    for _ in 0..STARTING_FWD {
        players.push(generate_player(campaign_id, club_id, Position::Fwd, campaign_seed, seed_index));
        seed_index += 1;
    }

    for player in &players {
        sqlx::query(
            r#"
            INSERT INTO fd.players (id, campaign_id, club_id, name, position, age, ability, seed_index)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            "#,
        )
        .bind(player.id)
        .bind(player.campaign_id)
        .bind(player.club_id)
        .bind(&player.name)
        .bind(player.position)
        .bind(player.age)
        .bind(player.ability)
        .bind(player.seed_index)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

fn generate_player(
    campaign_id: Uuid,
    club_id: Uuid,
    position: Position,
    campaign_seed: i32,
    seed_index: i32,
) -> Player {
    let combined_seed = campaign_seed.wrapping_mul(31).wrapping_add(seed_index);

    let name = generate_name(combined_seed);
    let age = 18 + (combined_seed.abs() % 15) as i32;
    let ability = 40 + (combined_seed.wrapping_mul(17).abs() % 41) as i32;

    Player {
        id: Uuid::new_v4(),
        campaign_id,
        club_id,
        name,
        position,
        age,
        ability,
        seed_index,
    }
}

fn generate_name(seed: i32) -> String {
    const FIRST_NAMES: &[&str] = &[
        "Alex", "Ben", "Chris", "David", "Ethan", "Frank", "George", "Harry",
        "Ivan", "Jack", "Kevin", "Leo", "Mark", "Nathan", "Oscar", "Paul",
        "Quinn", "Ryan", "Sam", "Tom", "Ulrich", "Victor", "Will", "Xavier",
        "Yuri", "Zack", "Adam", "Brian", "Carl", "Dan", "Eric", "Felix",
    ];
    const LAST_NAMES: &[&str] = &[
        "Smith", "Johnson", "Brown", "Taylor", "Anderson", "Thomas", "Jackson", "White",
        "Harris", "Martin", "Garcia", "Martinez", "Robinson", "Clark", "Rodriguez", "Lewis",
        "Lee", "Walker", "Hall", "Allen", "Young", "King", "Wright", "Lopez",
        "Hill", "Scott", "Green", "Adams", "Baker", "Nelson", "Carter", "Mitchell",
    ];

    let first_idx = (seed.abs() as usize) % FIRST_NAMES.len();
    let last_idx = (seed.wrapping_mul(7).abs() as usize) % LAST_NAMES.len();

    format!("{} {}", FIRST_NAMES[first_idx], LAST_NAMES[last_idx])
}

async fn update_expired_contracts(tx: &mut Transaction<'_, Postgres>, campaign_id: Uuid) -> AppResult<()> {
    let today = OffsetDateTime::now_utc().date();

    sqlx::query(
        r#"
        UPDATE fd.contracts
        SET status = 'expired'
        WHERE campaign_id = $1 AND status = 'active' AND end_date < $2
        "#,
    )
    .bind(campaign_id)
    .bind(today)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_generate_name_deterministic() {
        let name1 = generate_name(42);
        let name2 = generate_name(42);
        assert_eq!(name1, name2);
    }

    #[test]
    fn test_generate_name_variety() {
        let mut names = HashSet::new();
        for seed in 0..100 {
            names.insert(generate_name(seed));
        }
        assert!(names.len() > 50);
    }

    #[test]
    fn test_generate_player_deterministic() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let p1 = generate_player(campaign_id, club_id, Position::Gk, 100, 0);
        let p2 = generate_player(campaign_id, club_id, Position::Gk, 100, 0);

        assert_eq!(p1.name, p2.name);
        assert_eq!(p1.age, p2.age);
        assert_eq!(p1.ability, p2.ability);
        assert_eq!(p1.position, p2.position);
    }

    #[test]
    fn test_generate_player_variety() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();
        let mut players = Vec::new();

        for i in 0..23 {
            players.push(generate_player(campaign_id, club_id, Position::Mid, 500, i));
        }

        let names: HashSet<_> = players.iter().map(|p| &p.name).collect();
        assert!(names.len() > 15);

        let ages: HashSet<_> = players.iter().map(|p| p.age).collect();
        assert!(ages.len() > 5);

        let abilities: HashSet<_> = players.iter().map(|p| p.ability).collect();
        assert!(abilities.len() > 10);
    }

    #[test]
    fn test_position_distribution() {
        let mut gk = 0;
        let mut def = 0;
        let mut mid = 0;
        let mut fwd = 0;

        for _ in 0..STARTING_GK { gk += 1; }
        for _ in 0..STARTING_DEF { def += 1; }
        for _ in 0..STARTING_MID { mid += 1; }
        for _ in 0..STARTING_FWD { fwd += 1; }

        assert_eq!(gk, 2);
        assert_eq!(def, 8);
        assert_eq!(mid, 8);
        assert_eq!(fwd, 5);
        assert_eq!(gk + def + mid + fwd, STARTING_SQUAD_SIZE);
    }

    #[test]
    fn test_player_age_bounds() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();

        for seed in 0..100 {
            let player = generate_player(campaign_id, club_id, Position::Fwd, seed, 0);
            assert!(player.age >= 18);
            assert!(player.age < 33);
        }
    }

    #[test]
    fn test_player_ability_bounds() {
        let campaign_id = Uuid::new_v4();
        let club_id = Uuid::new_v4();

        for seed in 0..100 {
            let player = generate_player(campaign_id, club_id, Position::Def, seed, 0);
            assert!(player.ability >= 40);
            assert!(player.ability <= 80);
        }
    }
}
