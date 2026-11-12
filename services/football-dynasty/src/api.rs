use std::collections::HashSet;

use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use sherlock_core::{GameMode, RoomMember, build_round_plan};

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
        .route(
            "/api/v1/alias/round-plan",
            post(alias_round_plan).layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .route("/api/v1/alias/rounds/{round_id}/end", post(alias_end_round))
        .route(
            "/api/v1/alias/rounds/{round_id}/pause",
            post(alias_pause_round),
        )
        .route(
            "/api/v1/alias/rounds/{round_id}/resume",
            post(alias_resume_round),
        )
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AliasRoundPlanRequest {
    pub mode: String,
    pub teams: Vec<String>,
    pub members: Vec<AliasRoundPlanMember>,
    pub total_rounds: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AliasRoundPlanMember {
    pub player_id: i64,
    pub team_id: Option<String>,
    pub joined_at: String,
}

#[derive(Debug, Serialize)]
struct AliasPlannedRound {
    round_number: u32,
    team_id: String,
    explainer_id: Option<i64>,
}

async fn alias_round_plan(
    Extension(identity): Extension<Identity>,
    Json(request): Json<AliasRoundPlanRequest>,
) -> Result<Json<Vec<AliasPlannedRound>>, ApiError> {
    let mode = match request.mode.as_str() {
        "team" => GameMode::Teams,
        "1v1" => GameMode::OneVsOne,
        _ => return Err(ApiError::bad_request("invalid_alias_round_plan")),
    };

    let total_turns = request
        .teams
        .len()
        .checked_mul(usize::try_from(request.total_rounds).unwrap_or(usize::MAX));
    let unique_teams: HashSet<&str> = request.teams.iter().map(String::as_str).collect();
    let unique_players: HashSet<i64> = request
        .members
        .iter()
        .map(|member| member.player_id)
        .collect();

    if request.teams.is_empty()
        || request.teams.len() > 16
        || unique_teams.len() != request.teams.len()
        || request.teams.iter().any(|team| {
            team.trim().is_empty() || team.len() > 64 || team.chars().any(char::is_whitespace)
        })
        || request.total_rounds == 0
        || request.total_rounds > 64
        || total_turns.is_none_or(|count| count > 256)
        || request.members.len() > 128
        || unique_players.len() != request.members.len()
        || request.members.iter().any(|member| {
            member.player_id <= 0
                || chrono::DateTime::parse_from_rfc3339(&member.joined_at).is_err()
                || member.team_id.as_ref().is_some_and(|team| {
                    team.trim().is_empty()
                        || team.len() > 64
                        || team.chars().any(char::is_whitespace)
                })
        })
    {
        return Err(ApiError::bad_request("invalid_alias_round_plan"));
    }

    let members: Vec<RoomMember> = request
        .members
        .into_iter()
        .map(|member| RoomMember {
            player_id: member.player_id,
            team_id: member.team_id,
            joined_at: member.joined_at,
        })
        .collect();

    let plan = build_round_plan(
        mode,
        &request.teams,
        &members,
        identity.telegram_id,
        request.total_rounds,
    )
    .map_err(|_| ApiError::bad_request("invalid_alias_round_plan"))?;

    Ok(Json(
        plan.into_iter()
            .map(|round| AliasPlannedRound {
                round_number: round.round_number,
                team_id: round.team_id,
                explainer_id: round.explainer_id,
            })
            .collect(),
    ))
}

#[derive(Debug, Serialize)]
struct AliasRoundEndResponse {
    outcome: String,
    next_round_id: Option<Uuid>,
}

#[derive(Debug, FromRow)]
struct AliasRoundClaim {
    room_id: Uuid,
    team_id: Uuid,
    round_number: i32,
}

#[derive(Debug, Serialize, FromRow)]
struct AliasRoundPauseState {
    paused_at: Option<DateTime<Utc>>,
    paused_ms: i32,
}

async fn alias_end_round(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(round_id): Path<Uuid>,
) -> Result<Json<AliasRoundEndResponse>, ApiError> {
    let mut tx = state.db.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM public.rounds WHERE id = $1)")
            .bind(round_id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(ApiError::not_found());
    }

    let member_id: Option<i64> = sqlx::query_scalar(
        "SELECT rp.player_id
           FROM public.room_players AS rp
           JOIN public.rounds AS r ON r.room_id = rp.room_id
          WHERE r.id = $1 AND rp.player_id = $2
          FOR KEY SHARE OF rp",
    )
    .bind(round_id)
    .bind(identity.telegram_id)
    .fetch_optional(&mut *tx)
    .await?;
    if member_id.is_none() {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "room_membership_required",
        ));
    }

    let claimed = sqlx::query_as::<_, AliasRoundClaim>(
        "UPDATE public.rounds
            SET status = 'completed', ended_at = now()
          WHERE id = $1 AND status = 'active'
        RETURNING room_id, team_id, round_number",
    )
    .bind(round_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(claimed) = claimed else {
        tx.commit().await?;
        return Ok(Json(AliasRoundEndResponse {
            outcome: "already_ended".into(),
            next_round_id: None,
        }));
    };

    let correct_cards: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.round_cards WHERE round_id = $1 AND status = 'correct'",
    )
    .bind(round_id)
    .fetch_one(&mut *tx)
    .await?;
    let points = i32::try_from(correct_cards).map_err(|_| ApiError::internal())?;

    sqlx::query(
        "INSERT INTO public.scores (room_id, team_id, round_id, points)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (team_id, round_id) DO UPDATE SET points = EXCLUDED.points",
    )
    .bind(claimed.room_id)
    .bind(claimed.team_id)
    .bind(round_id)
    .bind(points)
    .execute(&mut *tx)
    .await?;

    let next_round_id = match claimed.round_number.checked_add(1) {
        Some(next_number) => {
            sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM public.rounds
                  WHERE room_id = $1 AND round_number = $2 AND status = 'pending'
                  LIMIT 1",
            )
            .bind(claimed.room_id)
            .bind(next_number)
            .fetch_optional(&mut *tx)
            .await?
        },
        None => None,
    };

    let outcome = if next_round_id.is_some() {
        "next_round"
    } else {
        sqlx::query(
            "UPDATE public.rooms
                SET status = 'finished', ended_at = now()
              WHERE id = $1 AND status <> 'finished'",
        )
        .bind(claimed.room_id)
        .execute(&mut *tx)
        .await?;
        "game_end"
    };

    tx.commit().await?;
    Ok(Json(AliasRoundEndResponse {
        outcome: outcome.into(),
        next_round_id,
    }))
}

