use std::collections::{HashMap, HashSet};

use chrono::DateTime;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GameMode {
    Teams,
    OneVsOne,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoomMember {
    pub player_id: i64,
    pub team_id: Option<String>,
    pub joined_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlannedRound {
    pub round_number: u32,
    pub team_id: String,
    pub explainer_id: Option<i64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RoundPlanError {
    NoTeams,
    ZeroRounds,
    TooManyRounds,
    InvalidInput,
}

fn valid_team_id(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 64
        && !value.chars().any(char::is_whitespace)
}

fn valid_joined_at(value: &str) -> bool {
    value.len() <= 64 && DateTime::parse_from_rfc3339(value).is_ok()
}


pub fn build_round_plan(
    mode: GameMode,
    teams: &[String],
    members: &[RoomMember],
    host_id: i64,
    total_rounds: u32,
) -> Result<Vec<PlannedRound>, RoundPlanError> {
    if teams.is_empty() {
        return Err(RoundPlanError::NoTeams);
    }
    if total_rounds == 0 {
        return Err(RoundPlanError::ZeroRounds);
    }
    if teams.len() > 16
        || total_rounds > 64
        || host_id <= 0
        || teams.iter().any(|team| !valid_team_id(team))
        || teams.iter().collect::<HashSet<_>>().len() != teams.len()
        || members.len() > 128
        || members.iter().map(|member| member.player_id).collect::<HashSet<_>>().len()
            != members.len()
        || members.iter().any(|member| {
            member.player_id <= 0
                || !valid_joined_at(&member.joined_at)
                || member.team_id.as_ref().is_some_and(|team| !valid_team_id(team))
        })
    {
        return Err(RoundPlanError::InvalidInput);
    }

    let rounds_per_team =
        usize::try_from(total_rounds).map_err(|_| RoundPlanError::TooManyRounds)?;
    let total_turns = teams
        .len()
        .checked_mul(rounds_per_team)
        .ok_or(RoundPlanError::TooManyRounds)?;
    u32::try_from(total_turns).map_err(|_| RoundPlanError::TooManyRounds)?;
    if total_turns > 256 {
        return Err(RoundPlanError::TooManyRounds);
    }

    let mut player_by_team = HashMap::new();
    for member in members {
        if let Some(team_id) = &member.team_id {
            player_by_team.insert(team_id.clone(), member.player_id);
        }
    }

    let mut ordered_teams: Vec<&String> = teams.iter().collect();
    if mode == GameMode::OneVsOne
        && let Some(host_team_index) = teams
            .iter()
            .position(|team_id| player_by_team.get(team_id) == Some(&host_id))
    {
        let host_team = ordered_teams.remove(host_team_index);
        ordered_teams.insert(0, host_team);
    }

    let known_teams: std::collections::HashSet<&str> = teams.iter().map(String::as_str).collect();
    let mut sorted_members: Vec<&RoomMember> = members
        .iter()
        .filter(|member| {
            member
                .team_id
                .as_deref()
                .is_some_and(|team_id| known_teams.contains(team_id))
        })
        .collect();
    sorted_members.sort_by(|left, right| {
        left.joined_at
            .cmp(&right.joined_at)
            .then_with(|| left.player_id.cmp(&right.player_id))
    });

    let mut roster_by_team: HashMap<String, Vec<i64>> = HashMap::new();
    for member in sorted_members {
        if let Some(team_id) = &member.team_id {
            roster_by_team
                .entry(team_id.clone())
                .or_default()
                .push(member.player_id);
        }
    }

    let team_count = ordered_teams.len();
    let mut plan = Vec::with_capacity(total_turns);
    for index in 0..total_turns {
        let team_id = ordered_teams[index % team_count];
        let explainer_id = match mode {
            GameMode::OneVsOne => player_by_team.get(team_id).copied(),
            GameMode::Teams => roster_by_team.get(team_id).and_then(|roster| {
                if roster.is_empty() {
                    None
                } else {
                    let turn = (index / team_count) % roster.len();
                    Some(roster[turn])
                }
            }),
        };
        plan.push(PlannedRound {
            round_number: u32::try_from(index + 1).map_err(|_| RoundPlanError::TooManyRounds)?,
            team_id: team_id.clone(),
            explainer_id,
        });
    }

    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(player_id: i64, team_id: &str, joined_at: &str) -> RoomMember {
        RoomMember {
            player_id,
            team_id: Some(team_id.into()),
            joined_at: joined_at.into(),
        }
    }

    fn pairs(plan: &[PlannedRound]) -> Vec<(&str, Option<i64>)> {
        plan.iter()
            .map(|round| (round.team_id.as_str(), round.explainer_id))
            .collect()
    }

    #[test]
    fn round_plan_matches_the_shared_typescript_contract() {
        let cases: serde_json::Value = serde_json::from_str(include_str!(
            "../../../contracts/alias_round_plan_cases.json"
        ))
        .expect("round-plan fixture JSON must parse");

        for case in cases.as_array().expect("fixture root must be an array") {
            let name = case["name"].as_str().expect("case name");
            let mode = match case["mode"].as_str().expect("mode") {
                "team" => GameMode::Teams,
                "1v1" => GameMode::OneVsOne,
                other => panic!("unsupported fixture mode: {other}"),
            };
            let teams: Vec<String> = serde_json::from_value(case["teams"].clone()).expect("teams");
            let members: Vec<RoomMember> = case["members"]
                .as_array()
                .expect("members")
                .iter()
                .map(|member| RoomMember {
                    player_id: member["player_id"].as_i64().expect("player id"),
                    team_id: member["team_id"].as_str().map(str::to_owned),
                    joined_at: member["joined_at"].as_str().expect("joined_at").to_owned(),
                })
                .collect();
            let expected: Vec<PlannedRound> = case["expected"]
                .as_array()
                .expect("expected rounds")
                .iter()
                .map(|round| PlannedRound {
                    round_number: round["round_number"].as_u64().expect("round number") as u32,
                    team_id: round["team_id"].as_str().expect("team id").to_owned(),
                    explainer_id: round["explainer_id"].as_i64(),
                })
                .collect();
            let actual = build_round_plan(
                mode,
                &teams,
                &members,
                case["host_id"].as_i64().expect("host id"),
                case["total_rounds"].as_u64().expect("total rounds") as u32,
            )
            .expect("valid fixture plan");

            assert_eq!(actual, expected, "{name}");
        }
    }

    #[test]
    fn team_mode_rotates_rosters_in_join_order_with_player_id_tiebreaks() {
        let teams = vec!["blue".into(), "red".into()];
        let members = vec![
            member(3, "blue", "2026-01-02T10:00:00Z"),
            member(8, "red", "2026-01-03T10:00:00Z"),
            member(7, "red", "2026-01-01T10:00:00Z"),
            member(1, "blue", "2026-01-01T10:00:00Z"),
        ];

        let plan = build_round_plan(GameMode::Teams, &teams, &members, 1, 3).unwrap();

        assert_eq!(
            pairs(&plan),
            vec![
                ("blue", Some(1)),
                ("red", Some(7)),
                ("blue", Some(3)),
                ("red", Some(8)),
                ("blue", Some(1)),
                ("red", Some(7)),
            ]
        );
        assert_eq!(
            plan.iter()
                .map(|round| round.round_number)
                .collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5, 6]
        );
    }

    #[test]
    fn one_vs_one_puts_the_host_team_first_and_keeps_each_explainer() {
        let teams = vec!["home".into(), "away".into()];
        let members = vec![
            member(20, "away", "2026-01-02T10:00:00Z"),
            member(10, "home", "2026-01-01T10:00:00Z"),
        ];

        let plan = build_round_plan(GameMode::OneVsOne, &teams, &members, 20, 2).unwrap();

        assert_eq!(
            pairs(&plan),
            vec![
                ("away", Some(20)),
                ("home", Some(10)),
                ("away", Some(20)),
                ("home", Some(10)),
            ]
        );
    }

    #[test]
    fn one_vs_one_keeps_team_order_when_host_has_no_team() {
        let teams = vec!["home".into(), "away".into()];
        let members = vec![member(10, "home", "2026-01-01T10:00:00Z")];

        let plan = build_round_plan(GameMode::OneVsOne, &teams, &members, 99, 1).unwrap();

        assert_eq!(pairs(&plan), vec![("home", Some(10)), ("away", None)]);
    }

    #[test]
    fn teams_without_members_keep_a_null_explainer() {
        let teams = vec!["blue".into(), "red".into()];
        let members = vec![member(1, "blue", "2026-01-01T10:00:00Z")];

        let plan = build_round_plan(GameMode::Teams, &teams, &members, 1, 1).unwrap();

        assert_eq!(pairs(&plan), vec![("blue", Some(1)), ("red", None)]);
    }

    #[test]
    fn members_from_removed_teams_do_not_enter_any_roster() {
        let teams = vec!["blue".into()];
        let members = vec![
            member(1, "blue", "2026-01-01T10:00:00Z"),
            member(2, "removed", "2025-01-01T10:00:00Z"),
        ];

        let plan = build_round_plan(GameMode::Teams, &teams, &members, 1, 1).unwrap();

        assert_eq!(pairs(&plan), vec![("blue", Some(1))]);
    }

    #[test]
    fn rejects_invalid_teams_members_and_timestamps() {
        let valid_member = member(1, "blue", "2026-01-01T10:00:00Z");
        let teams = vec!["blue".to_owned()];

        assert_eq!(
            build_round_plan(GameMode::Teams, &[" ".into()], &[], 1, 1),
            Err(RoundPlanError::InvalidInput)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &["blue".into(), "blue".into()], &[], 1, 1),
            Err(RoundPlanError::InvalidInput)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &teams, &[RoomMember {
                joined_at: "2026-02-30T10:00:00Z".into(),
                ..valid_member.clone()
            }], 1, 1),
            Err(RoundPlanError::InvalidInput)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &teams, &[RoomMember {
                player_id: 0,
                ..valid_member.clone()
            }], 1, 1),
            Err(RoundPlanError::InvalidInput)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &teams, &[valid_member.clone(), valid_member], 1, 1),
            Err(RoundPlanError::InvalidInput)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &teams, &[], 0, 1),
            Err(RoundPlanError::InvalidInput)
        );
    }

    #[test]
    fn accepts_inclusive_round_plan_limits() {
        let teams: Vec<String> = (0..16).map(|index| format!("team-{index}")).collect();
        let members: Vec<RoomMember> = (1..=128)
            .map(|player_id| RoomMember {
                player_id,
                team_id: Some(teams[(player_id as usize - 1) % teams.len()].clone()),
                joined_at: "2026-01-01T10:00:00Z".into(),
            })
            .collect();

        let plan = build_round_plan(GameMode::Teams, &teams, &members, 1, 16).unwrap();

        assert_eq!(plan.len(), 256);
        assert_eq!(plan[0].round_number, 1);
        assert_eq!(plan[255].round_number, 256);
    }

    #[test]
    fn rejects_empty_teams_zero_rounds_and_unrepresentable_plan_sizes() {
        let members = [];
        assert_eq!(
            build_round_plan(GameMode::Teams, &[], &members, 1, 1),
            Err(RoundPlanError::NoTeams)
        );
        assert_eq!(
            build_round_plan(GameMode::Teams, &["blue".into()], &members, 1, 0),
            Err(RoundPlanError::ZeroRounds)
        );
        assert_eq!(
            build_round_plan(
                GameMode::Teams,
                &["blue".into(), "red".into()],
                &members,
                1,
                u32::MAX
            ),
            Err(RoundPlanError::TooManyRounds)
        );
    }
}
