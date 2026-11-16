use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    api::{
        complete_command, idempotency_key, payload_hash, replay, reserve_command, set_owner_scope,
    },
    auth::Identity,
    errors::ApiError,
    state::AppState,
};

pub const PRINCIPLE_COUNT: i16 = 18;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/campaigns/{campaign_id}/doctrine",
            get(get_progress),
        )
        .route(
            "/api/v1/campaigns/{campaign_id}/doctrine/{principle_id}/answer",
            post(submit_answer),
        )
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DoctrineAnswerRequest {
    pub choice_id: String,
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct DoctrineCompletion {
    pub principle_id: i16,
    pub choice_id: String,
    pub score: i16,
    pub completed_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct DoctrineProgress {
    pub completed: Vec<DoctrineCompletion>,
    pub completed_count: i16,
    pub total_principles: i16,
    pub total_score: i16,
    pub unlocked_principle_id: Option<i16>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DoctrineAnswerResult {
    pub campaign_id: Uuid,
    pub principle_id: i16,
    pub choice_id: String,
    pub score: i16,
    pub completed_at: DateTime<Utc>,
    pub completed_count: i16,
    pub total_principles: i16,
    pub unlocked_principle_id: Option<i16>,
}

async fn get_progress(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path(campaign_id): Path<Uuid>,
) -> Result<Json<DoctrineProgress>, ApiError> {
    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2)",
    )
    .bind(campaign_id)
    .bind(identity.telegram_id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(ApiError::not_found());
    }

    let completed = sqlx::query_as::<_, DoctrineCompletion>(
        "SELECT principle_id,choice_id,score,completed_at FROM fd.doctrine_progress WHERE campaign_id=$1 ORDER BY principle_id",
    )
    .bind(campaign_id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;

    let completed_count = i16::try_from(completed.len()).map_err(|_| ApiError::internal())?;
    let total_score = completed.iter().map(|item| item.score).sum();
    Ok(Json(DoctrineProgress {
        completed,
        completed_count,
        total_principles: PRINCIPLE_COUNT,
        total_score,
        unlocked_principle_id: (completed_count < PRINCIPLE_COUNT).then_some(completed_count + 1),
    }))
}

async fn submit_answer(
    State(state): State<AppState>,
    Extension(identity): Extension<Identity>,
    Path((campaign_id, principle_id)): Path<(Uuid, i16)>,
    headers: HeaderMap,
    Json(request): Json<DoctrineAnswerRequest>,
) -> Result<(StatusCode, Json<DoctrineAnswerResult>), ApiError> {
    if !(1..=PRINCIPLE_COUNT).contains(&principle_id) {
        return Err(ApiError::bad_request("invalid_principle_id"));
    }
    let score = score_choice(principle_id, &request.choice_id)
        .ok_or_else(|| ApiError::bad_request("invalid_doctrine_choice"))?;
    let key = idempotency_key(&headers)?;
    let hash = payload_hash(&(campaign_id, principle_id, &request))?;

    let mut tx = state.db.begin().await?;
    set_owner_scope(&mut tx, identity.telegram_id).await?;
    if let Some(value) = reserve_command(
        &mut tx,
        identity.telegram_id,
        &key,
        "submit_doctrine_answer",
        &hash,
    )
    .await?
    {
        tx.rollback().await?;
        return Ok((StatusCode::OK, replay(value)?));
    }

    let current_year: i32 = sqlx::query_scalar(
        "SELECT current_year FROM fd.campaigns WHERE id=$1 AND owner_telegram_id=$2 FOR UPDATE",
    )
    .bind(campaign_id)
    .bind(identity.telegram_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(ApiError::not_found)?;

    let completed_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM fd.doctrine_progress WHERE campaign_id=$1")
            .bind(campaign_id)
            .fetch_one(&mut *tx)
            .await?;

    if i64::from(principle_id) <= completed_count {
        return Err(ApiError::conflict("principle_already_completed"));
    }
    if i64::from(principle_id) != completed_count + 1 {
        return Err(ApiError::conflict("principle_locked"));
    }

    let completed_at: DateTime<Utc> = sqlx::query_scalar(
        "INSERT INTO fd.doctrine_progress (campaign_id,principle_id,choice_id,score) VALUES ($1,$2,$3,$4) RETURNING completed_at",
    )
    .bind(campaign_id)
    .bind(principle_id)
    .bind(&request.choice_id)
    .bind(score)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO fd.chronicle (campaign_id,event_type,title,game_year,payload) VALUES ($1,'machiavelli_lesson_completed','A lesson in strategic judgment',$2,$3)",
    )
    .bind(campaign_id)
    .bind(current_year)
    .bind(serde_json::json!({
        "principle_id": principle_id,
        "choice_id": request.choice_id,
        "score": score
    }))
    .execute(&mut *tx)
    .await?;

    let completed_count = i16::try_from(completed_count + 1).map_err(|_| ApiError::internal())?;
    let response = DoctrineAnswerResult {
        campaign_id,
        principle_id,
        choice_id: request.choice_id,
        score,
        completed_at,
        completed_count,
        total_principles: PRINCIPLE_COUNT,
        unlocked_principle_id: (completed_count < PRINCIPLE_COUNT)
            .then_some(completed_count + 1),
    };
    complete_command(&mut tx, identity.telegram_id, &key, campaign_id, &response).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// Strategic-judgment scores are fixed server-side; clients cannot award
/// themselves points by changing a submitted score.
pub fn score_choice(principle_id: i16, choice_id: &str) -> Option<i16> {
    let best = match principle_id {
        1 => "a",
        2 => "b",
        3 => "c",
        4 => "a",
        5 => "b",
        6 => "c",
        7 => "a",
        8 => "b",
        9 => "c",
        10 => "a",
        11 => "b",
        12 => "c",
        13 => "a",
        14 => "b",
        15 => "c",
        16 => "a",
        17 => "b",
        18 => "c",
        _ => return None,
    };
    let middle = match best {
        "a" => "b",
        "b" => "c",
        _ => "a",
    };
    match choice_id {
        value if value == best => Some(2),
        value if value == middle => Some(1),
        "a" | "b" | "c" => Some(0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{PRINCIPLE_COUNT, score_choice};

    #[test]
    fn all_eighteen_principles_have_three_bounded_choice_scores() {
        for principle_id in 1..=PRINCIPLE_COUNT {
            let scores = ["a", "b", "c"]
                .map(|choice| score_choice(principle_id, choice))
                .map(|score| score.expect("choice must be mapped"));
            assert_eq!(scores.iter().filter(|score| **score == 2).count(), 1);
            assert_eq!(scores.iter().filter(|score| **score == 1).count(), 1);
            assert_eq!(scores.iter().filter(|score| **score == 0).count(), 1);
        }
    }

    #[test]
    fn unknown_principles_and_choice_ids_are_rejected() {
        assert_eq!(score_choice(0, "a"), None);
        assert_eq!(score_choice(19, "a"), None);
        assert_eq!(score_choice(1, "d"), None);
        assert_eq!(score_choice(1, ""), None);
    }
}