async fn alias_pause_round(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(round_id): Path<Uuid>,
) -> Result<Json<AliasRoundPauseState>, ApiError> {
    let explainer_id: Option<i64> = sqlx::query_scalar(
        "SELECT COALESCE(explainer_id, 0)::bigint FROM public.rounds WHERE id = $1",
    )
    .bind(round_id)
    .fetch_optional(&state.db)
    .await?;
    let explainer_id = explainer_id.ok_or_else(ApiError::not_found)?;
    if explainer_id != identity.telegram_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "only_explainer_may_pause",
        ));
    }

    let max_pause_ms = i32::try_from(sherlock_core::MAX_ROUND_PAUSE_MS).unwrap_or(i32::MAX);
    let updated = sqlx::query_as::<_, AliasRoundPauseState>(
        "UPDATE public.rounds
            SET paused_at = now()
          WHERE id = $1 AND explainer_id = $2 AND status = 'active'
            AND paused_at IS NULL AND paused_ms < $3
        RETURNING paused_at, paused_ms",
    )
    .bind(round_id)
    .bind(identity.telegram_id)
    .bind(max_pause_ms)
    .fetch_optional(&state.db)
    .await?;

    let current = match updated {
        Some(value) => value,
        None => sqlx::query_as::<_, AliasRoundPauseState>(
            "SELECT paused_at, paused_ms FROM public.rounds WHERE id = $1 AND explainer_id = $2",
        )
        .bind(round_id)
        .bind(identity.telegram_id)
        .fetch_one(&state.db)
        .await?,
    };
    Ok(Json(current))
}

