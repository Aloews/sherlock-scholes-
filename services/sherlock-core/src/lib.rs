pub mod round_plan;

pub use round_plan::{build_round_plan, GameMode, PlannedRound, RoomMember, RoundPlanError};

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
        self.seconds.saturating_sub(self.elapsed_ms(now_ms) / 1_000)
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

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct DeckFilter {
    pub categories: Option<Vec<String>>,
    pub card_ids: Option<Vec<String>>,
    pub continents: Option<Vec<String>>,
    pub countries: Option<Vec<String>>,
    pub leagues: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub clubs: Option<Vec<String>>,
    pub fame_min: Option<u8>,
    pub lang: Option<String>,
}

fn canonicalize(values: &mut Option<Vec<String>>, deduplicate: bool) {
    if let Some(items) = values {
        if items.is_empty() {
            *values = None;
            return;
        }
        items.sort();
        if deduplicate {
            items.dedup();
        }
    }
}

impl DeckFilter {
    pub fn normalized(mut self) -> Self {
        canonicalize(&mut self.categories, false);
        canonicalize(&mut self.card_ids, true);
        canonicalize(&mut self.continents, false);
        canonicalize(&mut self.countries, false);
        canonicalize(&mut self.leagues, false);
        canonicalize(&mut self.tags, false);
        canonicalize(&mut self.clubs, false);
        if self.fame_min == Some(0) {
            self.fame_min = None;
        }
        if self.lang.as_deref() == Some("") {
            self.lang = None;
        }
        self
    }

    pub fn is_empty_selection(&self) -> bool {
        matches!(&self.categories, Some(items) if items.is_empty())
    }

    pub fn is_whole_deck(&self) -> bool {
        let filter = self.clone().normalized();
        filter.categories.is_none()
            && filter.card_ids.is_none()
            && filter.continents.is_none()
            && filter.countries.is_none()
            && filter.leagues.is_none()
            && filter.tags.is_none()
            && filter.clubs.is_none()
            && filter.fame_min.is_none()
            && filter.lang.is_none()
    }

    pub fn pinnable(mut self) -> Self {
        self.lang = None;
        self.normalized()
    }
}

pub fn room_deck_filter(deck: Option<DeckFilter>, categories: Option<Vec<String>>) -> DeckFilter {
    match deck {
        Some(value) => value.normalized(),
        None => DeckFilter {
            categories,
            ..DeckFilter::default()
        }
        .normalized(),
    }
}

pub fn settings_categories(filter: &DeckFilter) -> Option<Vec<String>> {
    filter.clone().pinnable().categories
}

pub const ROOM_CODE_LENGTH: usize = 6;

pub fn normalize_room_code(raw: Option<&str>) -> Option<String> {
    let code = raw?.trim().to_ascii_uppercase();
    if code.is_empty()
        || code.len() > ROOM_CODE_LENGTH
        || !code.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(code)
}

pub fn sanitize_room_code_input(raw: &str) -> String {
    let candidate = extract_room_code(raw);
    candidate.chars().take(ROOM_CODE_LENGTH).collect()
}

fn extract_room_code(raw: &str) -> String {
    let text = raw.trim();
    let candidate = if let Some((_, query)) = text.split_once('?') {
        query
            .split('&')
            .find_map(|part| {
                let (key, value) = part.split_once('=')?;
                (key.eq_ignore_ascii_case("startapp") || key.eq_ignore_ascii_case("start"))
                    .then_some(value)
            })
            .unwrap_or("")
    } else {
        text
    };
    candidate
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_uppercase())
        .collect()
}

