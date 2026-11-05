use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{auth::Identity, errors::ApiError, state::AppState};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns",
            get(list_campaigns).post(create_campaign),
        )
        .route("/api/v1/campaigns/{campaign_id}", get(get_campaign))
        .route("/api/v1/campaigns/{campaign_id}/heirs", post(create_heir))
        .route(
            "/api/v1/campaigns/{campaign_id}/advance",
            post(advance_campaign),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/succession/preview",
            get(preview_succession),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/succession",
            post(execute_succession),
        )
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateCampaignRequest {
    pub name: String,
    pub mode: String,
    pub origin: String,
    pub founder_name: String,
    pub dynasty_name: String,
    pub club_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateHeirRequest {
    pub name: String,
    pub age: i32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdvanceRequest {
    pub years: i32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SuccessionRequest {
    pub heir_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CampaignCreated {
    pub id: Uuid,
    pub name: String,
    pub mode: String,
    pub status: String,
    pub current_year: i32,
    pub dynasty_id: Uuid,
    pub founder_id: Uuid,
    pub club_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct CampaignSummary {
    pub id: Uuid,
    pub name: String,
    pub mode: String,
    pub status: String,
    pub current_year: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct CharacterView {
    pub id: Uuid,
    pub full_name: String,
    pub age: i32,
    pub life_status: String,
    pub is_heir: bool,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct DynastyView {
    pub id: Uuid,
    pub name: String,
    pub head_character_id: Uuid,
    pub prestige: i32,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ClubView {
    pub id: Uuid,
    pub name: String,
    pub city: String,
    pub reputation: i32,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct CashAccountView {
    pub id: Uuid,
    pub name: String,
    pub account_type: String,
    pub currency: String,
    pub balance_minor: i64,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct ChronicleView {
    pub id: Uuid,
    pub event_type: String,
    pub title: String,
    pub game_year: i32,
    pub payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CampaignView {
    pub campaign: CampaignSummary,
    pub player_character_id: Uuid,
    pub founder: CharacterView,
    pub dynasty: DynastyView,
    pub characters: Vec<CharacterView>,
    pub clubs: Vec<ClubView>,
    pub cash_accounts: Vec<CashAccountView>,
    pub chronicle: Vec<ChronicleView>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AdvanceResult {
    pub current_year: i32,
    pub founder_age: i32,
    pub status: String,
    pub succession_available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SuccessionResult {
    pub campaign_id: Uuid,
    pub deceased_character_id: Uuid,
    pub heir_id: Uuid,
    pub dynasty_head_id: Uuid,
    pub status: String,
}

#[derive(Debug, FromRow)]
struct CampaignRow {
    id: Uuid,
    name: String,
    mode: String,
    status: String,
    current_year: i32,
    created_at: DateTime<Utc>,
    founder_character_id: Uuid,
    player_character_id: Uuid,
    dynasty_id: Uuid,
}

#[derive(Debug, FromRow)]
struct ReceiptRow {
    command_type: String,
    request_hash: String,
    response: Option<Value>,
}

fn valid_name(value: &str, max: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.chars().count() <= max
}

fn idempotency_key(headers: &HeaderMap) -> Result<String, ApiError> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| value.len() >= 8 && value.len() <= 128)
        .map(str::to_owned)
        .ok_or_else(|| ApiError::bad_request("idempotency_key_required"))
}

fn payload_hash<T: Serialize>(payload: &T) -> Result<String, ApiError> {
    let bytes = serde_json::to_vec(payload)?;
    let digest = Sha256::digest(bytes);
    Ok(format!("{digest:x}"))
}

async fn reserve_command(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
    key: &str,
    command: &str,
    request_hash: &str,
) -> Result<Option<Value>, ApiError> {
    let inserted = sqlx::query(
        "INSERT INTO fd.command_receipts (owner_telegram_id, idempotency_key, command_type, request_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (owner_telegram_id, idempotency_key) DO NOTHING"
    )
    .bind(owner_id)
    .bind(key)
    .bind(command)
    .bind(request_hash)
    .execute(&mut **tx)
    .await?;

    if inserted.rows_affected() == 1 {
        return Ok(None);
    }

    let existing = sqlx::query_as::<_, ReceiptRow>(
        "SELECT command_type, request_hash, response FROM fd.command_receipts WHERE owner_telegram_id = $1 AND idempotency_key = $2"
    )
    .bind(owner_id)
    .bind(key)
    .fetch_one(&mut **tx)
    .await?;

    if existing.command_type != command || existing.request_hash != request_hash {
        return Err(ApiError::conflict("idempotency_key_reused"));
    }

    existing
        .response
        .ok_or_else(|| ApiError::conflict("idempotency_request_in_progress"))
        .map(Some)
}

async fn complete_command(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
    key: &str,
    campaign_id: Uuid,
    response: &impl Serialize,
) -> Result<(), ApiError> {
    let value = serde_json::to_value(response)?;
    sqlx::query(
        "UPDATE fd.command_receipts SET campaign_id = $3, response = $4 WHERE owner_telegram_id = $1 AND idempotency_key = $2"
    )
    .bind(owner_id)
    .bind(key)
    .bind(campaign_id)
    .bind(value)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn replay<T: DeserializeOwned>(value: Value) -> Result<Json<T>, ApiError> {
    Ok(Json(serde_json::from_value(value)?))
}

pub async fn list_campaigns(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
) -> Result<Json<Vec<CampaignSummary>>, ApiError> {
    let campaigns = sqlx::query_as::<_, CampaignSummary>(
        "SELECT id, name, mode, status, current_year, created_at FROM fd.campaigns WHERE owner_telegram_id = $1 ORDER BY created_at DESC"
    )
    .bind(identity.telegram_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(campaigns))
}

pub async fn create_campaign(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    headers: HeaderMap,
    Json(request): Json<CreateCampaignRequest>,
) -> Result<(StatusCode, Json<CampaignCreated>), ApiError> {
    if !valid_name(&request.name, 64)
        || !valid_name(&request.founder_name, 80)
        || !valid_name(&request.dynasty_name, 64)
        || !valid_name(&request.club_name, 64)
        || !matches!(request.mode.as_str(), "sandbox" | "scenario")
        || !matches!(
            request.origin.as_str(),
            "football_family"
                | "entrepreneur"
                | "former_player"
                | "agent"
                | "executive"
                | "newcomer"
        )
    {
        return Err(ApiError::bad_request("invalid_campaign_setup"));
    }

    let key = idempotency_key(&headers)?;
    let hash = payload_hash(&request)?;
    let mut tx = state.db.begin().await?;
    if let Some(value) = reserve_command(
        &mut tx,
        identity.telegram_id,
        &key,
        "create_campaign",
        &hash,
    )
    .await?
    {
        tx.rollback().await?;
        let cached: Json<CampaignCreated> = replay(value)?;
        return Ok((StatusCode::OK, cached));
    }

    let campaign_id = Uuid::new_v4();
    let dynasty_id = Uuid::new_v4();
    let founder_id = Uuid::new_v4();
    let club_id = Uuid::new_v4();
    let seed = (Uuid::new_v4().as_u128() & i64::MAX as u128) as i64;

    sqlx::query(
        "INSERT INTO fd.campaigns (id, owner_telegram_id, name, mode, seed, current_year, status, dynasty_id, founder_character_id, player_character_id) VALUES ($1,$2,$3,$4,$5,2026,'active',$6,$7,$7)"
    )
    .bind(campaign_id).bind(identity.telegram_id).bind(request.name.trim())
    .bind(&request.mode).bind(seed).bind(dynasty_id).bind(founder_id)
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO fd.dynasties (id, campaign_id, name, head_character_id, prestige) VALUES ($1,$2,$3,$4,0)"
    )
    .bind(dynasty_id).bind(campaign_id).bind(request.dynasty_name.trim()).bind(founder_id)
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO fd.characters (id,campaign_id,full_name,age,life_status,is_heir,origin) VALUES ($1,$2,$3,40,'alive',false,$4)"
    )
    .bind(founder_id).bind(campaign_id).bind(request.founder_name.trim()).bind(&request.origin)
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO fd.clubs (id,campaign_id,name,city,reputation) VALUES ($1,$2,$3,'Northbridge',35)"
    )
    .bind(club_id).bind(campaign_id).bind(request.club_name.trim())
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO fd.club_ownership (campaign_id,club_id,owner_type,owner_id,equity_bps,voting_bps) VALUES ($1,$2,'dynasty',$3,10000,10000)"
    )
    .bind(campaign_id).bind(club_id).bind(dynasty_id)
    .execute(&mut *tx).await?;

    let founder_cash = Uuid::new_v4();
    let club_cash = Uuid::new_v4();
    let opening_capital = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fd.accounts (id,campaign_id,name,account_type,owner_type,owner_id,currency,normal_balance) VALUES ($1,$2,'Founder cash','cash','character',$3,'EUR','debit'),($4,$2,'Club treasury','cash','club',$5,'EUR','debit'),($6,$2,'Opening capital','equity','system',$2,'EUR','credit')"
    )
    .bind(founder_cash).bind(campaign_id).bind(founder_id)
    .bind(club_cash).bind(club_id).bind(opening_capital)
    .execute(&mut *tx).await?;

    let journal_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fd.journal_entries (id,campaign_id,idempotency_key,memo,game_year) VALUES ($1,$2,'campaign-opening','Initial campaign capital',2026)"
    )
    .bind(journal_id).bind(campaign_id).execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO fd.journal_lines (campaign_id,journal_entry_id,account_id,side,amount_minor) VALUES ($1,$2,$3,'debit',2500000000),($1,$2,$4,'debit',1000000000),($1,$2,$5,'credit',3500000000)"
    )
    .bind(campaign_id).bind(journal_id).bind(founder_cash).bind(club_cash).bind(opening_capital)
    .execute(&mut *tx).await?;

    sqlx::query(
        "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'campaign_founded','The dynasty begins',2026,$2)"
    )
    .bind(campaign_id)
    .bind(json!({"founder_id":founder_id,"dynasty_id":dynasty_id,"club_id":club_id,"origin":request.origin}))
    .execute(&mut *tx).await?;

    let response = CampaignCreated {
        id: campaign_id,
        name: request.name.trim().to_owned(),
        mode: request.mode,
        status: "active".to_owned(),
        current_year: 2026,
        dynasty_id,
        founder_id,
        club_id,
    };
    complete_command(&mut tx, identity.telegram_id, &key, campaign_id, &response).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

pub async fn get_campaign(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<CampaignView>, ApiError> {
    Ok(Json(
        load_campaign(&state.db, identity.telegram_id, campaign_id).await?,
    ))
}

async fn load_campaign(
    pool: &sqlx::PgPool,
    owner_id: i64,
    campaign_id: Uuid,
) -> Result<CampaignView, ApiError> {
    let campaign = sqlx::query_as::<_, CampaignRow>(
        "SELECT id,name,mode,status,current_year,created_at,founder_character_id,player_character_id,dynasty_id FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2"
    )
    .bind(campaign_id).bind(owner_id).fetch_optional(pool).await?.ok_or_else(ApiError::not_found)?;

    let dynasty = sqlx::query_as::<_, DynastyView>(
        "SELECT id,name,head_character_id,prestige FROM fd.dynasties WHERE id=$1 AND campaign_id=$2"
    )
    .bind(campaign.dynasty_id).bind(campaign_id).fetch_one(pool).await?;

    let founder = sqlx::query_as::<_, CharacterView>(
        "SELECT id,full_name,age,life_status,is_heir FROM fd.characters WHERE id=$1 AND campaign_id=$2"
    )
    .bind(campaign.founder_character_id).bind(campaign_id).fetch_one(pool).await?;

    let characters = sqlx::query_as::<_, CharacterView>(
        "SELECT id,full_name,age,life_status,is_heir FROM fd.characters WHERE campaign_id=$1 ORDER BY is_heir DESC, age DESC, full_name"
    )
    .bind(campaign_id).fetch_all(pool).await?;

    let clubs = sqlx::query_as::<_, ClubView>(
        "SELECT id,name,city,reputation FROM fd.clubs WHERE campaign_id=$1 ORDER BY name",
    )
    .bind(campaign_id)
    .fetch_all(pool)
    .await?;

    let cash_accounts = sqlx::query_as::<_, CashAccountView>(
        "SELECT a.id,a.name,a.account_type,a.currency,COALESCE(SUM(CASE WHEN l.side=a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::bigint AS balance_minor FROM fd.accounts a LEFT JOIN fd.journal_lines l ON l.campaign_id=a.campaign_id AND l.account_id=a.id WHERE a.campaign_id=$1 AND a.account_type='cash' GROUP BY a.id ORDER BY a.name"
    )
    .bind(campaign_id).fetch_all(pool).await?;

    let chronicle = sqlx::query_as::<_, ChronicleView>(
        "SELECT id,event_type,title,game_year,payload FROM fd.chronicle WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(campaign_id).fetch_all(pool).await?;

    Ok(CampaignView {
        campaign: CampaignSummary {
            id: campaign.id,
            name: campaign.name,
            mode: campaign.mode,
            status: campaign.status,
            current_year: campaign.current_year,
            created_at: campaign.created_at,
        },
        player_character_id: campaign.player_character_id,
        founder,
        dynasty,
        characters,
        clubs,
        cash_accounts,
        chronicle,
    })
}

pub async fn create_heir(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<CreateHeirRequest>,
) -> Result<(StatusCode, Json<CharacterView>), ApiError> {
    if !valid_name(&request.name, 80) || !(0..=70).contains(&request.age) {
        return Err(ApiError::bad_request("invalid_heir"));
    }
    let key = idempotency_key(&headers)?;
    let hash = payload_hash(&(campaign_id, &request))?;
    let mut tx = state.db.begin().await?;
    if let Some(value) =
        reserve_command(&mut tx, identity.telegram_id, &key, "create_heir", &hash).await?
    {
        tx.rollback().await?;
        let cached: Json<CharacterView> = replay(value)?;
        return Ok((StatusCode::OK, cached));
    }

    let campaign = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT founder_character_id,status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
    )
    .bind(campaign_id).bind(identity.telegram_id).fetch_optional(&mut *tx).await?
    .ok_or_else(ApiError::not_found)?;
    if campaign.1 != "active" {
        return Err(ApiError::conflict("campaign_not_active"));
    }

    let founder_age: i32 = sqlx::query_scalar(
        "SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2 AND life_status='alive'",
    )
    .bind(campaign.0)
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::conflict("founder_not_alive"))?;
    if founder_age - request.age < 16 {
        return Err(ApiError::bad_request("invalid_parent_child_age_gap"));
    }

    let heir_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fd.characters (id,campaign_id,full_name,age,life_status,is_heir,origin) VALUES ($1,$2,$3,$4,'alive',true,'family')"
    )
    .bind(heir_id).bind(campaign_id).bind(request.name.trim()).bind(request.age)
    .execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO fd.family_relations (campaign_id,parent_character_id,child_character_id,relation_type) VALUES ($1,$2,$3,'parent_child')"
    )
    .bind(campaign_id).bind(campaign.0).bind(heir_id).execute(&mut *tx).await?;
    let current_year: i32 = sqlx::query_scalar("SELECT current_year FROM fd.campaigns WHERE id=$1")
        .bind(campaign_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'heir_born','A new heir joins the family', $2, $3)"
    )
    .bind(campaign_id).bind(current_year).bind(json!({"heir_id":heir_id,"name":request.name}))
    .execute(&mut *tx).await?;

    let response = CharacterView {
        id: heir_id,
        full_name: request.name.trim().to_owned(),
        age: request.age,
        life_status: "alive".to_owned(),
        is_heir: true,
    };
    complete_command(&mut tx, identity.telegram_id, &key, campaign_id, &response).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

pub async fn advance_campaign(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<AdvanceRequest>,
) -> Result<Json<AdvanceResult>, ApiError> {
    if !(1..=10).contains(&request.years) {
        return Err(ApiError::bad_request(
            "advance_must_be_between_1_and_10_years",
        ));
    }
    let key = idempotency_key(&headers)?;
    let hash = payload_hash(&(campaign_id, &request))?;
    let mut tx = state.db.begin().await?;
    if let Some(value) = reserve_command(
        &mut tx,
        identity.telegram_id,
        &key,
        "advance_campaign",
        &hash,
    )
    .await?
    {
        tx.rollback().await?;
        return replay(value);
    }

    let campaign = sqlx::query_as::<_, (Uuid, i32, String)>(
        "SELECT founder_character_id,current_year,status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
    )
    .bind(campaign_id).bind(identity.telegram_id).fetch_optional(&mut *tx).await?
    .ok_or_else(ApiError::not_found)?;
    if campaign.2 != "active" {
        return Err(ApiError::conflict("campaign_not_active"));
    }

    let next_year = campaign.1 + request.years;
    sqlx::query("UPDATE fd.characters SET age=age+$2 WHERE campaign_id=$1 AND life_status='alive'")
        .bind(campaign_id)
        .bind(request.years)
        .execute(&mut *tx)
        .await?;
    let founder_age: i32 =
        sqlx::query_scalar("SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2")
            .bind(campaign.0)
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;

    let mut status = "active".to_owned();
    let mut succession_available = false;
    if founder_age >= 90 {
        sqlx::query(
            "UPDATE fd.characters SET life_status='deceased' WHERE id=$1 AND campaign_id=$2",
        )
        .bind(campaign.0)
        .bind(campaign_id)
        .execute(&mut *tx)
        .await?;
        let eligible_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=$1 AND r.parent_character_id=$2 AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18"
        )
        .bind(campaign_id).bind(campaign.0).fetch_one(&mut *tx).await?;
        succession_available = eligible_count > 0;
        status = if succession_available {
            "succession_pending"
        } else {
            "ended_no_heir"
        }
        .to_owned();
        sqlx::query("UPDATE fd.campaigns SET current_year=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1")
            .bind(campaign_id).bind(next_year).bind(&status).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'founder_death','The founder has died', $2, $3)"
        )
        .bind(campaign_id).bind(next_year).bind(json!({"founder_id":campaign.0,"founder_age":founder_age,"succession_available":succession_available}))
        .execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE fd.campaigns SET current_year=$2,version=version+1,updated_at=now() WHERE id=$1")
            .bind(campaign_id).bind(next_year).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'time_advanced','The years pass', $2, $3)"
        )
        .bind(campaign_id).bind(next_year).bind(json!({"years":request.years,"founder_age":founder_age}))
        .execute(&mut *tx).await?;
    }

    let response = AdvanceResult {
        current_year: next_year,
        founder_age,
        status,
        succession_available,
    };
    complete_command(&mut tx, identity.telegram_id, &key, campaign_id, &response).await?;
    tx.commit().await?;
    Ok(Json(response))
}

