use crate::errors::DynastyError;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: i64,
    pub campaign_id: i64,
    pub club_id: i64,
    pub first_name: String,
    pub last_name: String,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contract {
    pub id: i64,
    pub player_id: i64,
    pub club_id: i64,
    pub weekly_wage: i32,
    pub start_date: chrono::NaiveDate,
    pub end_date: chrono::NaiveDate,
    pub status: String,
}

#[derive(Debug, Deserialize)]
pub struct SignContractRequest {
    pub player_id: i64,
    pub weekly_wage: i32,
    pub years: i32,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseContractRequest {
    pub contract_id: i64,
}

const FIRST_NAMES: &[&str] = &[
    "Marco", "Luca", "Giovanni", "Alessandro", "Matteo", "Andrea", "Paolo", "Francesco",
    "Diego", "Carlos", "Luis", "Miguel", "Antonio", "Jose", "Fernando", "Pedro",
];

const LAST_NAMES: &[&str] = &[
    "Rossi", "Bianchi", "Romano", "Gallo", "Costa", "Ricci", "Marino", "Greco",
    "Silva", "Santos", "Pereira", "Oliveira", "Costa", "Rodrigues", "Fernandes", "Alves",
];

fn deterministic_name(campaign_seed: i64, index: usize) -> (String, String) {
    let mut hasher = DefaultHasher::new();
    campaign_seed.hash(&mut hasher);
    index.hash(&mut hasher);
    let hash = hasher.finish();

    let first_idx = (hash % FIRST_NAMES.len() as u64) as usize;
    let last_idx = ((hash >> 16) % LAST_NAMES.len() as u64) as usize;

    (FIRST_NAMES[first_idx].to_string(), LAST_NAMES[last_idx].to_string())
}

fn position_for_index(index: usize) -> &'static str {
    match index {
        0..=1 => "GK",
        2..=9 => "DEF",
        10..=17 => "MID",
        18..=22 => "FWD",
        _ => "MID",
    }
}