pub fn room_code_from_text(raw: Option<&str>) -> Option<String> {
    let text = raw?.trim();
    if text.contains('?') {
        normalize_room_code(Some(&extract_room_code(text)))
    } else {
        normalize_room_code(Some(text))
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
    fn deck_filter_normalization_matches_client_contract() {
        let filter = DeckFilter {
            categories: Some(vec!["player".into(), "club".into()]),
            card_ids: Some(vec!["b".into(), "a".into(), "b".into()]),
            fame_min: Some(0),
            lang: Some("".into()),
            ..DeckFilter::default()
        }
        .normalized();
        assert_eq!(
            filter.categories,
            Some(vec!["club".to_string(), "player".to_string()])
        );
        assert_eq!(
            filter.card_ids,
            Some(vec!["a".to_string(), "b".to_string()])
        );
        assert_eq!(filter.fame_min, None);
        assert_eq!(filter.lang, None);
    }

    #[test]
    fn empty_filter_is_whole_deck_but_explicit_empty_category_is_empty_selection() {
        assert!(DeckFilter::default().is_whole_deck());
        let empty = DeckFilter {
            categories: Some(vec![]),
            ..DeckFilter::default()
        };
        assert!(empty.is_empty_selection());
        assert!(empty.is_whole_deck());
    }

    #[test]
    fn room_filter_falls_back_for_legacy_rooms_and_prefers_saved_deck() {
        let legacy = room_deck_filter(None, Some(vec!["player".into()]));
        assert_eq!(legacy.categories, Some(vec!["player".to_string()]));

        let saved = room_deck_filter(
            Some(DeckFilter {
                categories: Some(vec!["club".into()]),
                lang: Some("ru".into()),
                ..DeckFilter::default()
            }),
            Some(vec!["player".into()]),
        );
        assert_eq!(saved.categories, Some(vec!["club".to_string()]));
        assert_eq!(saved.lang, Some("ru".to_string()));
    }

    #[test]
    fn pinned_room_filter_drops_device_language_and_keeps_other_constraints() {
        let pinned = DeckFilter {
            categories: Some(vec!["player".into()]),
            lang: Some("ru".into()),
            fame_min: Some(60),
            ..DeckFilter::default()
        }
        .pinnable();
        assert_eq!(pinned.lang, None);
        assert_eq!(pinned.fame_min, Some(60));
        assert_eq!(
            settings_categories(&pinned),
            Some(vec!["player".to_string()])
        );
    }

    #[test]
    fn room_codes_accept_one_to_six_ascii_alphanumeric_characters() {
        assert_eq!(normalize_room_code(Some(" a ")), Some("A".into()));
        assert_eq!(normalize_room_code(Some(" ab12cd ")), Some("AB12CD".into()));
        assert_eq!(normalize_room_code(Some("")), None);
        assert_eq!(normalize_room_code(Some("ABCDEFG")), None);
        assert_eq!(normalize_room_code(Some("ABC-12")), None);
        assert_eq!(normalize_room_code(None), None);
    }

    #[test]
    fn pasted_room_invite_links_extract_startapp_and_start_codes() {
        assert_eq!(
            room_code_from_text(Some("https://t.me/bot?startapp=ab12cd")),
            Some("AB12CD".into())
        );
        assert_eq!(
            room_code_from_text(Some("https://t.me/bot?start=Q")),
            Some("Q".into())
        );
        assert_eq!(
            room_code_from_text(Some("https://t.me/bot?start=ab12cd&other=1")),
            Some("AB12CD".into())
        );
        assert_eq!(sanitize_room_code_input("ab-12 cd"), "AB12CD");
        assert_eq!(room_code_from_text(Some("https://t.me/bot?other=1")), None);
        assert_eq!(sanitize_room_code_input("https://t.me/bot?other=1"), "");
        assert_eq!(room_code_from_text(Some("no-code")), None);
        assert_eq!(room_code_from_text(Some("AB-12")), None);
        assert_eq!(sanitize_room_code_input("AB-12"), "AB12");
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
        assert_eq!(
            force_transition(GamePhase::RoundActive),
            GamePhase::RoundActive
        );
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
        let value = clock(Some(i64::MIN), u64::MAX, 0, None);
        assert_eq!(value.elapsed_ms(i64::MAX), u64::MAX);
        assert_eq!(value.deadline_at_ms(i64::MAX), i64::MAX);
        assert_eq!(
            value.remaining_seconds(i64::MAX),
            u64::MAX - u64::MAX / 1_000
        );
    }
}
