pub const MAX_ROUND_PAUSE_MS: u64 = 120_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoomStatus {
    Waiting,
    Playing,
    Finished,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoundStatus {
    Pending,
    Active,
    Completed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CardStatus {
    Pending,
    Correct,
    Skipped,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CardProgress {
    pub id: String,
    pub status: CardStatus,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoomRecord {
    pub id: String,
    pub status: RoomStatus,
    pub current_round_id: Option<String>,
    pub ended_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundRecord {
    pub id: String,
    pub room_id: String,
    pub round_number: u32,
    pub team_id: String,
    pub explainer_id: Option<i64>,
    pub status: RoundStatus,
    pub ended_at_ms: Option<i64>,
    pub paused_at_ms: Option<i64>,
    pub paused_ms: u64,
    pub cards: Vec<CardProgress>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoundScore {
    pub room_id: String,
    pub team_id: String,
    pub round_id: String,
    pub points: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameLifecycle {
    pub room: RoomRecord,
    pub rounds: Vec<RoundRecord>,
    pub scores: Vec<RoundScore>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LifecycleError {
    RoundNotFound,
    Unauthorized,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EndRoundOutcome {
    AlreadyEnded,
    NextRound { next_round_id: String },
    GameEnd,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PauseOutcome {
    Changed,
    Unchanged,
}

impl GameLifecycle {
    pub fn end_round(
        &mut self,
        round_id: &str,
        now_ms: i64,
    ) -> Result<EndRoundOutcome, LifecycleError> {
        let index = self
            .rounds
            .iter()
            .position(|round| round.id == round_id && round.room_id == self.room.id)
            .ok_or(LifecycleError::RoundNotFound)?;

        if self.rounds[index].status != RoundStatus::Active {
            return Ok(EndRoundOutcome::AlreadyEnded);
        }

        let round = &mut self.rounds[index];
        round.status = RoundStatus::Completed;
        round.ended_at_ms = Some(now_ms);

        let score = RoundScore {
            room_id: round.room_id.clone(),
            team_id: round.team_id.clone(),
            round_id: round.id.clone(),
            points: u32::try_from(
                round
                    .cards
                    .iter()
                    .filter(|card| card.status == CardStatus::Correct)
                    .count(),
            )
            .unwrap_or(u32::MAX),
        };

        if let Some(existing) = self.scores.iter_mut().find(|existing| {
            existing.room_id == score.room_id
                && existing.team_id == score.team_id
                && existing.round_id == score.round_id
        }) {
            existing.points = score.points;
        } else {
            self.scores.push(score);
        }

        let next_round_number = self.rounds[index].round_number.checked_add(1);
        if let Some(next) = next_round_number.and_then(|number| {
            self.rounds.iter().find(|candidate| {
                candidate.room_id == self.room.id
                    && candidate.round_number == number
                    && candidate.status == RoundStatus::Pending
            })
        }) {
            return Ok(EndRoundOutcome::NextRound {
                next_round_id: next.id.clone(),
            });
        }

        self.room.status = RoomStatus::Finished;
        self.room.ended_at_ms = Some(now_ms);
        Ok(EndRoundOutcome::GameEnd)
    }

    pub fn pause_round(
        &mut self,
        round_id: &str,
        caller_id: i64,
        now_ms: i64,
    ) -> Result<PauseOutcome, LifecycleError> {
        let round = self.round_mut(round_id)?;
        if round.explainer_id != Some(caller_id) {
            return Err(LifecycleError::Unauthorized);
        }
        if round.status != RoundStatus::Active
            || round.paused_at_ms.is_some()
            || round.paused_ms >= MAX_ROUND_PAUSE_MS
        {
            return Ok(PauseOutcome::Unchanged);
        }
        round.paused_at_ms = Some(now_ms);
        Ok(PauseOutcome::Changed)
    }

    pub fn resume_round(
        &mut self,
        round_id: &str,
        caller_id: i64,
        now_ms: i64,
    ) -> Result<PauseOutcome, LifecycleError> {
        let round = self.round_mut(round_id)?;
        if round.explainer_id != Some(caller_id) {
            return Err(LifecycleError::Unauthorized);
        }
        let Some(paused_at_ms) = round.paused_at_ms else {
            return Ok(PauseOutcome::Unchanged);
        };

        let elapsed = (i128::from(now_ms) - i128::from(paused_at_ms)).max(0);
        let elapsed = u64::try_from(elapsed).unwrap_or(u64::MAX);
        round.paused_ms = round
            .paused_ms
            .saturating_add(elapsed)
            .min(MAX_ROUND_PAUSE_MS);
        round.paused_at_ms = None;
        Ok(PauseOutcome::Changed)
    }

    fn round_mut(&mut self, round_id: &str) -> Result<&mut RoundRecord, LifecycleError> {
        let room_id = self.room.id.as_str();
        self.rounds
            .iter_mut()
            .find(|round| round.id == round_id && round.room_id == room_id)
            .ok_or(LifecycleError::RoundNotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, status: CardStatus) -> CardProgress {
        CardProgress {
            id: id.into(),
            status,
        }
    }

    fn round(id: &str, number: u32, status: RoundStatus, cards: Vec<CardProgress>) -> RoundRecord {
        RoundRecord {
            id: id.into(),
            room_id: "room-1".into(),
            round_number: number,
            team_id: "team-1".into(),
            explainer_id: Some(7),
            status,
            ended_at_ms: None,
            paused_at_ms: None,
            paused_ms: 0,
            cards,
        }
    }

    fn game(rounds: Vec<RoundRecord>) -> GameLifecycle {
        GameLifecycle {
            room: RoomRecord {
                id: "room-1".into(),
                status: RoomStatus::Playing,
                current_round_id: Some("round-1".into()),
                ended_at_ms: None,
            },
            rounds,
            scores: Vec::new(),
        }
    }

    #[test]
    fn end_round_scores_only_correct_cards_and_returns_the_next_round() {
        let mut game = game(vec![
            round(
                "round-1",
                1,
                RoundStatus::Active,
                vec![
                    card("a", CardStatus::Correct),
                    card("b", CardStatus::Skipped),
                    card("c", CardStatus::Correct),
                    card("d", CardStatus::Pending),
                ],
            ),
            round("round-2", 2, RoundStatus::Pending, Vec::new()),
        ]);

        assert_eq!(
            game.end_round("round-1", 50_000).unwrap(),
            EndRoundOutcome::NextRound {
                next_round_id: "round-2".into()
            }
        );
        assert_eq!(game.rounds[0].status, RoundStatus::Completed);
        assert_eq!(game.rounds[0].ended_at_ms, Some(50_000));
        assert_eq!(game.scores.len(), 1);
        assert_eq!(game.scores[0].points, 2);
        assert_eq!(game.room.status, RoomStatus::Playing);
        assert_eq!(game.room.ended_at_ms, None);
    }

    #[test]
    fn end_round_is_idempotent_and_does_not_score_twice() {
        let mut game = game(vec![round(
            "round-1",
            1,
            RoundStatus::Active,
            vec![card("a", CardStatus::Correct)],
        )]);

        assert_eq!(
            game.end_round("round-1", 10).unwrap(),
            EndRoundOutcome::GameEnd
        );
        assert_eq!(
            game.end_round("round-1", 20).unwrap(),
            EndRoundOutcome::AlreadyEnded
        );
        assert_eq!(game.scores.len(), 1);
        assert_eq!(game.scores[0].points, 1);
        assert_eq!(game.rounds[0].ended_at_ms, Some(10));
        assert_eq!(game.room.ended_at_ms, Some(10));
    }

    #[test]
    fn final_round_finishes_the_room_in_the_same_operation() {
        let mut game = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);

        assert_eq!(
            game.end_round("round-1", 123).unwrap(),
            EndRoundOutcome::GameEnd
        );
        assert_eq!(game.room.status, RoomStatus::Finished);
        assert_eq!(game.room.ended_at_ms, Some(123));
        assert_eq!(game.scores[0].points, 0);
    }

    #[test]
    fn a_missing_consecutive_round_finishes_the_room_like_the_sql_rpc() {
        let mut game = game(vec![
            round("round-1", 1, RoundStatus::Active, Vec::new()),
            round("round-3", 3, RoundStatus::Pending, Vec::new()),
        ]);

        assert_eq!(
            game.end_round("round-1", 123).unwrap(),
            EndRoundOutcome::GameEnd
        );
        assert_eq!(game.rounds[1].status, RoundStatus::Pending);
        assert_eq!(game.room.status, RoomStatus::Finished);
    }

    #[test]
    fn an_existing_score_is_replaced_not_added() {
        let mut game = game(vec![round(
            "round-1",
            1,
            RoundStatus::Active,
            vec![
                card("a", CardStatus::Correct),
                card("b", CardStatus::Correct),
            ],
        )]);
        game.scores.push(RoundScore {
            room_id: "room-1".into(),
            team_id: "team-1".into(),
            round_id: "round-1".into(),
            points: 99,
        });

        game.end_round("round-1", 123).unwrap();

        assert_eq!(game.scores.len(), 1);
        assert_eq!(game.scores[0].points, 2);
    }

    #[test]
    fn non_active_rounds_and_unknown_round_ids_do_not_mutate_the_game() {
        let mut game = game(vec![round(
            "round-1",
            1,
            RoundStatus::Pending,
            vec![card("a", CardStatus::Correct)],
        )]);
        let before = game.clone();

        assert_eq!(
            game.end_round("round-1", 123).unwrap(),
            EndRoundOutcome::AlreadyEnded
        );
        assert_eq!(game, before);
        assert_eq!(
            game.end_round("missing", 123),
            Err(LifecycleError::RoundNotFound)
        );
        assert_eq!(game, before);
    }

    #[test]
    fn pause_is_explainer_only_and_idempotent() {
        let mut game = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);

        assert_eq!(
            game.pause_round("round-1", 7, 10).unwrap(),
            PauseOutcome::Changed
        );
        assert_eq!(
            game.pause_round("round-1", 7, 20).unwrap(),
            PauseOutcome::Unchanged
        );
        assert_eq!(game.rounds[0].paused_at_ms, Some(10));
        assert_eq!(
            game.pause_round("round-1", 8, 30),
            Err(LifecycleError::Unauthorized)
        );
    }

    #[test]
    fn pause_refuses_inactive_rounds_and_rounds_at_the_pause_cap() {
        let mut inactive = game(vec![round(
            "round-1",
            1,
            RoundStatus::Completed,
            Vec::new(),
        )]);
        assert_eq!(
            inactive.pause_round("round-1", 7, 10).unwrap(),
            PauseOutcome::Unchanged
        );

        let mut capped = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);
        capped.rounds[0].paused_ms = MAX_ROUND_PAUSE_MS;
        assert_eq!(
            capped.pause_round("round-1", 7, 10).unwrap(),
            PauseOutcome::Unchanged
        );
    }

    #[test]
    fn resume_folds_elapsed_pause_and_clamps_total_to_two_minutes() {
        let mut game = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);
        game.rounds[0].paused_ms = 100_000;
        game.rounds[0].paused_at_ms = Some(1_000);

        assert_eq!(
            game.resume_round("round-1", 7, 40_000).unwrap(),
            PauseOutcome::Changed
        );
        assert_eq!(game.rounds[0].paused_ms, MAX_ROUND_PAUSE_MS);
        assert_eq!(game.rounds[0].paused_at_ms, None);
    }

    #[test]
    fn resume_does_not_count_time_before_the_pause_or_allow_non_explainer() {
        let mut game = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);
        game.rounds[0].paused_at_ms = Some(1_000);

        assert_eq!(
            game.resume_round("round-1", 7, 500).unwrap(),
            PauseOutcome::Changed
        );
        assert_eq!(game.rounds[0].paused_ms, 0);
        assert_eq!(game.rounds[0].paused_at_ms, None);
        assert_eq!(
            game.resume_round("round-1", 8, 2_000),
            Err(LifecycleError::Unauthorized)
        );
    }

    #[test]
    fn pause_and_resume_for_unknown_or_foreign_rounds_fail_without_mutation() {
        let mut game = game(vec![round("foreign", 1, RoundStatus::Active, Vec::new())]);
        game.rounds[0].room_id = "other-room".into();
        let before = game.clone();

        assert_eq!(
            game.pause_round("foreign", 7, 10),
            Err(LifecycleError::RoundNotFound)
        );
        assert_eq!(
            game.resume_round("foreign", 7, 10),
            Err(LifecycleError::RoundNotFound)
        );
        assert_eq!(game, before);
    }

    #[test]
    fn a_round_can_be_resumed_only_by_its_explainer() {
        let mut game = game(vec![round("round-1", 1, RoundStatus::Active, Vec::new())]);
        game.rounds[0].paused_at_ms = Some(1_000);

        assert_eq!(
            game.resume_round("round-1", 99, 5_000),
            Err(LifecycleError::Unauthorized)
        );
        assert_eq!(game.rounds[0].paused_at_ms, Some(1_000));
    }
}