async fn alias_resume_round(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(round_id): Path<Uuid>,
) -> Result<Json<AliasRoundPauseState>, ApiError> {
    let explainer_id: Option<i64> = sqlx::query_scalar(
        "SELECT COALESCE(explainer_id, 0)::bigint FROM public.rounds WHERE id = $1",
    )
    .bind(round_id)
    .fetch_optional(&state.db)
    .await?;
    let explainer_id = explainer_id.ok_or_else(ApiError::not_found)?;
    if explainer_id != identity.telegram_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "only_explainer_may_resume",
        ));
    }

    let max_pause_ms = i32::try_from(sherlock_core::MAX_ROUND_PAUSE_MS).unwrap_or(i32::MAX);
    let updated = sqlx::query_as::<_, AliasRoundPauseState>(
        "UPDATE public.rounds
            SET paused_ms = LEAST(
                    $2,
                    paused_ms + (extract(epoch from (now() - paused_at)) * 1000)::integer
                ),
                paused_at = NULL
          WHERE id = $1 AND explainer_id = $3 AND paused_at IS NOT NULL
        RETURNING paused_at, paused_ms",
    )
    .bind(round_id)
    .bind(max_pause_ms)
    .bind(identity.telegram_id)
    .fetch_optional(&state.db)
    .await?;

    let current = match updated {
        Some(value) => value,
        None => sqlx::query_as::<_, AliasRoundPauseState>(
            "SELECT paused_at, paused_ms FROM public.rounds WHERE id = $1 AND explainer_id = $2",
        )
        .bind(round_id)
        .bind(identity.telegram_id)
        .fetch_one(&state.db)
        .await?,
    };
    Ok(Json(current))
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
    pub player_age: i32,
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

pub async fn list_campaigns(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
) -> Result<Json<Vec<CampaignSummary>>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let campaigns = sqlx::query_as::<_, CampaignSummary>(
        "SELECT id, name, mode, status, current_year, created_at FROM fd.campaigns WHERE owner_telegram_id = $1 ORDER BY created_at DESC"
    )
    .bind(identity.telegram_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
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
    set_owner_scope(&mut tx, identity.telegram_id).await?;
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
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let campaign = load_campaign(&mut tx, identity.telegram_id, campaign_id).await?;
    tx.commit().await?;
    Ok(Json(campaign))
}

