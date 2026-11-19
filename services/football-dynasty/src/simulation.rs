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
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::{
    auth::Identity,
    errors::ApiError,
    match_engine::{MatchSquad, PlayerMatchEventKind, SubstitutionPlan, simulate_player_match},
    squad::{Formation, Lineup, Player, PlayerAttributes, Position, TacticalPlan},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/time/advance",
            post(advance_time),
        )
        .route("/api/v1/campaigns/{campaign_id}/events", get(list_events))
        .route("/api/v1/campaigns/{campaign_id}/season", get(get_season))
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

#[derive(Debug, sqlx::FromRow)]
struct MatchPlayerRow {
    id: Uuid,
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

fn take_position(players: &mut Vec<Player>, position: Position, count: usize) -> Vec<Player> {
    let mut selected = Vec::with_capacity(count);
    let mut remaining = Vec::with_capacity(players.len());
    for player in players.drain(..) {
        if player.position == position && selected.len() < count {
            selected.push(player);
        } else {
            remaining.push(player);
        }
    }
    *players = remaining;
    selected
}

async fn load_match_squad(
    tx: &mut Transaction<'_, Postgres>,
    campaign_id: Uuid,
    fixture_id: Uuid,
    team_id: Uuid,
    match_date: NaiveDate,
) -> Result<MatchSquad, ApiError> {
    let tactics = crate::fd_query_as!((String, i16, i16, i16, i16),
        "SELECT formation,pressing,tempo,width,attacking_intent FROM fd.team_tactics WHERE campaign_id=$1 AND team_id=$2")
        .bind(campaign_id).bind(team_id).fetch_optional(&mut **tx).await?
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
        "SELECT p.id,p.position,p.pace,p.shooting,p.passing,p.defending,p.physical,
                p.goalkeeping,p.stamina,p.morale,p.fatigue,p.injured_until,p.suspended_until
         FROM fd.match_lineups ml JOIN fd.players p ON p.campaign_id=ml.campaign_id AND p.id=ml.player_id
         WHERE ml.campaign_id=$1 AND ml.fixture_id=$2 AND ml.team_id=$3
         ORDER BY p.shirt_number")
        .bind(campaign_id).bind(fixture_id).bind(team_id).fetch_all(&mut **tx).await?;
    let mut players = Vec::with_capacity(rows.len());
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
        if unavailable { continue; }
        players.push(Player {
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
        });
    }
    let mut starters = take_position(&mut players,Position::Goalkeeper,1);
    starters.extend(take_position(&mut players,Position::Defender,usize::from(formation.defenders)));
    starters.extend(take_position(&mut players,Position::Midfielder,midfielders));
    starters.extend(take_position(&mut players,Position::Forward,forwards));
    let squad = MatchSquad {
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
        bench:players,
    };
    if squad.starting.starters.len()!=11 {
        return Err(ApiError::conflict("insufficient_eligible_players_for_lineup"));
    }
    Ok(squad)
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

#[derive(Debug, Serialize)]
pub struct FixtureMatchView {
    pub fixture: SeasonFixture,
    pub events: Vec<MatchEventView>,
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
    tx.commit().await?;
    Ok(Json(FixtureMatchView { fixture, events }))
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
            for event in &result.events {
                let event_type=match event.kind {
                    PlayerMatchEventKind::Goal=>"goal",
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
                   SELECT ml.campaign_id,ml.fixture_id,ml.team_id,ml.player_id,ml.role='starter' AS started,
                     CASE WHEN ml.role='starter' THEN COALESCE(
                       (SELECT MIN(me.minute) FROM fd.match_events me WHERE me.campaign_id=ml.campaign_id
                        AND me.fixture_id=ml.fixture_id AND me.event_type='substitution' AND me.player_id=ml.player_id),90)
                     ELSE COALESCE(90-(SELECT MIN(me.minute) FROM fd.match_events me WHERE me.campaign_id=ml.campaign_id
                        AND me.fixture_id=ml.fixture_id AND me.event_type='substitution' AND me.related_player_id=ml.player_id),0)
                     END::smallint AS minutes_played
                   FROM fd.match_lineups ml
                   WHERE ml.campaign_id=$1 AND ml.fixture_id=$2
                 ), stats AS (
                   SELECT p.*,
                     (SELECT COUNT(*)::smallint FROM fd.match_events me WHERE me.campaign_id=p.campaign_id
                       AND me.fixture_id=p.fixture_id AND me.event_type='goal' AND me.player_id=p.player_id) AS goals,
                     (SELECT COUNT(*)::smallint FROM fd.match_events me WHERE me.campaign_id=p.campaign_id
                       AND me.fixture_id=p.fixture_id AND me.event_type='goal' AND me.related_player_id=p.player_id) AS assists,
                     (p.minutes_played>0 AND ((p.team_id=$3 AND $5=0) OR (p.team_id=$4 AND $6=0))) AS clean_sheet
                   FROM played p
                 )
                 INSERT INTO fd.player_match_stats(campaign_id,fixture_id,team_id,player_id,started,minutes_played,goals,assists,clean_sheet,rating)
                 SELECT campaign_id,fixture_id,team_id,player_id,started,minutes_played,goals,assists,clean_sheet,
                   CASE WHEN minutes_played=0 THEN 0.0 ELSE LEAST(10.0,6.0+(goals*1.5)+(assists*1.0)+CASE WHEN clean_sheet THEN 0.5 ELSE 0.0 END) END::numeric(3,1)
                 FROM stats
                 ON CONFLICT(campaign_id,fixture_id,player_id) DO NOTHING"
            )
            .bind(campaign_id).bind(fixture_id).bind(home_team_id).bind(away_team_id)
            .bind(away_goals).bind(home_goals)
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
