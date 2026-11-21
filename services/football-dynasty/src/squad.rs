//! Squad validation and deterministic team-strength aggregation.
use std::collections::BTreeSet;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::engine::TeamProfile;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Position { Goalkeeper, Defender, Midfielder, Forward }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerAttributes {
    pub pace: u8,
    pub shooting: u8,
    pub passing: u8,
    pub defending: u8,
    pub physical: u8,
    pub goalkeeping: u8,
    pub stamina: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Player {
    pub id: Uuid,
    pub position: Position,
    pub attributes: PlayerAttributes,
    pub morale: u8,
    pub fatigue: u8,
    pub injured: bool,
    pub suspended: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Formation {
    pub defenders: u8,
    pub midfielders: u8,
    pub forwards: u8,
}

impl Formation {
    pub const FOUR_THREE_THREE: Self = Self { defenders: 4, midfielders: 3, forwards: 3 };

    fn is_valid(self) -> bool {
        self.defenders >= 3 && self.midfielders >= 2 && self.forwards >= 1
            && u16::from(self.defenders) + u16::from(self.midfielders) + u16::from(self.forwards) == 10
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TacticalPlan {
    pub pressing: u8,
    pub tempo: u8,
    pub width: u8,
    pub attacking_intent: u8,
}

impl Default for TacticalPlan {
    fn default() -> Self {
        Self { pressing: 50, tempo: 50, width: 50, attacking_intent: 50 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lineup {
    pub starters: Vec<Player>,
    pub formation: Formation,
    pub tactics: TacticalPlan,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SquadError {
    WrongPlayerCount(usize),
    InvalidFormation,
    InvalidTactics,
    PositionCountMismatch,
    DuplicatePlayer(Uuid),
    PlayerUnavailable(Uuid),
    AttributeOutOfRange(Uuid),
}

impl std::fmt::Display for SquadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrongPlayerCount(n) => write!(f, "lineup must contain 11 players, got {n}"),
            Self::InvalidFormation => write!(f, "invalid formation"),
            Self::InvalidTactics => write!(f, "tactical values must be between 0 and 100"),
            Self::PositionCountMismatch => write!(f, "lineup does not match formation"),
            Self::DuplicatePlayer(id) => write!(f, "duplicate player: {id}"),
            Self::PlayerUnavailable(id) => write!(f, "player unavailable: {id}"),
            Self::AttributeOutOfRange(id) => write!(f, "player attribute out of range: {id}"),
        }
    }
}
impl std::error::Error for SquadError {}

fn average(values: impl Iterator<Item = u8>) -> u8 {
    let (sum, count) = values.fold((0_u32, 0_u32), |(sum, count), value| {
        (sum + u32::from(value), count + 1)
    });
    sum.checked_div(count).unwrap_or_default() as u8
}

fn weighted(a: u8, b: u8, c: u8, d: u8, weights: [u16; 4]) -> u8 {
    let total = u32::from(a) * u32::from(weights[0])
        + u32::from(b) * u32::from(weights[1])
        + u32::from(c) * u32::from(weights[2])
        + u32::from(d) * u32::from(weights[3]);
    (total / u32::from(weights.iter().sum::<u16>())) as u8
}

/// Validates an XI and derives the ratings consumed by the match simulator.
pub fn build_team_profile(team_id: Uuid, lineup: &Lineup) -> Result<TeamProfile, SquadError> {
    if lineup.starters.len() != 11 {
        return Err(SquadError::WrongPlayerCount(lineup.starters.len()));
    }
    if !lineup.formation.is_valid() {
        return Err(SquadError::InvalidFormation);
    }
    if [lineup.tactics.pressing, lineup.tactics.tempo, lineup.tactics.width,
        lineup.tactics.attacking_intent].iter().any(|value| *value > 100) {
        return Err(SquadError::InvalidTactics);
    }

    let mut ids = BTreeSet::new();
    let mut goalkeepers = Vec::new();
    let mut defenders = Vec::new();
    let mut midfielders = Vec::new();
    let mut forwards = Vec::new();

    for player in &lineup.starters {
        if !ids.insert(player.id) {
            return Err(SquadError::DuplicatePlayer(player.id));
        }
        if player.injured || player.suspended {
            return Err(SquadError::PlayerUnavailable(player.id));
        }
        let a = player.attributes;
        if [a.pace, a.shooting, a.passing, a.defending, a.physical, a.goalkeeping,
            a.stamina, player.morale, player.fatigue].iter().any(|v| *v > 100) {
            return Err(SquadError::AttributeOutOfRange(player.id));
        }
        match player.position {
            Position::Goalkeeper => goalkeepers.push(player),
            Position::Defender => defenders.push(player),
            Position::Midfielder => midfielders.push(player),
            Position::Forward => forwards.push(player),
        }
    }

    if goalkeepers.len() != 1
        || defenders.len() != usize::from(lineup.formation.defenders)
        || midfielders.len() != usize::from(lineup.formation.midfielders)
        || forwards.len() != usize::from(lineup.formation.forwards)
    {
        return Err(SquadError::PositionCountMismatch);
    }

    let gk = goalkeepers[0].attributes;
    let attack = average(forwards.iter().map(|p| {
        weighted(p.attributes.shooting, p.attributes.pace, p.attributes.passing,
            p.attributes.physical, [40, 25, 20, 15])
    }));
    let midfield = average(midfielders.iter().map(|p| {
        weighted(p.attributes.passing, p.attributes.stamina, p.attributes.pace,
            p.attributes.defending, [40, 25, 20, 15])
    }));
    let defence = average(defenders.iter().map(|p| {
        weighted(p.attributes.defending, p.attributes.physical, p.attributes.pace,
            p.attributes.passing, [40, 25, 20, 15])
    }));
    let goalkeeper = weighted(gk.goalkeeping, gk.defending, gk.physical, gk.pace, [70, 15, 10, 5]);
    let morale = average(lineup.starters.iter().map(|p| p.morale));
    let fatigue = average(lineup.starters.iter().map(|p| p.fatigue));

    let tactical_attack = (u16::from(attack) * 3 + u16::from(lineup.tactics.attacking_intent)) / 4;
    let tactical_midfield = (u16::from(midfield) * 3 + u16::from(lineup.tactics.pressing)) / 4;
    Ok(TeamProfile {
        id: team_id,
        attack: tactical_attack.min(100) as u8,
        midfield: tactical_midfield.min(100) as u8,
        defence,
        goalkeeper,
        morale,
        fatigue,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(id: u128, position: Position) -> Player {
        Player {
            id: Uuid::from_u128(id),
            position,
            attributes: PlayerAttributes {
                pace: 70, shooting: 65, passing: 70, defending: 65,
                physical: 70, goalkeeping: 60, stamina: 75,
            },
            morale: 70, fatigue: 10, injured: false, suspended: false,
        }
    }

    fn lineup() -> Lineup {
        let mut starters = vec![player(1, Position::Goalkeeper)];
        starters.extend((2..=5).map(|id| player(id, Position::Defender)));
        starters.extend((6..=8).map(|id| player(id, Position::Midfielder)));
        starters.extend((9..=11).map(|id| player(id, Position::Forward)));
        Lineup { starters, formation: Formation::FOUR_THREE_THREE, tactics: TacticalPlan::default() }
    }

    #[test]
    fn valid_formation_produces_bounded_profile() {
        let profile = build_team_profile(Uuid::from_u128(99), &lineup()).unwrap();
        assert_eq!(profile.id, Uuid::from_u128(99));
        assert!((0..=100).contains(&profile.attack));
        assert!((0..=100).contains(&profile.defence));
        assert_eq!(profile.fatigue, 10);
    }

    #[test]
    fn injured_starter_is_rejected() {
        let mut team = lineup();
        team.starters[3].injured = true;
        assert!(matches!(build_team_profile(Uuid::from_u128(99), &team),
            Err(SquadError::PlayerUnavailable(_))));
    }

    #[test]
    fn invalid_tactics_are_rejected() {
        let mut team = lineup();
        team.tactics.pressing = 101;
        assert_eq!(build_team_profile(Uuid::from_u128(99), &team), Err(SquadError::InvalidTactics));
    }

    #[test]
    fn formation_position_mismatch_is_rejected() {
        let mut team = lineup();
        team.starters[10].position = Position::Midfielder;
        assert_eq!(build_team_profile(Uuid::from_u128(99), &team),
            Err(SquadError::PositionCountMismatch));
    }
}