pub async fn get_squad(
    pool: &PgPool,
    campaign_id: i64,
    club_id: i64,
) -> Result<Vec<(Player, Option<Contract>)>, DynastyError> {
    let mut tx = pool.begin().await?;

    let existing: Vec<i64> = sqlx::query_scalar(
        "select id from fd.players where campaign_id = $1 and club_id = $2"
    )
    .bind(campaign_id)
    .bind(club_id)
    .fetch_all(&mut *tx)
    .await?;

    if existing.is_empty() {
        let campaign_seed: i64 = sqlx::query_scalar(
            "select seed from fd.campaigns where id = $1"
        )
        .bind(campaign_id)
        .fetch_one(&mut *tx)
        .await?;

        let current_date: chrono::NaiveDate = sqlx::query_scalar(
            "select current_date from fd.campaigns where id = $1"
        )
        .bind(campaign_id)
        .fetch_one(&mut *tx)
        .await?;

        for i in 0..23 {
            let (first_name, last_name) = deterministic_name(campaign_seed, i);
            let position = position_for_index(i);

            let player_id: Option<i64> = sqlx::query_scalar(
                "insert into fd.players (campaign_id, club_id, first_name, last_name, position, seed_index)
                 values ($1, $2, $3, $4, $5, $6)
                 on conflict (campaign_id, club_id, seed_index) do nothing
                 returning id"
            )
            .bind(campaign_id)
            .bind(club_id)
            .bind(&first_name)
            .bind(&last_name)
            .bind(position)
            .bind(i as i32)
            .fetch_optional(&mut *tx)
            .await?;

            if let Some(player_id) = player_id {
                let base_wage = match position {
                    "GK" => 15000,
                    "DEF" => 12000,
                    "MID" => 14000,
                    "FWD" => 16000,
                    _ => 10000,
                };

                sqlx::query(
                    "insert into fd.contracts (campaign_id, player_id, club_id, weekly_wage, start_date, end_date, status)
                     values ($1, $2, $3, $4, $5, $6, 'active')
                     on conflict do nothing"
                )
                .bind(campaign_id)
                .bind(player_id)
                .bind(club_id)
                .bind(base_wage)
                .bind(current_date)
                .bind(current_date + chrono::Duration::days(365 * 3))
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    let rows: Vec<(i64, i64, i64, String, String, String, Option<i64>, Option<i64>, Option<i32>, Option<chrono::NaiveDate>, Option<chrono::NaiveDate>, Option<String>)> = sqlx::query_as(
        "select p.id, p.campaign_id, p.club_id, p.first_name, p.last_name, p.position,
                c.id, c.club_id, c.weekly_wage, c.start_date, c.end_date, c.status
         from fd.players p
         left join fd.contracts c on c.campaign_id = p.campaign_id and c.player_id = p.id and c.status = 'active'
         where p.campaign_id = $1 and p.club_id = $2
         order by p.seed_index"
    )
    .bind(campaign_id)
    .bind(club_id)
    .fetch_all(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(rows.into_iter().map(|r| {
        let player = Player {
            id: r.0,
            campaign_id: r.1,
            club_id: r.2,
            first_name: r.3,
            last_name: r.4,
            position: r.5,
        };
        let contract = if let Some(cid) = r.6 {
            Some(Contract {
                id: cid,
                player_id: r.0,
                club_id: r.7.unwrap(),
                weekly_wage: r.8.unwrap(),
                start_date: r.9.unwrap(),
                end_date: r.10.unwrap(),
                status: r.11.unwrap(),
            })
        } else {
            None
        };
        (player, contract)
    }).collect())
}

pub async fn sign_contract(
    pool: &PgPool,
    campaign_id: i64,
    club_id: i64,
    req: SignContractRequest,
) -> Result<Contract, DynastyError> {
    if req.weekly_wage <= 0 || req.weekly_wage > 1_000_000 {
        return Err(DynastyError::InvalidInput("weekly_wage out of bounds".into()));
    }
    if req.years <= 0 || req.years > 10 {
        return Err(DynastyError::InvalidInput("contract years out of bounds".into()));
    }

    let mut tx = pool.begin().await?;

    let player_exists: bool = sqlx::query_scalar(
        "select exists(select 1 from fd.players where campaign_id = $1 and id = $2)"
    )
    .bind(campaign_id)
    .bind(req.player_id)
    .fetch_one(&mut *tx)
    .await?;

    if !player_exists {
        return Err(DynastyError::NotFound);
    }

    let active_count: i64 = sqlx::query_scalar(
        "select count(*) from fd.contracts where campaign_id = $1 and player_id = $2 and status = 'active'"
    )
    .bind(campaign_id)
    .bind(req.player_id)
    .fetch_one(&mut *tx)
    .await?;

    if active_count > 0 {
        return Err(DynastyError::InvalidInput("player already has active contract".into()));
    }

    let current_date: chrono::NaiveDate = sqlx::query_scalar(
        "select current_date from fd.campaigns where id = $1"
    )
    .bind(campaign_id)
    .fetch_one(&mut *tx)
    .await?;

    let end_date = current_date + chrono::Duration::days(365 * req.years as i64);

    let contract_id: i64 = sqlx::query_scalar(
        "insert into fd.contracts (campaign_id, player_id, club_id, weekly_wage, start_date, end_date, status)
         values ($1, $2, $3, $4, $5, $6, 'active')
         returning id"
    )
    .bind(campaign_id)
    .bind(req.player_id)
    .bind(club_id)
    .bind(req.weekly_wage)
    .bind(current_date)
    .bind(end_date)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Contract {
        id: contract_id,
        player_id: req.player_id,
        club_id,
        weekly_wage: req.weekly_wage,
        start_date: current_date,
        end_date,
        status: "active".to_string(),
    })
}

pub async fn release_contract(
    pool: &PgPool,
    campaign_id: i64,
    req: ReleaseContractRequest,
) -> Result<(), DynastyError> {
    let mut tx = pool.begin().await?;

    let rows_updated = sqlx::query(
        "update fd.contracts set status = 'released' where campaign_id = $1 and id = $2 and status = 'active'"
    )
    .bind(campaign_id)
    .bind(req.contract_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if rows_updated == 0 {
        return Err(DynastyError::NotFound);
    }

    tx.commit().await?;

    Ok(())
}
