use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
};
use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use std::collections::{BTreeMap, HashSet};
use uuid::Uuid;

use crate::{
    auth::Identity,
    errors::ApiError,
    match_engine::{MatchSquad, PlayerMatchEventKind, SubstitutionPlan, simulate_player_match},
    squad::{Formation, Lineup, Player, PlayerAttributes, Position, TacticalPlan},
    player_lifecycle::{apply_training, recover, PlayerCareer, TrainingFocus, TrainingPlan},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/time/advance",
            post(advance_time),
        )
        .route("/api/v1/campaigns/{campaign_id}/events", get(list_events))
        .route("/api/v1/campaigns/{campaign_id}/world/events", get(list_world_events))
        .route("/api/v1/campaigns/{campaign_id}/world/events/{event_id}/respond", post(respond_world_event))
        .route("/api/v1/campaigns/{campaign_id}/season", get(get_season))
        .route("/api/v1/campaigns/{campaign_id}/squad", get(get_squad))
        .route("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}/lineup", post(save_lineup))
        .route("/api/v1/campaigns/{campaign_id}/training", post(set_training))
        .route("/api/v1/campaigns/{campaign_id}/fixtures/{fixture_id}", get(get_fixture))
        .route(
            "/api/v1/campaigns/{campaign_id}/events/{event_id}/resolve",
            post(resolve_event),
        )
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdvanceTimeRequest {
    pub days: i32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AdvanceTimeResult {
    pub from_date: NaiveDate,
    pub current_date: NaiveDate,
    pub current_year: i32,
    pub player_age: i32,
    pub status: String,
    pub generated_events: i64,
    pub expired_events: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct GameEvent {
    pub id: Uuid,
    pub event_type: String,
    pub title: String,
    pub body: String,
    pub game_date: NaiveDate,
    pub expires_on: NaiveDate,
    pub priority: i16,
    pub choices: Value,
    pub status: String,
    pub resolution: Option<Value>,
}

#[derive(Debug, Serialize, sqlx::FromRow, Clone)]
pub struct SeasonFixture {
    pub id: Uuid,
    pub season_year: i32,
    pub matchday: i16,
    pub match_date: NaiveDate,
    pub home_team: String,
    pub away_team: String,
    pub status: String,
    pub home_goals: Option<i16>,
    pub away_goals: Option<i16>,
}

#[derive(Debug, Serialize)]
pub struct LeagueStanding {
    pub team: String,
    pub played: i32,
    pub wins: i32,
    pub draws: i32,
    pub losses: i32,
    pub goals_for: i32,
    pub goals_against: i32,
    pub points: i32,
}

#[derive(Debug, Serialize)]
pub struct SeasonView {
    pub season_year: i32,
    pub fixtures: Vec<SeasonFixture>,
    pub standings: Vec<LeagueStanding>,
}

#[derive(Default)]
struct StandingTotals {
    played: i32,
    wins: i32,
    draws: i32,
    losses: i32,
    goals_for: i32,
    goals_against: i32,
    points: i32,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CampaignSquadPlayerView {
    pub id: Uuid,
    pub full_name: String,
    pub position: String,
    pub shirt_number: i16,
    pub age: i16,
    pub pace: i16,
    pub shooting: i16,
    pub passing: i16,
    pub defending: i16,
    pub physical: i16,
    pub goalkeeping: i16,
    pub stamina: i16,
    pub morale: i16,
    pub fatigue: i16,
    pub potential: i16,
    pub market_value_minor: i64,
    pub wage_minor: i64,
    pub contract_until: Option<NaiveDate>,
    pub injured_until: Option<NaiveDate>,
    pub suspended_until: Option<NaiveDate>,
    pub training_focus: Option<String>,
    pub training_intensity: Option<i16>,
}

#[derive(Debug, Deserialize)]
pub struct SaveLineupRequest { pub formation: String, pub starter_ids: Vec<Uuid>, #[serde(default)] pub substitute_ids: Vec<Uuid> }
#[derive(Debug, Serialize)]
pub struct SaveLineupResponse { pub fixture_id: Uuid, pub team_id: Uuid, pub formation: String, pub starters_saved: usize, pub substitutes_saved: usize }

#[derive(Debug, Serialize)]
pub struct CampaignSquadView {
    pub team_id: Uuid,
    pub team_name: String,
    pub formation: String,
    pub next_fixture_id: Option<Uuid>,
    pub starter_ids: Vec<Uuid>,
    pub substitute_ids: Vec<Uuid>,
    pub players: Vec<CampaignSquadPlayerView>,
}

#[derive(Debug, sqlx::FromRow)]
struct MatchPlayerRow {
    id: Uuid,
    role: String,
    position: String,
    pace: i16,
    shooting: i16,
    passing: i16,
    defending: i16,
    physical: i16,
    goalkeeping: i16,
    stamina: i16,
    morale: i16,
    fatigue: i16,
    injured_until: Option<NaiveDate>,
    suspended_until: Option<NaiveDate>,
}

async fn load_match_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    fixture_id: Uuid,
    team_id: Uuid,
    match_date: NaiveDate,
) -> Result<MatchSquad, ApiError> {
    let tactics = crate::fd_query_as!((String, i16, i16, i16, i16),
        "SELECT COALESCE((SELECT ml.formation FROM fd.match_lineups ml
                    WHERE ml.campaign_id=$1 AND ml.fixture_id=$2 AND ml.team_id=$3 LIMIT 1),tt.formation),
                tt.pressing,tt.tempo,tt.width,tt.attacking_intent
         FROM fd.team_tactics tt WHERE tt.campaign_id=$1 AND tt.team_id=$3")
        .bind(campaign_id).bind(fixture_id).bind(team_id).fetch_optional(&mut **tx).await?
        .unwrap_or(("4-3-3".to_owned(),50,50,50,50));
    let (formation, midfielders, forwards) = match tactics.0.as_str() {
        "4-3-3" => (Formation { defenders:4, midfielders:3, forwards:3 },3,3),
        "4-4-2" => (Formation { defenders:4, midfielders:4, forwards:2 },4,2),
        "3-5-2" => (Formation { defenders:3, midfielders:5, forwards:2 },5,2),
        "4-2-3-1" => (Formation { defenders:4, midfielders:5, forwards:1 },5,1),
        "3-4-3" => (Formation { defenders:3, midfielders:4, forwards:3 },4,3),
        _ => return Err(ApiError::conflict("invalid_team_formation")),
    };
    let rows = crate::fd_query_as!(MatchPlayerRow,
        "SELECT p.id,ml.role,p.position,p.pace,p.shooting,p.passing,p.defending,p.physical,
                p.goalkeeping,p.stamina,p.morale,p.fatigue,p.injured_until,p.suspended_until
         FROM fd.match_lineups ml JOIN fd.players p ON p.campaign_id=ml.campaign_id AND p.id=ml.player_id
         WHERE ml.campaign_id=$1 AND ml.fixture_id=$2 AND ml.team_id=$3
         ORDER BY p.shirt_number")
        .bind(campaign_id).bind(fixture_id).bind(team_id).fetch_all(&mut **tx).await?;
    let mut starters = Vec::with_capacity(11);
    let mut bench = Vec::with_capacity(rows.len().saturating_sub(11));
    let mut unavailable_starters = Vec::new();
    let mut promoted_starters = Vec::new();
    for row in rows {
        let position = match row.position.as_str() {
            "goalkeeper" => Position::Goalkeeper,
            "defender" => Position::Defender,
            "midfielder" => Position::Midfielder,
            "forward" => Position::Forward,
            _ => return Err(ApiError::conflict("invalid_player_position")),
        };
        let to_rating = |value: i16| u8::try_from(value).map_err(|_| ApiError::conflict("invalid_player_rating"));
        let unavailable = row.injured_until.is_some_and(|until| until >= match_date)
            || row.suspended_until.is_some_and(|until| until >= match_date);
        if unavailable {
            if row.role == "starter" { unavailable_starters.push(row.id); }
            continue;
        }
        let player = Player {
            id: row.id,
            position,
            attributes: PlayerAttributes {
                pace:to_rating(row.pace)?, shooting:to_rating(row.shooting)?,
                passing:to_rating(row.passing)?, defending:to_rating(row.defending)?,
                physical:to_rating(row.physical)?, goalkeeping:to_rating(row.goalkeeping)?,
                stamina:to_rating(row.stamina)?,
            },
            morale:to_rating(row.morale)?,
            fatigue:to_rating(row.fatigue)?,
            injured:row.injured_until.is_some_and(|until| until >= match_date),
            suspended:row.suspended_until.is_some_and(|until| until >= match_date),
        };
        match row.role.as_str() {
            "starter" => starters.push(player),
            "substitute" => bench.push(player),
            _ => return Err(ApiError::conflict("invalid_match_lineup_role")),
        }
    }
    // A player can become unavailable after the lineup was saved. Promote an
    // eligible substitute in the same position before kickoff so a stale saved
    // XI cannot prevent the fixture from being simulated.
    for (position, required) in [
        (Position::Goalkeeper, 1usize),
        (Position::Defender, usize::from(formation.defenders)),
        (Position::Midfielder, midfielders),
        (Position::Forward, forwards),
    ] {
        while starters.iter().filter(|player| player.position == position).count() < required {
            let Some(index) = bench.iter().position(|player| player.position == position) else { break; };
            let promoted = bench.remove(index);
            promoted_starters.push(promoted.id);
            starters.push(promoted);
        }
    }
    // Persist the adjusted roles before player_match_stats derives minutes from
    // the lineup snapshot. Otherwise a promoted substitute would be simulated
    // as a starter in memory but recorded as a 0-minute substitute in PostgreSQL.
    for player_id in &unavailable_starters {
        crate::fd_query!("UPDATE fd.match_lineups SET role='substitute' WHERE campaign_id=$1 AND fixture_id=$2 AND team_id=$3 AND player_id=$4")
            .bind(campaign_id).bind(fixture_id).bind(team_id).bind(player_id)
            .execute(&mut **tx).await?;
    }
    for player_id in &promoted_starters {
        crate::fd_query!("UPDATE fd.match_lineups SET role='starter' WHERE campaign_id=$1 AND fixture_id=$2 AND team_id=$3 AND player_id=$4")
            .bind(campaign_id).bind(fixture_id).bind(team_id).bind(player_id)
            .execute(&mut **tx).await?;
    }
    let goalkeeper_count = starters.iter().filter(|player| player.position == Position::Goalkeeper).count();
    let defender_count = starters.iter().filter(|player| player.position == Position::Defender).count();
    let midfielder_count = starters.iter().filter(|player| player.position == Position::Midfielder).count();
    let forward_count = starters.iter().filter(|player| player.position == Position::Forward).count();
    if starters.len() != 11
        || goalkeeper_count != 1
        || defender_count != usize::from(formation.defenders)
        || midfielder_count != midfielders
        || forward_count != forwards
    {
        return Err(ApiError::conflict("invalid_persisted_match_lineup"));
    }
    Ok(MatchSquad {
        team_id,
        starting:Lineup {
            starters, formation,
            tactics:TacticalPlan {
                pressing:u8::try_from(tactics.1).unwrap_or(50),
                tempo:u8::try_from(tactics.2).unwrap_or(50),
                width:u8::try_from(tactics.3).unwrap_or(50),
                attacking_intent:u8::try_from(tactics.4).unwrap_or(50),
            },
        },
        bench,
    })
}

fn automatic_substitutions(squad: &MatchSquad, minutes: u8) -> Vec<SubstitutionPlan> {
    let mut plans=Vec::new();
    let mut used=std::collections::BTreeSet::new();
    for (minute,position) in [(60,Position::Forward),(70,Position::Midfielder),(80,Position::Defender)] {
        if minute>minutes { continue; }
        let incoming=squad.bench.iter()
            .filter(|p|p.position==position && !used.contains(&p.id))
            .max_by_key(|p|(p.attributes.stamina,100_u8.saturating_sub(p.fatigue),p.id));
        let outgoing=squad.starting.starters.iter()
            .filter(|p|p.position==position && !used.contains(&p.id))
            .min_by_key(|p|(p.attributes.stamina,100_u8.saturating_sub(p.fatigue),p.id));
        if let (Some(incoming),Some(outgoing))=(incoming,outgoing) {
            used.insert(incoming.id); used.insert(outgoing.id);
            plans.push(SubstitutionPlan {
                minute,
                outgoing_player_id:outgoing.id,
                incoming_player_id:incoming.id,
            });
        }
    }
    plans
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct MatchEventView {
    pub sequence: i16,
    pub minute: i16,
    pub event_type: String,
    pub team_id: Option<Uuid>,
    pub team_name: Option<String>,
    pub player_id: Option<Uuid>,
    pub player_name: Option<String>,
    pub related_player_id: Option<Uuid>,
    pub related_player_name: Option<String>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct SpatialEventView {
    pub sequence: i16, pub minute: i16, pub event_type: String,
    pub team_id: Uuid, pub player_id: Uuid, pub related_player_id: Option<Uuid>,
    pub from_x: i16, pub from_y: i16, pub to_x: i16, pub to_y: i16,
}
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PlayerHeatmapView {
    pub team_id: Uuid, pub player_id: Uuid, pub bins: Value, pub samples: i32,
}
#[derive(Debug, Serialize)]
pub struct FixtureMatchView {
    pub fixture: SeasonFixture,
    pub events: Vec<MatchEventView>,
    pub spatial_events: Vec<SpatialEventView>,
    pub heatmaps: Vec<PlayerHeatmapView>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ResolveEventRequest {
    pub choice_id: String,
}

fn command_key(headers: &HeaderMap) -> Result<String, ApiError> {
    headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| v.len() >= 8 && v.len() <= 128)
        .map(str::to_owned)
        .ok_or_else(|| ApiError::bad_request("idempotency_key_required"))
}

fn request_hash<T: Serialize>(value: &T) -> Result<String, ApiError> {
    let bytes = serde_json::to_vec(value)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

async fn set_owner(tx: &mut Transaction<'_, Postgres>, owner_id: i64) -> Result<(), ApiError> {
    crate::fd_query!("SET LOCAL ROLE fd_runtime")
        .execute(&mut **tx)
        .await?;
    crate::fd_query!("SELECT set_config('fd.telegram_id', $1, true)")
        .bind(owner_id.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn reserve(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
    key: &str,
    command: &str,
    hash: &str,
) -> Result<Option<Value>, ApiError> {
    let inserted = crate::fd_query!(
        "INSERT INTO fd.command_receipts(owner_telegram_id,idempotency_key,command_type,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    )
    .bind(owner_id).bind(key).bind(command).bind(hash)
    .execute(&mut **tx).await?;
    if inserted.rows_affected() == 1 {
        return Ok(None);
    }
    let row: (String, String, Option<Value>) = crate::fd_query_as!((String, String, Option<Value>),
        "SELECT command_type,request_hash,response FROM fd.command_receipts WHERE owner_telegram_id=$1 AND idempotency_key=$2",
    )
    .bind(owner_id).bind(key).fetch_one(&mut **tx).await?;
    if row.0 != command || row.1 != hash {
        return Err(ApiError::conflict("idempotency_key_reused"));
    }
    row.2
        .map(Some)
        .ok_or_else(|| ApiError::conflict("idempotency_request_in_progress"))
}

async fn complete(
    tx: &mut Transaction<'_, Postgres>,
    owner_id: i64,
    key: &str,
    campaign_id: Uuid,
    response: &impl Serialize,
) -> Result<(), ApiError> {
    crate::fd_query!("UPDATE fd.command_receipts SET campaign_id=$3,response=$4 WHERE owner_telegram_id=$1 AND idempotency_key=$2")
        .bind(owner_id).bind(key).bind(campaign_id).bind(serde_json::to_value(response)?)
        .execute(&mut **tx).await?;
    Ok(())
}

fn replay<T: for<'de> Deserialize<'de>>(value: Value) -> Result<Json<T>, ApiError> {
    Ok(Json(serde_json::from_value(value)?))
}

pub async fn list_events(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<Vec<GameEvent>>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    let exists: bool = crate::fd_query_scalar!("SELECT EXISTS(SELECT 1 FROM fd.campaigns WHERE id=$1)")
        .bind(campaign_id)
        .fetch_one(&mut *tx)
        .await?;
    if !exists {
        return Err(ApiError::not_found());
    }

    // Backfill the inbox for campaigns created before launch events existed.
    // This makes the first game visit useful without requiring a calendar skip.
    let campaign_date: NaiveDate =
        crate::fd_query_scalar!("SELECT game_date FROM fd.campaigns WHERE id=$1")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;
    let has_events: bool =
        crate::fd_query_scalar!("SELECT EXISTS(SELECT 1 FROM fd.game_events WHERE campaign_id=$1)")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;
    if !has_events {
        crate::fd_query!(
            "INSERT INTO fd.game_events (campaign_id,event_key,event_type,title,body,game_date,expires_on,priority,choices) VALUES
             ($1,'launch-club-plan','club_launch_plan','План развития клуба','Совет директоров ждёт от нового владельца первого решения. На что направить внимание в начале проекта?',$2,$2 + 14,95,$3),
             ($1,'launch-public-debut','dynasty_public_debut','Публичный дебют династии','Местная пресса готовит материал о новой футбольной династии. Выберите, какой образ закрепить за семьёй.',$2,$2 + 14,85,$4),
             ($1,'launch-board-priorities','board_priorities','Приоритеты совета','Руководители клуба предлагают определить главный ориентир на ближайший месяц.',$2,$2 + 14,80,$5)
             ON CONFLICT (campaign_id,event_key) DO NOTHING"
        )
        .bind(campaign_id)
        .bind(campaign_date)
        .bind(json!([
            {"id":"reputation","label":"Развивать клуб и укреплять его репутацию","effect":"club_reputation"},
            {"id":"prestige","label":"Укреплять влияние и престиж династии","effect":"dynasty_prestige"}
        ]))
        .bind(json!([
            {"id":"reputation","label":"Показать амбиции и открыть клуб болельщикам","effect":"club_reputation"},
            {"id":"prestige","label":"Подчеркнуть традиции и статус семьи","effect":"dynasty_prestige"}
        ]))
        .bind(json!([
            {"id":"reputation","label":"Сосредоточиться на спортивном развитии","effect":"club_reputation"},
            {"id":"prestige","label":"Сосредоточиться на влиянии семьи","effect":"dynasty_prestige"}
        ]))
        .execute(&mut *tx).await?;
    }

    let rows = crate::fd_query_as!(GameEvent,
        "SELECT id,event_type,title,body,game_date,expires_on,priority,choices,status,resolution FROM fd.game_events WHERE campaign_id=$1 ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, game_date DESC, priority DESC LIMIT 100",
    )
    .bind(campaign_id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(rows))
}


#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct WorldEventView {
    pub id: Uuid,
    pub event_type: String,
    pub game_day: i32,
    pub location_key: String,
    pub state: String,
    pub payload: Value,
    pub parent_event_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct WorldResponseRequest {
    pub response: String,
}

async fn list_world_events(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<Vec<WorldEventView>>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    let exists: bool = crate::fd_query_scalar!(
        "SELECT EXISTS(SELECT 1 FROM fd.campaigns WHERE id=$1)"
    )
    .bind(campaign_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(ApiError::not_found());
    }
    let rows = crate::fd_query_as!(WorldEventView,
        "SELECT id,event_type,game_day,location_key,state,payload,parent_event_id
         FROM fd.world_events WHERE campaign_id=$1 AND state IN ('known','active','resolved')
         ORDER BY game_day DESC,created_at DESC LIMIT 100")
        .bind(campaign_id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(rows))
}

async fn respond_world_event(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, event_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(request): Json<WorldResponseRequest>,
) -> Result<Json<Value>, ApiError> {
    let response = match request.response.as_str() {
        "help" => crate::living_world::PlayerResponse::HelpVictim,
        "report" => crate::living_world::PlayerResponse::ReportIncident,
        "ignore" => crate::living_world::PlayerResponse::Ignore,
        _ => return Err(ApiError::bad_request("invalid_world_response")),
    };
    let key = command_key(&headers)?;
    let hash = request_hash(&(campaign_id, event_id, &request))?;
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    if let Some(value) = reserve(
        &mut tx,
        identity.telegram_id,
        &key,
        "respond_world_event",
        &hash,
    )
    .await?
    {
        tx.rollback().await?;
        return Ok(Json(value));
    }

    let row = crate::fd_query_as!((String, i32, String, Value, String),
        "SELECT event_type,game_day,location_key,payload,state
         FROM fd.world_events
         WHERE campaign_id=$1 AND id=$2
         FOR UPDATE")
        .bind(campaign_id)
        .bind(event_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::not_found)?;
    if row.0 != "theft_near_club" || row.4 != "known" {
        return Err(ApiError::conflict("world_event_not_respondable"));
    }

    let witnesses = row.3["witnesses"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let incident = crate::living_world::WorldIncident {
        id: event_id.to_string(),
        kind: crate::living_world::IncidentKind::TheftNearClub,
        day: u32::try_from(row.1).unwrap_or_default(),
        location: row.2.clone(),
        witnesses: witnesses.clone(),
        status: crate::living_world::IncidentStatus::PlayerAware,
    };
    let resolution = crate::living_world::resolve_incident(incident, response);
    let witness_count = witnesses.len();

    if request.response == "report" {
        crate::fd_query!(
            "INSERT INTO fd.world_actor_knowledge(campaign_id,actor_key,source_event_id)
             VALUES($1,'local_authorities',$2)
             ON CONFLICT DO NOTHING"
        )
        .bind(campaign_id)
        .bind(event_id)
        .execute(&mut *tx)
        .await?;
    } else if !witnesses.is_empty() {
        crate::fd_query!(
            "INSERT INTO fd.world_actor_knowledge(campaign_id,actor_key,source_event_id)
             SELECT $1,value,$2
             FROM jsonb_array_elements_text($3->'witnesses')
             ON CONFLICT DO NOTHING"
        )
        .bind(campaign_id)
        .bind(event_id)
        .bind(&row.3)
        .execute(&mut *tx)
        .await?;
    }
    if request.response == "help" && !witnesses.is_empty() {
        crate::fd_query!(
            "INSERT INTO fd.world_actor_knowledge(campaign_id,actor_key,source_event_id)
             VALUES($1,'local_news',$2)
             ON CONFLICT DO NOTHING"
        )
        .bind(campaign_id)
        .bind(event_id)
        .execute(&mut *tx)
        .await?;
    }

    for fact in &resolution.facts {
        crate::fd_query!(
            "INSERT INTO fd.world_facts(campaign_id,fact_key,fact_value,source_event_id)
             VALUES($1,$2,$3,$4)
             ON CONFLICT DO NOTHING"
        )
        .bind(campaign_id)
        .bind(&fact.key)
        .bind(json!({"value":fact.value}))
        .bind(event_id)
        .execute(&mut *tx)
        .await?;
    }

    let mut scheduled_reactions = Vec::new();
    for consequence in &resolution.delayed {
        let reaction_type = match &consequence.kind {
            crate::living_world::DelayedKind::NewsFollowUp => "local_news_follow_up",
            crate::living_world::DelayedKind::WitnessReport => "witness_report",
            crate::living_world::DelayedKind::InvestigationUpdate => {
                "police_investigation_update"
            }
        };
        let reaction_key = format!("{}:{}", event_id, reaction_type);
        crate::fd_query!(
            "INSERT INTO fd.world_reactions(
                campaign_id,source_event_id,reaction_key,reaction_type,
                due_game_day,state,payload
             )
             VALUES($1,$2,$3,$4,$5,'queued',$6)
             ON CONFLICT(campaign_id,reaction_key) DO NOTHING"
        )
        .bind(campaign_id)
        .bind(event_id)
        .bind(reaction_key)
        .bind(reaction_type)
        .bind(i32::try_from(consequence.due_day).unwrap_or(i32::MAX))
        .bind(json!({
            "response": request.response.as_str(),
            "location": row.2.as_str(),
            "witnesses": witnesses.clone(),
            "immediate_reactions": resolution.immediate_reactions.clone(),
        }))
        .execute(&mut *tx)
        .await?;
        scheduled_reactions.push(reaction_type);
    }

    crate::fd_query!(
        "UPDATE fd.world_events
         SET state='resolved',resolved_at=now(),
             payload=payload || $3
         WHERE campaign_id=$1 AND id=$2"
    )
    .bind(campaign_id)
    .bind(event_id)
    .bind(json!({
        "player_response": request.response.as_str(),
        "immediate_reactions": resolution.immediate_reactions.clone(),
    }))
    .execute(&mut *tx)
    .await?;

    let primary_reaction = scheduled_reactions.first().copied();
    let result = json!({
        "event_id": event_id,
        "response": request.response.as_str(),
        "status": "resolved",
        "witness_count": witness_count,
        "immediate_reactions": resolution.immediate_reactions,
        "scheduled_reaction": primary_reaction,
        "scheduled_reactions": scheduled_reactions,
    });
    complete(&mut tx, identity.telegram_id, &key, campaign_id, &result).await?;
    tx.commit().await?;
    Ok(Json(result))
}

async fn tick_living_world(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    current_date: NaiveDate,
) -> Result<i64, ApiError> {
    let game_day=current_date.num_days_from_ce();
    let mut generated=0_i64;
    if game_day % 11 == 0 {
        let event_key=format!("street-incident-{}",current_date.format("%Y%m%d"));
        let inserted=crate::fd_query!(
            "INSERT INTO fd.world_events(campaign_id,event_key,event_type,game_day,location_key,state,payload)
             VALUES($1,$2,'theft_near_club',$3,'club_district','known',
               jsonb_build_object('witnesses',jsonb_build_array('supporter_01','staff_02'),
                 'awareness_channel','local_news','choices',jsonb_build_array('help','report','ignore')))
             ON CONFLICT(campaign_id,event_key) DO NOTHING")
            .bind(campaign_id).bind(event_key).bind(game_day).execute(&mut **tx).await?;
        generated+=inserted.rows_affected() as i64;
        if inserted.rows_affected()>0 {
            let incident_id:Uuid=crate::fd_query_scalar!("SELECT id FROM fd.world_events WHERE campaign_id=$1 AND event_key=$2")
                .bind(campaign_id).bind(format!("street-incident-{}",current_date.format("%Y%m%d")))
                .fetch_one(&mut **tx).await?;
            crate::fd_query!("INSERT INTO fd.world_actor_knowledge(campaign_id,actor_key,source_event_id) VALUES($1,'supporter_01',$2),($1,'staff_02',$2) ON CONFLICT DO NOTHING")
                .bind(campaign_id).bind(incident_id).execute(&mut **tx).await?;
        }
    }
    let due=crate::fd_query_as!((Uuid,Uuid,String,String,i32,Value),
        "SELECT id,source_event_id,reaction_key,reaction_type,due_game_day,payload
         FROM fd.world_reactions WHERE campaign_id=$1 AND state='queued' AND due_game_day <= $2
         ORDER BY due_game_day,id FOR UPDATE")
        .bind(campaign_id).bind(game_day).fetch_all(&mut **tx).await?;
    for (reaction_id,parent_id,reaction_key,reaction_type,_due,payload) in due {
        let informed: bool = match reaction_type.as_str() {
            "local_news_follow_up" => crate::fd_query_scalar!(
                "SELECT EXISTS(
                   SELECT 1 FROM fd.world_actor_knowledge
                   WHERE campaign_id=$1 AND source_event_id=$2 AND actor_key='local_news'
                 )"
            )
            .bind(campaign_id)
            .bind(parent_id)
            .fetch_one(&mut **tx)
            .await?,
            "witness_report" => crate::fd_query_scalar!(
                "SELECT EXISTS(
                   SELECT 1 FROM fd.world_actor_knowledge
                   WHERE campaign_id=$1 AND source_event_id=$2
                     AND actor_key IN (SELECT jsonb_array_elements_text($3->'witnesses'))
                 )"
            )
            .bind(campaign_id)
            .bind(parent_id)
            .bind(&payload)
            .fetch_one(&mut **tx)
            .await?,
            "police_investigation_update" => crate::fd_query_scalar!(
                "SELECT EXISTS(
                   SELECT 1 FROM fd.world_actor_knowledge
                   WHERE campaign_id=$1 AND source_event_id=$2 AND actor_key='local_authorities'
                 )"
            )
            .bind(campaign_id)
            .bind(parent_id)
            .fetch_one(&mut **tx)
            .await?,
            _ => false,
        };
        if !informed {
            crate::fd_query!(
                "UPDATE fd.world_reactions SET state='cancelled',processed_at=now()
                 WHERE id=$1 AND campaign_id=$2 AND state='queued'"
            )
            .bind(reaction_id)
            .bind(campaign_id)
            .execute(&mut **tx)
            .await?;
            continue;
        }
        let child_type=match reaction_type.as_str() {
            "local_news_follow_up"=>"news_follow_up",
            "witness_report"=>"witness_report",
            "police_investigation_update"=>"investigation_update",
            _=>continue,
        };
        crate::fd_query!(
            "INSERT INTO fd.world_events(campaign_id,event_key,event_type,game_day,location_key,state,payload,parent_event_id)
             VALUES($1,$2,$3,$4,$5,'known',$6,$7) ON CONFLICT(campaign_id,event_key) DO NOTHING")
            .bind(campaign_id).bind(format!("follow-up-{reaction_key}")).bind(child_type)
            .bind(game_day).bind(payload["location"].as_str().unwrap_or("club_district"))
            .bind(json!({"source_reaction":reaction_type,"source_payload":payload,"awareness_channel":"news_or_witness"}))
            .bind(parent_id).execute(&mut **tx).await?;
        crate::fd_query!("UPDATE fd.world_reactions SET state='processed',processed_at=now() WHERE id=$1 AND campaign_id=$2 AND state='queued'")
            .bind(reaction_id).bind(campaign_id).execute(&mut **tx).await?;
        crate::fd_query!("INSERT INTO fd.world_facts(campaign_id,fact_key,fact_value,source_event_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING")
            .bind(campaign_id).bind(format!("reaction_processed:{reaction_key}"))
            .bind(json!({"type":reaction_type,"processed_on":current_date})).bind(parent_id)
            .execute(&mut **tx).await?;
        generated+=1;
    }
    Ok(generated)
}

pub async fn save_lineup(
    State(state): State<AppState>, Extension(identity): Extension<Identity>,
    Path((campaign_id, fixture_id)): Path<(Uuid, Uuid)>, Json(request): Json<SaveLineupRequest>,
) -> Result<Json<SaveLineupResponse>, ApiError> {
    let (defenders, midfielders, forwards) = match request.formation.as_str() {
        "4-3-3" => (4usize, 3usize, 3usize), "4-4-2" => (4, 4, 2),
        "3-5-2" => (3, 5, 2), "4-2-3-1" => (4, 5, 1), "3-4-3" => (3, 4, 3),
        _ => return Err(ApiError::bad_request("invalid_formation")),
    };
    if request.starter_ids.len() != 11 || request.substitute_ids.len() > 7 {
        return Err(ApiError::bad_request("invalid_matchday_squad_size"));
    }
    let mut unique = HashSet::new();
    if request.starter_ids.iter().chain(&request.substitute_ids).any(|id| !unique.insert(*id)) {
        return Err(ApiError::bad_request("duplicate_matchday_player"));
    }
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    let team_id = crate::fd_query_scalar!(
        "SELECT t.id FROM fd.teams t JOIN fd.season_fixtures f
         ON f.campaign_id=t.campaign_id AND f.id=$2 AND t.id IN (f.home_team_id,f.away_team_id)
         WHERE t.campaign_id=$1 AND t.is_player_controlled=true AND f.status='scheduled'
         FOR UPDATE OF f,t")
        .bind(campaign_id).bind(fixture_id).fetch_optional(&mut *tx).await?
        .ok_or_else(ApiError::not_found)?;
    let selected_ids: Vec<Uuid> = request.starter_ids.iter().chain(&request.substitute_ids).copied().collect();
    let players = crate::fd_query_as!((Uuid, String, Option<NaiveDate>, Option<NaiveDate>),
        "SELECT id,position,injured_until,suspended_until FROM fd.players
         WHERE campaign_id=$1 AND team_id=$2 AND id=ANY($3)")
        .bind(campaign_id).bind(team_id).bind(&selected_ids).fetch_all(&mut *tx).await?;
    if players.len() != selected_ids.len() { return Err(ApiError::bad_request("matchday_player_not_in_controlled_team")); }
    let fixture_date: NaiveDate = crate::fd_query_scalar!(
        "SELECT match_date FROM fd.season_fixtures WHERE campaign_id=$1 AND id=$2")
        .bind(campaign_id).bind(fixture_id).fetch_one(&mut *tx).await?;
    let by_id: BTreeMap<Uuid, (String, Option<NaiveDate>, Option<NaiveDate>)> = players.into_iter()
        .map(|(id, pos, injured, suspended)| (id, (pos, injured, suspended))).collect();
    let mut counts = (0usize, 0usize, 0usize, 0usize);
    for id in &request.starter_ids {
        let (position, injured, suspended) = by_id.get(id).ok_or_else(|| ApiError::bad_request("unknown_matchday_player"))?;
        if injured.is_some_and(|date| date >= fixture_date) || suspended.is_some_and(|date| date >= fixture_date) {
            return Err(ApiError::conflict("unavailable_matchday_starter"));
        }
        match position.as_str() {
            "goalkeeper" => counts.0 += 1, "defender" => counts.1 += 1,
            "midfielder" => counts.2 += 1, "forward" => counts.3 += 1,
            _ => return Err(ApiError::conflict("invalid_player_position")),
        }
    }
    if counts != (1, defenders, midfielders, forwards) {
        return Err(ApiError::bad_request("starting_eleven_does_not_match_formation"));
    }
    for id in &request.substitute_ids {
        let (_, injured, suspended) = by_id.get(id).ok_or_else(|| ApiError::bad_request("unknown_matchday_player"))?;
        if injured.is_some_and(|date| date >= fixture_date) || suspended.is_some_and(|date| date >= fixture_date) {
            return Err(ApiError::conflict("unavailable_matchday_substitute"));
        }
    }
    crate::fd_query!("DELETE FROM fd.match_lineups WHERE campaign_id=$1 AND fixture_id=$2 AND team_id=$3")
        .bind(campaign_id).bind(fixture_id).bind(team_id).execute(&mut *tx).await?;
    for (role, ids) in [("starter", &request.starter_ids), ("substitute", &request.substitute_ids)] {
        for player_id in ids {
            crate::fd_query!("INSERT INTO fd.match_lineups(campaign_id,fixture_id,team_id,player_id,role,position,shirt_number)
                SELECT campaign_id,$2,team_id,id,$4,position,shirt_number FROM fd.players
                WHERE campaign_id=$1 AND team_id=$3 AND id=$5")
                .bind(campaign_id).bind(fixture_id).bind(team_id).bind(role).bind(*player_id)
                .execute(&mut *tx).await?;
        }
    }
    crate::fd_query!("UPDATE fd.match_lineups SET formation=$4 WHERE campaign_id=$1 AND fixture_id=$2 AND team_id=$3")
        .bind(campaign_id).bind(fixture_id).bind(team_id).bind(&request.formation).execute(&mut *tx).await?;
    crate::fd_query!("UPDATE fd.team_tactics SET formation=$3,updated_at=now() WHERE campaign_id=$1 AND team_id=$2")
        .bind(campaign_id).bind(team_id).bind(&request.formation).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(SaveLineupResponse { fixture_id, team_id, formation: request.formation,
        starters_saved: request.starter_ids.len(), substitutes_saved: request.substitute_ids.len() }))
}


#[derive(Debug, Deserialize, Serialize)]
pub struct SetTrainingRequest {
    pub player_ids: Vec<Uuid>,
    pub focus: String,
    pub intensity: i16,
}
#[derive(Debug, Deserialize, Serialize)]
pub struct SetTrainingResponse {
    pub campaign_id: Uuid,
    pub team_id: Uuid,
    pub assigned_players: usize,
    pub focus: String,
    pub intensity: i16,
}

#[derive(Debug, sqlx::FromRow)]
struct TrainingPlayerRow {
    id: Uuid, age: i16, potential: i16,
    pace: i16, shooting: i16, passing: i16, defending: i16, physical: i16,
    goalkeeping: i16, stamina: i16, morale: i16, fatigue: i16,
    injured_until: Option<NaiveDate>, contract_until: Option<NaiveDate>,
    wage_minor: i64, market_value_minor: i64, focus: String, intensity: i16,
}

fn training_focus(value: &str) -> Result<TrainingFocus, ApiError> {
    match value {
        "finishing" => Ok(TrainingFocus::Finishing),
        "passing" => Ok(TrainingFocus::Passing),
        "defending" => Ok(TrainingFocus::Defending),
        "physical" => Ok(TrainingFocus::Physical),
        "goalkeeping" => Ok(TrainingFocus::Goalkeeping),
        "balanced" => Ok(TrainingFocus::Balanced),
        _ => Err(ApiError::bad_request("invalid_training_focus")),
    }
}

async fn apply_daily_training(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    game_date: NaiveDate,
    campaign_seed: i64,
) -> Result<(), ApiError> {
    let rows = crate::fd_query_as!(TrainingPlayerRow,
        "SELECT p.id,p.age,p.potential,p.pace,p.shooting,p.passing,p.defending,p.physical,
                p.goalkeeping,p.stamina,p.morale,p.fatigue,p.injured_until,p.contract_until,
                p.wage_minor,p.market_value_minor,plan.focus,plan.intensity
         FROM fd.player_training_plans plan
         JOIN fd.players p ON p.campaign_id=plan.campaign_id AND p.id=plan.player_id
         WHERE plan.campaign_id=$1 ORDER BY p.id")
        .bind(campaign_id).fetch_all(&mut **tx).await?;

    for row in rows {
        let attributes_before = json!({
            "pace":row.pace,"shooting":row.shooting,"passing":row.passing,
            "defending":row.defending,"physical":row.physical,
            "goalkeeping":row.goalkeeping,"stamina":row.stamina,
        });
        let to_u8 = |value: i16| u8::try_from(value).map_err(|_| ApiError::conflict("invalid_player_training_state"));
        let mut career = PlayerCareer {
            id: row.id,
            age: to_u8(row.age)?, potential: to_u8(row.potential)?,
            attributes: PlayerAttributes {
                pace:to_u8(row.pace)?, shooting:to_u8(row.shooting)?,
                passing:to_u8(row.passing)?, defending:to_u8(row.defending)?,
                physical:to_u8(row.physical)?, goalkeeping:to_u8(row.goalkeeping)?,
                stamina:to_u8(row.stamina)?,
            },
            morale:to_u8(row.morale)?, fatigue:to_u8(row.fatigue)?,
            appearances:0, goals:0, assists:0, minutes_played:0,
            injury_until:row.injured_until, suspension_matches:0,
            contract_until:row.contract_until.unwrap_or_else(|| NaiveDate::from_ymd_opt(9999,12,31).expect("valid sentinel date")),
            wage_minor:u64::try_from(row.wage_minor).unwrap_or_default(),
            market_value_minor:u64::try_from(row.market_value_minor).unwrap_or_default(),
        };
        let fatigue_before = career.fatigue;
        let focus_label = row.focus.clone();
        let (gain, morale_delta) = if row.focus == "recovery" {
            recover(&mut career, 1);
            (0_u8, 0_i8)
        } else {
            let focus = training_focus(&row.focus)?;
            let intensity = u8::try_from(row.intensity).map_err(|_| ApiError::conflict("invalid_training_intensity"))?;
            let outcome = apply_training(&mut career, TrainingPlan { focus, intensity },
                (campaign_seed as u64) ^ (game_date.num_days_from_ce() as u64).rotate_left(13))
                .map_err(|_| ApiError::conflict("invalid_player_training_state"))?;
            (outcome.attribute_gain, outcome.morale_change)
        };
        let improved_attribute = if gain > 0 {
            [
                ("pace", row.pace, i16::from(career.attributes.pace)),
                ("shooting", row.shooting, i16::from(career.attributes.shooting)),
                ("passing", row.passing, i16::from(career.attributes.passing)),
                ("defending", row.defending, i16::from(career.attributes.defending)),
                ("physical", row.physical, i16::from(career.attributes.physical)),
                ("goalkeeping", row.goalkeeping, i16::from(career.attributes.goalkeeping)),
                ("stamina", row.stamina, i16::from(career.attributes.stamina)),
            ].into_iter().find(|(_, before, after)| after > before).map(|(name, _, _)| name.to_owned())
        } else { None };
        let attributes_after = json!({
            "pace":career.attributes.pace,"shooting":career.attributes.shooting,
            "passing":career.attributes.passing,"defending":career.attributes.defending,
            "physical":career.attributes.physical,"goalkeeping":career.attributes.goalkeeping,
            "stamina":career.attributes.stamina,
        });
        crate::fd_query!("UPDATE fd.players SET pace=$3,shooting=$4,passing=$5,defending=$6,physical=$7,goalkeeping=$8,stamina=$9,morale=$10,fatigue=$11 WHERE campaign_id=$1 AND id=$2")
            .bind(campaign_id).bind(row.id)
            .bind(i16::from(career.attributes.pace)).bind(i16::from(career.attributes.shooting))
            .bind(i16::from(career.attributes.passing)).bind(i16::from(career.attributes.defending))
            .bind(i16::from(career.attributes.physical)).bind(i16::from(career.attributes.goalkeeping))
            .bind(i16::from(career.attributes.stamina)).bind(i16::from(career.morale))
            .bind(i16::from(career.fatigue)).execute(&mut **tx).await?;
        crate::fd_query!("INSERT INTO fd.player_training_log(campaign_id,player_id,game_date,focus,intensity,attribute_gain,improved_attribute,fatigue_delta,morale_delta,attributes_before,attributes_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(campaign_id,player_id,game_date) DO NOTHING")
            .bind(campaign_id).bind(row.id).bind(game_date).bind(&focus_label).bind(row.intensity)
            .bind(i16::from(gain)).bind(improved)
            .bind(i16::from(career.fatigue)-i16::from(fatigue_before)).bind(i16::from(morale_delta))
            .bind(attributes_before).bind(attributes_after).execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn set_training(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<SetTrainingRequest>,
) -> Result<Json<SetTrainingResponse>, ApiError> {
    let unique: HashSet<Uuid> = request.player_ids.iter().copied().collect();
    let valid_focus = matches!(request.focus.as_str(), "finishing"|"passing"|"defending"|"physical"|"goalkeeping"|"balanced"|"recovery");
    let valid_intensity = if request.focus == "recovery" { request.intensity == 0 } else { (20..=100).contains(&request.intensity) };
    if request.player_ids.is_empty() || request.player_ids.len() > 19
        || unique.len() != request.player_ids.len() || !valid_focus || !valid_intensity {
        return Err(ApiError::bad_request("invalid_training_assignment"));
    }
    let key = command_key(&headers)?;
    let hash = request_hash(&(campaign_id, &request))?;
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    if let Some(value) = reserve(&mut tx, identity.telegram_id, &key, "set_training", &hash).await? {
        tx.rollback().await?;
        return replay(value);
    }
    let status: String = crate::fd_query_scalar!("SELECT status FROM fd.campaigns WHERE id=$1 FOR UPDATE")
        .bind(campaign_id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::not_found)?;
    if status != "active" { return Err(ApiError::conflict("campaign_not_active")); }
    let team_id: Uuid = crate::fd_query_scalar!("SELECT id FROM fd.teams WHERE campaign_id=$1 AND is_player_controlled=true ORDER BY created_at,id LIMIT 1")
        .bind(campaign_id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::not_found)?;
    let owned_count: i64 = crate::fd_query_scalar!("SELECT COUNT(*) FROM fd.players WHERE campaign_id=$1 AND team_id=$2 AND id=ANY($3) AND ($4::text<>'goalkeeping' OR position='goalkeeper')")
        .bind(campaign_id).bind(team_id).bind(&request.player_ids).bind(&request.focus).fetch_one(&mut *tx).await?;
    if owned_count != request.player_ids.len() as i64 { return Err(ApiError::not_found()); }
    crate::fd_query!("INSERT INTO fd.player_training_plans(campaign_id,player_id,focus,intensity) SELECT $1,p.id,$4,$5 FROM fd.players p WHERE p.campaign_id=$1 AND p.team_id=$2 AND p.id=ANY($3) ON CONFLICT(campaign_id,player_id) DO UPDATE SET focus=EXCLUDED.focus,intensity=EXCLUDED.intensity,updated_at=now()")
        .bind(campaign_id).bind(team_id).bind(&request.player_ids).bind(&request.focus).bind(request.intensity)
        .execute(&mut *tx).await?;
    let result = SetTrainingResponse { campaign_id, team_id, assigned_players:request.player_ids.len(), focus:request.focus.clone(), intensity:request.intensity };
    crate::fd_query!("INSERT INTO fd.chronicle(campaign_id,event_type,title,game_year,payload) SELECT $1,'training_plan_updated','Training plan updated',current_year,$2 FROM fd.campaigns WHERE id=$1")
        .bind(campaign_id).bind(json!({"player_ids":request.player_ids,"focus":request.focus,"intensity":request.intensity}))
        .execute(&mut *tx).await?;
    complete(&mut tx, identity.telegram_id, &key, campaign_id, &result).await?;
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn get_squad(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<CampaignSquadView>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    let team = crate::fd_query_as!((Uuid, String),
        "SELECT id,name FROM fd.teams WHERE campaign_id=$1 AND is_player_controlled=true ORDER BY created_at,id LIMIT 1")
        .bind(campaign_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let formation = crate::fd_query_scalar!(
        "SELECT formation FROM fd.team_tactics WHERE campaign_id=$1 AND team_id=$2"
    )
        .bind(campaign_id)
        .bind(team.0)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or_else(|| "4-3-3".to_owned());
    let players = crate::fd_query_as!(CampaignSquadPlayerView,
        "SELECT p.id,p.full_name,p.position,p.shirt_number,p.age,p.pace,p.shooting,p.passing,p.defending,p.physical,
                p.goalkeeping,p.stamina,p.morale,p.fatigue,p.potential,p.market_value_minor,p.wage_minor,
                p.contract_until,p.injured_until,p.suspended_until,plan.focus AS training_focus,plan.intensity AS training_intensity
         FROM fd.players p LEFT JOIN fd.player_training_plans plan ON plan.campaign_id=p.campaign_id AND plan.player_id=p.id
         WHERE p.campaign_id=$1 AND p.team_id=$2 ORDER BY p.shirt_number")
        .bind(campaign_id)
        .bind(team.0)
        .fetch_all(&mut *tx)
        .await?;
    if players.is_empty() {
        return Err(ApiError::not_found());
    }
    let next_fixture_id = crate::fd_query_scalar!(
        "SELECT id FROM fd.season_fixtures
         WHERE campaign_id=$1 AND status='scheduled' AND (home_team_id=$2 OR away_team_id=$2)
         ORDER BY match_date,matchday,id LIMIT 1"
    )
        .bind(campaign_id).bind(team.0).fetch_optional(&mut *tx).await?;
    let lineup_rows = if let Some(fixture_id) = next_fixture_id {
        crate::fd_query_as!((Uuid, String),
            "SELECT player_id,role FROM fd.match_lineups
             WHERE campaign_id=$1 AND fixture_id=$2 AND team_id=$3 ORDER BY shirt_number")
            .bind(campaign_id).bind(fixture_id).bind(team.0).fetch_all(&mut *tx).await?
    } else {
        Vec::new()
    };
    let starter_ids = lineup_rows.iter().filter(|(_, role)| role == "starter").map(|(id, _)| *id).collect();
    let substitute_ids = lineup_rows.iter().filter(|(_, role)| role == "substitute").map(|(id, _)| *id).collect();
    tx.commit().await?;
    Ok(Json(CampaignSquadView {
        team_id: team.0,
        team_name: team.1,
        formation,
        next_fixture_id,
        starter_ids,
        substitute_ids,
        players,
    }))
}

pub async fn get_season(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<SeasonView>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    let season_year: i32 = crate::fd_query_scalar!("SELECT current_year FROM fd.campaigns WHERE id=$1")
        .bind(campaign_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let fixtures = crate::fd_query_as!(SeasonFixture,
        "SELECT id,season_year,matchday,match_date,home_team,away_team,status,home_goals,away_goals
         FROM fd.season_fixtures WHERE campaign_id=$1 AND season_year=$2
         ORDER BY matchday,match_date,home_team,away_team",
    )
    .bind(campaign_id)
    .bind(season_year)
    .fetch_all(&mut *tx)
    .await?;

    let mut totals: BTreeMap<String, StandingTotals> = BTreeMap::new();
    for fixture in &fixtures {
        totals.entry(fixture.home_team.clone()).or_default();
        totals.entry(fixture.away_team.clone()).or_default();
        if fixture.status != "played" {
            continue;
        }
        let home_goals = fixture.home_goals.unwrap_or(0) as i32;
        let away_goals = fixture.away_goals.unwrap_or(0) as i32;
        let outcome = home_goals.cmp(&away_goals);
        {
            let home = totals
                .get_mut(&fixture.home_team)
                .expect("home team inserted");
            home.played += 1;
            home.goals_for += home_goals;
            home.goals_against += away_goals;
            match outcome {
                std::cmp::Ordering::Greater => {
                    home.wins += 1;
                    home.points += 3;
                }
                std::cmp::Ordering::Equal => {
                    home.draws += 1;
                    home.points += 1;
                }
                std::cmp::Ordering::Less => {
                    home.losses += 1;
                }
            }
        }
        {
            let away = totals
                .get_mut(&fixture.away_team)
                .expect("away team inserted");
            away.played += 1;
            away.goals_for += away_goals;
            away.goals_against += home_goals;
            match outcome {
                std::cmp::Ordering::Greater => {
                    away.losses += 1;
                }
                std::cmp::Ordering::Equal => {
                    away.draws += 1;
                    away.points += 1;
                }
                std::cmp::Ordering::Less => {
                    away.wins += 1;
                    away.points += 3;
                }
            }
        }
    }
    let mut standings: Vec<LeagueStanding> = totals
        .into_iter()
        .map(|(team, value)| LeagueStanding {
            team,
            played: value.played,
            wins: value.wins,
            draws: value.draws,
            losses: value.losses,
            goals_for: value.goals_for,
            goals_against: value.goals_against,
            points: value.points,
        })
        .collect();
    standings.sort_by(|a, b| {
        b.points
            .cmp(&a.points)
            .then_with(|| (b.goals_for - b.goals_against).cmp(&(a.goals_for - a.goals_against)))
            .then_with(|| b.goals_for.cmp(&a.goals_for))
            .then_with(|| a.team.cmp(&b.team))
    });
    tx.commit().await?;
    Ok(Json(SeasonView {
        season_year,
        fixtures,
        standings,
    }))
}

pub async fn get_fixture(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, fixture_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<FixtureMatchView>, ApiError> {
    let mut tx=state.db.begin().await?;
    set_owner(&mut tx,identity.telegram_id).await?;
    let fixture=crate::fd_query_as!(SeasonFixture,
        "SELECT id,season_year,matchday,match_date,home_team,away_team,status,home_goals,away_goals
         FROM fd.season_fixtures WHERE campaign_id=$1 AND id=$2")
        .bind(campaign_id).bind(fixture_id).fetch_optional(&mut *tx).await?
        .ok_or_else(ApiError::not_found)?;
    let events=crate::fd_query_as!(MatchEventView,
        "SELECT me.sequence,me.minute,me.event_type,me.team_id,t.name AS team_name,
                me.player_id,p.full_name AS player_name,
                me.related_player_id,r.full_name AS related_player_name
         FROM fd.match_events me
         LEFT JOIN fd.teams t ON t.campaign_id=me.campaign_id AND t.id=me.team_id
         LEFT JOIN fd.players p ON p.campaign_id=me.campaign_id AND p.id=me.player_id
         LEFT JOIN fd.players r ON r.campaign_id=me.campaign_id AND r.id=me.related_player_id
         WHERE me.campaign_id=$1 AND me.fixture_id=$2 ORDER BY me.sequence")
        .bind(campaign_id).bind(fixture_id).fetch_all(&mut *tx).await?;
    let spatial_events = crate::fd_query_as!(SpatialEventView,
        "SELECT sequence,minute,event_type,team_id,player_id,related_player_id,from_x,from_y,to_x,to_y
         FROM fd.match_spatial_events WHERE campaign_id=$1 AND fixture_id=$2 ORDER BY sequence")
        .bind(campaign_id).bind(fixture_id).fetch_all(&mut *tx).await?;
    let heatmaps = crate::fd_query_as!(PlayerHeatmapView,
        "SELECT team_id,player_id,bins,samples FROM fd.match_player_heatmaps
         WHERE campaign_id=$1 AND fixture_id=$2 ORDER BY team_id,player_id")
        .bind(campaign_id).bind(fixture_id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(FixtureMatchView { fixture, events, spatial_events, heatmaps }))
}



fn match_board_review_choices(
    team_goals: i16,
    opponent_goals: i16,
    is_home: bool,
    report: &str,
) -> (&'static str, String, Value) {
    let (result_label, narrative, suffix, choices) =
        match team_goals.cmp(&opponent_goals) {
            std::cmp::Ordering::Greater => (
                "победа",
                if is_home {
                    "Команда добилась победы"
                } else {
                    "Команда добилась выездной победы"
                },
                "Совет предлагает решить, как закрепить результат.",
                json!([
                    {
                        "id": "build_momentum",
                        "label": "Использовать победу для укрепления репутации клуба",
                        "effect": "club_reputation_2"
                    },
                    {
                        "id": "reward_leadership",
                        "label": "Публично поддержать руководство династии",
                        "effect": "dynasty_prestige"
                    }
                ]),
            ),
            std::cmp::Ordering::Equal => (
                "ничья",
                if is_home {
                    "Матч завершился вничью"
                } else {
                    "Выездной матч завершился вничью"
                },
                "Совет ждёт решения о следующем шаге.",
                json!([
                    {
                        "id": "steady_course",
                        "label": "Сохранить стабильность и доверие болельщиков",
                        "effect": "club_reputation"
                    },
                    {
                        "id": "back_leadership",
                        "label": "Подтвердить доверие руководству династии",
                        "effect": "dynasty_prestige"
                    }
                ]),
            ),
            std::cmp::Ordering::Less => (
                "поражение",
                if is_home {
                    "Команда потерпела поражение"
                } else {
                    "Команда проиграла на выезде"
                },
                "Совет требует реакции руководства.",
                json!([
                    {
                        "id": "manager_review",
                        "label": "Провести открытый разбор и восстановить доверие",
                        "effect": "club_reputation_minus_1"
                    },
                    {
                        "id": "protect_manager",
                        "label": "Публично поддержать тренерский штаб",
                        "effect": "dynasty_prestige_2"
                    }
                ]),
            ),
        };
    (
        result_label,
        format!("{narrative}: {report}. {suffix}"),
        choices,
    )
}

pub async fn advance_time(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
    headers: HeaderMap,
    Json(request): Json<AdvanceTimeRequest>,
) -> Result<Json<AdvanceTimeResult>, ApiError> {
    if !(1..=31).contains(&request.days) {
        return Err(ApiError::bad_request(
            "advance_days_must_be_between_1_and_31",
        ));
    }
    let key = command_key(&headers)?;
    let hash = request_hash(&(campaign_id, &request))?;
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    if let Some(value) = reserve(&mut tx, identity.telegram_id, &key, "advance_time", &hash).await?
    {
        tx.rollback().await?;
        return replay(value);
    }

    let row: (NaiveDate, Uuid, String, i64) = crate::fd_query_as!((NaiveDate, Uuid, String, i64),
        "SELECT game_date,player_character_id,status,seed FROM fd.campaigns WHERE id=$1 FOR UPDATE",
    )
    .bind(campaign_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::not_found)?;
    let (from_date, player_id, initial_status, campaign_seed) = row;
    if initial_status != "active" {
        return Err(ApiError::conflict("campaign_not_active"));
    }

    let mut current_date = from_date;
    let mut generated_events = 0_i64;
    let mut expired_events = 0_i64;
    let mut status = initial_status;
    for _ in 0..request.days {
        current_date += Duration::days(1);
        // Living-world incidents have their own feed and must not inflate the
        // legacy calendar event counter returned by this endpoint.
        tick_living_world(&mut tx, campaign_id, current_date).await?;
        crate::fd_query!(
            "UPDATE fd.players SET
               fatigue=GREATEST(0,fatigue-8),
               injured_until=CASE WHEN injured_until<$2 THEN NULL ELSE injured_until END,
               suspended_until=CASE WHEN suspended_until<$2 THEN NULL ELSE suspended_until END,
               updated_at=now()
             WHERE campaign_id=$1"
        )
        .bind(campaign_id).bind(current_date).execute(&mut *tx).await?;
        apply_daily_training(&mut tx, campaign_id, current_date, campaign_seed).await?;
        let expired = crate::fd_query!("UPDATE fd.game_events SET status='expired' WHERE campaign_id=$1 AND status='pending' AND expires_on < $2")
            .bind(campaign_id).bind(current_date).execute(&mut *tx).await?;
        expired_events += expired.rows_affected() as i64;

        if current_date.month() == 1 && current_date.day() == 1 {
            crate::fd_query!(
                "UPDATE fd.characters SET age=age+1 WHERE campaign_id=$1 AND life_status='alive'",
            )
            .bind(campaign_id)
            .execute(&mut *tx)
            .await?;
            let age: i32 =
                crate::fd_query_scalar!("SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2")
                    .bind(player_id)
                    .bind(campaign_id)
                    .fetch_one(&mut *tx)
                    .await?;
            if age >= 90 {
                crate::fd_query!("UPDATE fd.characters SET life_status='deceased' WHERE id=$1 AND campaign_id=$2")
                    .bind(player_id).bind(campaign_id).execute(&mut *tx).await?;
                let eligible: i64 = crate::fd_query_scalar!(
                    "SELECT COUNT(*) FROM fd.family_relations r JOIN fd.characters c ON c.id=r.child_character_id AND c.campaign_id=r.campaign_id WHERE r.campaign_id=$1 AND r.parent_character_id=$2 AND r.relation_type='parent_child' AND c.is_heir=true AND c.life_status='alive' AND c.age>=18",
                ).bind(campaign_id).bind(player_id).fetch_one(&mut *tx).await?;
                status = if eligible > 0 {
                    "succession_pending"
                } else {
                    "ended_no_heir"
                }
                .to_owned();
                crate::fd_query!("INSERT INTO fd.chronicle(campaign_id,event_type,title,game_year,payload) VALUES($1,'character_death','The head of the dynasty has died',$2,$3)")
                    .bind(campaign_id).bind(current_date.year()).bind(json!({"deceased_character_id":player_id,"player_age":age,"succession_available":eligible > 0,"game_date":current_date}))
                    .execute(&mut *tx).await?;
                break;
            }
        }

        // One domain-specific event is created at most once per campaign/week.
        // Event families rotate so the world is not a repeated board-review loop.
        if current_date.weekday().number_from_monday() == 1 {
            let event_key = format!("weekly-event-{}", current_date.format("%G-W%V"));
            let (event_type, title, body, choices) = match (current_date.ordinal() / 7) % 4 {
                0 => (
                    "club_weekly_review",
                    "Совет директоров",
                    "Совет клуба подвёл итоги недели. Выберите главный приоритет развития.",
                    json!([
                        {"id":"reputation","label":"Укрепить репутацию клуба","effect":"club_reputation"},
                        {"id":"prestige","label":"Укрепить влияние династии","effect":"dynasty_prestige"}
                    ]),
                ),
                1 => (
                    "sponsor_approach",
                    "Предложение титульного партнёра",
                    "Потенциальный партнёр предлагает €250 000 на развитие клуба. Выберите условия сотрудничества.",
                    json!([
                        {"id":"sponsor_cash","label":"Принять €250 000 и пополнить бюджет клуба","effect":"sponsor_cash"},
                        {"id":"club_reputation_2","label":"Отказаться от сделки и укрепить независимость клуба","effect":"club_reputation_2"}
                    ]),
                ),
                2 => (
                    "supporter_meeting",
                    "Встреча с болельщиками",
                    "Представители болельщиков хотят влиять на развитие клуба и ждут решения руководства.",
                    json!([
                        {"id":"club_reputation_2","label":"Инвестировать время в отношения с болельщиками","effect":"club_reputation_2"},
                        {"id":"dynasty_prestige_2","label":"Провести встречу от имени династии","effect":"dynasty_prestige_2"}
                    ]),
                ),
                _ => (
                    "rival_scouting_report",
                    "Доклад о соперниках",
                    "Скаутский отдел подготовил обзор конкурентов. Определите, как использовать полученную информацию.",
                    json!([
                        {"id":"reputation","label":"Направить ресурсы на развитие команды","effect":"club_reputation"},
                        {"id":"prestige","label":"Использовать связи династии","effect":"dynasty_prestige"}
                    ]),
                ),
            };
            let inserted = crate::fd_query!(
                "INSERT INTO fd.game_events(campaign_id,event_key,event_type,title,body,game_date,expires_on,priority,choices) VALUES($1,$2,$3,$4,$5,$6,$7,60,$8) ON CONFLICT(campaign_id,event_key) DO NOTHING",
            )
            .bind(campaign_id)
            .bind(event_key)
            .bind(event_type)
            .bind(title)
            .bind(body)
            .bind(current_date)
            .bind(current_date + Duration::days(6))
            .bind(choices)
            .execute(&mut *tx)
            .await?;
            generated_events += inserted.rows_affected() as i64;
        }

        // Resolve every scheduled fixture on its match date. The score is
        // deterministic for the campaign seed and fixture, so retries/reloads
        // cannot produce a different result.
        let due_fixtures = crate::fd_query_as!((Uuid, i32, i16, String, String, Uuid, Uuid),
            "SELECT id,season_year,matchday,home_team,away_team,home_team_id,away_team_id
             FROM fd.season_fixtures
             WHERE campaign_id=$1 AND match_date=$2 AND status='scheduled'
             ORDER BY matchday,id FOR UPDATE",
        )
        .bind(campaign_id)
        .bind(current_date)
        .fetch_all(&mut *tx)
        .await?;

        let player_team_id: Option<Uuid> = if due_fixtures.is_empty() {
            None
        } else {
            crate::fd_query_scalar!(
                "SELECT id FROM fd.teams WHERE campaign_id=$1 AND is_player_controlled=true ORDER BY created_at,id LIMIT 1"
            )
            .bind(campaign_id)
            .fetch_optional(&mut *tx)
            .await?
        };
        for (fixture_id, season_year, matchday, home_team, away_team, home_team_id, away_team_id) in due_fixtures {
            let home_squad=load_match_squad(&mut tx,campaign_id,fixture_id,home_team_id,current_date).await?;
            let away_squad=load_match_squad(&mut tx,campaign_id,fixture_id,away_team_id,current_date).await?;
            let home_subs=automatic_substitutions(&home_squad,90);
            let away_subs=automatic_substitutions(&away_squad,90);
            let match_seed=(campaign_seed as u64)
                ^ (season_year as u64).rotate_left(17)
                ^ (matchday as u64).rotate_left(31);
            let result=simulate_player_match(
                match_seed,fixture_id,&home_squad,&away_squad,crate::engine::MatchRules::default(),
                &home_subs,&away_subs,
            ).map_err(|_|ApiError::conflict("match_engine_rejected_fixture"))?;
            let home_goals=result.home_goals as i16;
            let away_goals=result.away_goals as i16;
            crate::fd_query!(
                "UPDATE fd.season_fixtures SET status='played',home_goals=$3,away_goals=$4
                 WHERE id=$1 AND campaign_id=$2 AND status='scheduled'",
            )
            .bind(fixture_id)
            .bind(campaign_id)
            .bind(home_goals)
            .bind(away_goals)
            .execute(&mut *tx)
            .await?;
            for spatial in &result.spatial_events {
                let event_type = match spatial.kind {
                    crate::match_engine::SpatialEventKind::Movement => "movement",
                    crate::match_engine::SpatialEventKind::Pass => "pass",
                    crate::match_engine::SpatialEventKind::Tackle => "tackle",
                };
                crate::fd_query!(
                    "INSERT INTO fd.match_spatial_events(campaign_id,fixture_id,sequence,minute,event_type,team_id,player_id,related_player_id,from_x,from_y,to_x,to_y) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"
                )
                .bind(campaign_id).bind(fixture_id).bind(spatial.sequence as i16)
                .bind(spatial.minute as i16).bind(event_type).bind(spatial.team_id)
                .bind(spatial.player_id).bind(spatial.related_player_id)
                .bind(spatial.from.x as i16).bind(spatial.from.y as i16)
                .bind(spatial.to.x as i16).bind(spatial.to.y as i16)
                .execute(&mut *tx).await?;
            }
            for item in &result.heatmaps {
                crate::fd_query!(
                    "INSERT INTO fd.match_player_heatmaps(campaign_id,fixture_id,team_id,player_id,bins,samples) VALUES($1,$2,$3,$4,$5,$6)"
                )
                .bind(campaign_id).bind(fixture_id).bind(item.team_id).bind(item.player_id)
                .bind(json!(item.heatmap.bins)).bind(item.heatmap.samples as i32)
                .execute(&mut *tx).await?;
            }

            for event in &result.events {
                let event_type=match event.kind {
                    PlayerMatchEventKind::Shot=>"shot",
                    PlayerMatchEventKind::Goal=>"goal",
                    PlayerMatchEventKind::Save=>"save",
                    PlayerMatchEventKind::Miss=>"miss",
                    PlayerMatchEventKind::Substitution=>"substitution",
                    PlayerMatchEventKind::HalfTime=>"half_time",
                    PlayerMatchEventKind::FullTime=>"full_time",
                };
                crate::fd_query!(
                    "INSERT INTO fd.match_events(campaign_id,fixture_id,sequence,minute,event_type,team_id,player_id,related_player_id,payload)
                     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)"
                )
                .bind(campaign_id).bind(fixture_id).bind(event.sequence as i16)
                .bind(event.minute as i16).bind(event_type).bind(event.team_id)
                .bind(event.player_id).bind(event.related_player_id)
                .bind(json!({"player_id":event.player_id,"related_player_id":event.related_player_id}))
                .execute(&mut *tx).await?;
            }
            crate::fd_query!(
                "WITH played AS (
                   SELECT ml.campaign_id,ml.fixture_id,ml.team_id,ml.player_id,
                     ml.role='starter' AS started,
                     CASE WHEN ml.role='starter' THEN 0::smallint ELSE COALESCE(
                       (SELECT MIN(me.minute) FROM fd.match_events me
                        WHERE me.campaign_id=ml.campaign_id AND me.fixture_id=ml.fixture_id
                          AND me.event_type='substitution' AND me.related_player_id=ml.player_id),90)
                     END::smallint AS start_minute,
                     CASE WHEN ml.role='starter' THEN COALESCE(
                       (SELECT MIN(me.minute) FROM fd.match_events me
                        WHERE me.campaign_id=ml.campaign_id AND me.fixture_id=ml.fixture_id
                          AND me.event_type='substitution' AND me.player_id=ml.player_id),90)
                     ELSE 90 END::smallint AS end_minute,
                     CASE WHEN ml.role='starter' THEN 0::smallint ELSE COALESCE(
                       (SELECT MIN(me.sequence) FROM fd.match_events me
                        WHERE me.campaign_id=ml.campaign_id AND me.fixture_id=ml.fixture_id
                          AND me.event_type='substitution' AND me.related_player_id=ml.player_id),32767)
                     END::smallint AS start_sequence,
                     CASE WHEN ml.role='starter' THEN COALESCE(
                       (SELECT MIN(me.sequence) FROM fd.match_events me
                        WHERE me.campaign_id=ml.campaign_id AND me.fixture_id=ml.fixture_id
                          AND me.event_type='substitution' AND me.player_id=ml.player_id),32767)
                     ELSE 32767 END::smallint AS end_sequence
                   FROM fd.match_lineups ml
                   WHERE ml.campaign_id=$1 AND ml.fixture_id=$2
                 ), stats AS (
                   SELECT p.*,
                     GREATEST(0,p.end_minute-p.start_minute)::smallint AS minutes_played,
                     (SELECT COUNT(*)::smallint FROM fd.match_events me
                      WHERE me.campaign_id=p.campaign_id AND me.fixture_id=p.fixture_id
                        AND me.event_type='goal' AND me.player_id=p.player_id) AS goals,
                     (SELECT COUNT(*)::smallint FROM fd.match_events me
                      WHERE me.campaign_id=p.campaign_id AND me.fixture_id=p.fixture_id
                        AND me.event_type='goal' AND me.related_player_id=p.player_id) AS assists,
                     (GREATEST(0,p.end_minute-p.start_minute)>=60 AND NOT EXISTS (
                       SELECT 1 FROM fd.match_events me
                       WHERE me.campaign_id=p.campaign_id AND me.fixture_id=p.fixture_id
                         AND me.event_type='goal' AND me.team_id<>p.team_id
                         AND (me.minute,me.sequence)>(p.start_minute,p.start_sequence)
                         AND (me.minute,me.sequence)<=(p.end_minute,p.end_sequence)
                     )) AS clean_sheet
                   FROM played p
                 )
                 INSERT INTO fd.player_match_stats(campaign_id,fixture_id,team_id,player_id,started,minutes_played,goals,assists,clean_sheet,rating)
                 SELECT campaign_id,fixture_id,team_id,player_id,started,minutes_played,goals,assists,clean_sheet,
                   CASE WHEN minutes_played=0 THEN 0.0 ELSE LEAST(10.0,6.0+(goals*1.5)+(assists*1.0)+CASE WHEN clean_sheet THEN 0.5 ELSE 0.0 END) END::numeric(3,1)
                 FROM stats
                 ON CONFLICT(campaign_id,fixture_id,player_id) DO NOTHING"
            )
            .bind(campaign_id).bind(fixture_id)
            .execute(&mut *tx).await?;
            crate::fd_query!(
                "UPDATE fd.players p SET
                   appearances=p.appearances+CASE WHEN s.minutes_played>0 THEN 1 ELSE 0 END,
                   career_goals=p.career_goals+s.goals,
                   career_assists=p.career_assists+s.assists,
                   career_minutes=p.career_minutes+s.minutes_played,
                   clean_sheets=p.clean_sheets+CASE WHEN s.clean_sheet AND s.minutes_played>0 THEN 1 ELSE 0 END,
                   fatigue=LEAST(100,p.fatigue+CASE WHEN s.minutes_played>0
                     THEN CEIL(s.minutes_played/10.0)::integer*GREATEST(1,(100-p.stamina)/25) ELSE 0 END),
                   updated_at=now()
                 FROM fd.player_match_stats s
                 WHERE s.campaign_id=$1 AND s.fixture_id=$2 AND p.campaign_id=s.campaign_id AND p.id=s.player_id"
            )
            .bind(campaign_id).bind(fixture_id).execute(&mut *tx).await?;
            let report = format!("{home_team} {home_goals}–{away_goals} {away_team}");
            let scorers:Vec<_>=result.events.iter().filter(|e|e.kind==PlayerMatchEventKind::Goal)
                .map(|e|json!({"team_id":e.team_id,"scorer_id":e.player_id,"assist_id":e.related_player_id,"minute":e.minute}))
                .collect();
            let substitutions:Vec<_>=result.events.iter().filter(|e|e.kind==PlayerMatchEventKind::Substitution)
                .map(|e|json!({"team_id":e.team_id,"outgoing_id":e.player_id,"incoming_id":e.related_player_id,"minute":e.minute}))
                .collect();
            let result_payload = json!({
                "fixture_id":fixture_id,
                "matchday":matchday,
                "match_date":current_date,
                "home_team":home_team,
                "away_team":away_team,
                "home_goals":home_goals,
                "away_goals":away_goals,
                "home_xg_milli":result.home_xg_milli,
                "away_xg_milli":result.away_xg_milli,
                "engine_version":result.engine_version,
                "scorers":scorers,
                "substitutions":substitutions
            });
            crate::fd_query!(
                "INSERT INTO fd.chronicle(campaign_id,event_type,title,game_year,payload)
                 VALUES($1,'match_result',$2,$3,$4)",
            )
            .bind(campaign_id)
            .bind(&report)
            .bind(current_date.year())
            .bind(&result_payload)
            .execute(&mut *tx)
            .await?;
            let event_key = format!("match-result-{fixture_id}");
            let event_insert = crate::fd_query!(
                "INSERT INTO fd.game_events(campaign_id,event_key,event_type,title,body,game_date,expires_on,priority,choices,status,resolution,resolved_at)
                 VALUES($1,$2,'match_result','Результат матча',$3,$4,$4,70,'[]'::jsonb,'resolved',$5,now())
                 ON CONFLICT(campaign_id,event_key) DO NOTHING"
            )
            .bind(campaign_id)
            .bind(event_key)
            .bind(&report)
            .bind(current_date)
            .bind(&result_payload)
            .execute(&mut *tx)
            .await?;
            generated_events += event_insert.rows_affected() as i64;

            let player_is_home = player_team_id == Some(home_team_id);
            let player_is_away = player_team_id == Some(away_team_id);
            if player_is_home || player_is_away {
                let is_home = player_is_home;
                let (team_goals, opponent_goals) = if is_home {
                    (home_goals, away_goals)
                } else {
                    (away_goals, home_goals)
                };
                let (result_label, body, choices) =
                    match_board_review_choices(team_goals, opponent_goals, is_home, &report);
                let review_key = format!("match-board-review-{fixture_id}");
                let review_insert = crate::fd_query!(
                    "INSERT INTO fd.game_events(campaign_id,event_key,event_type,title,body,game_date,expires_on,priority,choices)
                     VALUES($1,$2,'match_board_review',$3,$4,$5,$6,80,$7)
                     ON CONFLICT(campaign_id,event_key) DO NOTHING"
                )
                .bind(campaign_id)
                .bind(review_key)
                .bind(format!("Решение после матча: {result_label}"))
                .bind(body)
                .bind(current_date)
                .bind(current_date + Duration::days(7))
                .bind(choices)
                .execute(&mut *tx)
                .await?;
                generated_events += review_insert.rows_affected() as i64;
            }
        }
    }

    let player_age: i32 =
        crate::fd_query_scalar!("SELECT age FROM fd.characters WHERE id=$1 AND campaign_id=$2")
            .bind(player_id)
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;
    crate::fd_query!("UPDATE fd.campaigns SET game_date=$2,current_year=$3,status=$4,version=version+1,updated_at=now() WHERE id=$1")
        .bind(campaign_id).bind(current_date).bind(current_date.year()).bind(&status)
        .execute(&mut *tx).await?;
    crate::fd_query!("INSERT INTO fd.chronicle(campaign_id,event_type,title,game_year,payload) VALUES($1,'time_advanced','The calendar moves forward',$2,$3)")
        .bind(campaign_id).bind(current_date.year())
        .bind(json!({"from_date":from_date,"to_date":current_date,"days":(current_date-from_date).num_days(),"events_generated":generated_events}))
        .execute(&mut *tx).await?;

    let result = AdvanceTimeResult {
        from_date,
        current_date,
        current_year: current_date.year(),
        player_age,
        status,
        generated_events,
        expired_events,
    };
    complete(&mut tx, identity.telegram_id, &key, campaign_id, &result).await?;
    tx.commit().await?;
    Ok(Json(result))
}

pub async fn resolve_event(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, event_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(request): Json<ResolveEventRequest>,
) -> Result<Json<Value>, ApiError> {
    if request.choice_id.trim().is_empty() || request.choice_id.len() > 40 {
        return Err(ApiError::bad_request("invalid_event_choice"));
    }
    let key = command_key(&headers)?;
    let hash = request_hash(&(campaign_id, event_id, &request))?;
    let mut tx = state.db.begin().await?;
    set_owner(&mut tx, identity.telegram_id).await?;
    if let Some(value) =
        reserve(&mut tx, identity.telegram_id, &key, "resolve_event", &hash).await?
    {
        tx.rollback().await?;
        return Ok(Json(value));
    }

    let event: (String, Value, String, NaiveDate) = crate::fd_query_as!((String, Value, String, NaiveDate),
        "SELECT event_type,choices,status,game_date FROM fd.game_events WHERE id=$1 AND campaign_id=$2 FOR UPDATE",
    )
    .bind(event_id).bind(campaign_id).fetch_optional(&mut *tx).await?.ok_or_else(ApiError::not_found)?;
    if event.2 != "pending" {
        return Err(ApiError::conflict("event_already_resolved"));
    }
    let selected = event
        .1
        .as_array()
        .and_then(|choices| {
            choices
                .iter()
                .find(|choice| choice["id"].as_str() == Some(request.choice_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| ApiError::bad_request("unknown_event_choice"))?;

    let outcome = match selected["effect"].as_str() {
        Some("club_reputation") => {
            crate::fd_query!(
                "UPDATE fd.clubs SET reputation=LEAST(100,reputation+1) WHERE campaign_id=$1",
            )
            .bind(campaign_id)
            .execute(&mut *tx)
            .await?;
            "club_reputation_increased"
        }
        Some("club_reputation_2") => {
            crate::fd_query!(
                "UPDATE fd.clubs SET reputation=LEAST(100,reputation+2) WHERE campaign_id=$1",
            )
            .bind(campaign_id)
            .execute(&mut *tx)
            .await?;
            "club_reputation_increased_by_two"
        }
        Some("club_reputation_minus_1") => {
            crate::fd_query!(
                "UPDATE fd.clubs SET reputation=GREATEST(0,reputation-1) WHERE campaign_id=$1",
            )
            .bind(campaign_id)
            .execute(&mut *tx)
            .await?;
            "club_reputation_decreased_by_one"
        }
        Some("dynasty_prestige") => {
            crate::fd_query!("UPDATE fd.dynasties SET prestige=prestige+1 WHERE campaign_id=$1")
                .bind(campaign_id)
                .execute(&mut *tx)
                .await?;
            "dynasty_prestige_increased"
        }
        Some("dynasty_prestige_2") => {
            crate::fd_query!("UPDATE fd.dynasties SET prestige=prestige+2 WHERE campaign_id=$1")
                .bind(campaign_id)
                .execute(&mut *tx)
                .await?;
            "dynasty_prestige_increased_by_two"
        }
        Some("sponsor_cash") => {
            let club_id: Uuid = crate::fd_query_scalar!(
                "SELECT id FROM fd.clubs WHERE campaign_id=$1 ORDER BY created_at LIMIT 1",
            )
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;
            let cash_account_id: Uuid = crate::fd_query_scalar!(
                "SELECT id FROM fd.accounts WHERE campaign_id=$1 AND account_type='cash' AND owner_type='club' ORDER BY created_at LIMIT 1"
            )
            .bind(campaign_id).fetch_one(&mut *tx).await?;
            let existing_revenue: Option<Uuid> = crate::fd_query_scalar!(
                "SELECT id FROM fd.accounts WHERE campaign_id=$1 AND account_type='revenue' AND owner_type='club' ORDER BY created_at LIMIT 1"
            )
            .bind(campaign_id).fetch_optional(&mut *tx).await?;
            let revenue_account_id = if let Some(id) = existing_revenue {
                id
            } else {
                let id = Uuid::new_v4();
                crate::fd_query!(
                    "INSERT INTO fd.accounts(id,campaign_id,name,account_type,owner_type,owner_id,currency,normal_balance)
                     VALUES($1,$2,'Sponsorship revenue','revenue','club',$3,'EUR','credit')"
                )
                .bind(id).bind(campaign_id).bind(club_id).execute(&mut *tx).await?;
                id
            };
            let journal_id = Uuid::new_v4();
            let journal_key = format!("sponsor-event-{event_id}");
            crate::fd_query!(
                "INSERT INTO fd.journal_entries(id,campaign_id,idempotency_key,memo,game_year)
                 VALUES($1,$2,$3,'Sponsorship payment', $4)",
            )
            .bind(journal_id)
            .bind(campaign_id)
            .bind(journal_key)
            .bind(event.3.year())
            .execute(&mut *tx)
            .await?;
            crate::fd_query!(
                "INSERT INTO fd.journal_lines(campaign_id,journal_entry_id,account_id,side,amount_minor)
                 VALUES($1,$2,$3,'debit',25000000),($1,$2,$4,'credit',25000000)"
            )
            .bind(campaign_id).bind(journal_id).bind(cash_account_id).bind(revenue_account_id)
            .execute(&mut *tx).await?;
            "sponsorship_income_received"
        }
        _ => return Err(ApiError::bad_request("unsupported_event_effect")),
    };
    let resolution = json!({"choice_id":request.choice_id,"outcome":outcome});
    crate::fd_query!("UPDATE fd.game_events SET status='resolved',resolution=$3,resolved_at=now() WHERE id=$1 AND campaign_id=$2")
        .bind(event_id).bind(campaign_id).bind(&resolution).execute(&mut *tx).await?;
    let year = event.3.year();
    crate::fd_query!("INSERT INTO fd.chronicle(campaign_id,event_type,title,game_year,payload) VALUES($1,'event_resolved',$2,$3,$4)")
        .bind(campaign_id)
        .bind(selected["label"].as_str().unwrap_or("Club decision"))
        .bind(year)
        .bind(json!({"event_id":event_id,"event_type":event.0,"game_date":event.3,"resolution":resolution}))
        .execute(&mut *tx).await?;

    let result = json!({"event_id":event_id,"status":"resolved","resolution":resolution});
    complete(&mut tx, identity.telegram_id, &key, campaign_id, &result).await?;
    tx.commit().await?;
    Ok(Json(result))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_board_decision_choices_follow_result_and_venue() {
        let (win, win_body, win_choices) =
            match_board_review_choices(2, 1, false, "Northbridge United 1–2 Harbor Athletic");
        assert_eq!(win, "победа");
        assert!(win_body.contains("выездной"));
        assert_eq!(win_choices.as_array().expect("win choices").len(), 2);
        assert_eq!(win_choices[0]["effect"], "club_reputation_2");
        assert_eq!(win_choices[1]["effect"], "dynasty_prestige");

        let (draw, draw_body, draw_choices) =
            match_board_review_choices(1, 1, true, "Northbridge United 1–1 Harbor Athletic");
        assert_eq!(draw, "ничья");
        assert!(draw_body.contains("Матч завершился вничью"));
        assert_eq!(draw_choices[0]["effect"], "club_reputation");
        assert_eq!(draw_choices[1]["effect"], "dynasty_prestige");

        let (loss, loss_body, loss_choices) =
            match_board_review_choices(0, 2, false, "Northbridge United 0–2 Harbor Athletic");
        assert_eq!(loss, "поражение");
        assert!(loss_body.contains("выезде"));
        assert_eq!(loss_choices.as_array().expect("loss choices").len(), 2);
        assert_eq!(loss_choices[0]["effect"], "club_reputation_minus_1");
        assert_eq!(loss_choices[1]["effect"], "dynasty_prestige_2");
    }
}
