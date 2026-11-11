#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GamePhase {
    Idle,
    Lobby,
    Countdown,
    RoundActive,
    RoundSummary,
    GameEnd,
}

impl GamePhase {
    pub const ALL: [Self; 6] = [
        Self::Idle,
        Self::Lobby,
        Self::Countdown,
        Self::RoundActive,
        Self::RoundSummary,
        Self::GameEnd,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Lobby => "lobby",
            Self::Countdown => "countdown",
            Self::RoundActive => "round_active",
            Self::RoundSummary => "round_summary",
            Self::GameEnd => "game_end",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|phase| phase.as_str() == value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InvalidTransition {
    pub from: GamePhase,
    pub to: GamePhase,
}

pub const fn can_transition(from: GamePhase, to: GamePhase) -> bool {
    use GamePhase::*;
    matches!(
        (from, to),
        (Idle, Lobby)
            | (Lobby, Idle)
            | (Lobby, Countdown)
            | (Countdown, RoundActive)
            | (Countdown, Idle)
            | (RoundActive, RoundSummary)
            | (RoundActive, GameEnd)
            | (RoundSummary, Countdown)
            | (RoundSummary, RoundActive)
            | (RoundSummary, GameEnd)
            | (GameEnd, Idle)
    )
}

pub fn transition(current: GamePhase, to: GamePhase) -> Result<GamePhase, InvalidTransition> {
    if can_transition(current, to) {
        Ok(to)
    } else {
        Err(InvalidTransition { from: current, to })
    }
}

pub const fn force_transition(to: GamePhase) -> GamePhase {
    to
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RoundClock {
    pub started_at_ms: Option<i64>,
    pub seconds: u64,
    pub paused_ms: u64,
    pub paused_at_ms: Option<i64>,
}

impl RoundClock {
    pub fn elapsed_ms(self, now_ms: i64) -> u64 {
        let Some(started_at_ms) = self.started_at_ms else {
            return 0;
        };

        let since = i128::from(now_ms) - i128::from(started_at_ms);
        let held = self
            .paused_at_ms
            .map(|paused_at| (i128::from(now_ms) - i128::from(paused_at)).max(0))
            .unwrap_or(0);
        let elapsed = (since - i128::from(self.paused_ms) - held).max(0);
        u64::try_from(elapsed).unwrap_or(u64::MAX)
    }

    pub fn remaining_seconds(self, now_ms: i64) -> u64 {
        if self.started_at_ms.is_none() {
            return self.seconds;
        }
        self.seconds
            .saturating_sub(self.elapsed_ms(now_ms) / 1_000)
    }

    pub fn deadline_at_ms(self, now_ms: i64) -> i64 {
        let deadline = match self.started_at_ms {
            None => i128::from(now_ms) + i128::from(self.seconds) * 1_000,
            Some(started_at_ms) => {
                let active_pause = self
                    .paused_at_ms
                    .map(|paused_at| (i128::from(now_ms) - i128::from(paused_at)).max(0))
                    .unwrap_or(0);
                i128::from(started_at_ms)
                    + i128::from(self.seconds) * 1_000
                    + i128::from(self.paused_ms)
                    + active_pause
            }
        };
        deadline.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
    }

    pub const fn is_paused(self) -> bool {
        self.paused_at_ms.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_785_283_200_000;

    fn clock(
        started_at_ms: Option<i64>,
        seconds: u64,
        paused_ms: u64,
        paused_at_ms: Option<i64>,
    ) -> RoundClock {
        RoundClock {
            started_at_ms,
            seconds,
            paused_ms,
            paused_at_ms,
        }
    }

    #[test]
    fn every_legal_transition_is_accepted_and_every_other_edge_is_rejected() {
        for from in GamePhase::ALL {
            for to in GamePhase::ALL {
                assert_eq!(
                    transition(from, to).is_ok(),
                    can_transition(from, to),
                    "{} -> {}",
                    from.as_str(),
                    to.as_str()
                );
            }
        }
    }

    #[test]
    fn phase_names_round_trip() {
        for phase in GamePhase::ALL {
            assert_eq!(GamePhase::parse(phase.as_str()), Some(phase));
        }
        assert_eq!(GamePhase::parse("unknown"), None);
    }

    #[test]
    fn forced_transition_is_unconditional() {
        assert_eq!(force_transition(GamePhase::GameEnd), GamePhase::GameEnd);
        assert_eq!(force_transition(GamePhase::RoundActive), GamePhase::RoundActive);
    }

    #[test]
    fn running_clock_counts_down_from_server_start() {
        let value = clock(Some(T0), 60, 0, None);
        assert_eq!(value.remaining_seconds(T0), 60);
        assert_eq!(value.remaining_seconds(T0 + 10_000), 50);
        assert_eq!(value.remaining_seconds(T0 + 90_000), 0);
    }

    #[test]
    fn clock_without_start_keeps_full_duration() {
        let value = clock(None, 60, 0, None);
        assert_eq!(value.elapsed_ms(T0 + 99_000), 0);
        assert_eq!(value.remaining_seconds(T0 + 99_000), 60);
        assert_eq!(value.deadline_at_ms(T0), T0 + 60_000);
    }

    #[test]
    fn active_pause_stops_the_clock_and_moves_the_deadline() {
        let value = clock(Some(T0), 60, 0, Some(T0 + 10_000));
        assert_eq!(value.remaining_seconds(T0 + 10_000), 50);
        assert_eq!(value.remaining_seconds(T0 + 40_000), 50);
        assert_eq!(value.remaining_seconds(T0 + 600_000), 50);
        assert_eq!(value.deadline_at_ms(T0 + 10_000), T0 + 60_000);
        assert_eq!(value.deadline_at_ms(T0 + 45_000), T0 + 95_000);
        assert!(value.is_paused());
    }

    #[test]
    fn released_pause_is_folded_into_elapsed_time() {
        let value = clock(Some(T0), 60, 30_000, None);
        assert_eq!(value.remaining_seconds(T0 + 40_000), 50);
        assert_eq!(value.deadline_at_ms(T0 + 40_000), T0 + 90_000);
        assert_eq!(value.remaining_seconds(T0 + 90_000), 0);
        assert!(!value.is_paused());
    }

    #[test]
    fn a_new_pause_is_added_to_previously_folded_pauses() {
        let value = clock(Some(T0), 60, 20_000, Some(T0 + 30_000));
        assert_eq!(value.remaining_seconds(T0 + 30_000), 50);
        assert_eq!(value.remaining_seconds(T0 + 120_000), 50);
    }

    #[test]
    fn clock_never_counts_pause_or_elapsed_time_backwards() {
        let held = clock(Some(T0), 60, 0, Some(T0 + 10_000));
        assert_eq!(held.remaining_seconds(T0 + 5_000), 55);
        assert_eq!(held.deadline_at_ms(T0 + 5_000), T0 + 60_000);
        assert_eq!(clock(Some(T0), 60, 0, None).elapsed_ms(T0 - 10_000), 0);
    }

    #[test]
    fn arithmetic_saturates_at_numeric_boundaries() {
        let value = clock(Some(i64::MIN), u64::MAX, u64::MAX, Some(i64::MIN));
        assert_eq!(value.deadline_at_ms(i64::MAX), i64::MAX);
        assert_eq!(value.remaining_seconds(i64::MAX), 0);
    }
}