async fn load_campaign(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
    campaign_id: Uuid,
) -> Result<CampaignView, ApiError> {
    let campaign = sqlx::query_as::<_, CampaignRow>(
        "SELECT id,name,mode,status,current_year,created_at,founder_character_id,player_character_id,dynasty_id FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2"
    )
    .bind(campaign_id).bind(owner_id).fetch_optional(&mut **tx).await?.ok_or_else(ApiError::not_found)?;

    let dynasty = sqlx::query_as::<_, DynastyView>(
        "SELECT id,name,head_character_id,prestige FROM fd.dynasties WHERE id=$1 AND campaign_id=$2"
    )
    .bind(campaign.dynasty_id).bind(campaign_id).fetch_one(&mut **tx).await?;

    let founder = sqlx::query_as::<_, CharacterView>(
        "SELECT id,full_name,age,life_status,is_heir FROM fd.characters WHERE id=$1 AND campaign_id=$2"
    )
    .bind(campaign.founder_character_id).bind(campaign_id).fetch_one(&mut **tx).await?;

    let characters = sqlx::query_as::<_, CharacterView>(
        "SELECT id,full_name,age,life_status,is_heir FROM fd.characters WHERE campaign_id=$1 ORDER BY is_heir DESC, age DESC, full_name"
    )
    .bind(campaign_id).fetch_all(&mut **tx).await?;

    let clubs = sqlx::query_as::<_, ClubView>(
        "SELECT id,name,city,reputation FROM fd.clubs WHERE campaign_id=$1 ORDER BY name",
    )
    .bind(campaign_id)
    .fetch_all(&mut **tx)
    .await?;

    let cash_accounts = sqlx::query_as::<_, CashAccountView>(
        "SELECT a.id,a.name,a.account_type,a.currency,COALESCE(SUM(CASE WHEN l.side=a.normal_balance THEN l.amount_minor ELSE -l.amount_minor END),0)::bigint AS balance_minor FROM fd.accounts a LEFT JOIN fd.journal_lines l ON l.campaign_id=a.campaign_id AND l.account_id=a.id WHERE a.campaign_id=$1 AND a.account_type='cash' GROUP BY a.id ORDER BY a.name"
    )
    .bind(campaign_id).fetch_all(&mut **tx).await?;

    let chronicle = sqlx::query_as::<_, ChronicleView>(
        "SELECT id,event_type,title,game_year,payload FROM fd.chronicle WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 50"
    )
    .bind(campaign_id).fetch_all(&mut **tx).await?;

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
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    if let Some(value) =
        reserve_command(&mut tx, identity.telegram_id, &key, "create_heir", &hash).await?
    {
        tx.rollback().await?;
        let cached: Json<CharacterView> = replay(value)?;
        return Ok((StatusCode::OK, cached));
    }

    let campaign = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT player_character_id,status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
    )
    .bind(campaign_id).bind(identity.telegram_id).fetch_optional(&mut *tx).await?
    .ok_or_else(ApiError::not_found)?;
    if campaign.1 != "active" {
        return Err(ApiError::conflict("campaign_not_active"));
    }

    let parent_age: i32 = sqlx::query_scalar(
        "SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2 AND life_status='alive'",
    )
    .bind(campaign.0)
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::conflict("player_not_alive"))?;
    if parent_age - request.age < 16 {
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
    set_owner_scope(&mut tx, identity.telegram_id).await?;
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
        "SELECT player_character_id,current_year,status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
    )
    .bind(campaign_id).bind(identity.telegram_id).fetch_optional(&mut *tx).await?
    .ok_or_else(ApiError::not_found)?;
    if campaign.2 != "active" {
        return Err(ApiError::conflict("campaign_not_active"));
    }

    let current_player_age: i32 = sqlx::query_scalar(
        "SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2 AND life_status='alive'",
    )
    .bind(campaign.0)
    .bind(campaign_id)
    .fetch_one(&mut *tx)
    .await?;
    // The player can request a decade, but a character's death is resolved at
    // the exact simulation year of the age-90 boundary, never after overshooting it.
    let elapsed_years = if current_player_age >= 90 {
        0
    } else {
        request.years.min(90 - current_player_age)
    };
    let next_year = campaign.1 + elapsed_years;
    if elapsed_years > 0 {
        sqlx::query(
            "UPDATE fd.characters SET age=age+$2 WHERE campaign_id=$1 AND life_status='alive'",
        )
        .bind(campaign_id)
        .bind(elapsed_years)
        .execute(&mut *tx)
        .await?;
    }
    let player_age: i32 =
        sqlx::query_scalar("SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2")
            .bind(campaign.0)
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;

    let mut status = "active".to_owned();
    let mut succession_available = false;
    if player_age >= 90 {
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
            "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'character_death','The head of the dynasty has died', $2, $3)"
        )
        .bind(campaign_id).bind(next_year).bind(json!({"deceased_character_id":campaign.0,"player_age":player_age,"succession_available":succession_available}))
        .execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE fd.campaigns SET current_year=$2,version=version+1,updated_at=now() WHERE id=$1")
            .bind(campaign_id).bind(next_year).execute(&mut *tx).await?;
        sqlx::query(
            "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'time_advanced','The years pass', $2, $3)"
        )
        .bind(campaign_id).bind(next_year).bind(json!({"years":request.years,"player_age":player_age}))
        .execute(&mut *tx).await?;
    }

    let response = AdvanceResult {
        current_year: next_year,
        player_age,
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
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let status: String =
        sqlx::query_scalar("SELECT status FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2")
            .bind(campaign_id)
            .bind(identity.telegram_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(ApiError::not_found)?;
    if status != "succession_pending" {
        return Err(ApiError::conflict("succession_not_pending"));
    }
    let heirs = sqlx::query_as::<_, CharacterView>(
        "SELECT c.id,c.full_name,c.age,c.life_status,c.is_heir FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=(SELECT id FROM fd.campaigns WHERE id=$1) AND r.parent_character_id=(SELECT player_character_id FROM fd.campaigns WHERE id=$1) AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18 ORDER BY c.age DESC,c.created_at ASC"
    )
    .bind(campaign_id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
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
    set_owner_scope(&mut tx, identity.telegram_id).await?;
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
        "SELECT player_character_id,dynasty_id,status,current_year FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE"
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

    sqlx::query("UPDATE fd.characters SET is_heir=false WHERE campaign_id=$1 AND is_heir=true")
        .bind(campaign_id)
        .execute(&mut *tx)
        .await?;

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