pub async fn preview_succession(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<Vec<CharacterView>>, ApiError> {
    let status: String =
        sqlx::query_scalar("SELECT status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2")
            .bind(campaign_id)
            .bind(identity.telegram_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(ApiError::not_found)?;
    if status != "succession_pending" {
        return Err(ApiError::conflict("succession_not_pending"));
    }
    let heirs = sqlx::query_as::<_, CharacterView>(
        "SELECT c.id,c.full_name,c.age,c.life_status,c.is_heir FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=(SELECT id FROM fd.campaigns WHERE id=$1) AND r.parent_character_id=(SELECT founder_character_id FROM fd.campaigns WHERE id=$1) AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18 ORDER BY c.age DESC,c.created_at ASC"
    )
    .bind(campaign_id).fetch_all(&state.db).await?;
    Ok(Json(heirs))
}

pub async fn execute_succession(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<SuccessionRequest>,
) -> Result<Json<SuccessionResult>, ApiError> {
    let key = idempotency_key(&headers)?;
    let hash = payload_hash(&(campaign_id, &request))?;
    let mut tx = state.db.begin().await?;
    if let Some(value) = reserve_command(
        &mut tx,
        identity.telegram_id,
        &key,
        "execute_succession",
        &hash,
    )
    .await?
    {
        tx.rollback().await?;
        return replay(value);
    }

    let campaign = sqlx::query_as::<_, (Uuid, Uuid, String, i32)>(
        "SELECT founder_character_id,dynasty_id,status,current_year FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
    )
    .bind(campaign_id).bind(identity.telegram_id).fetch_optional(&mut *tx).await?
    .ok_or_else(ApiError::not_found)?;
    if campaign.2 != "succession_pending" {
        return Err(ApiError::conflict("succession_not_pending"));
    }

    let heir = if let Some(heir_id) = request.heir_id {
        sqlx::query_as::<_, CharacterView>(
            "SELECT c.id,c.full_name,c.age,c.life_status,c.is_heir FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=$1 AND r.parent_character_id=$2 AND r.child_character_id=$3 AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18"
        )
        .bind(campaign_id).bind(campaign.0).bind(heir_id).fetch_optional(&mut *tx).await?
    } else {
        sqlx::query_as::<_, CharacterView>(
            "SELECT c.id,c.full_name,c.age,c.life_status,c.is_heir FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=$1 AND r.parent_character_id=$2 AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18 ORDER BY c.age DESC,c.created_at ASC LIMIT 1"
        )
        .bind(campaign_id).bind(campaign.0).fetch_optional(&mut *tx).await?
    }.ok_or_else(|| ApiError::conflict("no_eligible_heir"))?;

    sqlx::query("UPDATE fd.dynasties SET head_character_id=$2,prestige=prestige+10 WHERE id=$1 AND campaign_id=$3")
        .bind(campaign.1).bind(heir.id).bind(campaign_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE fd.campaigns SET player_character_id=$2,status='active',version=version+1,updated_at=now() WHERE id=$1")
        .bind(campaign_id).bind(heir.id).execute(&mut *tx).await?;
    sqlx::query("UPDATE fd.accounts SET owner_id=$3 WHERE campaign_id=$1 AND owner_type='character' AND owner_id=$2")
        .bind(campaign_id).bind(campaign.0).bind(heir.id).execute(&mut *tx).await?;

    let succession_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO fd.succession_events (id,campaign_id,deceased_character_id,heir_character_id,game_year) VALUES ($1,$2,$3,$4,$5)"
    )
    .bind(succession_id).bind(campaign_id).bind(campaign.0).bind(heir.id).bind(campaign.3)
    .execute(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'succession_completed','The heir takes the seat', $2, $3)"
    )
    .bind(campaign_id).bind(campaign.3).bind(json!({"deceased_id":campaign.0,"heir_id":heir.id,"dynasty_id":campaign.1}))
    .execute(&mut *tx).await?;

    let response = SuccessionResult {
        campaign_id,
        deceased_character_id: campaign.0,
        heir_id: heir.id,
        dynasty_head_id: heir.id,
        status: "active".to_owned(),
    };
    complete_command(&mut tx, identity.telegram_id, &key, campaign_id, &response).await?;
    tx.commit().await?;
    Ok(Json(response))
}
